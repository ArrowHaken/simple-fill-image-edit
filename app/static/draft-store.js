import { post, PREFIX } from './api.js';
export class DraftStore {
  constructor(onStatus) { this.entries = new Map(); this.onStatus = onStatus; }
  key(pid, source) { return `${pid}:${source}`; }
  diskKey(key) { return `catsco-v15:${PREFIX}:draft:${key}`; }
  persist(key, entry) { try { localStorage.setItem(this.diskKey(key), JSON.stringify({draft:entry.draft, dirty:entry.dirty, revision:entry.revision})); } catch { this.onStatus(key, '本地空间不足，请保持页面打开'); } }
  restore(pid, source, remote) {
    const key = this.key(pid, source); let cached;
    try { cached = JSON.parse(localStorage.getItem(this.diskKey(key))); } catch {}
    const existing = this.entries.get(key);
    if (existing?.dirty) return structuredClone(existing.draft);
    const draft = cached?.dirty ? cached.draft : remote;
    const entry = {pid, source, draft:structuredClone(draft), revision:cached?.dirty ? cached.revision : remote.revision || 0, dirty:!!cached?.dirty, seq:0};
    this.entries.set(key, entry);
    if (entry.dirty) this.onStatus(key, '草稿已在本机恢复，待同步');
    return structuredClone(draft);
  }
  update(pid, source, draft) {
    const key = this.key(pid, source), entry = this.entries.get(key);
    if (!entry) return;
    entry.draft = structuredClone(draft); entry.dirty = true; entry.seq++;
    this.persist(key, entry); this.onStatus(key, '保存中…');
    clearTimeout(entry.timer); entry.timer = setTimeout(() => this.flush(key), 500);
  }
  async flush(key) {
    const entry = this.entries.get(key); if (!entry) return true;
    clearTimeout(entry.timer);
    if (entry.saving) { const ok=await entry.saving; return ok && entry.dirty ? this.flush(key) : ok; }
    if (!entry.dirty) return true;
    const seq = entry.seq;
    const payload = {...entry.draft, expected_revision:entry.revision};
    entry.saving = post(`/api/projects/${entry.pid}/edit-draft`, payload).then(saved => {
      entry.revision = saved.revision;
      if (entry.seq === seq) entry.dirty = false;
      this.persist(key, entry);
      this.onStatus(key, entry.dirty ? '保存中…' : '已保存');
      return true;
    }).catch(error => { this.onStatus(key, error.status === 409 ? '草稿冲突 · 本机副本已保留' : '未同步 · 本机副本已保留'); return false; });
    const ok = await entry.saving; entry.saving = null;
    if (ok && entry.dirty) return this.flush(key);
    return ok;
  }
  flushAll() { return Promise.all([...this.entries.keys()].map(key => this.flush(key))); }
  forget(pid, source) {
    for (const [key, entry] of this.entries) {
      if (entry.pid !== pid || (source && entry.source !== source)) continue;
      clearTimeout(entry.timer);
      this.entries.delete(key);
      try { localStorage.removeItem(this.diskKey(key)); } catch {}
    }
    // Also remove drafts from earlier visits that were never opened in this tab.
    try {
      const prefix = this.diskKey(`${pid}:`);
      for (const key of Object.keys(localStorage)) {
        if (source ? key === this.diskKey(this.key(pid, source)) : key.startsWith(prefix)) localStorage.removeItem(key);
      }
    } catch {}
  }
}
