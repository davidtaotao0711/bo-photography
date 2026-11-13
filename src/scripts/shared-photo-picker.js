import { editorPost, syncEditorImages } from './editor-requests.js';
export function installSharedPhotoPicker({ canImport, onImported, onChoose, anchor = '#add-photos', series = false, library = false, book = false, imageUrl }) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'add-photos'; button.hidden = true;
  button.textContent = library ? '云端图库' : '＋ 从云端图库添加';
  if (anchor) document.querySelector(anchor).before(button);
  const dialog = document.createElement('dialog');
  dialog.className = 'shared-library-dialog';
  dialog.setAttribute('aria-label', '云端图库');
  dialog.innerHTML = `<header><h2>云端图库</h2><button type="button" data-close>关闭</button></header>
    ${library || onChoose ? '<p><label>上传到图库 <input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload></label></p>' : `<p>选择后加入${book ? '当前跨页' : series ? '当前系列' : '当前分类的 Archive'}。</p>`}
    <div class="shared-library-tools"><input type="search" placeholder="搜索名称、标签或 ID" aria-label="搜索云端图库" />
    <select aria-label="照片方向" data-direction><option value="all">全部方向</option><option value="portrait">竖图</option><option value="landscape">横图</option><option value="square">方图</option></select>
    <select aria-label="所属作品" data-scope><option value="all">全部素材</option><option value="street">Street</option><option value="portrait">Portrait</option><option value="scenes">Scenes</option><option value="nature">Nature</option><option value="series">Series</option><option value="portrait-books">Portrait Books</option></select>
    ${library || book ? '' : '<button type="button" data-all>全选当前筛选</button><button type="button" data-none>清空选择</button>'}</div>
    <p data-status role="status" aria-live="polite"></p><div class="shared-library-grid"></div>
    <footer><button type="button" data-prev>上一页</button><span data-count></span><button type="button" data-next>下一页</button><button type="button" data-add ${library ? 'hidden' : ''} disabled>添加所选照片</button></footer>`;
  const style = document.createElement('style');
  style.textContent = `.shared-library-dialog{width:min(1080px,92vw);max-height:88vh;padding:24px;border:1px solid #bbb;background:#faf9f5;color:#222;overflow:auto}.shared-library-dialog::backdrop{background:#0008}.shared-library-dialog header,.shared-library-dialog footer,.shared-library-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.shared-library-dialog header{justify-content:space-between}.shared-library-dialog h2{font:24px Georgia,serif;margin:0}.shared-library-dialog p{font-size:13px;line-height:1.7}.shared-library-dialog button,.shared-library-dialog input,.shared-library-dialog select{font:13px sans-serif;padding:10px 14px;border:1px solid #bbb;background:#fff;color:#222}.shared-library-dialog button{cursor:pointer}.shared-library-dialog button:disabled{opacity:.45;cursor:default}.shared-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px}.shared-library-card{display:block;border:1px solid #ccc;padding:8px;font:12px sans-serif;cursor:pointer}.shared-library-card:has(input:checked){outline:2px solid #333}.shared-library-card:has(input:disabled){opacity:.45;cursor:default}.shared-library-card img{display:block;width:100%;height:165px;object-fit:contain;background:#eeede8;margin:6px 0}.shared-library-card span{display:block;overflow-wrap:anywhere}.shared-library-dialog footer{position:sticky;bottom:-24px;background:#faf9f5;padding:16px 0;margin-top:16px;justify-content:space-between}.shared-library-dialog [data-add]{background:#20201d;color:white}.shared-library-dialog [data-status][data-error=true]{color:#a32216}`;
  document.head.append(style); document.body.append(dialog);
  const grid = dialog.querySelector('.shared-library-grid');
  const status = dialog.querySelector('[data-status]');
  const add = dialog.querySelector('[data-add]');
  const search = dialog.querySelector('input[type=search]');
  const filter = dialog.querySelector('[data-direction]');
  const scope = dialog.querySelector('[data-scope]');
  const previous = dialog.querySelector('[data-prev]');
  const next = dialog.querySelector('[data-next]');
  let category = '', target = '', group = '', photos = [], selected = new Set(), busy = false;
  let page = 1, total = 0, pageSize = 36, queryTimer, pending;
  let firstPage;
  function controls() {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    dialog.querySelector('[data-count]').textContent = `${library ? '' : `已选 ${selected.size} 张 · `}${page} / ${pages} 页 · ${total} 张`;
    add.textContent = busy ? '正在添加并保存…' : `添加所选照片（${selected.size}）`;
    dialog.querySelectorAll('button,input,select').forEach(control => { control.disabled = busy; });
    grid.querySelectorAll('input').forEach(input => { input.disabled = busy || input.dataset.added === 'true'; });
    add.disabled = busy || Boolean(pending) || selected.size === 0;
    previous.disabled = busy || Boolean(pending) || page <= 1;
    next.disabled = busy || Boolean(pending) || page >= pages;
  }
  function render(message = '') {
    grid.replaceChildren();
    for (const photo of photos) {
      const card = document.createElement(library ? 'article' : 'label'); card.className = 'shared-library-card';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(photo.id); check.dataset.added = String(photo.added); check.setAttribute('aria-label', photo.alt || photo.id);
      check.addEventListener('change', () => {
        if (book) { selected.clear(); if (check.checked) selected.add(photo.id); render(); return; }
        if (check.checked) selected.add(photo.id); else selected.delete(photo.id);
        controls();
      });
      const image = document.createElement('img'); image.src = imageUrl(photo.thumbnail); image.alt = photo.alt || ''; image.loading = 'lazy'; image.decoding = 'async';
      const label = document.createElement('span'); label.textContent = photo.alt || photo.id;
      const size = document.createElement('span'); size.textContent = `${photo.width} × ${photo.height}${photo.added ? ' · 已加入' : ''}`;
      if (!library) card.append(check);
      card.append(image, label, size);
      if (library && catalogTags) {
        const tags = document.createElement('input'); tags.value = photo.tags.join(', '); tags.setAttribute('aria-label', `编辑 ${photo.alt} 的标签`); tags.placeholder = '逗号分隔的标签'; tags.size = 12;
        const save = document.createElement('button'); save.type = 'button'; save.textContent = '保存标签';
        save.addEventListener('click', async () => {
          busy = true; controls();
          try {
            await editorPost('/__editor/shared-library/tags', { id: photo.id, tags: tags.value.split(/[,，]/) });
            await load(page, '标签已保存。');
          } catch (error) { showError(error); }
          finally { busy = false; controls(); }
        });
        card.append(tags, save);
      }
      grid.append(card);
    }
    status.dataset.error = 'false';
    status.textContent = message || (photos.length ? '' : '没有符合条件的照片。');
    controls();
  }
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  const showError = error => { status.dataset.error = 'true'; status.textContent = error.message; };
  let catalogTags = false;
  async function query(params, signal) {
    const url = new URLSearchParams({ category: target, q: search.value, direction: filter.value, scope: scope.value, ...params });
    const response = await fetch(`/__editor/shared-library?${url}`, { cache: 'no-store', signal });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || '暂时无法读取云端图库。');
    return result;
  }
  async function load(requested, message) {
    pending?.abort();
    const request = new AbortController(); pending = request;
    status.dataset.error = 'false'; status.textContent = '正在读取云端图库…'; controls();
    try {
      const result = await query({ page: requested }, request.signal);
      if (pending !== request) return;
      ({ photos, page, total, pageSize, catalogTags } = result);
      render(message);
    } catch (error) { if (pending === request && error.name !== 'AbortError') showError(error); }
    finally { if (pending === request) { pending = null; controls(); } }
  }
  function open(value, groupId = '') {
    if (!value || !canImport()) return;
    target = value; group = groupId; photos = []; selected.clear(); search.value = ''; filter.value = 'all'; scope.value = 'all'; page = 1; total = 0;
    grid.replaceChildren(); dialog.showModal();
    if (library && firstPage) {
      ({ photos, page, total, pageSize, catalogTags } = firstPage);
      firstPage = null; render();
    }
    void load(1);
  }
  search.addEventListener('input', () => { clearTimeout(queryTimer); queryTimer = setTimeout(() => load(1), 250); });
  for (const select of [filter, scope]) select.addEventListener('change', () => { clearTimeout(queryTimer); void load(1); });
  previous.addEventListener('click', () => load(page - 1));
  next.addEventListener('click', () => load(page + 1));
  dialog.addEventListener('close', () => { clearTimeout(queryTimer); pending?.abort(); });
  dialog.querySelector('[data-all]')?.addEventListener('click', async () => {
    busy = true; controls();
    try {
      const { ids } = await query({ ids: 1 });
      const combined = new Set([...selected, ...ids]);
      if (combined.size > 100) throw new Error('每次最多添加 100 张，请缩小筛选范围。');
      selected = combined; render();
    } catch (error) { showError(error); }
    finally { busy = false; controls(); }
  });
  dialog.querySelector('[data-none]')?.addEventListener('click', () => { selected.clear(); render(); });
  button.addEventListener('click', () => open(library ? 'library' : category));
  dialog.querySelector('[data-upload]')?.addEventListener('change', async event => {
    const files = [...event.target.files];
    if (!files.length) return;
    busy = true; controls();
    try {
      await syncEditorImages(files, value => { status.dataset.error = 'false'; status.textContent = value; }, { willAttach: false });
      search.value = ''; filter.value = 'all'; scope.value = 'all'; await load(1, '上传完成，照片已加入云端图库。');
    } catch (error) { showError(error); }
    finally { event.target.value = ''; busy = false; controls(); }
  });
  add.addEventListener('click', async () => {
    if (busy || !selected.size || !canImport()) return;
    if (selected.size > 100) { status.textContent = '每次最多添加 100 张，请减少选择后重试。'; return; }
    busy = true; controls(); status.dataset.error = 'false'; status.textContent = '正在添加并保存…';
    try {
      if (onChoose) await onChoose([...selected]);
      else onImported(await editorPost('/__editor/shared-library', { category: target, ids: [...selected], group }));
      dialog.close();
    } catch(error) { status.dataset.error = 'true'; status.textContent = error.message; }
    finally { busy = false; controls(); }
  });
  button.hidden = !library;
  if (library) void query({ category: 'library', page: 1 }).then(result => {
    if (!dialog.open) firstPage = result;
  }).catch(() => {});
  return { open, setCategory(value) { category = value; button.hidden = !value; } };
}
