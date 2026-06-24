import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

const CATEGORY_ENDPOINT = '/__editor/import-photos';
const SERIES_CREATE_ENDPOINT = '/__editor/series/create';
const SERIES_UPLOAD_ENDPOINT = '/__editor/series/upload';
const SERIES_COVER_ENDPOINT = '/__editor/series/cover';
const SERIES_REORDER_ENDPOINT = '/__editor/series/reorder';
const CATEGORIES = new Set(['street', 'portrait', 'scenes']);
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

function dataPaths(projectRoot) {
  return {
    photos: path.join(projectRoot, 'src', 'data', 'photos.json'),
    series: path.join(projectRoot, 'src', 'data', 'series.json'),
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
