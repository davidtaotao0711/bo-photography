// All ordinary galleries use width-relative coordinates, never DOM measurements
// or dense-grid packing after saving. Editor chrome is outside this geometry.
import { normalizeCollageLayout } from './collage-layout.js';
export const CANVAS_WIDTH = 1000;
export const CANVAS_VERSION = 1;
const round = (value) => Math.round(value * 100) / 100;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const isGalleryKey = (key) => /^(category:(street|scenes|nature):(selected|archive)|category:portrait:all|series:[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(key);

export function normalizeCanvasRect(item) {
  const width = clamp(Number(item.width) || 300, 30, CANVAS_WIDTH);
  return {
    photoId: String(item.photoId),
    x: round(clamp(Number(item.x) || 0, 0, CANVAS_WIDTH - width)),
    y: round(clamp(Number(item.y) || 0, 0, 200000)),
    width: round(width),
    height: round(clamp(Number(item.height) || 200, 20, 10000)),
    ...(typeof item.crop === 'boolean' ? {
      crop: item.crop,
      focalX: round(clamp(Number.isFinite(item.focalX) ? item.focalX : 50, 0, 100)),
      focalY: round(clamp(Number.isFinite(item.focalY) ? item.focalY : 50, 0, 100)),
    } : {}),
  };
}

export function validateCanvasLayout(layout) {
  if (layout?.version !== CANVAS_VERSION || !Array.isArray(layout.items) || layout.items.length > 5000) {
    throw new Error('Invalid gallery canvas version or items.');
  }
  const ids = new Set();
  for (const item of layout.items) {
    if (!item || typeof item.photoId !== 'string' || !item.photoId || ids.has(item.photoId)
      || !['x', 'y', 'width', 'height'].every((key) => typeof item[key] === 'number' && Number.isFinite(item[key]))
      || item.x < 0 || item.y < 0 || item.y > 200000 || item.width < 30 || item.width > CANVAS_WIDTH
      || item.height < 20 || item.height > 10000 || item.x + item.width > CANVAS_WIDTH + 0.02) {
      throw new Error('Invalid or duplicate photograph / canvas coordinates.');
    }
    if (item.crop !== undefined && (typeof item.crop !== 'boolean'
      || ['focalX', 'focalY'].some((key) => item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]) || item[key] < 0 || item[key] > 100)))) {
      throw new Error('Invalid crop / focal point.');
    }
    ids.add(item.photoId);
  }
  const hidden = layout.hiddenPhotoIds || [];
  if (!Array.isArray(hidden) || hidden.length > 5000 || hidden.some((id) => typeof id !== 'string' || !id || ids.has(id)) || new Set(hidden).size !== hidden.length) {
    throw new Error('Invalid removed photograph IDs.');
  }
  return { version: CANVAS_VERSION, items: layout.items.map(normalizeCanvasRect), ...(hidden.length ? { hiddenPhotoIds: [...hidden] } : {}) };
}

export function canvasImageLayout(rect, photo) {
  const layout = normalizeCollageLayout(photo);
  if (typeof rect.crop !== 'boolean') return layout;
  return { ...layout, crop: rect.crop, fit: rect.crop ? 'cover' : 'contain', focalX: rect.focalX ?? 50, focalY: rect.focalY ?? 50 };
}

export function visibleCanvasPhotos(layout, photos) {
  const hidden = new Set(layout?.hiddenPhotoIds || []);
  return photos.filter((photo) => !hidden.has(photo.id));
}

export function photoHeightRatio(photo, manifest = {}) {
  if (Number(photo.layout?.ratio) > 0) return Number(photo.layout.ratio);
  const meta = manifest[photo.image];
  return meta?.width && meta?.height ? meta.height / meta.width : photo.orientation === 'portrait' ? 1.5 : 2 / 3;
}

export function arrangeCanvasRows(items, count, gap = 20, startY = 0) {
  count = clamp(Math.round(Number(count) || 1), 1, 6);
  gap = clamp(Number(gap) || 0, 0, 120);
  const result = [];
  let y = startY;
  for (let i = 0; i < items.length; i += count) {
    const row = items.slice(i, i + count);
    // A single image is deliberately not stretched across the whole page.
    const width = count === 1 ? 680 : (CANVAS_WIDTH - gap * (count - 1)) / count;
    row.forEach((item, column) => result.push(normalizeCanvasRect({
      ...item, x: count === 1 ? (CANVAS_WIDTH - width) / 2 : column * (width + gap), y,
      width, height: width * item.height / item.width,
    })));
    y += Math.max(...row.map((item) => width * item.height / item.width)) + gap;
  }
  return result;
}

export function resolveCanvasLayout(layout, photos, manifest = {}) {
  photos = visibleCanvasPhotos(layout, photos);
  const available = new Set(photos.map((photo) => photo.id));
  const seen = new Set();
  const items = (layout?.items || []).filter((item) => {
    if (!available.has(item.photoId) || seen.has(item.photoId)) return false;
    seen.add(item.photoId);
    return true;
  }).map(normalizeCanvasRect);
  const missing = photos.filter((photo) => !seen.has(photo.id)).map((photo) => ({
    photoId: photo.id, width: 300, height: 300 * photoHeightRatio(photo, manifest),
  }));
  if (missing.length) {
    const bottom = items.length ? Math.max(...items.map((item) => item.y + item.height)) + 24 : 0;
    items.push(...arrangeCanvasRows(missing, 3, 20, bottom));
  }
  return {
    version: CANVAS_VERSION, items,
    ...(layout?.hiddenPhotoIds?.length ? { hiddenPhotoIds: [...layout.hiddenPhotoIds] } : {}),
    height: Math.max(100, ...items.map((item) => item.y + item.height + 24)),
  };
}

export function canvasRectStyle(item, height) {
  return `left:${item.x / 10}%;top:${item.y / height * 100}%;width:${item.width / 10}%;height:${item.height / height * 100}%`;
}

// Snap the whole selection, so moving a group never changes its internal gaps.
export function snapCanvasRect(rect, others, threshold = 8) {
  const guides = [];
  const result = { ...rect };
  for (const axis of ['x', 'y']) {
    const size = axis === 'x' ? 'width' : 'height';
    const targets = axis === 'x' ? [0, CANVAS_WIDTH / 2, CANVAS_WIDTH] : [0];
    others.forEach((item) => targets.push(item[axis], item[axis] + item[size] / 2, item[axis] + item[size]));
    let best = threshold + 0.001;
    let delta = 0;
    let guide;
    [0, rect[size] / 2, rect[size]].forEach((offset) => targets.forEach((target) => {
      const distance = target - rect[axis] - offset;
      const candidate = rect[axis] + distance;
      if (candidate < 0 || (axis === 'x' && candidate + rect.width > CANVAS_WIDTH)) return;
      if (Math.abs(distance) < best) { best = Math.abs(distance); delta = distance; guide = target; }
    }));
    result[axis] += delta;
    if (guide !== undefined) guides.push({ axis, value: guide });
  }
  return { rect: result, guides };
}

export function resizeCanvasRect(rect, dx, dy, others, options = {}) {
  const { free = false, snap = true, threshold = 8 } = options;
  const ratio = rect.height / rect.width;
  const verticalDelta = dy / ratio;
  const delta = Math.abs(dx) >= Math.abs(verticalDelta) ? dx : verticalDelta;
  const maxWidth = Math.min(CANVAS_WIDTH - rect.x, free ? CANVAS_WIDTH : 10000 / ratio);
  const minWidth = free ? 30 : Math.max(30, 20 / ratio);
  let width = clamp(rect.width + (free ? dx : delta), minWidth, maxWidth);
  let height = free ? clamp(rect.height + dy, 20, 10000) : width * ratio;
  const targets = {
    x: [0, CANVAS_WIDTH / 2, CANVAS_WIDTH], y: [0],
  };
  others.forEach((item) => {
    targets.x.push(item.x, item.x + item.width / 2, item.x + item.width);
    targets.y.push(item.y, item.y + item.height / 2, item.y + item.height);
  });
  if (snap) {
    const matches = ['x', 'y'].flatMap((axis) => targets[axis].map((target) => {
      const distance = target - rect[axis] - (axis === 'x' ? width : height);
      const candidateWidth = axis === 'x' ? target - rect.x : (target - rect.y) / ratio;
      return { axis, target, distance, candidateWidth };
    })).filter((match) => Math.abs(match.distance) <= threshold);
    if (free) {
      for (const axis of ['x', 'y']) {
        const match = matches.filter((match) => match.axis === axis)
          .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))[0];
        if (!match) continue;
        if (axis === 'x' && match.target - rect.x >= 30 && match.target - rect.x <= maxWidth) width = match.target - rect.x;
        if (axis === 'y' && match.target - rect.y >= 20 && match.target - rect.y <= 10000) height = match.target - rect.y;
      }
    } else {
      const match = matches.filter((match) => match.candidateWidth >= 30 && match.candidateWidth <= maxWidth && match.candidateWidth * ratio >= 20)
        .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance))[0];
      if (match) { width = match.candidateWidth; height = width * ratio; }
    }
  }
  const resized = normalizeCanvasRect({ ...rect, width, height });
  const guides = snap ? ['x', 'y'].flatMap((axis) => {
    const end = resized[axis] + (axis === 'x' ? resized.width : resized.height);
    return [...new Set(targets[axis])].filter((target) => Math.abs(end - target) < 0.03 || Math.abs(resized[axis] - target) < 0.03)
      .map((value) => ({ axis, value }));
  }) : [];
  return { rect: resized, guides };
}

export function panCanvasCrop(rect, dx, dy, imageAspect) {
  const renderedWidth = Math.max(rect.width, rect.height * imageAspect);
  const renderedHeight = Math.max(rect.height, rect.width / imageAspect);
  return normalizeCanvasRect({ ...rect, crop: true,
    focalX: renderedWidth - rect.width > 0.1 ? (rect.focalX ?? 50) - dx / (renderedWidth - rect.width) * 100 : rect.focalX ?? 50,
    focalY: renderedHeight - rect.height > 0.1 ? (rect.focalY ?? 50) - dy / (renderedHeight - rect.height) * 100 : rect.focalY ?? 50,
  });
}

export function canvasNudgeStep(elapsed, shift = false) {
  const step = elapsed < 300 ? 1 : elapsed < 800 ? 2 : elapsed < 1500 ? 4 : elapsed < 2300 ? 8 : 16;
  return Math.min(80, step * (shift ? 10 : 1));
}
