from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image
from fastapi import HTTPException
from app import storage, workbench, main
from app.config import settings


class DeletionTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.old_data = settings.data_dir
        object.__setattr__(settings, 'data_dir', Path(self.temp.name))
        self.p = storage.create_project('删除测试', 'test.png', 64, 64)
        self.pid = self.p['id']
        folder = storage.project_dir(self.pid)
        Image.new('RGB', (64,64), 'white').save(folder/'source.png')
        self.p['versions'] = [dict(id='v2',filename='v2.png',source_ref='v1'),dict(id='v1',filename='v1.png',source_ref='source')]
        for v in self.p['versions']:
            Image.new('RGB', (64,64), 'green').save(folder/'versions'/v['filename'])
        self.p['masks'] = [dict(id='m1',source_ref='v1'),dict(id='m2',source_ref='v2')]
        self.p['edit_drafts'] = {'v1':dict(source_ref='v1',prompt='旧版本草稿'), 'v2':dict(source_ref='v2',prompt='保留草稿')}
        self.p['edit_draft'] = self.p['edit_drafts']['v1']
        self.p['active_source_ref'] = 'v1'
        self.p['active_mask_id'] = 'm1'
        storage.write_project(self.p)

    def tearDown(self):
        object.__setattr__(settings, 'data_dir', self.old_data)
        self.temp.cleanup()

    def test_delete_version_preserves_descendant_and_comparison(self):
        result = workbench.delete_version(self.pid, 'v1')
        self.assertEqual([v['id'] for v in result['versions']], ['v2'])
        self.assertEqual(result['versions'][0]['number'], 2)
        self.assertTrue(result['versions'][0]['base_url'].endswith('/v1.png'))
        self.assertTrue((storage.project_dir(self.pid)/'versions/v1.png').is_file())
        self.assertEqual(result['active_source_ref'], 'source')
        self.assertNotIn('v1',result['edit_drafts'])
        self.assertEqual(result['edit_drafts']['v2']['prompt'],'保留草稿')
        self.assertEqual([m['id'] for m in result['masks']],['m2'])
        self.assertIsNone(result['active_mask_id'])
        with self.assertRaises(FileNotFoundError): main._resolve_source(storage.read_project(self.pid), 'v1')

    def test_late_write_cannot_resurrect_version(self):
        stale = storage.read_project(self.pid)
        workbench.delete_version(self.pid, 'v1')
        storage.write_project(stale)
        self.assertEqual([v['id'] for v in storage.read_project(self.pid)['versions']],['v2'])

    def test_delete_project_hidden_and_late_save_rejected(self):
        stale = storage.read_project(self.pid)
        workbench.delete_project(self.pid)
        self.assertEqual(storage.list_projects(), [])
        with self.assertRaises(FileNotFoundError): storage.read_project(self.pid)
        with self.assertRaises(FileNotFoundError): storage.write_project(stale)
        self.assertTrue((storage.project_dir(self.pid)/'source.png').is_file())

    def test_running_task_blocks_both_deletions(self):
        storage.create_task(self.pid,'fill','test','m1',6)
        for action in [lambda:workbench.delete_project(self.pid),lambda:workbench.delete_version(self.pid,'v1')]:
            with self.assertRaises(HTTPException) as caught: action()
            self.assertEqual(caught.exception.status_code,409)
        self.assertEqual(len(storage.read_project(self.pid)['versions']),2)

    def test_original_not_independently_deletable_and_missing_version_404(self):
        for ref,status in [('source',400),('missing',404)]:
            with self.assertRaises(HTTPException) as caught: workbench.delete_version(self.pid,ref)
            self.assertEqual(caught.exception.status_code,status)

    def test_task_links_flag_deleted_sources_and_results(self):
        task=storage.create_task(self.pid,'fill','test','m1',6)
        storage.update_task(self.pid,task['id'],status='completed',source_ref='v1',version_id='v1')
        result=workbench.delete_version(self.pid,'v1')
        self.assertTrue(result['tasks'][0]['source_deleted'])
        self.assertTrue(result['tasks'][0]['result_deleted'])
        self.assertFalse(result['tasks'][0]['can_resume'])

    def test_project_path_stays_in_data_directory(self):
        with self.assertRaises(HTTPException) as caught: workbench.delete_project('..\\outside')
        self.assertEqual(caught.exception.status_code,404)


if __name__ == '__main__': unittest.main()
