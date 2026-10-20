import { CANVAS_WIDTH, canvasImageLayout, canvasNudgeStep, canvasRectStyle, normalizeCanvasRect, panCanvasCrop, resizeCanvasRect, resolveCanvasLayout, snapCanvasRect } from '../utils/gallery-canvas.js';
import '../styles/gallery-canvas.css';
import '../styles/gallery-canvas-editor.css';

const escape = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const copy = (value) => structuredClone(value);
const icons = {
  delete: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  crop: '<path d="M6 3v15h15M3 6h15v15M3 21 21 3"/>',
  replace: '<path d="M4 7h14l-4-4M20 17H6l4 4M20 7v5M4 17v-5"/>',
  done: '<path d="m4 12 5 5L20 6"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const bounds = (items) => ({
  x: Math.min(...items.map((item) => item.x)), y: Math.min(...items.map((item) => item.y)),
  width: Math.max(...items.map((item) => item.x + item.width)) - Math.min(...items.map((item) => item.x)),
  height: Math.max(...items.map((item) => item.y + item.height)) - Math.min(...items.map((item) => item.y)),
});

export function createGalleryCanvasEditor({ initial, manifest, onInspect, onManage, beforeSave, onStateChange, notify }) {
  const layouts = new Map(Object.entries(initial.galleries || {}).map(([key, value]) => [key, copy(value)]));
  const dirty = new Set();
  const histories = new Map();
  const storageKey = 'ordinary-gallery-canvas-drafts-v1';
  try {
    Object.entries(JSON.parse(sessionStorage.getItem(storageKey) || '{}')).forEach(([key, value]) => {
      layouts.set(key, value); dirty.add(key);
    });
  } catch { /* Storage is optional; file saving is not. */ }
  let host, galleries = [], activeKey = '', selected = new Set(), generation = 0;
  let mobile = false, saving = false, model, current, gesture, cropId = '', replaceId = '', restoring = false, heldNudge;
  const snap = true;
  window.addEventListener('scroll', () => positionTools(), { passive: true });
  window.addEventListener('resize', () => positionTools());
  window.addEventListener('keyup', () => { heldNudge = null; });
  window.addEventListener('blur', () => { heldNudge = null; gesture?.cancel(); });

  const persist = () => {
    try { sessionStorage.setItem(storageKey, JSON.stringify(Object.fromEntries([...dirty].map((key) => [key, layouts.get(key)])))); }
    catch { /* beforeunload still guards an unsaved layout. */ }
  };
  const currentLayout = () => ({ version: 1, items: copy(model.items), ...(model.hiddenPhotoIds?.length ? { hiddenPhotoIds: [...model.hiddenPhotoIds] } : {}) });
  function remember() {
    const history = histories.get(activeKey) || [];
    history.push(currentLayout());
    if (history.length > 40) history.shift();
    histories.set(activeKey, history);
  }
  function changed() {
    layouts.set(activeKey, currentLayout());
    dirty.add(activeKey);
    persist();
    updateStatus();
  }
  function resolve(layout) { return resolveCanvasLayout(layout, current.photos, manifest); }
  function thumb(photo, width = 800) {
    const variants = manifest[photo.image]?.variants || [];
    return (variants.find((item) => item.width >= width) || variants.at(-1))?.src || photo.image;
  }

  // Import the *actual* legacy public composition instead of inventing another
  // editor-only packing algorithm. Nothing is saved until the user applies it.
  async function capturePublic(gallery) {
    const iframe = document.createElement('iframe');
    const publicWidth = Math.max(1024, document.documentElement.clientWidth);
    iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${publicWidth}px;height:900px;border:0;visibility:hidden;pointer-events:none`;
    iframe.tabIndex = -1;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = gallery.url;
    let timer;
    try {
      await new Promise((resolveLoad, reject) => {
        timer = setTimeout(() => reject(new Error('网页预览读取超时')), 10000);
        iframe.onload = resolveLoad;
        iframe.onerror = () => reject(new Error('无法读取网页预览'));
        document.body.append(iframe);
      });
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      const root = doc?.querySelector('[data-gallery-canvas], [data-masonry-gallery], .gallery--rows');
      if (!root) throw new Error('此页尚无可读取的照片版面');
      // Reveal transforms belong to playback, not saved photo coordinates.
      root.querySelectorAll('[data-scroll-reveal]').forEach((node) => { node.style.transition = 'none'; node.style.transform = 'none'; });
      // Wait for the public packer to finish, without downloading every lazy image.
      await new Promise((done) => win.requestAnimationFrame(() => win.requestAnimationFrame(done)));
      const box = root.getBoundingClientRect();
      if (!box.width) throw new Error('网页画布宽度无效');
      const scale = CANVAS_WIDTH / box.width;
      const ids = new Set(gallery.photos.map((photo) => photo.id));
      const items = [...root.querySelectorAll('.photo-card[data-photo-id]')].filter((card) => ids.has(card.dataset.photoId)).map((card) => {
        const image = card.querySelector('.photo-card__image').getBoundingClientRect();
        return normalizeCanvasRect({ photoId: card.dataset.photoId, x: (image.left - box.left) * scale, y: (image.top - box.top) * scale, width: image.width * scale, height: image.height * scale });
      });
      if (!items.length) throw new Error('没有可读取的照片');
      return { version: 1, items };
    } finally { clearTimeout(timer); iframe.remove(); }
  }

  function updateStatus() {
    onStateChange?.();
    if (!host?.isConnected) return;
    const status = host.querySelector('[data-canvas-status]');
    if (status) status.textContent = dirty.has(activeKey) ? '画布有未保存修改' : initial.galleries[activeKey] ? '已保存 · Editor 与正式页使用相同坐标' : '已读取现有版面 · 点击「保存并应用画布」后正式页不再自动重排';
    const undo = host.querySelector('[data-canvas-action="undo"]');
    if (undo) undo.disabled = !(histories.get(activeKey)?.length);
  }

  function positionItems(guides = []) {
    if (!host?.isConnected || !model) return;
    const canvas = host.querySelector('[data-canvas-stage]');
    if (!canvas) return;
    model.height = Math.max(180, ...model.items.map((item) => item.y + item.height + 24));
    canvas.style.setProperty('--canvas-height', model.height);
    const nodes = new Map([...canvas.querySelectorAll('[data-canvas-id]')].map((node) => [node.dataset.canvasId, node]));
    model.items.forEach((item) => {
      const node = nodes.get(item.photoId);
      if (!node) return;
      node.style.cssText = `${canvasRectStyle(item, model.height)};--canvas-photo-aspect:${item.width} / ${item.height}`;
      node.classList.toggle('is-selected', selected.has(item.photoId));
      node.classList.toggle('is-cropping', cropId === item.photoId);
      node.setAttribute('aria-pressed', String(selected.has(item.photoId)));
      const photo = current.photos.find((photo) => photo.id === item.photoId);
      const layout = canvasImageLayout(item, photo);
      const image = node.querySelector('img');
      image.style.objectFit = layout.fit;
      image.style.objectPosition = `${layout.focalX}% ${layout.focalY}%`;
    });
    canvas.querySelectorAll('.canvas-guide').forEach((node) => node.remove());
    guides.forEach(({ axis, value }) => {
      const line = document.createElement('i');
      line.className = `canvas-guide canvas-guide--${axis}`;
      line.style[axis === 'x' ? 'left' : 'top'] = `${value / (axis === 'x' ? CANVAS_WIDTH : model.height) * 100}%`;
      canvas.append(line);
    });
    positionTools();
    updateStatus();
  }

  function positionTools() {
    if (!host?.isConnected) return;
    const tools = host.querySelector('[data-canvas-photo-tools]');
    if (!tools) return;
    const id = selected.size === 1 ? [...selected][0] : '';
    const node = [...host.querySelectorAll('[data-canvas-id]')].find((node) => node.dataset.canvasId === id);
    const box = node?.getBoundingClientRect();
    tools.hidden = mobile || !box || box.bottom < 85 || box.top > window.innerHeight - 30 || Boolean(host.querySelector('dialog[open]'));
    if (tools.hidden) return;
    tools.querySelector('[data-canvas-action="crop"]').classList.toggle('is-active', cropId === id);
    tools.querySelector('[data-crop-options]').hidden = cropId !== id;
    const sideInset = Math.min(20, box.width * 0.05);
    const bottomInset = Math.min(8, box.height * 0.02);
    tools.style.width = `${box.width - sideInset * 2}px`;
    tools.style.left = `${box.left + sideInset}px`;
    // Stay inside the photo's bottom edge; never float above it or pin to the viewport.
    const top = box.bottom - tools.offsetHeight - bottomInset;
    tools.style.top = `${top}px`;
    if (top < 84) tools.hidden = true;
  }

  function paint() {
    if (!host?.isConnected) return;
    const byId = new Map(current.photos.map((photo) => [photo.id, photo]));
    const reading = [...model.items].sort((a, b) => a.y - b.y || a.x - b.x);
    host.innerHTML = `<section class="canvas-studio" aria-label="普通页面自由画布">
      <header class="canvas-studio__head"><div><p class="eyebrow">Page layout · Free canvas</p><h2>页面排版</h2></div>
        <select data-canvas-page aria-label="选择页面">${galleries.map((gallery) => `<option value="${escape(gallery.key)}" ${gallery.key === activeKey ? 'selected' : ''}>${escape(gallery.label)} · ${gallery.photos.length} 张</option>`).join('')}</select>
        <a class="button" href="${escape(current.url)}" target="_blank" rel="noopener">查看正式页面 ↗</a><button type="button" class="button" data-canvas-action="manage">照片管理</button>
        ${model.hiddenPhotoIds?.length ? `<button type="button" data-canvas-action="restore">已移除（${model.hiddenPhotoIds.length}）</button>` : ''}
      </header>
      <p class="canvas-studio__hint">点击照片：删除 / 裁剪 / 替换。拖动定位，右下角等比例缩放；裁剪模式中可自由调整画框并拖动取景。长按方向键逐渐加速；Alt 暂停吸附，Esc 取消当前操作。</p>
      <div class="canvas-essential-controls">
        <button type="button" data-canvas-action="undo">↶ 撤销</button>
        <button type="button" data-canvas-action="mobile" aria-pressed="${mobile}">${mobile ? '返回桌面画布' : '手机预览'}</button>
        <button type="button" data-canvas-action="save" ${saving ? 'disabled' : ''}>${saving ? '正在保存…' : '保存并应用画布'}</button>
      </div>
      <p class="canvas-studio__status" data-canvas-status role="status"></p>
      <div class="canvas-studio__surface ${mobile ? 'is-mobile' : ''}">
        <div class="gallery-canvas ${mobile ? '' : 'gallery-canvas--editor'}" data-canvas-stage style="--canvas-height:${model.height}">
          ${reading.map((rect, index) => {
            const photo = byId.get(rect.photoId);
            const layout = canvasImageLayout(rect, photo);
            return `<div class="canvas-photo canvas-editor-photo" data-canvas-id="${escape(rect.photoId)}" role="button" tabindex="0" aria-label="移动照片 ${escape(rect.photoId)}" aria-pressed="false" style="${canvasRectStyle(rect, model.height)};--canvas-photo-aspect:${rect.width} / ${rect.height}">
              <img src="${escape(thumb(photo))}" alt="${escape(photo.alt || rect.photoId)}" loading="lazy" decoding="async" draggable="false" style="object-fit:${layout.fit};object-position:${layout.focalX}% ${layout.focalY}%" />
              <span class="canvas-editor-photo__label">${index + 1} · ${escape(rect.photoId)}</span><span class="canvas-crop-grid" aria-hidden="true"></span><span class="canvas-editor-photo__resize" data-canvas-resize aria-hidden="true"></span>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="canvas-photo-tools" data-canvas-photo-tools role="toolbar" aria-label="照片操作" hidden>
        <button type="button" data-canvas-action="delete" title="从当前页面移除，原图保留" aria-label="删除此页照片">${icon('delete')}</button>
        <button type="button" data-canvas-action="crop" title="裁剪 / 填满画框" aria-label="裁剪照片">${icon('crop')}</button>
        <button type="button" data-canvas-action="replace" title="替换照片，保留画框" aria-label="替换照片">${icon('replace')}</button>
        <span class="canvas-photo-tools__crop" data-crop-options hidden>
          <button type="button" data-canvas-action="contain" title="恢复原图比例并完整显示">完整</button>
          <button type="button" data-canvas-action="crop-done" aria-label="完成裁剪" title="完成裁剪">${icon('done')}</button>
        </span>
      </div>
      <dialog class="canvas-replace-dialog" aria-label="替换照片">
        <header><h3>替换照片</h3><button type="button" data-canvas-action="close-replace" aria-label="关闭替换照片">×</button></header>
        <p>已有照片会交换位置；已移除照片可重新选用。原图保留在图库中。</p>
        <input type="search" data-canvas-replace-search aria-label="搜索替换照片" placeholder="搜索编号或文件名" />
        <div class="canvas-replace-grid" data-canvas-replace-grid></div>
      </dialog></section>`;
    positionItems();
    const canvas = host.querySelector('[data-canvas-stage]');
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('dblclick', (event) => {
      const photo = event.target.closest('[data-canvas-id]');
      if (photo) onInspect(photo.dataset.canvasId);
    });
    canvas.addEventListener('keydown', keyboard);
    host.onclick = action;
    host.onchange = input;
    host.oninput = (event) => { if (event.target.matches('[data-canvas-replace-search]')) renderReplacements(event.target.value); };
    host.querySelector('.canvas-replace-dialog').addEventListener('close', () => { replaceId = ''; restoring = false; positionTools(); });
  }

  function pointerDown(event) {
    if (mobile || event.button !== 0) return;
    const canvas = event.currentTarget;
    const node = event.target.closest('[data-canvas-id]');
    if (!node) { selected.clear(); positionItems(); return; }
    event.preventDefault();
    const id = node.dataset.canvasId;
    if (cropId && cropId !== id) cropId = '';
    const collapseOnClick = !event.shiftKey && selected.has(id) && selected.size > 1;
    if (event.shiftKey && selected.has(id)) { selected.delete(id); positionItems(); return; }
    if (!selected.has(id)) { if (!event.shiftKey) selected.clear(); selected.add(id); }
    const resizing = Boolean(event.target.closest('[data-canvas-resize]'));
    const cropping = cropId === id;
    if (resizing) selected = new Set([id]);
    node.focus({ preventScroll: true });
    positionItems(snap ? [{ axis: 'x', value: CANVAS_WIDTH / 2 }] : []);
    const original = currentLayout();
    const picked = original.items.filter((item) => selected.has(item.photoId));
    const group = bounds(picked);
    const scale = CANVAS_WIDTH / canvas.getBoundingClientRect().width;
    const start = { x: event.clientX, y: event.clientY, scrollY: window.scrollY };
    let moved = false;
    let lastPointer = event, scrollFrame = 0;
    gesture = { cancel: () => finish(true) };
    canvas.setPointerCapture(event.pointerId);
    function move(pointer) {
      if (pointer.pointerId !== event.pointerId) return;
      lastPointer = pointer;
      const dx = (pointer.clientX - start.x) * scale, dy = (pointer.clientY - start.y + window.scrollY - start.scrollY) * scale;
      if (!moved && Math.hypot(dx, dy) < 1) return;
      if (!moved) { remember(); moved = true; }
      let guides = [];
      if (cropping && !resizing) {
        const before = picked.find((item) => item.photoId === id);
        const photo = current.photos.find((photo) => photo.id === id);
        const image = node.querySelector('img');
        const meta = manifest[photo.image];
        const aspect = meta?.width && meta?.height ? meta.width / meta.height : image.naturalWidth / image.naturalHeight || before.width / before.height;
        model.items = original.items.map((item) => item.photoId === id ? panCanvasCrop(before, dx, dy, aspect) : copy(item));
      } else if (resizing) {
        const before = picked[0];
        const resized = resizeCanvasRect(before, dx, dy, original.items.filter((item) => item.photoId !== id), { free: cropping, threshold: 6 * scale, snap: !pointer.altKey });
        guides = resized.guides;
        model.items = original.items.map((item) => item.photoId === id ? resized.rect : copy(item));
      } else {
        let next = { ...group, x: Math.max(0, Math.min(CANVAS_WIDTH - group.width, group.x + dx)), y: Math.max(0, Math.min(200000 - group.height, group.y + dy)) };
        if (snap && !pointer.altKey) {
          const snapped = snapCanvasRect(next, original.items.filter((item) => !selected.has(item.photoId)), 6 * scale);
          next = snapped.rect; guides = snapped.guides;
        }
        model.items = original.items.map((item) => selected.has(item.photoId)
          ? normalizeCanvasRect({ ...item, x: item.x + next.x - group.x, y: item.y + next.y - group.y }) : copy(item));
      }
      positionItems(guides);
    }
    function finish(cancel = false) {
      cancelAnimationFrame(scrollFrame);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancelPointer);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      gesture = null;
      if (!moved && collapseOnClick) selected = new Set([id]);
      if (moved) {
        if (cancel) { model = resolve(original); histories.get(activeKey)?.pop(); }
        else changed();
      }
      positionItems();
    }
    const up = (pointer) => { if (pointer.pointerId === event.pointerId) finish(); };
    const cancelPointer = () => finish(true);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancelPointer);
    function autoScroll() {
      const edge = 65;
      const speed = lastPointer.clientY < edge ? -12 : lastPointer.clientY > window.innerHeight - edge ? 12 : 0;
      if (speed) {
        const before = window.scrollY;
        window.scrollBy(0, speed);
        if (window.scrollY !== before) move(lastPointer);
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    scrollFrame = requestAnimationFrame(autoScroll);
  }

  function keyboard(event) {
    if (event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    if (event.key === 'Escape') { gesture?.cancel(); cropId = ''; positionItems(); return; }
    if (mobile || !selected.size || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat || heldNudge?.key !== event.key) {
      heldNudge = { key: event.key, start: event.timeStamp };
      remember();
    }
    const group = bounds(model.items.filter((item) => selected.has(item.photoId)));
    const step = canvasNudgeStep(event.timeStamp - heldNudge.start, event.shiftKey);
    const dx = event.key === 'ArrowLeft' ? -Math.min(step, group.x) : event.key === 'ArrowRight' ? Math.min(step, CANVAS_WIDTH - group.x - group.width) : 0;
    const dy = event.key === 'ArrowUp' ? -Math.min(step, group.y) : event.key === 'ArrowDown' ? step : 0;
    model.items = model.items.map((item) => selected.has(item.photoId) ? normalizeCanvasRect({ ...item, x: item.x + dx, y: item.y + dy }) : item);
    changed(); positionItems();
  }

  async function action(event) {
    const replacement = event.target.closest('[data-canvas-replacement]');
    if (replacement) { replacePhoto(replacement.dataset.canvasReplacement); return; }
    const name = event.target.closest('[data-canvas-action]')?.dataset.canvasAction;
    if (!name) return;
    if (name === 'manage') { onManage(); return; }
    if (name === 'save') {
      try { if (!dirty.has(activeKey)) changed(); await save(); paint(); notify('当前页面画布已保存，刷新正式页面即可查看'); }
      catch (error) { notify(`保存失败：${error.message}`); }
      return;
    }
    if (name === 'mobile') { mobile = !mobile; cropId = ''; paint(); return; }
    if (name === 'undo') {
      const previous = histories.get(activeKey)?.pop();
      if (previous) { model = resolve(previous); cropId = ''; changed(); paint(); }
      return;
    }
    if (name === 'close-replace') { host.querySelector('dialog').close(); return; }
    if (name === 'restore') {
      restoring = true; replaceId = '';
      host.querySelector('dialog h3').textContent = '重新加入当前页面';
      host.querySelector('dialog p').textContent = '恢复到当前页面末尾，不改变其他照片的位置。';
      renderReplacements(''); host.querySelector('dialog').showModal(); positionTools(); return;
    }
    const id = selected.size === 1 ? [...selected][0] : '';
    const item = model.items.find((item) => item.photoId === id);
    if (!item || mobile) return;
    if (name === 'delete') {
      remember();
      model.items = model.items.filter((item) => item.photoId !== id);
      model.hiddenPhotoIds = [...new Set([...(model.hiddenPhotoIds || []), id])];
      selected.clear(); cropId = '';
      changed(); paint(); notify('已从当前页面移除，原图仍在图库。点击撤销可恢复。');
    } else if (name === 'crop') {
      if (cropId === id) { cropId = ''; positionItems(); return; }
      remember();
      const layout = canvasImageLayout(item, current.photos.find((photo) => photo.id === id));
      Object.assign(item, { crop: true, focalX: layout.focalX, focalY: layout.focalY });
      cropId = id; changed(); positionItems();
      notify('已填满画框。拖动照片调整取景；拖右下角自由裁框，点击勾号完成。');
    } else if (name === 'contain') {
      remember();
      const photo = current.photos.find((photo) => photo.id === id);
      const meta = manifest[photo.image];
      const ratio = meta?.width && meta?.height ? meta.height / meta.width : photo.orientation === 'portrait' ? 1.5 : 2 / 3;
      Object.assign(item, normalizeCanvasRect({ ...item, height: item.width * ratio, crop: false, focalX: 50, focalY: 50 }));
      cropId = ''; changed(); positionItems();
    } else if (name === 'crop-done') {
      cropId = ''; positionItems();
    } else if (name === 'replace') {
      restoring = false; replaceId = id;
      host.querySelector('dialog h3').textContent = '替换照片';
      host.querySelector('dialog p').textContent = '已有照片会交换位置；已移除照片可重新选用。原图保留在图库中。';
      renderReplacements('');
      host.querySelector('dialog').showModal(); positionTools();
    }
  }

  function renderReplacements(query) {
    const search = query.trim().toLowerCase();
    const visible = new Set(model.items.map((item) => item.photoId));
    host.querySelector('[data-canvas-replace-grid]').innerHTML = current.photos.map((photo, index) => ({ photo, index }))
      .filter(({ photo }) => !restoring || (model.hiddenPhotoIds || []).includes(photo.id))
      .filter(({ photo, index }) => !search || `${index + 1} ${photo.id} ${photo.image.split('/').pop()}`.toLowerCase().includes(search))
      .map(({ photo, index }) => `<button type="button" data-canvas-replacement="${escape(photo.id)}" ${photo.id === replaceId ? 'disabled' : ''}>
        <img src="${escape(thumb(photo, 480))}" alt="${escape(photo.alt || photo.id)}" loading="lazy" decoding="async" />
        <span>No. ${index + 1} · ${escape(photo.image.split('/').pop())}</span><small>${restoring ? '重新加入此页' : visible.has(photo.id) ? photo.id === replaceId ? '当前照片' : '交换位置' : '从图库选用'}</small></button>`).join('');
  }

  function replacePhoto(id) {
    if (restoring && (model.hiddenPhotoIds || []).includes(id)) {
      remember();
      model.hiddenPhotoIds = model.hiddenPhotoIds.filter((photoId) => photoId !== id);
      model = resolve(currentLayout());
      host.querySelector('dialog').close(); selected = new Set([id]);
      changed(); paint(); notify('照片已重新加入页面末尾，其他照片的位置未改变'); return;
    }
    const target = replaceId;
    if (!target || id === target || !current.photos.some((photo) => photo.id === id)) return;
    remember();
    const existing = model.items.some((item) => item.photoId === id);
    model.items = model.items.map((item) => item.photoId === target ? { ...item, photoId: id } : existing && item.photoId === id ? { ...item, photoId: target } : item);
    if (!existing) model.hiddenPhotoIds = [...new Set([...(model.hiddenPhotoIds || []).filter((photoId) => photoId !== id), target])];
    host.querySelector('dialog').close();
    selected = new Set([id]); cropId = ''; changed(); paint();
    notify(existing ? '两张照片已交换位置，画框大小保持不变' : '照片已替换，原图仍保留在图库');
  }

  async function input(event) {
    const target = event.target;
    if (target.matches('[data-canvas-page]')) { activeKey = target.value; selected.clear(); cropId = ''; await load(); }
  }

  async function load() {
    const token = ++generation;
    current = galleries.find((gallery) => gallery.key === activeKey) || galleries[0];
    activeKey = current.key;
    if (!layouts.has(activeKey) && current.photos.length) {
      host.innerHTML = '<p class="canvas-studio__status" role="status">正在读取正式页面的实际排版…</p>';
      let captured;
      try { captured = await capturePublic(current); }
      catch (error) { notify(`${error.message}；按现有尺寸初始化，保存后两端将使用同一画布。`); }
      if (token !== generation || !host.isConnected) return;
      layouts.set(activeKey, captured || { version: 1, items: [] });
    }
    model = resolve(layouts.get(activeKey));
    selected = new Set([...selected].filter((id) => model.items.some((item) => item.photoId === id)));
    paint();
  }

  async function save() {
    if (saving) throw new Error('画布正在保存，请稍候。');
    saving = true;
    try {
      await beforeSave?.();
      for (const key of [...dirty]) {
        const layout = copy(layouts.get(key));
        const response = await fetch('/__editor/gallery-layouts/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, layout }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || '本地画布保存接口不可用，请重新启动 Editor。');
        initial.galleries[key] = copy(result.layout);
        if (JSON.stringify(layouts.get(key)) === JSON.stringify(layout)) dirty.delete(key);
        persist();
      }
    } finally { saving = false; updateStatus(); }
  }

  return {
    mount(element, pages) {
      gesture?.cancel(); host = element; galleries = pages;
      if (!pages.some((gallery) => gallery.key === activeKey)) { activeKey = pages[0].key; selected.clear(); }
      load();
    },
    hasDirty: () => dirty.size > 0,
    applyCurrent() { if (host?.isConnected && model && host.querySelector('[data-canvas-stage]')) changed(); },
    download() {
      const data = { version: 1, galleries: { ...initial.galleries, ...Object.fromEntries([...dirty].map((key) => [key, layouts.get(key)])) } };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'gallery-layouts.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    save,
  };
}
