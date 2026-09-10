export const PREFIX = location.pathname.startsWith('/catsco-image-edit/') ? '/catsco-image-edit' : location.pathname.startsWith('/artifacts/') ? '/catsco-image-edit-api' : '';
export const media = url => url?.startsWith('/') && !url.startsWith(PREFIX + '/') ? PREFIX + url : url;
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function api(path, options = {}) {
  let response;
  try { response = await fetch(PREFIX + path, options); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('连接中断，请检查本地服务。提交结果未确认时，重试会沿用同一次提交标识。'); }
  const body = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  if (!response.ok) {
    let detail = body?.detail ?? body;
    if (Array.isArray(detail)) detail = detail.map(item => {
      const field = item.loc?.at(-1);
      return item.type === 'string_too_long' ? `${field === 'prompt' || field === 'segment_prompt' ? '目标描述' : '输入'}超过${item.ctx?.max_length ?? 32}字，请缩短。` : `${field || '输入'}：${item.msg || '格式不正确'}`;
    }).join('\n');
    if (typeof detail !== 'string') detail = detail?.message || '请求未完成，请检查输入。';
    const error = new Error(detail || `请求未完成（${response.status}）`); error.status = response.status; throw error;
  }
  return body;
}
export const post = (url, body, options = {}) => api(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), ...options});

