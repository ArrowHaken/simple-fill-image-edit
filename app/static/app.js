import {drawSelection} from './selection-renderer.js?v=34';
import {setupRangePicker} from './range-picker.js?v=23';
import {api, post, media, escapeHtml as esc} from './api.js';
import {DraftStore} from './draft-store.js?v=28';
import {TaskController, isTerminal} from './task-controller.js?v=28';
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const syncRangePicker = setupRangePicker();
const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
const state = {project:null, source:'source', draft:null, image:null, overlay:null, preview:null, previewPending:false, capabilities:null,
  epoch:0, selectionSeq:0, previewSeq:0, selecting:false, submitting:false, uploading:false, opening:false,
  mode:'single', overlayVisible:true, zoom:1, fitted:true, pointLabel:1, projects:[], tasks:new Map(), drawerTab:'projects'};
let previewTimer, toastTimer, drag=null, promptUndo=null;
function saveStatus(text){$('#saveStatus').textContent=text;$('#saveStatus').classList.toggle('sr-only',text==='已保存');}
const draftStore = new DraftStore((key,text) => {if(state.project && key === draftStore.key(state.project.id,state.source)) saveStatus(text);});
const context = () => ({epoch:state.epoch,pid:state.project?.id,source:state.source});
const current = ctx => ctx.epoch===state.epoch && ctx.pid===state.project?.id && ctx.source===state.source;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4200);}
function errorAt(id,text=''){ $(id).textContent=text;show(id,!!text); }
function defaults(source){return {source_ref:source,target_mask_id:null,protected_mask_ids:[],prompt:'',segment_prompt:'',selection_mode:'box',points:[],box:null,growth_ratio:.08,revision:0};}
function saveDraft(){if(state.project&&state.draft) draftStore.update(state.project.id,state.source,state.draft);}
function imageAt(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('图片加载失败，请重试打开该项目。'));image.src=media(url);});}
function sourceUrl(ref=state.source){return ref==='source'?state.project.source_url:state.project.versions.find(v=>v.id===ref)?.url;}
function versionName(ref){if(ref==='source')return '原始素材';const i=state.project.versions.findIndex(v=>v.id===ref);return `版本 ${state.project.versions[i]?.number||state.project.versions.length-i}`;}
function payload(){return {operation:'fill',mask_id:state.draft.target_mask_id,prompt:state.draft.prompt.trim(),dilation:6,feather:3,protected_mask_ids:[],result_object_prompt:'',pipeline_mode:'simple_fill',cleanup_radius:10,semantic_edge:6,growth_ratio:Number(state.draft.growth_ratio),source_ref:state.source};}
function matchingTask(){const d=state.draft;return d&&state.project?.tasks.find(t=>!isTerminal(t)&&t.mask_id===d.target_mask_id&&t.prompt===d.prompt.trim()&&Number(t.growth_ratio)===Number(d.growth_ratio));}
function ready(){return !!(state.project&&state.image&&!state.opening&&state.draft?.target_mask_id&&state.preview&&!state.previewPending&&!state.selecting&&!state.submitting&&!matchingTask()&&state.capabilities?.generation&&state.draft.prompt.trim());}
function renderControls(){
 const d=state.draft,p=state.project;
 $('#deleteProject').disabled=!p||state.opening||state.submitting||state.selecting;
 show('#deleteProject',!!p);
 $('#generateButton').disabled=!ready();$('#segmentButton').disabled=state.selecting||!state.capabilities?.semantic_selection||state.opening;
 $('#generateButton').innerHTML=state.submitting?'正在提交…':matchingTask()?'相同修改正在生成…':'生成修改 <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>';
 const hasSelection=!!(state.image&&!state.opening&&(state.preview||d?.box||d?.points.length));
 const selectionShown=hasSelection&&state.overlayVisible&&state.mode==='single';
 $('#toggleOverlay').disabled=!hasSelection||state.mode==='compare';
 $('#toggleOverlay').setAttribute('aria-pressed',String(selectionShown));
 $('#toggleOverlay').textContent=selectionShown?'隐藏选区':'显示选区';
 $('#toggleOverlay').title=selectionShown?'隐藏选区':'显示选区';
 const canCompare=!!(p&&state.source!=='source');$('#compareButton').disabled=!canCompare;$('#compareButton').setAttribute('aria-pressed',String(state.mode==='compare'));
 show('#compareButton',!!p?.versions.length);
 $('#compareButton').textContent=state.mode==='compare'?'返回单图':'对比';
 ['#zoomOut','#zoomIn','#fitCanvas'].forEach(id=>$(id).disabled=!state.image||state.mode==='compare');
 $('#openEditor').disabled=!p;$('#exportCurrent').disabled=!p||state.opening||!state.image;$('#renameProject').disabled=!p;
 show('#coordinateButton',!!p&&d?.selection_mode==='box');
 if(!p) return;
 renderPromptTools();
 $$('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===d.selection_mode)));
 show('#pointOptions',d.selection_mode==='point');show('#targetField',d.selection_mode==='text');show('#segmentButton',d.selection_mode!=='box');
 show('#selectionHint',d.selection_mode!=='box');
 $('#selectionHint').textContent=d.selection_mode==='box'?'':!state.capabilities?.semantic_selection?'智能选区尚未配置，可切换为框选。':d.selection_mode==='point'?'点击对象添加目标点；按住 Shift 可排除误选。':'输入一个对象名称，再点击识别对象。';
 $('#segmentButton').textContent=state.selecting?'正在识别…':'识别对象';
 $('#maskSummary').classList.toggle('ready',!!state.preview);
 $('#maskSummary').textContent=state.selecting?'正在更新选区…':state.preview?'已选择':d.target_mask_id?'正在确认选区…':d.box||d.points.length?'选区待确认':'尚未选择区域';
 $('#generationAvailability').textContent=!state.capabilities?.generation?'生成服务未配置':state.submitting?'正在提交…':matchingTask()?'相同修改正在生成':!d.target_mask_id?'请选择修改区域':!d.prompt.trim()?'请填写修改要求':state.previewPending||!state.preview?'正在更新范围…':'';
 show('#generationAvailability',!!$('#generationAvailability').textContent);
}
function restoreInputs(){const d=state.draft;$('#generationPrompt').value=d.prompt;$('#segmentPrompt').value=d.segment_prompt;const option=[...$('#growthMode').options].find(o=>Number(o.value)===Number(d.growth_ratio));$('#growthMode').value=option?.value||'0.08';if(!option)d.growth_ratio=.08;syncRangePicker();}
async function openProject(pid, requestedSource){
 const epoch=++state.epoch;state.opening=true;state.selectionSeq++;state.previewSeq++;clearTimeout(previewTimer);drag=null;promptUndo=null;state.previewPending=false;
 await draftStore.flushAll(); if(epoch!==state.epoch)return;
 $('#editFields').inert=true;show('#imageLoading',true);renderControls();
 try {
  const project=await api(`/api/projects/${pid}`);if(epoch!==state.epoch)return;
  state.project=project;state.source=requestedSource||project.active_source_ref||'source';
  if(state.source!=='source'&&!project.versions.some(v=>v.id===state.source))state.source='source';
  const remote=project.edit_drafts?.[state.source]||(project.edit_draft?.source_ref===state.source?project.edit_draft:null);
  state.draft=draftStore.restore(pid,state.source,{...defaults(state.source),...remote});
  if(state.draft.target_mask_id&&!project.masks.some(m=>m.id===state.draft.target_mask_id&&m.source_ref===state.source))state.draft.target_mask_id=null;
  state.preview=null;state.overlay=null;state.image=null;state.selecting=false;state.mode='single';state.overlayVisible=true;state.fitted=true;
  show('#compareView',false);show('#emptyState',false);show('#stageCanvas',false);show('#editorIntro',false);show('#editFields',true);show('#filmstrip',true);
  show('#alphaNotice',!!project.has_alpha);restoreInputs();$('#renameProject').textContent=project.name;saveStatus(draftStore.entries.get(draftStore.key(pid,state.source))?.dirty?'本机草稿待同步':'已保存');
  ['#selectionError','#promptError','#generationError'].forEach(id=>errorAt(id));
  for(const task of project.tasks){state.tasks.set(`${pid}:${task.id}`,task);monitor.watch(pid,task);}
  renderVersions();renderTasks();syncProgress();
  const ctx=context(),image=await imageAt(sourceUrl());if(!current(ctx))return;
  state.image=image;$('#stageCanvas').width=image.naturalWidth;$('#stageCanvas').height=image.naturalHeight;
  $('#sourceLabel').textContent=versionName(state.source);$('#imageSize').textContent=`${image.naturalWidth} × ${image.naturalHeight}`;
  show('#stageCanvas',true);draw();fitCanvas();
  const url=new URL(location.href);url.searchParams.set('project',pid);url.searchParams.set('version',state.source);history.replaceState(null,'',url);
  try{localStorage.setItem('catsco-v15:lastProject',JSON.stringify({pid,source:state.source}));}catch{}
  if(state.draft.target_mask_id) await refreshPreview();
  else if(state.draft.box&&state.draft.selection_mode==='box') await resolveSelection();
  draftStore.flush(draftStore.key(pid,state.source));
 }catch(error){toast(error.message);errorAt('#generationError',error.message);}
 finally{if(epoch===state.epoch){state.opening=false;$('#editFields').inert=false;show('#imageLoading',false);renderControls();}}
}
function draw(){
 if(!state.image)return;const canvas=$('#stageCanvas'),ctx=canvas.getContext('2d');
 ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(state.image,0,0);
 drawSelection(ctx,{draft:state.draft,preview:state.preview,visible:state.overlayVisible,zoom:state.zoom});
}
function applyZoom(value,fitted=false){if(!state.image)return;state.zoom=Math.max(.01,Math.min(8,value));state.fitted=fitted;const c=$('#stageCanvas');c.style.width=`${Math.round(state.image.naturalWidth*state.zoom)}px`;c.style.height=`${Math.round(state.image.naturalHeight*state.zoom)}px`;$('#fitCanvas').textContent=fitted?'适合':`${Math.round(state.zoom*100)}%`;draw();}
function fitCanvas(){if(!state.image||state.mode==='compare')return;const s=$('#stage');applyZoom(Math.min(1,Math.max(1,s.clientWidth-36)/state.image.naturalWidth,Math.max(1,s.clientHeight-36)/state.image.naturalHeight),true);}
new ResizeObserver(()=>{if(state.fitted)fitCanvas();}).observe($('#stage'));
function invalidateSelection(){state.overlayVisible=true;state.selectionSeq++;state.previewSeq++;state.previewPending=false;state.selecting=false;state.draft.target_mask_id=null;state.preview=null;state.overlay=null;clearTimeout(previewTimer);errorAt('#selectionError');errorAt('#generationError');saveDraft();renderControls();draw();}
function schedulePreview(){state.previewSeq++;state.previewPending=!!state.draft?.target_mask_id;clearTimeout(previewTimer);renderControls();if(state.draft?.target_mask_id)previewTimer=setTimeout(refreshPreview,350);}
async function refreshPreview(){
 if(!state.draft?.target_mask_id)return;
 const ctx=context(),seq=++state.previewSeq;state.previewPending=true;renderControls();
 try{const value=await post(`/api/projects/${ctx.pid}/edit-preview`,payload());if(!current(ctx)||seq!==state.previewSeq)return;state.preview=value;state.previewPending=false;errorAt('#selectionError');draw();}
 catch(error){if(current(ctx)&&seq===state.previewSeq){state.preview=null;state.previewPending=false;errorAt('#selectionError',error.message);draw();}}
 finally{if(current(ctx)&&seq===state.previewSeq)renderControls();}
}
async function resolveSelection(){
 if(!state.project||!state.draft)return;const d=state.draft;
 if(d.selection_mode==='box'&&!d.box)return;
 if(d.selection_mode!=='box'&&!state.capabilities?.semantic_selection){errorAt('#selectionError','智能选区尚未配置，请使用框选。');return;}
 if(d.selection_mode==='point'&&!d.points.length){errorAt('#selectionError','请先点击图片中的对象。');return;}
 if(d.selection_mode==='text'&&!d.segment_prompt.trim()){errorAt('#selectionError','请输入要选择的对象名称。');$('#segmentPrompt').focus();return;}
 const ctx=context(),seq=++state.selectionSeq;state.selecting=true;renderControls();
 const body={points:d.selection_mode==='point'?structuredClone(d.points):[],boxes:d.selection_mode==='box'?[structuredClone(d.box)]:[],prompt:d.selection_mode==='text'?d.segment_prompt.trim():'',source_ref:state.source,selection_mode:d.selection_mode==='box'?'box':'point'};
 try{const mask=await post(`/api/projects/${ctx.pid}/segment`,body);if(!current(ctx)||seq!==state.selectionSeq)return;state.draft.target_mask_id=mask.id;state.project.masks.unshift(mask);saveDraft();await refreshPreview();}
 catch(error){if(current(ctx)&&seq===state.selectionSeq)errorAt('#selectionError',error.message);}
 finally{if(current(ctx)&&seq===state.selectionSeq){state.selecting=false;renderControls();}}
}
function point(event){const c=$('#stageCanvas'),r=c.getBoundingClientRect();return{x:Math.max(0,Math.min(c.width-1,Math.round((event.clientX-r.left)*c.width/r.width))),y:Math.max(0,Math.min(c.height-1,Math.round((event.clientY-r.top)*c.height/r.height)))};}
const boxBetween=(a,b)=>({x_min:Math.min(a.x,b.x),y_min:Math.min(a.y,b.y),x_max:Math.max(a.x,b.x),y_max:Math.max(a.y,b.y)});
let spaceDown=false;
$('#stageCanvas').addEventListener('pointerdown',event=>{
 if(!state.image||state.opening||state.mode!=='single'||event.button!==0)return;
 $('#stage').focus({preventScroll:true});
 const s=$('#stage');
 if(spaceDown){drag={pan:true,x:event.clientX,y:event.clientY,left:s.scrollLeft,top:s.scrollTop};event.currentTarget.setPointerCapture(event.pointerId);return;}
 if(state.draft.selection_mode==='text')return;
 if(state.draft.selection_mode==='point'){invalidateSelection();state.draft.points.push({...point(event),label:event.shiftKey?0:state.pointLabel});saveDraft();draw();renderControls();return;}
 invalidateSelection();drag={start:point(event)};state.draft.box=boxBetween(drag.start,drag.start);event.currentTarget.setPointerCapture(event.pointerId);draw();
});
$('#stageCanvas').addEventListener('pointermove',event=>{if(!drag)return;if(drag.pan){$('#stage').scrollLeft=drag.left-(event.clientX-drag.x);$('#stage').scrollTop=drag.top-(event.clientY-drag.y);return;}state.draft.box=boxBetween(drag.start,point(event));draw();});
$('#stageCanvas').addEventListener('pointerup',event=>{if(!drag)return;if(drag.pan){drag=null;return;}state.draft.box=boxBetween(drag.start,point(event));drag=null;const b=state.draft.box;if(b.x_max-b.x_min<4||b.y_max-b.y_min<4)state.draft.box=null;saveDraft();draw();resolveSelection();});
function cancelDrag(){if(drag&&!drag.pan){state.draft.box=null;invalidateSelection();}drag=null;}
$('#stageCanvas').addEventListener('pointercancel',cancelDrag);$('#stageCanvas').addEventListener('lostpointercapture',()=>{if(drag)cancelDrag();});
window.addEventListener('keydown',event=>{if(/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.code==='Space'&&document.activeElement===$('#stage')){spaceDown=true;event.preventDefault();}if(event.key==='Escape'){cancelDrag();$('#workspace').classList.remove('editor-open');}});
window.addEventListener('keyup',event=>{if(event.code==='Space')spaceDown=false;});window.addEventListener('blur',()=>{spaceDown=false;cancelDrag();});
$$('[data-mode]').forEach(button=>button.onclick=()=>{if(!state.draft)return;state.draft.selection_mode=button.dataset.mode;state.draft.box=null;state.draft.points=[];invalidateSelection();});
$$('[data-point]').forEach(button=>button.onclick=()=>{state.pointLabel=Number(button.dataset.point);$$('[data-point]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));});
$('#segmentButton').onclick=resolveSelection;
$('#segmentPrompt').oninput=event=>{state.draft.segment_prompt=event.target.value;invalidateSelection();};
$('#generationPrompt').oninput=event=>{promptUndo=null;state.draft.prompt=event.target.value;errorAt('#promptError');errorAt('#generationError');saveDraft();schedulePreview();};
$('#growthMode').onchange=event=>{state.draft.growth_ratio=Number(event.target.value);saveDraft();schedulePreview();};
const examples={'替换对象':'把选中对象替换成白色陶瓷杯，保持其他内容不变。','移除内容':'把选中对象去掉','修改文字':'将选中的文字改为“秋季上新”，保持原有排版和字体风格。'};
function renderPromptTools(){
 $$('[data-example]').forEach(button=>button.setAttribute('aria-pressed',String(state.draft?.prompt===examples[button.dataset.example])));
 show('#undoPrompt',!!promptUndo&&current(promptUndo.ctx));
}
function setPrompt(text){state.draft.prompt=text;$('#generationPrompt').value=text;errorAt('#promptError');errorAt('#generationError');saveDraft();schedulePreview();$('#generationPrompt').focus({preventScroll:true});}
$$('[data-example]').forEach(button=>button.onclick=()=>{
 if(!state.draft||state.opening)return;
 const text=examples[button.dataset.example],input=$('#generationPrompt');
 if(state.draft.prompt!==text){promptUndo={ctx:context(),text:state.draft.prompt,start:input.selectionStart,end:input.selectionEnd};setPrompt(text);}
 const editable=button.dataset.example==='替换对象'?'白色陶瓷杯':button.dataset.example==='修改文字'?'秋季上新':null;
 input.focus({preventScroll:true});const start=editable?text.indexOf(editable):text.length;input.setSelectionRange(start,editable?start+editable.length:start);
});
$('#undoPrompt').onclick=()=>{if(!promptUndo||!current(promptUndo.ctx))return;const previous=promptUndo;promptUndo=null;setPrompt(previous.text);$('#generationPrompt').setSelectionRange(previous.start,previous.end);};
async function upload(file){
 if(!file||state.uploading)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){toast('请选择PNG、JPG或WEBP图片。');return;}if(file.size>200*1024*1024){toast('图片超过200 MiB，请先缩小文件。');return;}
 state.uploading=true;['#uploadButton','#sideUpload','#newProject'].forEach(id=>$(id).disabled=true);show('#imageLoading',true);$('#imageLoading').textContent='正在上传并保存原文件…';
 try{const body=new FormData();body.append('image',file);body.append('name',file.name.replace(/\.[^.]+$/,''));const project=await api('/api/projects',{method:'POST',body});await openProject(project.id);await loadProjects();toast(project.has_alpha?'透明原文件已保存，编辑使用白底副本。':'图片已保存');}
 catch(error){toast(error.message);errorAt('#generationError',error.message);}
 finally{state.uploading=false;['#uploadButton','#sideUpload','#newProject'].forEach(id=>$(id).disabled=false);show('#imageLoading',false);$('#imageLoading').textContent='正在载入图片…';$('#fileInput').value='';}
}
['#uploadButton','#sideUpload','#newProject'].forEach(id=>$(id).onclick=()=>$('#fileInput').click());$('#fileInput').onchange=event=>upload(event.target.files[0]);
$('#stage').addEventListener('dragover',event=>{event.preventDefault();$('#stage').classList.add('drag-over');});$('#stage').addEventListener('dragleave',()=>$('#stage').classList.remove('drag-over'));$('#stage').addEventListener('drop',event=>{event.preventDefault();$('#stage').classList.remove('drag-over');upload(event.dataTransfer.files[0]);});
$('#openEditor').onclick=()=>{$('#workspace').classList.add('editor-open');$('#closeEditor').focus();};$('#closeEditor').onclick=()=>{$('#workspace').classList.remove('editor-open');$('#stage').focus();};
$('#toggleOverlay').onclick=()=>{state.overlayVisible=!state.overlayVisible;draw();renderControls();};
$('#zoomIn').onclick=()=>applyZoom(state.zoom*1.25);$('#zoomOut').onclick=()=>applyZoom(state.zoom/1.25);$('#fitCanvas').onclick=fitCanvas;
$('#compareButton').onclick=()=>{if(state.mode==='compare'){state.mode='single';show('#compareView',false);show('#stageCanvas',true);}else{const v=state.project.versions.find(v=>v.id===state.source);if(!v)return;state.mode='compare';$('#compareOriginal').src=media(v.base_url||sourceUrl(v.source_ref||'source'));$('#compareResult').src=media(v.url);show('#compareView',true);show('#stageCanvas',false);}renderControls();};
const trashIcon = '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg>';
function renderVersions(){
 if(!state.project)return;const p=state.project;$('#versionCount').textContent=`${p.versions.length} 个结果`;
 const items=[{id:'source',url:p.source_url},...p.versions.slice().reverse()];
 $('#versionList').innerHTML=items.map(v=>`<div class="version-item"><button class="version-card" data-version="${esc(v.id)}" aria-current="${v.id===state.source}"><img src="${esc(media(v.url))}" width="56" height="48" alt="" loading="lazy"><span>${esc(versionName(v.id))}<small>${v.id==='source'?'原图':esc((v.prompt||'局部修改').slice(0,20))}</small></span></button><button class="version-delete delete-icon" data-delete-version="${esc(v.id)}" aria-label="${v.id==='source'?'删除素材及全部版本':`删除${esc(versionName(v.id))}`}" title="${v.id==='source'?'删除素材及全部版本':'删除此版本'}">${trashIcon}</button></div>`).join('');
 $$('[data-version]').forEach(button=>button.onclick=()=>openProject(p.id,button.dataset.version));
 $$('[data-delete-version]').forEach(button=>button.onclick=()=>requestDelete(button.dataset.deleteVersion));
}
let deletion = null, deleting = false;
function requestDelete(ref='source'){
 if(!state.project||state.opening||state.selecting||state.submitting)return;
 deletion={ctx:context(),ref};
 $('#deleteTitle').textContent=ref==='source'?'删除这份素材？':'删除这个版本？';
 $('#deleteThumbnail').src=media(sourceUrl(ref));
 $('#deleteName').textContent=state.project.name;
 $('#deleteMeta').textContent=ref==='source'?`${state.project.versions.length} 个结果 · ${state.project.tasks.length} 条任务记录`:versionName(ref);
 $('#deleteDescription').textContent=ref==='source'?'素材及其全部版本、任务记录将从工作台移除。':`仅移除此版本，其他结果保留。${state.source===ref?'画布将返回原图。':''}`;
 $('#deleteNote').textContent=ref==='source'?'本机素材文件会保留。':'后续版本对比所需的底图会保留。';
 $('#confirmDelete').textContent=ref==='source'?'删除素材':'删除版本';
 errorAt('#deleteError');$('#deleteDialog').showModal();$('#cancelDelete').focus();
}
$('#deleteProject').onclick=()=>requestDelete();
$('#deleteDialog').addEventListener('cancel',event=>{if(deleting)event.preventDefault();});
function clearProject(){
 state.epoch++;state.selectionSeq++;state.previewSeq++;clearTimeout(previewTimer);drag=null;promptUndo=null;
 Object.assign(state,{project:null,draft:null,image:null,overlay:null,preview:null,previewPending:false,opening:false,selecting:false,mode:'single',source:'source'});
 ['#stageCanvas','#compareView','#editFields','#filmstrip','#taskProgress','#imageLoading','#alphaNotice'].forEach(id=>show(id,false));
 show('#emptyState',true);show('#editorIntro',true);$('#workspace').classList.remove('editor-open');
 $('#renameProject').textContent='图片预览';$('#sourceLabel').textContent='画布';$('#imageSize').textContent='';$('#versionList').replaceChildren();
 $('#generationPrompt').value='';$('#segmentPrompt').value='';$('#rangeSettings').open=false;
 ['#selectionError','#promptError','#generationError'].forEach(id=>errorAt(id));saveStatus('已保存');
 $('#generationAvailability').textContent='上传图片后开始编辑';show('#generationAvailability',true);
 const url=new URL(location.href);url.searchParams.delete('project');url.searchParams.delete('version');history.replaceState(null,'',url);
 try{localStorage.removeItem('catsco-v15:lastProject');}catch{}
 renderControls();renderTasks();syncProgress();
}
$('#confirmDelete').onclick=async()=>{
 if(deleting||!deletion||!current(deletion.ctx))return;
 const {ctx,ref}=deletion;deleting=true;$('#confirmDelete').disabled=true;$('#cancelDelete').disabled=true;$('#confirmDelete').textContent='正在删除…';
 try{
  await draftStore.flushAll();
  const result=await api(`/api/projects/${ctx.pid}${ref==='source'?'':`/versions/${ref}`}`,{method:'DELETE'});
  draftStore.forget(ctx.pid,ref==='source'?undefined:ref);
  if(ref==='source'){
   monitor.stopProject(ctx.pid);for(const key of state.tasks.keys())if(key.startsWith(`${ctx.pid}:`))state.tasks.delete(key);
   if(current(ctx))clearProject();
  }else if(current(ctx)){
   if(state.source===ref)await openProject(ctx.pid,'source');
   else{state.project=result;renderVersions();renderTasks();renderControls();}
  }
  $('#deleteDialog').close();deletion=null;await loadProjects();toast(ref==='source'?'素材已删除':'版本已删除');
 }catch(error){errorAt('#deleteError',error.message);}
 finally{deleting=false;$('#confirmDelete').disabled=false;$('#cancelDelete').disabled=false;$('#confirmDelete').textContent=ref==='source'?'删除素材':'删除版本';}
};
async function loadProjects(){try{state.projects=await api('/api/projects');renderProjects();}catch(error){$('#projectList').textContent=error.message;}}
function renderProjects(){const query=$('#projectSearch').value.trim().toLowerCase(),items=state.projects.filter(p=>p.name.toLowerCase().includes(query));$('#projectList').innerHTML=items.length?items.map(p=>`<button class="project-card" data-project="${esc(p.id)}" aria-current="${state.project?.id===p.id}"><img src="${esc(media(p.thumbnail_url))}" width="55" height="55" loading="lazy" alt=""><span><b>${esc(p.name)}</b><small>${p.width} × ${p.height} · ${p.versions} 个结果</small></span></button>`).join(''):`<p class="helper">${query?'没有匹配的项目，试试其他名称。':'还没有项目。上传一张图片即可开始。'}</p>`;$$('[data-project]').forEach(button=>button.onclick=()=>{$('#libraryDialog').close();openProject(button.dataset.project);});}
$('#projectSearch').oninput=renderProjects;
function openDrawer(tab){state.drawerTab=tab;show('#projectsPane',tab==='projects');show('#tasksPane',tab==='tasks');$('#projectsTab').setAttribute('aria-pressed',String(tab==='projects'));$('#tasksTab').setAttribute('aria-pressed',String(tab==='tasks'));$('#libraryTitle').textContent=tab==='projects'?'项目':'任务记录';if(!$('#libraryDialog').open)$('#libraryDialog').showModal();if(tab==='projects')loadProjects();else renderTasks();}
$('#openProjects').onclick=()=>openDrawer('projects');$('#projectsTab').onclick=()=>openDrawer('projects');$('#tasksTab').onclick=()=>openDrawer('tasks');$('#viewRunningTask').onclick=()=>openDrawer('tasks');
$('#openCanvasTools').onclick=()=>{$('#imageInfo').textContent=state.image?`${versionName(state.source)} · ${state.image.naturalWidth} × ${state.image.naturalHeight}`:'尚未上传图片';$('#canvasToolsDialog').showModal();};
$$('[data-close]').forEach(button=>button.onclick=()=>$('#'+button.dataset.close).close());
const statusName={created:'等待执行',generating:'生成中',completed:'已完成',failed:'未完成',interrupted:'执行中断'};
function renderTasks(){
 if(!state.project){$('#taskList').innerHTML='<p class="helper">打开项目后可查看它的任务记录。</p>';return;}
 const pid=state.project.id,tasks=state.project.tasks;
 $('#taskList').innerHTML=tasks.length?tasks.map(t=>`<article class="task-card"><header><b class="status-${esc(t.status)}">${statusName[t.status]||'处理中'}</b><time>${esc(new Date(t.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}))}</time></header><p>${esc(t.prompt||'局部修改')}</p>${t.error?`<p class="inline-error">${esc(t.error)}</p>`:`<p class="helper">${esc(t.stage)}</p>`}<footer>${t.version_id&&!t.result_deleted?`<button data-result="${esc(t.version_id)}">查看结果</button>`:''}${t.can_resume?`<button data-resume="${esc(t.id)}">继续处理已有图片</button>`:''}${isTerminal(t)&&!t.source_deleted?`<button data-copy-task="${esc(t.id)}">使用这些要求</button>`:''}</footer><details><summary>运行详情</summary><p>任务 ${esc(t.id)}\n${esc(t.stage)}${t.can_resume?'\n已有图片可继续处理，不会重新提交生成。':''}</p></details></article>`).join(''):'<p class="helper">还没有生成任务。选择区域并填写修改要求后开始。</p>';
 $$('[data-result]').forEach(button=>button.onclick=()=>{$('#libraryDialog').close();openProject(pid,button.dataset.result);});
 $$('[data-resume]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const t=await post(`/api/projects/${pid}/tasks/${button.dataset.resume}/resume`,{});putTask(pid,t);monitor.watch(pid,t);toast('正在继续处理已有图片。');}catch(error){toast(error.message);}finally{button.disabled=false;}});
 $$('[data-copy-task]').forEach(button=>button.onclick=async()=>{const t=tasks.find(t=>t.id===button.dataset.copyTask);await openProject(pid,t.source_ref||'source');state.draft.prompt=t.prompt;state.draft.growth_ratio=t.growth_ratio??.08;state.draft.target_mask_id=t.mask_id;restoreInputs();saveDraft();await refreshPreview();$('#libraryDialog').close();$('#workspace').classList.add('editor-open');toast('已载入原修改要求；点击生成会创建一个新结果。');});
}
function putTask(pid,task){state.tasks.set(`${pid}:${task.id}`,task);if(state.project?.id!==pid)return;const index=state.project.tasks.findIndex(t=>t.id===task.id);if(index<0)state.project.tasks.unshift(task);else state.project.tasks[index]=task;renderTasks();syncProgress();renderControls();}
function syncProgress(){const active=state.project?.tasks.filter(t=>!isTerminal(t))||[];$('#taskCount').textContent=active.length;show('#taskCount',active.length>0);show('#taskProgress',active.length>0);if(active.length){const t=active[0];$('#taskStage').textContent=t.stage||'等待执行';const seconds=Math.max(0,Math.floor((Date.now()-new Date(t.created_at))/1000));$('#taskElapsed').textContent=`已等待 ${Math.floor(seconds/60)}分${seconds%60}秒`;}}
const monitor=new TaskController(async(pid,task)=>{
 const previous=state.tasks.get(`${pid}:${task.id}`);
 const justCompleted=task.status==='completed'&&!isTerminal(previous||{status:'created'});
 const shouldReveal=justCompleted&&task.version_id&&state.project?.id===pid&&state.source===(task.source_ref||'source');
 putTask(pid,task);
 if(isTerminal(task)){
  if(shouldReveal){
   await openProject(pid,task.version_id);
   toast(state.project?.id===pid&&state.source===task.version_id?'生成完成，已自动展示新结果。':'生成完成，新结果已保存在版本栏。');
  }else if(state.project?.id===pid){
   const ctx=context(),project=await api(`/api/projects/${pid}`);
   if(current(ctx)){
    state.project=project;renderVersions();renderTasks();syncProgress();renderControls();
    if(justCompleted)toast('生成完成，新结果已保存在版本栏。');
   }
  }
  loadProjects();
 }
},(pid,error)=>{if(state.project?.id===pid){$('#taskStage').textContent='连接中断，正在重新检查任务…';}});
$('#generateButton').onclick=async()=>{
 if(state.submitting)return;if(!ready()){if(!state.draft?.prompt.trim()){errorAt('#promptError','请填写希望如何修改。');$('#generationPrompt').focus();}return;}
 const ctx=context(),body={...payload(),preview_id:state.preview.id};state.submitting=true;renderControls();errorAt('#generationError');
 const keyName=`catsco-submit:${ctx.pid}:${ctx.source}`;let pending;try{pending=JSON.parse(sessionStorage.getItem(keyName));}catch{}
 const signature=JSON.stringify(body);const request_id=pending?.signature===signature?pending.id:crypto.randomUUID();
 try{sessionStorage.setItem(keyName,JSON.stringify({signature,id:request_id}));}catch{}
 try{await draftStore.flush(draftStore.key(ctx.pid,ctx.source));const task=await post(`/api/projects/${ctx.pid}/generate`,{...body,request_id});try{sessionStorage.removeItem(keyName);}catch{}putTask(ctx.pid,task);monitor.watch(ctx.pid,task);toast('任务已提交，完成后会自动展示新结果。');}
 catch(error){if(current(ctx))errorAt('#generationError',error.message);else toast(error.message);}
 finally{state.submitting=false;renderControls();}
};
async function checkCapabilities(){try{state.capabilities=await api('/api/capabilities');}catch{state.capabilities={generation:false,semantic_selection:false,generation_reason:'本地服务未连接，请检查运行状态。'};}const c=state.capabilities;$('#openSettings').classList.toggle('ready',!!c.generation);$('#capabilityDetails').innerHTML=[['上传与手动框选','本地可用'],['智能选区',c.semantic_selection?'已配置':'未配置'],['图片生成',c.generation?'已配置':'未配置']].map(([a,b])=>`<div class="capability-row"><b>${a}</b><span>${b}</span></div>`).join('');renderControls();}
$('#openSettings').onclick=()=>{$('#settingsDialog').showModal();checkCapabilities();};$('#refreshCapabilities').onclick=checkCapabilities;
$('#renameProject').onclick=()=>{$('#projectName').value=state.project.name;errorAt('#renameError');$('#renameDialog').showModal();$('#projectName').select();};
$('#renameForm').onsubmit=async event=>{event.preventDefault();const pid=state.project.id;try{const p=await api(`/api/projects/${pid}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('#projectName').value.trim()})});if(state.project?.id===pid){state.project.name=p.name;$('#renameProject').textContent=p.name;}$('#renameDialog').close();loadProjects();}catch(error){errorAt('#renameError',error.message);}};
$('#exportCurrent').onclick=()=>{const pid=state.project.id;$('#exportLabel').textContent=`${state.project.name} · ${versionName(state.source)}`;$('#downloadCurrent').href=media(state.source==='source'?`/media/projects/${pid}/source.png`:`/api/projects/${pid}/versions/${state.source}/download`);$('#downloadCurrent').textContent=state.source==='source'?'下载工作副本（PNG）':'下载当前版本（PNG）';$('#downloadOriginal').href=media(`/api/projects/${pid}/original/download`);$('#exportDialog').showModal();};
$('#coordinateButton').onclick=()=>{$('#canvasToolsDialog').close();const b=state.draft.box;$('#boxX').value=b?.x_min||0;$('#boxY').value=b?.y_min||0;$('#boxW').value=b?b.x_max-b.x_min:Math.min(100,state.image.naturalWidth);$('#boxH').value=b?b.y_max-b.y_min:Math.min(100,state.image.naturalHeight);errorAt('#coordinateError');$('#coordinatesDialog').showModal();};
$('#coordinatesForm').onsubmit=event=>{event.preventDefault();const x=Number($('#boxX').value),y=Number($('#boxY').value),w=Number($('#boxW').value),h=Number($('#boxH').value);if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<4||h<4||x+w>state.image.naturalWidth||y+h>state.image.naturalHeight){errorAt('#coordinateError','选区必须位于图片内，宽高至少4像素。');return;}state.draft.box={x_min:x,y_min:y,x_max:x+w,y_max:y+h};invalidateSelection();$('#coordinatesDialog').close();resolveSelection();};
window.addEventListener('online',()=>{checkCapabilities();draftStore.flushAll();});document.addEventListener('visibilitychange',()=>{if(document.hidden)draftStore.flushAll();});window.addEventListener('pagehide',()=>monitor.stopAll());
setInterval(syncProgress,1000);
await checkCapabilities();await loadProjects();let last;try{last=JSON.parse(localStorage.getItem('catsco-v15:lastProject'));}catch{}
const url=new URL(location.href),pid=url.searchParams.get('project')||last?.pid;if(pid)await openProject(pid,url.searchParams.get('version')||last?.source);
