export const PORTRAIT_LAYOUT_PRESETS = [
  'HERO',
  'DIPTYCH',
  'TRIPTYCH',
  'FEATURE',
  'FULL',
  'TEXT',
  'SPACER',
];

const presetSet = new Set(PORTRAIT_LAYOUT_PRESETS);

export function normalizePortraitLayout(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const seenGroups = new Set();
  const seenPhotos = new Set();
  const groups = [];

  (Array.isArray(source.groups) ? source.groups : []).forEach((group, index) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return;
    const fallbackId = `portrait-group-${index + 1}`;
    let id = String(group.id || fallbackId).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!id || seenGroups.has(id)) id = `${fallbackId}-${index + 1}`;
    seenGroups.add(id);

    const preset = presetSet.has(group.preset) ? group.preset : 'FULL';
    const acceptsPhotos = !['TEXT', 'SPACER'].includes(preset);
    const items = [];
    if (acceptsPhotos) {
      (Array.isArray(group.items) ? group.items : []).forEach((item) => {
        const photoId = String(item?.photoId || '').trim();
        if (!photoId || seenPhotos.has(photoId)) return;
        seenPhotos.add(photoId);
        items.push({ photoId, cover: item?.cover === true });
      });
    }

    groups.push({
      id,
      preset,
      title: String(group.title || '').trim().slice(0, 120),
      text: String(group.text || '').trim().slice(0, 500),
      leftBlank: typeof group.leftBlank === 'boolean'
        ? group.leftBlank
        : (preset === 'SPACER' || (index === 0 && preset === 'HERO')),
      rightBlank: typeof group.rightBlank === 'boolean'
        ? group.rightBlank
        : preset === 'SPACER',
      items,
    });
  });

  return {
    version: 1,
    title: String(source.title || 'Portrait').trim().slice(0, 120) || 'Portrait',
    introduction: String(source.introduction || '').trim().slice(0, 500),
    groups,
  };
}

export function portraitLayoutPhotoIds(value) {
  return normalizePortraitLayout(value).groups.flatMap((group) => group.items.map((item) => item.photoId));
}

function portraitPage(side, blank) {
  return { side, blank, kind: blank ? 'blank' : 'paper', items: [] };
}

export function resolvePortraitSpread(group, index = 0) {
  const source = group && typeof group === 'object' ? group : {};
  const preset = presetSet.has(source.preset) ? source.preset : 'FULL';
  const items = Array.isArray(source.items) ? source.items : [];
  const leftBlank = preset === 'SPACER' || source.leftBlank === true || (index === 0 && preset === 'HERO' && source.leftBlank !== false);
  const rightBlank = preset === 'SPACER' || source.rightBlank === true;
  const left = portraitPage('left', leftBlank);
  const right = portraitPage('right', rightBlank);
  const spread = { preset, left, right, spanItems: [] };

  if (leftBlank && rightBlank) return spread;

  const placeAllOnOpenPage = () => {
    const page = leftBlank ? right : left;
    page.kind = preset === 'TEXT' ? 'text-full' : 'media';
    page.items = [...items];
  };

  if (leftBlank || rightBlank) {
    placeAllOnOpenPage();
    return spread;
  }

  if (preset === 'HERO') {
    left.kind = source.title || source.text ? 'text-full' : 'paper';
    right.kind = 'media';
    right.items = items.slice(0, 1);
  } else if (preset === 'DIPTYCH') {
    left.kind = 'media';
    right.kind = 'media';
    left.items = items.slice(0, 1);
    right.items = items.slice(1, 2);
  } else if (preset === 'TRIPTYCH') {
    spread.spanItems = items.slice(0, 3);
  } else if (preset === 'FEATURE') {
    left.kind = 'media';
    right.kind = 'media';
    left.items = items.slice(0, 1);
    right.items = items.slice(1, 3);
  } else if (preset === 'FULL') {
    spread.spanItems = items.slice(0, 1);
  } else if (preset === 'TEXT') {
    left.kind = 'text-title';
    right.kind = 'text-body';
  }

  return spread;
}

export function portraitVisiblePhotoIds(value) {
  return normalizePortraitLayout(value).groups.flatMap((group, index) => {
    const spread = resolvePortraitSpread(group, index);
    return [...spread.left.items, ...spread.right.items, ...spread.spanItems]
      .map((item) => item.photoId)
      .filter(Boolean);
  });
}

export function normalizePortraitBooks(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const seenSlugs = new Set();
  const books = [];

  (Array.isArray(source.books) ? source.books : []).forEach((book, index) => {
    if (!book || typeof book !== 'object' || Array.isArray(book)) return;
    const fallbackSlug = `portrait-book-${index + 1}`;
    let slug = String(book.slug || fallbackSlug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!slug || slug === 'archive' || seenSlugs.has(slug)) slug = `${fallbackSlug}-${index + 1}`;
    seenSlugs.add(slug);
    const title = String(book.title || '').trim().slice(0, 120) || `Portrait Book ${index + 1}`;
    const layout = normalizePortraitLayout(book.layout);
    if (!book.layout?.title) layout.title = title;

    books.push({
      title,
      slug,
      year: String(book.year || '').trim().slice(0, 20),
      description: String(book.description || '').trim().slice(0, 500),
      coverImage: String(book.coverImage || '').trim().slice(0, 500),
      order: Number.isFinite(Number(book.order)) ? Math.max(1, Math.round(Number(book.order))) : index + 1,
      layout,
    });
  });

  books.sort((a, b) => a.order - b.order).forEach((book, index) => { book.order = index + 1; });
  return { version: 1, books };
}
