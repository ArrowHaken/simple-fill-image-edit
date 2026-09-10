from __future__ import annotations
import asyncio
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import unittest
import sys
import numpy as np
from PIL import Image
from starlette.datastructures import Headers, UploadFile
from fastapi import HTTPException
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import main, storage, workbench
from app.config import settings


class WorkbenchTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.old_data = settings.data_dir
        self.old_key = settings.masked_image2_api_key
        object.__setattr__(settings, 'data_dir', Path(self.temp.name))
        object.__setattr__(settings, 'masked_image2_api_key', 'local-test-only')
        self.project = storage.create_project('测试', 'source.png', 512, 512)
        Image.new('RGB', (512, 512), '#ddd9c9').save(storage.project_dir(self.project['id']) / 'source.png')
        self.mask = main.segment(self.project['id'], main.SegmentRequest(selection_mode='box', boxes=[main.Box(x_min=150,y_min=150,x_max=250,y_max=250)]))

    def tearDown(self):
        object.__setattr__(settings, 'data_dir', self.old_data)
        object.__setattr__(settings, 'masked_image2_api_key', self.old_key)
        self.temp.cleanup()

    def request(self, **kwargs):
        values = dict(operation='fill', mask_id=self.mask['id'], prompt='换成白色杯子', source_ref='source', growth_ratio=.08, request_id='test-operation')
        values.update(kwargs)
        return main.GenerateRequest(**values)

    def test_duplicate_click_and_concurrent_resend_create_one_task(self):
        request = self.request()
        with patch.object(main.executor, 'submit') as executor:
            with ThreadPoolExecutor(max_workers=6) as pool:
                tasks = list(pool.map(lambda _: main.generate(self.project['id'], request), range(8)))
        self.assertEqual(len({t['id'] for t in tasks}), 1)
        self.assertEqual(executor.call_count, 1)
        self.assertEqual(len(storage.read_project(self.project['id'])['tasks']), 1)

    def test_same_id_different_content_rejected(self):
        with patch.object(main.executor, 'submit'):
            main.generate(self.project['id'], self.request())
            with self.assertRaises(HTTPException) as caught:
                main.generate(self.project['id'], self.request(prompt='另一个请求'))
        self.assertEqual(caught.exception.status_code, 409)

    def test_capability_preflight_does_not_create_task(self):
        with patch.object(workbench, 'capabilities', return_value={'generation':False,'generation_reason':'未配置'}):
            with self.assertRaises(HTTPException):
                main.generate(self.project['id'], self.request())
        self.assertEqual(storage.read_project(self.project['id'])['tasks'], [])

    def test_complete_draft_roundtrip_and_clear_does_not_resurrect_mask(self):
        pid=self.project['id']
        value=main.save_edit_draft(pid,main.EditDraftRequest(target_mask_id=self.mask['id'],prompt='替换杯子',growth_ratio=.2,box=main.Box(x_min=150,y_min=150,x_max=250,y_max=250),expected_revision=0))
        self.assertEqual(value['revision'],1)
        cleared=main.save_edit_draft(pid,main.EditDraftRequest(prompt='替换杯子',growth_ratio=.2,expected_revision=1))
        p=storage.read_project(pid)
        self.assertEqual(p['edit_drafts']['source']['prompt'],'替换杯子')
        self.assertEqual(p['edit_drafts']['source']['growth_ratio'],.2)
        self.assertIsNone(p['active_mask_id'])
        self.assertIsNone(cleared['target_mask_id'])
        with self.assertRaises(HTTPException):
            main.save_edit_draft(pid,main.EditDraftRequest(expected_revision=1,prompt='stale writer'))

    def test_atomic_project_mutations_preserve_all_writers(self):
        pid=self.project['id']
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(lambda i:storage.update_project(pid,lambda p:p.setdefault('writes',[]).append(i)),range(40)))
        self.assertEqual(sorted(storage.read_project(pid)['writes']),list(range(40)))

    def test_preview_stale_parameters_rejected(self):
        request=self.request()
        preview=main.edit_preview(self.project['id'],request)
        request.preview_id=preview['id'];request.growth_ratio=.35
        with self.assertRaises(HTTPException) as caught:
            main.generate(self.project['id'],request)
        self.assertEqual(caught.exception.status_code,409)

    def test_cached_resume_does_not_call_provider_twice_and_matches_preview(self):
        pid=self.project['id'];request=self.request()
        preview=main.edit_preview(pid,request);request.preview_id=preview['id']
        with patch.object(main.executor,'submit'):
            task=main.generate(pid,request)
        def provider(source,mask,prompt,folder,progress):
            path=folder/'mock-generated.png';Image.new('RGB',(512,512),'#446688').save(path)
            return path, {'provider':'gpt-image-2-native-mask'}
        with patch.object(main,'run_masked_image2',side_effect=provider) as calls:
            with patch.object(main,'feathered_composite',side_effect=RuntimeError('本地合成模拟失败')):
                main._run_task(pid,task['id'])
            self.assertEqual(storage.read_task(pid,task['id'])['status'],'failed')
            with patch.object(main.executor,'submit'):
                resumed=main.resume(pid,task['id'])
            main._run_task(pid,task['id'])
            self.assertEqual(calls.call_count,1)
        self.assertTrue(resumed['resume_only'])
        finished=storage.read_task(pid,task['id'])
        self.assertEqual(finished['status'],'completed',finished.get('error'))
        actual=np.asarray(Image.open(storage.project_dir(pid)/'tasks'/task['id']/'commit-mask.png'))
        expected=np.asarray(Image.open(storage.project_dir(pid)/'previews'/f"{preview['id']}-commit.png"))
        self.assertTrue(np.array_equal(actual,expected))

    def test_uncertain_resume_never_submits_provider(self):
        with patch.object(main.executor,'submit'):
            task=main.generate(self.project['id'],self.request())
        storage.update_task(self.project['id'],task['id'],status='failed',error='unknown outcome')
        with patch.object(main.executor,'submit') as execute:
            with self.assertRaises(HTTPException): main.resume(self.project['id'],task['id'])
            execute.assert_not_called()

    def test_restart_marks_pending_tasks_interrupted_without_resubmitting(self):
        with patch.object(main.executor,'submit'):
            task=main.generate(self.project['id'],self.request())
        with patch.object(main.executor,'submit') as execute:
            workbench.mark_interrupted_tasks()
            execute.assert_not_called()
        self.assertEqual(storage.read_task(self.project['id'],task['id'])['status'],'interrupted')

    def test_transparent_upload_keeps_original_bytes_and_labels_working_copy(self):
        stream=BytesIO();Image.new('RGBA',(64,64),(255,0,0,0)).save(stream,format='PNG');raw=stream.getvalue()
        file=UploadFile(filename='透明.png',file=BytesIO(raw),headers=Headers({'content-type':'image/png'}))
        p=asyncio.run(main.create_project(name='',image=file))
        self.assertTrue(p['has_alpha'])
        folder=storage.project_dir(p['id'])
        self.assertEqual((folder/p['original_file']).read_bytes(),raw)
        with Image.open(folder/'source.png') as working:self.assertEqual(working.getpixel((0,0)),(255,255,255))

    def test_browser_derivatives_are_small_cached_and_keep_canvas_dimensions(self):
        pid = self.project['id']
        project = storage.read_project(pid)
        display = main._browser_image(project, 'source', 'display')
        thumbnail = main._browser_image(project, 'source', 'thumbnail')
        display_mtime = display.stat().st_mtime_ns
        with Image.open(display) as image:
            self.assertEqual(image.size, (512, 512))
        with Image.open(thumbnail) as image:
            self.assertLessEqual(max(image.size), 240)
        self.assertEqual(main._browser_image(project, 'source', 'display').stat().st_mtime_ns, display_mtime)
        public = storage.public_project(project)
        self.assertIn('/browser-image/source/display', public['source_display_url'])
        self.assertIn('/browser-image/source/thumbnail', public['source_thumbnail_url'])


if __name__=='__main__': unittest.main()
