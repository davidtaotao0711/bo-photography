import { photoCategorySlugs } from '../data/categories.js';
import { getPortfolioStatus, migratePortfolioPhotos } from '../utils/portfolio-status.js';
import { PORTRAIT_LAYOUT_PRESETS, normalizePortraitBooks } from '../utils/portrait-layout.js';
import { isGalleryKey, validateCanvasLayout } from '../utils/gallery-canvas.js';
import { addHeroVariants, lookupImage } from './editor-images.mjs';

export const CATEGORIES = new Set(photoCategorySlugs);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function saveGalleryLayout(request, data) {
  const body = await request.json().catch(() => {
    throw new RequestError(400, '画布内容不是有效 JSON。');
  });
  if (!isGalleryKey(body?.key)) throw new RequestError(400, '无效的普通页面。');
  let layout;
  try { layout = validateCanvasLayout(body.layout); }
  catch (error) { throw new RequestError(400, error.message); }
  const photos = migratePortfolioPhotos(data.photos);
  const [, categoryOrSlug, status] = body.key.split(':');
  const validIds = new Set(photos.filter((photo) => body.key.startsWith('series:')
    ? photo.series === categoryOrSlug
    : photo.category === categoryOrSlug && (status === 'all'
      ? ['selected', 'archive'].includes(getPortfolioStatus(photo, categoryOrSlug))
      : getPortfolioStatus(photo, categoryOrSlug) === status)).map((photo) => photo.id));
  if (layout.items.some((item) => !validIds.has(item.photoId)) || (layout.hiddenPhotoIds || []).some((id) => !validIds.has(id))) {
    throw new RequestError(400, '照片尚未保存或已不在此页面，请先保存照片管理中的修改。');
  }
  data.galleryLayouts.galleries[body.key] = layout;
  return { key: body.key, layout };
}

async function savePhotos(request, data) {
  const body = await request.json().catch(() => {
    throw new RequestError(400, '保存内容不是有效 JSON。');
  });
  const photos = body?.photos;
  if (!Array.isArray(photos)) throw new RequestError(400, 'photos 必须是数组。');

  const ids = new Set();
  photos.forEach((photo, index) => {
    if (!photo || typeof photo !== 'object' || !photo.id || !photo.image) {
      throw new RequestError(400, `第 ${index + 1} 张照片缺少 id 或 image。`);
    }
    if (ids.has(photo.id)) throw new RequestError(400, `发现重复 ID：${photo.id}`);
    if (![...CATEGORIES, 'series'].includes(photo.category)) {
      throw new RequestError(400, `${photo.id} 的 category 无效。`);
    }
    ids.add(photo.id);
  });

  const normalizedPhotos = migratePortfolioPhotos(photos);
  data.photos = normalizedPhotos;

  let removedPortraitBookReferences = 0;
  try {
    const portraitBooks = normalizePortraitBooks(data.portraitBooks);
    const validPortraitIds = new Set(normalizedPhotos
      .filter((photo) => photo.category === 'portrait' && ['selected', 'archive'].includes(getPortfolioStatus(photo, 'portrait')))
      .map((photo) => photo.id));
    portraitBooks.books.forEach((book) => {
      book.layout.groups.forEach((group) => {
        const before = group.items.length;
        group.items = group.items.filter((item) => validPortraitIds.has(item.photoId));
        removedPortraitBookReferences += before - group.items.length;
      });
    });
    if (removedPortraitBookReferences > 0) data.portraitBooks = portraitBooks;
  } catch (error) {
    console.warn('[editor] Could not prune Portrait Book references after saving photos:', error.message);
  }

  return { photos: normalizedPhotos, count: normalizedPhotos.length, removedPortraitBookReferences };
}

async function saveSiteIntro(request, data) {
  const body = await request.json().catch(() => {
    throw new RequestError(400, '首页封面设置不是有效 JSON。');
  });
  const homeIntroImages = body?.homeIntroImages;
  if (!Array.isArray(homeIntroImages) || homeIntroImages.length !== 6) {
    throw new RequestError(400, '首页封面必须正好包含 6 张图片。');
  }
  if (new Set(homeIntroImages).size !== homeIntroImages.length) {
    throw new RequestError(400, '首页封面不能重复使用同一张图片。');
  }

  const { site, photos } = data;
  homeIntroImages.forEach((image, index) => {
    const photo = photos.find((item) => item.image === image);
    if (!photo) throw new RequestError(400, `第 ${index + 1} 张封面不在 photos.json 中。`);
    if (photo.orientation !== 'landscape') throw new RequestError(400, `第 ${index + 1} 张封面不是横图。`);
  });

  const updatedSite = { ...site, homeIntroImages };
  for (const image of homeIntroImages) {
    if (site.homeIntroImages.includes(image)) continue;
    const entry = await addHeroVariants(image, data.imageManifest[image]);
    if (entry) data.imageManifest[image] = entry;
  }
  data.site = updatedSite;
  return { site: updatedSite };
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function validateSlug(value) {
  const slug = normalizeSlug(value);
  if (!SLUG_PATTERN.test(slug)) {
    throw new RequestError(400, 'Slug 只能包含小写英文字母、数字和连字符。');
  }
  return slug;
}

function maxPhotosForOrientation(orientation) {
  return 4;
}

function normalizeCoverPosition(value) {
  const keywords = { left: 0, center: 50, right: 100, top: 0, bottom: 100 };
  const parts = String(value || '').trim().toLowerCase().split(/\s+/);
  if (parts.length !== 2) throw new RequestError(400, 'Cover positions must use x% y% values.');
  const numberFor = (part) => Object.hasOwn(keywords, part) ? keywords[part] : Number.parseFloat(part);
  const x = numberFor(parts[0]);
  const y = numberFor(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RequestError(400, 'Cover positions must use x% y% values.');
  }
  if (x < 0 || x > 100 || y < 0 || y > 100) {
    throw new RequestError(400, 'Cover positions must stay between 0% and 100%.');
  }
  return `${Number(x.toFixed(1))}% ${Number(y.toFixed(1))}%`;
}

async function savePortfolioCategoryCovers(request, data) {
  const body = await request.json().catch(() => {
    throw new RequestError(400, 'Portfolio cover settings must be valid JSON.');
  });
  const id = String(body?.id || '').trim();
  const allowedIds = new Set(['portrait', 'street', 'scenes', 'nature', 'series']);
  if (!allowedIds.has(id)) throw new RequestError(400, 'Unknown Portfolio entrance card.');
  const requiredCount = id === 'portrait' ? 3 : 1;
  const coverImages = Array.isArray(body.coverImages) ? body.coverImages.map((value) => String(value || '').trim()) : [];
  if (coverImages.length !== requiredCount || coverImages.some((value) => !value) || new Set(coverImages).size !== requiredCount) {
    throw new RequestError(400, `Choose exactly ${requiredCount} different ${id} photograph${requiredCount === 1 ? '' : 's'}.`);
  }
  const coverPositions = Array.isArray(body.coverPositions)
    ? body.coverPositions.map(normalizeCoverPosition)
    : Array.from({ length: requiredCount }, () => '50% 50%');
  if (coverPositions.length !== requiredCount) throw new RequestError(400, `${requiredCount} cover position${requiredCount === 1 ? '' : 's'} required.`);

  const [photos, categories] = await Promise.all([data.photos, data.portfolioCategories]);
  const index = categories.findIndex((entry) => entry.id === id);
  if (index < 0) throw new RequestError(404, 'Portfolio entrance card configuration was not found.');
  const validImages = new Set(migratePortfolioPhotos(photos)
    .filter((photo) => id === 'series'
      ? photo.category === 'series' || Boolean(photo.series)
      : photo.category === id && ['selected', 'archive'].includes(getPortfolioStatus(photo, id)))
    .map((photo) => photo.image));
  const existingEntry = categories[index];
  if (existingEntry.coverImage) validImages.add(existingEntry.coverImage);
  if (Array.isArray(existingEntry.coverImages)) {
    existingEntry.coverImages.filter(Boolean).forEach((image) => validImages.add(image));
  }
  if (coverImages.some((image) => !validImages.has(image))) {
    throw new RequestError(400, `Covers must come from ${id} photographs.`);
  }
  const updatedEntry = {
    ...categories[index],
    coverImage: coverImages[0],
  };
  if (id === 'portrait') {
    updatedEntry.coverImages = coverImages;
    updatedEntry.coverPositions = coverPositions;
  } else {
    updatedEntry.coverPosition = coverPositions[0];
    delete updatedEntry.coverImages;
    delete updatedEntry.coverPositions;
  }
  const updatedCategories = [...categories];
  updatedCategories[index] = updatedEntry;
  data.portfolioCategories = updatedCategories;
  return { entry: updatedEntry };
}

function savePortraitBookCollection(collection, data) {
  if (!collection || typeof collection !== 'object' || Array.isArray(collection) || !Array.isArray(collection.books)) {
    throw new RequestError(400, 'Portrait Books 必须包含 books 数组。');
  }
  if (collection.books.length > 80) throw new RequestError(400, 'Portrait Books 数量过多。');

  const photos = migratePortfolioPhotos(data.photos);
  const selectedPortraits = photos.filter((photo) => photo.category === 'portrait' && getPortfolioStatus(photo, 'portrait') === 'selected');
  const bookPortraitIds = new Set(photos
    .filter((photo) => photo.category === 'portrait' && ['selected', 'archive'].includes(getPortfolioStatus(photo, 'portrait')))
    .map((photo) => photo.id));
  const selectedPortraitImages = new Set(selectedPortraits.map((photo) => photo.image));
  const presetCapacity = { HERO: 1, DIPTYCH: 2, TRIPTYCH: 3, FEATURE: 3, FULL: 1, TEXT: 0, SPACER: 0 };
  const slugs = new Set();
  let removedPhotoReferences = 0;

  collection.books.forEach((book, bookIndex) => {
    if (!book || typeof book !== 'object' || Array.isArray(book)) throw new RequestError(400, `第 ${bookIndex + 1} 本 Portrait Book 无效。`);
    const title = String(book.title || '').trim();
    const slug = String(book.slug || '').trim();
    if (!title || title.length > 120) throw new RequestError(400, `第 ${bookIndex + 1} 本书的 title 无效。`);
    if (!SLUG_PATTERN.test(slug) || slug === 'archive' || slug.length > 80) throw new RequestError(400, `${title} 的 slug 无效。`);
    if (slugs.has(slug)) throw new RequestError(400, `Portrait Book slug 重复：${slug}`);
    if (String(book.year || '').length > 20 || String(book.description || '').length > 500) throw new RequestError(400, `${title} 的文字过长。`);
    if (!selectedPortraitImages.has(String(book.coverImage || ''))) throw new RequestError(400, `${title} 的书封必须来自 Selected Portrait。`);
    if (!Number.isFinite(Number(book.order)) || Number(book.order) < 1) throw new RequestError(400, `${title} 的 order 无效。`);
    if (!book.layout || typeof book.layout !== 'object' || Array.isArray(book.layout) || !Array.isArray(book.layout.groups)) throw new RequestError(400, `${title} 缺少有效 layout。`);
    if (book.layout.groups.length > 80) throw new RequestError(400, `${title} 的 Spread 数量过多。`);
    slugs.add(slug);
    const groupIds = new Set();
    const usedPhotoIds = new Set();

    book.layout.groups.forEach((group, groupIndex) => {
      if (!group || typeof group !== 'object' || Array.isArray(group)) throw new RequestError(400, `${title} 的第 ${groupIndex + 1} 个 Spread 无效。`);
      const id = String(group.id || '').trim();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 80) throw new RequestError(400, `${title} 的第 ${groupIndex + 1} 个 Spread ID 无效。`);
      if (groupIds.has(id)) throw new RequestError(400, `${title} 的 Spread ID 重复：${id}`);
      groupIds.add(id);
      if (!PORTRAIT_LAYOUT_PRESETS.includes(group.preset)) throw new RequestError(400, `${title} / ${id} 的 preset 无效。`);
      if (group.leftBlank !== undefined && typeof group.leftBlank !== 'boolean') throw new RequestError(400, `${title} / ${id} 的 leftBlank 必须为 boolean。`);
      if (group.rightBlank !== undefined && typeof group.rightBlank !== 'boolean') throw new RequestError(400, `${title} / ${id} 的 rightBlank 必须为 boolean。`);
      if (String(group.title || '').length > 120 || String(group.text || '').length > 500) throw new RequestError(400, `${title} / ${id} 的文字过长。`);
      const items = (Array.isArray(group.items) ? group.items : []).filter((item) => {
        const photoId = String(item?.photoId || '').trim();
        if (bookPortraitIds.has(photoId)) return true;
        removedPhotoReferences += 1;
        return false;
      });
      group.items = items;
      if (items.length > presetCapacity[group.preset]) throw new RequestError(400, `${title} / ${id} 的照片数量超过 ${group.preset} 预设上限。`);
      items.forEach((item) => {
        const photoId = String(item?.photoId || '').trim();
        if (!bookPortraitIds.has(photoId)) throw new RequestError(400, `${photoId || id} 不是 Selected 或 Archive Portrait。`);
        if (usedPhotoIds.has(photoId)) throw new RequestError(400, `${photoId} 不能在同一本书中重复出现。`);
        if (item.cover !== undefined && typeof item.cover !== 'boolean') throw new RequestError(400, `${photoId} 的 cover 必须为 true 或 false。`);
        usedPhotoIds.add(photoId);
      });
    });
  });

  const normalized = normalizePortraitBooks(collection);
  data.portraitBooks = normalized;
  return { books: normalized, removedPhotoReferences };
}

export async function addCatalogImageToBook(data, book, groupId, hash) {
  const group = book.layout.groups.find(item => item.id === groupId);
  const asset = await lookupImage(hash);
  const matches = photo => asset && (photo.image === asset.image || asset.aliases?.includes(photo.image));
  const photo = migratePortfolioPhotos(data.photos).find(item => item.category === 'portrait' && matches(item)
    && ['selected', 'archive'].includes(getPortfolioStatus(item, 'portrait')));
  if (!photo || !group) throw new RequestError(400, '这张照片无法加入跨页。');
  const usedIds = new Set(data.photos.filter(matches).map(item => item.id));
  if (book.layout.groups.some(item => item.items.some(entry => usedIds.has(entry.photoId)))) {
    throw new RequestError(409, '此照片已经在这本摄影书中。');
  }
  group.items.push({ photoId: photo.id, cover: false });
  return savePortraitBookCollection(data.portraitBooks, data);
}

function completeLayoutRows(rows, photos) {
  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  const used = new Set();
  const normalized = [];

  if (Array.isArray(rows)) {
    rows.forEach((row) => {
      const orientation = row?.orientation === 'portrait' ? 'portrait' : 'landscape';
      const photoIds = Array.isArray(row?.photoIds)
        ? row.photoIds.filter((id) => {
            const photo = photosById.get(id);
            if (!photo || used.has(id) || photo.orientation !== orientation) return false;
            used.add(id);
            return true;
          }).slice(0, maxPhotosForOrientation(orientation))
        : [];
      if (photoIds.length) normalized.push({ orientation, photoIds });
    });
  }

  photos.filter((photo) => !used.has(photo.id)).forEach((photo) => {
    const orientation = photo.orientation === 'portrait' ? 'portrait' : 'landscape';
    const lastCompatible = [...normalized].reverse().find((row) => row.orientation === orientation && row.photoIds.length < maxPhotosForOrientation(orientation));
    if (lastCompatible) lastCompatible.photoIds.push(photo.id);
    else normalized.push({ orientation, photoIds: [photo.id] });
  });
  return normalized;
}

async function createSeries(request, data) {
  const body = await request.json();
  const title = String(body.title || '').trim();
  const slug = validateSlug(body.slug);
  const year = String(body.year || '').trim();
  const description = String(body.description || '').trim();
  if (!title) throw new RequestError(400, '请填写 Series 名称。');

  const series = data.series;
  if (!Array.isArray(series)) throw new RequestError(500, 'series.json 不是有效数组。');
  if (series.some((item) => normalizeSlug(item.slug) === slug)) {
    throw new RequestError(409, `Slug “${slug}” 已存在，请换一个名称或调整 slug。`);
  }

  const highestOrder = series.reduce((highest, item, index) => {
    const order = Number(item.order);
    return Math.max(highest, Number.isFinite(order) ? order : index + 1);
  }, 0);
  const item = { slug, title, year, description, coverImage: '', order: highestOrder + 1 };
  data.series = [...series, item];
  return { series: item };
}

async function setSeriesCover(request, data) {
  const body = await request.json();
  const slug = validateSlug(body.slug);
  const image = String(body.image || '').trim();
  const { series, photos } = data;
  const seriesIndex = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (seriesIndex < 0) throw new RequestError(404, `找不到 Series：${slug}`);
  if (!photos.some((photo) => photo.series === slug && photo.image === image)) {
    throw new RequestError(400, '封面必须来自当前 Series。');
  }
  series[seriesIndex] = { ...series[seriesIndex], coverImage: image };
  data.series = series;
  return { series: series[seriesIndex] };
}

async function reorderSeries(request, data) {
  const body = await request.json();
  const slugs = Array.isArray(body.slugs) ? body.slugs.map(normalizeSlug) : [];
  const series = data.series;
  const currentSlugs = new Set(series.map((item) => normalizeSlug(item.slug)));
  if (slugs.length !== series.length || slugs.some((slug) => !currentSlugs.has(slug)) || new Set(slugs).size !== slugs.length) {
    throw new RequestError(400, 'Series 顺序数据不完整。');
  }
  const bySlug = new Map(series.map((item) => [normalizeSlug(item.slug), item]));
  const ordered = slugs.map((slug, index) => ({ ...bySlug.get(slug), order: index + 1 }));
  data.series = ordered;
  return { series: ordered };
}

async function updateSeries(request, data) {
  const body = await request.json();
  const slug = validateSlug(body.slug);
  const title = String(body.title || '').trim();
  const year = String(body.year || '').trim();
  const description = String(body.description || '').trim();
  const coverImage = String(body.coverImage || '').trim();
  const requestedOrder = Number(body.order);
  if (!title) throw new RequestError(400, '请填写 Series 名称。');
  if (!Number.isFinite(requestedOrder) || requestedOrder < 1) throw new RequestError(400, 'Series 顺序必须是大于 0 的数字。');

  const series = data.series;
  const index = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (index < 0) throw new RequestError(404, `找不到 Series：${slug}`);
  series[index] = { ...series[index], title, year, description, coverImage, order: Math.round(requestedOrder) };
  const ordered = series
    .map((item, originalIndex) => ({ item, originalIndex, order: Number.isFinite(Number(item.order)) ? Number(item.order) : originalIndex + 1 }))
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)
    .map(({ item }, orderIndex) => ({ ...item, order: orderIndex + 1 }));
  data.series = ordered;
  return { series: ordered, item: ordered.find((item) => item.slug === slug) };
}

async function saveSeriesLayout(request, data) {
  const body = await request.json();
  const slug = validateSlug(body.slug);
  const rows = Array.isArray(body.layoutRows) ? body.layoutRows : [];
  const { series, photos } = data;
  const index = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (index < 0) throw new RequestError(404, `找不到 Series：${slug}`);
  const seriesPhotos = photos.filter((photo) => photo.series === slug);
  const normalized = completeLayoutRows(rows, seriesPhotos);
  const requestedIds = rows.flatMap((row) => Array.isArray(row?.photoIds) ? row.photoIds : []);
  if (new Set(requestedIds).size !== requestedIds.length) throw new RequestError(400, '同一张照片不能出现在多个布局行中。');
  if (normalized.flatMap((row) => row.photoIds).length !== seriesPhotos.length) throw new RequestError(400, '布局必须包含当前 Series 的全部照片。');
  series[index] = { ...series[index], layoutRows: normalized };
  data.series = series;
  return { series: series[index] };
}

async function deleteSeries(request, data) {
  const { slug: input } = await request.json();
  const slug = validateSlug(input);
  if (!data.series.some(item => item.slug === slug)) throw new RequestError(404, `找不到 Series：${slug}`);
  const removedPhotoCount = data.photos.filter(photo => photo.series === slug).length;
  data.photos = data.photos.filter(photo => photo.series !== slug);
  data.series = data.series.filter(item => item.slug !== slug).map((item, index) => ({ ...item, order: index + 1 }));
  return { series: data.series, removedPhotoCount, trashPath: '' };
}

export async function attachImages(body, data, isSeries = false) {
  const category = isSeries ? 'series' : body.category;
  const slug = isSeries ? validateSlug(body.slug) : '';
  const series = isSeries ? data.series.find(item => item.slug === slug) : null;
  if (isSeries ? !series : !CATEGORIES.has(category)) throw new RequestError(400, '无效的分类或 Series。');
  if (!Array.isArray(body.images) || !body.images.length || body.images.length > 100) {
    throw new RequestError(400, '请选择 1–100 张照片。');
  }
  const inTarget = photo => isSeries ? photo.series === slug : photo.category === category;
  const existing = data.photos.filter(inTarget);
  const ids = new Set(data.photos.map(photo => String(photo.id).toLowerCase()));
  const additions = [];
  const manifestPatch = {};
  let sequence = 1;
  let order = existing.reduce((max, photo) => Math.max(max, Number(isSeries ? photo.order : photo.archiveOrder) || 0), 0);
  let titleNumber = isSeries ? existing.length : existing.reduce((max, photo) => Math.max(max, Number(String(photo.title).match(/^No\.\s*(\d+)$/i)?.[1]) || 0), 0);

  for (const reference of body.images) {
    const asset = await lookupImage(reference?.hash);
    if (!asset?.entry) throw new RequestError(400, '图片尚未同步到 R2。');
    const { image, entry } = asset;
    manifestPatch[image] = data.imageManifest[image] || entry;
    if ([...existing, ...additions].some(photo => photo.image === image || asset.aliases?.includes(photo.image))) continue;
    const idPrefix = slug || category;
    while (ids.has(`${idPrefix}-${String(sequence).padStart(3, '0')}`)) sequence++;
    const id = `${idPrefix}-${String(sequence++).padStart(3, '0')}`;
    ids.add(id);
    order++;
    titleNumber++;
    additions.push({
      id, title: `No. ${String(titleNumber).padStart(2, '0')}`, category, series: slug, image,
      location: '', date: String(series?.year || new Date().getFullYear()), featured: false,
      aspect: entry.width / entry.height, orientation: entry.height > entry.width ? 'portrait' : 'landscape',
      alt: isSeries ? `${series.title} photograph ${titleNumber} by Bo David` : `${category.charAt(0).toUpperCase() + category.slice(1)} photograph by Bo David`,
      ...(isSeries ? { order, size: 'standard' } : { portfolioStatus: 'archive', selectedOrder: null, archiveOrder: order }),
      ...(typeof reference.sharedLibraryId === 'string' && { sharedLibraryId: reference.sharedLibraryId }),
    });
  }

  Object.assign(data.imageManifest, manifestPatch);
  data.photos.push(...additions);
  if (series && additions.length) {
    if (!series.coverImage) series.coverImage = additions[0].image;
    if (Array.isArray(series.layoutRows)) series.layoutRows = completeLayoutRows(series.layoutRows, [...existing, ...additions]);
  }
  return { photos: additions, photoData: data.photos, manifestPatch, series, skipped: body.images.length - additions.length };
}

export const editorHandlers = new Map([
  ['import-photos', async (request, data) => attachImages(await request.json(), data)],
  ['series/upload', async (request, data) => attachImages(await request.json(), data, true)],
  ['series/create', createSeries], ['series/cover', setSeriesCover], ['series/reorder', reorderSeries],
  ['series/update', updateSeries], ['series/delete', deleteSeries], ['series/layout', saveSeriesLayout],
  ['photos/save', savePhotos], ['gallery-layouts/save', saveGalleryLayout], ['site/save', saveSiteIntro],
  ['portrait-books/save', async (request, data) => savePortraitBookCollection((await request.json())?.books, data)],
  ['portfolio-categories/save', savePortfolioCategoryCovers],
]);
