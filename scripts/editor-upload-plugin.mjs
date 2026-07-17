import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { photoCategorySlugs } from '../src/data/categories.js';
import { migratePortfolioPhotos } from '../src/utils/portfolio-status.js';

const CATEGORY_ENDPOINT = '/__editor/import-photos';
const SERIES_CREATE_ENDPOINT = '/__editor/series/create';
const SERIES_UPLOAD_ENDPOINT = '/__editor/series/upload';
const SERIES_COVER_ENDPOINT = '/__editor/series/cover';
const SERIES_REORDER_ENDPOINT = '/__editor/series/reorder';
const SERIES_UPDATE_ENDPOINT = '/__editor/series/update';
const SERIES_DELETE_ENDPOINT = '/__editor/series/delete';
const SERIES_LAYOUT_ENDPOINT = '/__editor/series/layout';
const PHOTOS_SAVE_ENDPOINT = '/__editor/photos/save';
const SITE_SAVE_ENDPOINT = '/__editor/site/save';
const CATEGORIES = new Set(photoCategorySlugs);
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function webRequestFrom(request, pathname) {
  return new Request(`http://localhost${pathname}`, {
    method: request.method,
    headers: request.headers,
    body: Readable.toWeb(request),
    duplex: 'half',
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function savePhotos(request, projectRoot) {
  const body = await webRequestFrom(request, PHOTOS_SAVE_ENDPOINT).json().catch(() => {
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
  await writeJson(dataPaths(projectRoot).photos, normalizedPhotos);
  return { photos: normalizedPhotos, count: normalizedPhotos.length };
}

async function saveSiteIntro(request, projectRoot) {
  const body = await webRequestFrom(request, SITE_SAVE_ENDPOINT).json().catch(() => {
    throw new RequestError(400, '首页封面设置不是有效 JSON。');
  });
  const homeIntroImages = body?.homeIntroImages;
  if (!Array.isArray(homeIntroImages) || homeIntroImages.length !== 6) {
    throw new RequestError(400, '首页封面必须正好包含 6 张图片。');
  }
  if (new Set(homeIntroImages).size !== homeIntroImages.length) {
    throw new RequestError(400, '首页封面不能重复使用同一张图片。');
  }

  const paths = dataPaths(projectRoot);
  const [site, photos] = await Promise.all([readJson(paths.site), readJson(paths.photos)]);
  homeIntroImages.forEach((image, index) => {
    const photo = photos.find((item) => item.image === image);
    if (!photo) throw new RequestError(400, `第 ${index + 1} 张封面不在 photos.json 中。`);
    if (photo.orientation !== 'landscape') throw new RequestError(400, `第 ${index + 1} 张封面不是横图。`);
  });

  const updatedSite = { ...site, homeIntroImages };
  await writeJson(paths.site, updatedSite);
  return { site: updatedSite };
}

function dataPaths(projectRoot) {
  return {
    photos: path.join(projectRoot, 'src', 'data', 'photos.json'),
    series: path.join(projectRoot, 'src', 'data', 'series.json'),
    site: path.join(projectRoot, 'src', 'data', 'site.json'),
  };
}

function normalizeExtension(fileName) {
  const extension = path.extname(fileName || '').toLowerCase();
  if (!EXTENSIONS.has(extension)) {
    throw new RequestError(400, `${fileName || '未知文件'} 不是支持的 JPG、PNG 或 WebP 图片。`);
  }
  return extension === '.jpeg' ? '.jpg' : extension;
}

function validateUpload(upload) {
  if (!upload || typeof upload.arrayBuffer !== 'function') {
    throw new RequestError(400, '上传内容不是有效图片。');
  }
  return normalizeExtension(upload.name);
}

function nextCategorySequence(files, category) {
  const pattern = new RegExp(`^${category}-(\\d+)\\.(?:jpe?g|png|webp)$`, 'i');
  return files.reduce((highest, file) => {
    const match = file.match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
}

function nextSeriesSequence(files) {
  const pattern = /^(\d+)\.(?:jpe?g|png|webp)$/i;
  return files.reduce((highest, file) => {
    const match = file.match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0) + 1;
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

function photoMetadata(value, index) {
  const metadata = Array.isArray(value) ? value[index] || {} : {};
  const orientation = metadata.orientation === 'portrait' ? 'portrait' : 'landscape';
  const ratio = Number(metadata.aspect);
  return {
    orientation,
    aspect: Number.isFinite(ratio) && ratio > 0 ? Number(ratio.toFixed(4)) : orientation === 'portrait' ? 0.75 : 1.5,
  };
}

function maxPhotosForOrientation(orientation) {
  return orientation === 'portrait' ? 4 : 3;
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

async function importCategoryPhotos(request, projectRoot) {
  const formData = await webRequestFrom(request, CATEGORY_ENDPOINT).formData();
  const category = String(formData.get('category') || '');
  const uploads = formData.getAll('photos');

  if (!CATEGORIES.has(category)) throw new RequestError(400, '照片分类无效。');
  if (!uploads.length) throw new RequestError(400, '没有收到照片。');
  const extensions = uploads.map(validateUpload);

  const targetDirectory = path.join(projectRoot, 'public', 'images', category);
  await mkdir(targetDirectory, { recursive: true });
  const existingFiles = await readdir(targetDirectory);
  let sequence = nextCategorySequence(existingFiles, category);
  const imported = [];

  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    const id = `${category}-${String(sequence).padStart(3, '0')}`;
    const fileName = `${id}${extensions[index]}`;
    await writeFile(path.join(targetDirectory, fileName), Buffer.from(await upload.arrayBuffer()), { flag: 'wx' });
    imported.push({ index, id, image: `/images/${category}/${fileName}`, originalName: upload.name });
    sequence += 1;
  }

  return { files: imported };
}

async function createSeries(request, projectRoot) {
  const body = await webRequestFrom(request, SERIES_CREATE_ENDPOINT).json();
  const title = String(body.title || '').trim();
  const slug = validateSlug(body.slug);
  const year = String(body.year || '').trim();
  const description = String(body.description || '').trim();
  if (!title) throw new RequestError(400, '请填写 Series 名称。');

  const paths = dataPaths(projectRoot);
  const series = await readJson(paths.series);
  if (!Array.isArray(series)) throw new RequestError(500, 'series.json 不是有效数组。');
  if (series.some((item) => normalizeSlug(item.slug) === slug)) {
    throw new RequestError(409, `Slug “${slug}” 已存在，请换一个名称或调整 slug。`);
  }

  const highestOrder = series.reduce((highest, item, index) => {
    const order = Number(item.order);
    return Math.max(highest, Number.isFinite(order) ? order : index + 1);
  }, 0);
  const item = { slug, title, year, description, coverImage: '', order: highestOrder + 1 };
  const seriesRoot = path.join(projectRoot, 'public', 'images', 'series');
  const directory = path.join(seriesRoot, slug);
  await mkdir(seriesRoot, { recursive: true });
  try {
    await mkdir(directory, { recursive: false });
  } catch (error) {
    if (error.code === 'EEXIST') throw new RequestError(409, `文件夹 “${slug}” 已存在，请调整 slug。`);
    throw error;
  }
  await writeJson(paths.series, [...series, item]);
  return { series: item };
}

async function uploadSeriesPhotos(request, projectRoot) {
  const formData = await webRequestFrom(request, SERIES_UPLOAD_ENDPOINT).formData();
  const slug = validateSlug(formData.get('slug'));
  const uploads = formData.getAll('photos');
  if (!uploads.length) throw new RequestError(400, '没有收到照片。');
  const extensions = uploads.map(validateUpload);
  let metadata = [];
  try {
    metadata = JSON.parse(String(formData.get('metadata') || '[]'));
  } catch {
    throw new RequestError(400, '图片尺寸信息无效。');
  }

  const paths = dataPaths(projectRoot);
  const [series, photos] = await Promise.all([readJson(paths.series), readJson(paths.photos)]);
  const seriesIndex = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (seriesIndex < 0) throw new RequestError(404, `找不到 Series：${slug}`);

  const targetDirectory = path.join(projectRoot, 'public', 'images', 'series', slug);
  await mkdir(targetDirectory, { recursive: true });
  const existingFiles = await readdir(targetDirectory);
  let sequence = nextSeriesSequence(existingFiles);
  const seriesPhotos = photos.filter((photo) => photo.series === slug);
  let nextOrder = seriesPhotos.reduce((highest, photo, index) => {
    const order = Number(photo.order);
    return Math.max(highest, Number.isFinite(order) ? order : index + 1);
  }, 0) + 1;
  const existingIds = new Set(photos.map((photo) => String(photo.id).toLowerCase()));
  const additions = [];
  const createdPaths = [];

  try {
    for (let index = 0; index < uploads.length; index += 1) {
      while (existingIds.has(`${slug}-${String(sequence).padStart(3, '0')}`)) sequence += 1;
      const upload = uploads[index];
      const number = String(sequence).padStart(3, '0');
      const id = `${slug}-${number}`;
      const fileName = `${number}${extensions[index]}`;
      const filePath = path.join(targetDirectory, fileName);
      const image = `/images/series/${slug}/${fileName}`;
      const details = photoMetadata(metadata, index);
      await writeFile(filePath, Buffer.from(await upload.arrayBuffer()), { flag: 'wx' });
      createdPaths.push(filePath);
      additions.push({
        id,
        title: `No. ${String(seriesPhotos.length + index + 1).padStart(2, '0')}`,
        category: 'series',
        series: slug,
        location: '',
        date: String(series[seriesIndex].year || new Date().getFullYear()),
        image,
        featured: false,
        order: nextOrder,
        size: 'standard',
        aspect: details.aspect,
        orientation: details.orientation,
        alt: `${series[seriesIndex].title} photograph ${seriesPhotos.length + index + 1} by Bo David`,
      });
      existingIds.add(id);
      nextOrder += 1;
      sequence += 1;
    }

    const updatedSeries = { ...series[seriesIndex] };
    if (!updatedSeries.coverImage && additions.length) updatedSeries.coverImage = additions[0].image;
    if (Array.isArray(updatedSeries.layoutRows)) {
      updatedSeries.layoutRows = completeLayoutRows(updatedSeries.layoutRows, [...seriesPhotos, ...additions]);
    }
    series[seriesIndex] = updatedSeries;
    await writeJson(paths.photos, [...photos, ...additions]);
    await writeJson(paths.series, series);
    return { photos: additions, series: updatedSeries };
  } catch (error) {
    await Promise.all(createdPaths.map((filePath) => unlink(filePath).catch(() => {})));
    throw error;
  }
}

async function setSeriesCover(request, projectRoot) {
  const body = await webRequestFrom(request, SERIES_COVER_ENDPOINT).json();
  const slug = validateSlug(body.slug);
  const image = String(body.image || '').trim();
  const paths = dataPaths(projectRoot);
  const [series, photos] = await Promise.all([readJson(paths.series), readJson(paths.photos)]);
  const seriesIndex = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (seriesIndex < 0) throw new RequestError(404, `找不到 Series：${slug}`);
  if (!photos.some((photo) => photo.series === slug && photo.image === image)) {
    throw new RequestError(400, '封面必须来自当前 Series。');
  }
  series[seriesIndex] = { ...series[seriesIndex], coverImage: image };
  await writeJson(paths.series, series);
  return { series: series[seriesIndex] };
}

async function reorderSeries(request, projectRoot) {
  const body = await webRequestFrom(request, SERIES_REORDER_ENDPOINT).json();
  const slugs = Array.isArray(body.slugs) ? body.slugs.map(normalizeSlug) : [];
  const paths = dataPaths(projectRoot);
  const series = await readJson(paths.series);
  const currentSlugs = new Set(series.map((item) => normalizeSlug(item.slug)));
  if (slugs.length !== series.length || slugs.some((slug) => !currentSlugs.has(slug)) || new Set(slugs).size !== slugs.length) {
    throw new RequestError(400, 'Series 顺序数据不完整。');
  }
  const bySlug = new Map(series.map((item) => [normalizeSlug(item.slug), item]));
  const ordered = slugs.map((slug, index) => ({ ...bySlug.get(slug), order: index + 1 }));
  await writeJson(paths.series, ordered);
  return { series: ordered };
}

async function updateSeries(request, projectRoot) {
  const body = await webRequestFrom(request, SERIES_UPDATE_ENDPOINT).json();
  const slug = validateSlug(body.slug);
  const title = String(body.title || '').trim();
  const year = String(body.year || '').trim();
  const description = String(body.description || '').trim();
  const coverImage = String(body.coverImage || '').trim();
  const requestedOrder = Number(body.order);
  if (!title) throw new RequestError(400, '请填写 Series 名称。');
  if (!Number.isFinite(requestedOrder) || requestedOrder < 1) throw new RequestError(400, 'Series 顺序必须是大于 0 的数字。');

  const paths = dataPaths(projectRoot);
  const series = await readJson(paths.series);
  const index = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (index < 0) throw new RequestError(404, `找不到 Series：${slug}`);
  series[index] = { ...series[index], title, year, description, coverImage, order: Math.round(requestedOrder) };
  const ordered = series
    .map((item, originalIndex) => ({ item, originalIndex, order: Number.isFinite(Number(item.order)) ? Number(item.order) : originalIndex + 1 }))
    .sort((a, b) => a.order - b.order || a.originalIndex - b.originalIndex)
    .map(({ item }, orderIndex) => ({ ...item, order: orderIndex + 1 }));
  await writeJson(paths.series, ordered);
  return { series: ordered, item: ordered.find((item) => item.slug === slug) };
}

async function saveSeriesLayout(request, projectRoot) {
  const body = await webRequestFrom(request, SERIES_LAYOUT_ENDPOINT).json();
  const slug = validateSlug(body.slug);
  const rows = Array.isArray(body.layoutRows) ? body.layoutRows : [];
  const paths = dataPaths(projectRoot);
  const [series, photos] = await Promise.all([readJson(paths.series), readJson(paths.photos)]);
  const index = series.findIndex((item) => normalizeSlug(item.slug) === slug);
  if (index < 0) throw new RequestError(404, `找不到 Series：${slug}`);
  const seriesPhotos = photos.filter((photo) => photo.series === slug);
  const normalized = completeLayoutRows(rows, seriesPhotos);
  const requestedIds = rows.flatMap((row) => Array.isArray(row?.photoIds) ? row.photoIds : []);
  if (new Set(requestedIds).size !== requestedIds.length) throw new RequestError(400, '同一张照片不能出现在多个布局行中。');
  if (normalized.flatMap((row) => row.photoIds).length !== seriesPhotos.length) throw new RequestError(400, '布局必须包含当前 Series 的全部照片。');
  series[index] = { ...series[index], layoutRows: normalized };
  await writeJson(paths.series, series);
  return { series: series[index] };
}

async function deleteSeries(request, projectRoot) {
  const body = await webRequestFrom(request, SERIES_DELETE_ENDPOINT).json();
  const slug = validateSlug(body.slug);
  const paths = dataPaths(projectRoot);
  const [series, photos] = await Promise.all([readJson(paths.series), readJson(paths.photos)]);
  const item = series.find((entry) => normalizeSlug(entry.slug) === slug);
  if (!item) throw new RequestError(404, `找不到 Series：${slug}`);

  const sourceDirectory = path.join(projectRoot, 'public', 'images', 'series', slug);
  const trashRoot = path.join(projectRoot, 'trash', 'series');
  let trashDirectory = path.join(trashRoot, slug);
  let folderMoved = false;
  try {
    await access(sourceDirectory);
    await mkdir(trashRoot, { recursive: true });
    try {
      await access(trashDirectory);
      trashDirectory = path.join(trashRoot, `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    } catch {}
    await rename(sourceDirectory, trashDirectory);
    folderMoved = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const remainingSeries = series
    .filter((entry) => normalizeSlug(entry.slug) !== slug)
    .map((entry, index) => ({ ...entry, order: index + 1 }));
  const removedPhotos = photos.filter((photo) => photo.series === slug);
  const remainingPhotos = photos.filter((photo) => photo.series !== slug);

  try {
    await writeJson(paths.photos, remainingPhotos);
    await writeJson(paths.series, remainingSeries);
  } catch (error) {
    await Promise.all([
      writeJson(paths.photos, photos).catch(() => {}),
      writeJson(paths.series, series).catch(() => {}),
      folderMoved ? rename(trashDirectory, sourceDirectory).catch(() => {}) : Promise.resolve(),
    ]);
    throw error;
  }
  return {
    series: remainingSeries,
    removedPhotoCount: removedPhotos.length,
    trashPath: folderMoved ? path.relative(projectRoot, trashDirectory).split(path.sep).join('/') : '',
  };
}

export function editorUploadPlugin() {
  return {
    name: 'bo-david-editor-upload',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        const handlers = new Map([
          [CATEGORY_ENDPOINT, importCategoryPhotos],
          [SERIES_CREATE_ENDPOINT, createSeries],
          [SERIES_UPLOAD_ENDPOINT, uploadSeriesPhotos],
          [SERIES_COVER_ENDPOINT, setSeriesCover],
          [SERIES_REORDER_ENDPOINT, reorderSeries],
          [SERIES_UPDATE_ENDPOINT, updateSeries],
          [SERIES_DELETE_ENDPOINT, deleteSeries],
          [SERIES_LAYOUT_ENDPOINT, saveSeriesLayout],
          [PHOTOS_SAVE_ENDPOINT, savePhotos],
          [SITE_SAVE_ENDPOINT, saveSiteIntro],
        ]);
        const handler = handlers.get(pathname);
        if (!handler) return next();
        if (request.method !== 'POST') return sendJson(response, 405, { error: '只支持 POST 请求。' });

        try {
          return sendJson(response, 200, await handler(request, process.cwd()));
        } catch (error) {
          server.config.logger.error(error instanceof Error ? (error.stack || error.message) : String(error));
          return sendJson(response, error.status || 500, { error: error.message || '本地编辑操作失败。' });
        }
      });
    },
  };
}
