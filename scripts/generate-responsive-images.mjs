import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceRoot = path.join(root, 'public', 'images');
const outputRoot = path.join(sourceRoot, 'generated');
const manifestPath = path.join(root, 'src', 'data', 'image-manifest.json');
const targetWidths = [480, 800, 1200, 1600];
const sourceExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const exists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const toPublicPath = (filePath) => `/${path.relative(path.join(root, 'public'), filePath).replace(/\\/g, '/')}`;
const toOutputName = (relativePath, width) => {
  const parsed = path.parse(relativePath);
  const safeDir = parsed.dir.replace(/[\\/]/g, '__');
  const base = safeDir ? `${safeDir}__${parsed.name}` : parsed.name;
  return `${base}-${width}.webp`;
};

const walk = async (dir) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === outputRoot) continue;
      files.push(...await walk(fullPath));
    } else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
};

await fs.mkdir(outputRoot, { recursive: true });

const files = await walk(sourceRoot);
const manifest = {};

for (const file of files) {
  const metadata = await sharp(file).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) continue;

  const relative = path.relative(sourceRoot, file);
  const usableWidths = targetWidths.filter((targetWidth) => targetWidth < width);
  const largestGeneratedWidth = Math.min(width, 1600);
  if (!usableWidths.includes(largestGeneratedWidth)) usableWidths.push(largestGeneratedWidth);

  const variants = [];
  for (const targetWidth of [...new Set(usableWidths)].sort((a, b) => a - b)) {
    const outputName = toOutputName(relative, targetWidth);
    const outputPath = path.join(outputRoot, outputName);
    if (!await exists(outputPath)) {
      await sharp(file)
        .rotate()
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: 76, effort: 3 })
        .toFile(outputPath);
    }

    variants.push({
      width: targetWidth,
      src: toPublicPath(outputPath),
    });
  }

  manifest[toPublicPath(file)] = {
    width,
    height,
    variants,
  };
}

await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Generated ${Object.keys(manifest).length} responsive image entries.`);
