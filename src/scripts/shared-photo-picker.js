export function installSharedPhotoPicker({ canImport, onImported, anchor = '#add-photos', series = false }) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'add-photos'; button.hidden = true;
  button.textContent = '＋ 从共享图库添加';
  document.querySelector(anchor).before(button);
  const dialog = document.createElement('dialog');
  dialog.className = 'shared-library-dialog';
  dialog.setAttribute('aria-label', '从共享图库添加照片');
  dialog.innerHTML = `<header><h2>共享图库 · Unassigned</h2><button type="button" data-close>关闭</button></header>
    <p>与 Zine 使用同一个 Unassigned 总库。选择后加入${series ? '当前系列' : '当前分类的 Archive'}；总库原图保留，排版各自独立。</p>
    <div class="shared-library-tools"><input type="search" placeholder="搜索名称或 ID" aria-label="搜索共享图库" />
    <select aria-label="照片方向"><option value="all">全部方向</option><option value="portrait">竖图</option><option value="landscape">横图</option><option value="square">方图</option></select>
    <button type="button" data-all>全选当前筛选</button><button type="button" data-none>清空选择</button></div>
    <p data-status role="status" aria-live="polite"></p><div class="shared-library-grid"></div>
    <footer><span data-count></span><button type="button" data-add disabled>添加所选照片</button></footer>`;
  const style = document.createElement('style');
  style.textContent = `.shared-library-dialog{width:min(1080px,92vw);max-height:88vh;padding:24px;border:1px solid #bbb;background:#faf9f5;color:#222;overflow:auto}.shared-library-dialog::backdrop{background:#0008}.shared-library-dialog header,.shared-library-dialog footer,.shared-library-tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.shared-library-dialog header{justify-content:space-between}.shared-library-dialog h2{font:24px Georgia,serif;margin:0}.shared-library-dialog p{font-size:13px;line-height:1.7}.shared-library-dialog button,.shared-library-dialog input,.shared-library-dialog select{font:13px sans-serif;padding:10px 14px;border:1px solid #bbb;background:#fff;color:#222}.shared-library-dialog button{cursor:pointer}.shared-library-dialog button:disabled{opacity:.45;cursor:default}.shared-library-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:14px}.shared-library-card{display:block;border:1px solid #ccc;padding:8px;font:12px sans-serif;cursor:pointer}.shared-library-card:has(input:checked){outline:2px solid #333}.shared-library-card:has(input:disabled){opacity:.45;cursor:default}.shared-library-card img{display:block;width:100%;height:165px;object-fit:contain;background:#eeede8;margin:6px 0}.shared-library-card span{display:block;overflow-wrap:anywhere}.shared-library-dialog footer{position:sticky;bottom:-24px;background:#faf9f5;padding:16px 0;margin-top:16px;justify-content:space-between}.shared-library-dialog [data-add]{background:#20201d;color:white}.shared-library-dialog [data-status][data-error=true]{color:#a32216}`;
  document.head.append(style); document.body.append(dialog);
  const grid = dialog.querySelector('.shared-library-grid');
  const status = dialog.querySelector('[data-status]');
  const add = dialog.querySelector('[data-add]');
  const search = dialog.querySelector('input[type=search]');
  const filter = dialog.querySelector('select');
  let category = '', target = '', photos = [], selected = new Set(), busy = false;
  const visible = () => photos.filter(photo => {
    const direction = photo.width === photo.height ? 'square' : photo.width > photo.height ? 'landscape' : 'portrait';
    return (filter.value === 'all' || filter.value === direction) && `${photo.alt || ''} ${photo.id}`.toLowerCase().includes(search.value.trim().toLowerCase());
  });
  function controls() {
    dialog.querySelector('[data-count]').textContent = `已选 ${selected.size} 张 · 总库 ${photos.length} 张`;
    add.textContent = busy ? '正在添加并保存…' : `添加所选照片（${selected.size}）`;
    dialog.querySelectorAll('button,input,select').forEach(control => { control.disabled = busy; });
    grid.querySelectorAll('input').forEach(input => { input.disabled = busy || input.dataset.added === 'true'; });
    add.disabled = busy || selected.size === 0;
  }
  function render() {
    grid.replaceChildren();
    const filtered = visible();
    for (const photo of filtered) {
      const card = document.createElement('label'); card.className = 'shared-library-card';
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(photo.id); check.dataset.added = String(photo.added); check.setAttribute('aria-label', photo.alt || photo.id);
      check.addEventListener('change', () => { if(check.checked) selected.add(photo.id); else selected.delete(photo.id); controls(); });
      const image = document.createElement('img'); image.src = photo.thumbnail; image.alt = photo.alt || ''; image.loading = 'lazy';
      const label = document.createElement('span'); label.textContent = photo.alt || photo.id;
      const size = document.createElement('span'); size.textContent = `${photo.width} × ${photo.height}${photo.added ? ' · 已在当前分类' : ''}`;
      card.append(check,image,label,size); grid.append(card);
    }
    status.dataset.error = 'false';
    status.textContent = photos.length ? `显示 ${filtered.length} 张；已在当前分类中的照片会自动跳过。` : 'Unassigned 暂无照片，请先在 Zine 编辑器同步或添加。';
    controls();
  }
  const close = () => { if (!busy) dialog.close(); };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  search.addEventListener('input', render); filter.addEventListener('change', render);
  dialog.querySelector('[data-all]').addEventListener('click', () => { visible().filter(photo => !photo.added).forEach(photo => selected.add(photo.id)); render(); });
  dialog.querySelector('[data-none]').addEventListener('click', () => { selected.clear(); render(); });
  button.addEventListener('click', async () => {
    if (!category || !canImport()) return;
    target = category; photos = []; selected.clear(); search.value = ''; filter.value = 'all'; grid.replaceChildren();
    busy = true; controls(); status.dataset.error = 'false'; status.textContent = '正在读取共享图库…'; dialog.showModal();
    try {
      const response = await fetch(`/__editor/shared-library?category=${encodeURIComponent(target)}`, {cache:'no-store'});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.photos)) throw new Error(result.error || '共享图库接口不可用，请重新启动本地编辑器。');
      photos = result.photos; render();
    } catch(error) { status.dataset.error = 'true'; status.textContent = error.message; }
    finally { busy = false; controls(); }
  });
  add.addEventListener('click', async () => {
    if (busy || !selected.size || !canImport()) return;
    if (selected.size > 100) { status.textContent = '每次最多添加 100 张，请减少选择后重试。'; return; }
    busy = true; controls(); status.dataset.error = 'false'; status.textContent = '正在复制所选原图、生成网站图片并保存，请保持页面打开。';
    try {
      const response = await fetch('/__editor/shared-library', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({category:target,ids:[...selected]})});
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.photoData)) throw new Error(result.error || '添加失败，请重新打开图库确认状态。');
      onImported(result); dialog.close();
    } catch(error) { status.dataset.error = 'true'; status.textContent = error.message; }
    finally { busy = false; controls(); }
  });
  return { setCategory(value) { category = value; button.hidden = !value; } };
}
