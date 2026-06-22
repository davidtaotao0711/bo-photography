import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const publicDirectory = path.join(projectRoot, 'public');
const imagesDirectory = path.join(publicDirectory, 'images');
const photosFile = path.join(projectRoot, 'src', 'data', 'photos.json');

const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const validCategories = new Set(['street', 'portrait', 'natural']);
const categoryDirectories = [
  { directory: 'street', category: 'street' },
  { directory: 'portrait', category: 'portrait' },
  { directory: 'scenes', category: 'natural' },
  { directory: 'natural', category: 'natural' },
];
const altPrefixes = {
  street: 'Street photograph',
  portrait: 'Portrait photograph',
  natural: 'Natural landscape photograph',
};

function normalizeImagePath(imagePath) {
  return imagePath.replaceAll('\\', '/').toLowerCase();
}

function toWebsitePath(filePath) {
  return `/${path.relative(publicDirectory, filePath).split(path.sep).join('/')}`;
}

function describeFile(filePath) {
  return path
    .parse(filePath)
    .name.replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findImages(directory) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findImages(entryPath)));
    } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

function getSeriesCategories(photos) {
  const categories = new Map();

  for (const photo of photos) {
    if (photo.series && validCategories.has(photo.category) && !categories.has(photo.series)) {
      categories.set(photo.series, photo.category);
    }
  }

  return categories;
}

function getNextNumber(photos) {
  const existingNumbers = photos
    .map((photo) => /^No\.\s*(\d+)$/i.exec(photo.title)?.[1])
    .filter(Boolean)
    .map(Number);

  return Math.max(photos.length, 0, ...existingNumbers) + 1;
}

async function collectCandidates(photos) {
  const candidates = [];

  for (const source of categoryDirectories) {
    const directory = path.join(imagesDirectory, source.directory);
    const files = await findImages(directory);

    for (const filePath of files) {
      candidates.push({ filePath, category: source.category, series: '' });
    }
  }

  const seriesDirectory = path.join(imagesDirectory, 'series');
  let seriesEntries = [];

  try {
    seriesEntries = await readdir(seriesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const categoryBySeries = getSeriesCategories(photos);

  for (const entry of seriesEntries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const files = await findImages(path.join(seriesDirectory, slug));
    const category = categoryBySeries.get(slug) ?? 'street';

    if (files.length > 0 && !categoryBySeries.has(slug)) {
      console.warn(`Series "${slug}" has no existing category; defaulting new photos to "street".`);
    }

    for (const filePath of files) {
      candidates.push({ filePath, category, series: slug });
    }
  }

  return candidates.sort((a, b) =>
    toWebsitePath(a.filePath).localeCompare(toWebsitePath(b.filePath), 'en', {
      numeric: true,
      sensitivity: 'base',
    }),
  );
}

async function main() {
  const source = await readFile(photosFile, 'utf8');
  const photos = JSON.parse(source);

  if (!Array.isArray(photos)) {
    throw new TypeError('src/data/photos.json must contain a JSON array.');
  }

  const existingImages = new Set(photos.map((photo) => normalizeImagePath(photo.image)));
  const existingIds = new Set(photos.map((photo) => String(photo.id).toLowerCase()));
  const candidates = await collectCandidates(photos);
  const currentYear = String(new Date().getFullYear());
  let nextNumber = getNextNumber(photos);
  let added = 0;

  for (const candidate of candidates) {
    const image = toWebsitePath(candidate.filePath);
    const normalizedImage = normalizeImagePath(image);

    if (existingImages.has(normalizedImage)) continue;

    const id = path.parse(candidate.filePath).name;
    const normalizedId = id.toLowerCase();

    if (existingIds.has(normalizedId)) {
      console.warn(`Skipped ${image}: photo id "${id}" already exists. Rename the image file and try again.`);
      continue;
    }

    const description = describeFile(candidate.filePath);

    photos.push({
      id,
      title: `No. ${String(nextNumber).padStart(2, '0')}`,
      category: candidate.category,
      series: candidate.series,
      location: '',
      date: currentYear,
      image,
      featured: false,
      orientation: 'landscape',
      alt: description
        ? `${altPrefixes[candidate.category]}: ${description}`
        : altPrefixes[candidate.category],
    });

    existingImages.add(normalizedImage);
    existingIds.add(normalizedId);
    nextNumber += 1;
    added += 1;
    console.log(`Added ${image}`);
  }

  await writeFile(photosFile, `${JSON.stringify(photos, null, 2)}\n`, 'utf8');

  if (added === 0) {
    console.log('No new photos found. photos.json was checked and formatted.');
  } else {
    console.log(`Imported ${added} new photo${added === 1 ? '' : 's'} into src/data/photos.json.`);
  }
}

main().catch((error) => {
  console.error(`Photo import failed: ${error.message}`);
  process.exitCode = 1;
});
