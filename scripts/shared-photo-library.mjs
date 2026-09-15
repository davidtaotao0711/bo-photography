import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const endpoint = '/__editor/shared-library';
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }

export async function readSharedLibrary(root = process.env.BO_SHARED_LIBRARY_ROOT || path.join(homedir(), 'Desktop', 'translate project', 'work', 'bo-david-portfolio')) {
  let projects;
  try { projects = JSON.parse(await readFile(path.join(root, 'src/data/projects.json'), 'utf8')); }
  catch { throw fail('找不到共享图库。请确认 Zine 项目文件夹还在本机；可通过 BO_SHARED_LIBRARY_ROOT 设置位置。', 503); }
  const library = projects.find(project => project.github?.key === 'unassigned');
  if (!library) throw fail('共享图库中尚未建立 Unassigned，请先在 Zine 编辑器同步照片。', 404);
  const photos = [...new Map(library.images.filter(photo => !photo.placeholderColor).map(photo => [photo.id, photo])).values()];
  return { root, photos };
}

export async function originalPath(root, photo) {
  if (!photo.src?.startsWith('/images/originals/')) throw fail('照片路径无效。');
  const publicRoot = await realpath(path.join(root, 'public'));
  const file = await realpath(path.resolve(publicRoot, `.${photo.src}`));
  const relative = path.relative(publicRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw fail('照片路径超出图库范围。');
  return file;
}

export function alreadyAdded(photo, existing, category) {
  return existing.some(item => (category.startsWith('series:') ? item.series === category.slice(7) : item.category === category) && (
    item.sharedLibraryId === photo.id ||
    (photo.github?.repository === 'davidtaotao0711/bo-photography' && item.image === photo.github.path)
  ));
}

// Reuse the normal importer so copies, responsive images and photos.json use the same workflow.
export async function sharedImportForm(library, ids, category, existing) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100) throw fail('请选择 1–100 张照片。');
  const selected = [...new Set(ids)].map(id => library.photos.find(photo => photo.id === id));
  if (selected.some(photo => !photo)) throw fail('部分照片已不在总库中，请刷新图库后重试。');
  const additions = selected.filter(photo => !alreadyAdded(photo, existing, category));
  const form = new FormData();
  form.set('category', category);
  if (category.startsWith('series:')) form.set('slug', category.slice(7));
  const metadata = [];
  for (const photo of additions) {
    const file = await originalPath(library.root, photo);
    let bytes = await readFile(file);
    let extension = path.extname(file).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
      bytes = await sharp(bytes).rotate().jpeg({ quality: 95 }).toBuffer();
      extension = '.jpg';
    }
    form.append('photos', new Blob([bytes]), `${photo.id}${extension}`);
    metadata.push({ aspect: photo.width / photo.height, orientation: photo.height > photo.width ? 'portrait' : 'landscape', sharedLibraryId: photo.id });
  }
  form.set('metadata', JSON.stringify(metadata));
  return { form, skipped: selected.length - additions.length, count: additions.length };
}

export async function handleSharedLibrary(request, response, projectRoot, importPhotos, categories, importSeriesPhotos) {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname !== endpoint && url.pathname !== `${endpoint}/image`) return false;
  const json = (status, data) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(data));
  };
  try {
    if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) throw fail('只允许从本地编辑器访问图库。', 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw fail('只允许从本地编辑器访问图库。', 403);
    if (!['GET', 'POST'].includes(request.method) || (url.pathname.endsWith('/image') && request.method !== 'GET')) throw fail('请求方式无效。', 405);
    const library = await readSharedLibrary();
    if (url.pathname.endsWith('/image')) {
      const photo = library.photos.find(photo => photo.id === url.searchParams.get('id'));
      if (!photo) throw fail('照片不在共享图库中。', 404);
      const file = await originalPath(library.root, photo);
      const bytes = await sharp(file).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
      response.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      response.end(bytes);
      return true;
    }
    const existing = JSON.parse(await readFile(path.join(projectRoot, 'src/data/photos.json'), 'utf8'));
    async function validTarget(category) {
      if (categories.has(category)) return true;
      if (typeof category !== 'string' || !category.startsWith('series:')) return false;
      const series = JSON.parse(await readFile(path.join(projectRoot, 'src/data/series.json'), 'utf8'));
      return series.some(item => item.slug === category.slice(7));
    }
    if (request.method === 'GET') {
      const category = url.searchParams.get('category');
      if (!await validTarget(category)) throw fail('请先选择一个照片分类或具体系列。');
      json(200, { photos: library.photos.map(photo => ({ id: photo.id, alt: photo.alt, width: photo.width, height: photo.height, added: alreadyAdded(photo, existing, category), thumbnail: `${endpoint}/image?id=${encodeURIComponent(photo.id)}` })) });
      return true;
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of request) { length += chunk.length; if (length > 32768) throw fail('选择内容过大。', 413); chunks.push(chunk); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!await validTarget(body.category)) throw fail('照片分类或系列无效。');
    const selection = await sharedImportForm(library, body.ids, body.category, existing);
    const importer = body.category.startsWith('series:') ? importSeriesPhotos : importPhotos;
    const result = selection.count ? await importer(null, projectRoot, selection.form) : { photos: [], photoData: existing };
    if (!result.photoData) result.photoData = JSON.parse(await readFile(path.join(projectRoot, 'src/data/photos.json'), 'utf8'));
    json(200, { ...result, skipped: selection.skipped });
  } catch (error) { json(error.status || 500, { error: error.message || '读取共享图库失败。' }); }
  return true;
}
