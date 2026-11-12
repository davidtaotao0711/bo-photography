import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

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
