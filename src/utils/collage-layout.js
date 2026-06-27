export const collageLayoutDefaults = Object.freeze({
  colSpan: 4,
  rowSpan: 4,
  fit: 'contain',
  crop: false,
  focalX: 50,
  focalY: 50,
});

export const collageLayoutPresets = Object.freeze({
  S: { colSpan: 3 },
  M: { colSpan: 4 },
  T: { colSpan: 5 },
  L: { colSpan: 6 },
  W: { colSpan: 8 },
  Full: { colSpan: 12 },
});

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function normalizeCollageLayout(photo = {}) {
  const layout = photo.layout && typeof photo.layout === 'object' ? photo.layout : {};
  const colSpan = clamp(layout.colSpan, 3, 12, collageLayoutDefaults.colSpan);
  const rowSpan = clamp(layout.rowSpan, 3, 8, collageLayoutDefaults.rowSpan);
  const crop = layout.crop === true;

  return {
    colSpan,
    rowSpan,
    crop,
    fit: crop && layout.fit === 'cover' ? 'cover' : 'contain',
    focalX: clamp(layout.focalX, 0, 100, collageLayoutDefaults.focalX),
    focalY: clamp(layout.focalY, 0, 100, collageLayoutDefaults.focalY),
  };
}

export function sortPhotosByOrder(photos = []) {
  return photos
    .map((photo, index) => ({
      photo,
      index,
      order: Number.isFinite(Number(photo.order)) ? Number(photo.order) : index + 1,
    }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ photo }) => photo);
}
