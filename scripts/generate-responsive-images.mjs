import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const targetWidths = [480, 800, 1200, 1600];
const heroTargetWidths = [960, 1600, 2400, 3200, 3840];
const sourceExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const pathsFor = (projectRoot) => {
  const sourceRoot = path.join(projectRoot, 'public', 'images');
  return {
    sourceRoot,
    outputRoot: path.join(sourceRoot, 'generated'),
    manifestPath: path.join(projectRoot, 'src', 'data', 'image-manifest.json'),
    sitePath: path.join(projectRoot, 'src', 'data', 'site.json'),
  };
};

const toPublicPath = (projectRoot, filePath) => `/${path.relative(path.join(projectRoot, 'public'), filePath).replace(/\\/g, '/')}`;
const toOutputName = (relativePath, width) => {
  const parsed = path.parse(relativePath);
  const safeDir = parsed.dir.replace(/[\\/]/g, '__');
  const base = safeDir ? `${safeDir}__${parsed.name}` : parsed.name;
  return `${base}-${width}.webp`;
};

const walk = async (dir, outputRoot) => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (fullPath === outputRoot) continue;
      files.push(...await walk(fullPath, outputRoot));
    } else if (sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
};

async function isStale(outputPath, sourceStat) {
  try {
    const outputStat = await fs.stat(outputPath);
    return sourceStat.mtimeMs > outputStat.mtimeMs;
  } catch {
    return true;
  }
}

/** Generate only the variants for one source image. */
export async function generateResponsiveVariants(sourcePath, { projectRoot = process.cwd() } = {}) {
  const { sourceRoot, outputRoot, sitePath } = pathsFor(projectRoot);
  await fs.mkdir(outputRoot, { recursive: true });
  const metadata = await sharp(sourcePath).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) throw new Error(`Unable to read dimensions for ${sourcePath}`);

  let site = {};
  try {
    site = JSON.parse(await fs.readFile(sitePath, 'utf8'));
  } catch {
    // Image optimization must not make an upload fail when optional site data is unavailable.
  }
  const relative = path.relative(sourceRoot, sourcePath);
  const normalizedRelative = relative.replace(/\\/g, '/');
  const publicPath = toPublicPath(projectRoot, sourcePath);
  const introImages = new Set(Array.isArray(site.homeIntroImages) ? site.homeIntroImages : []);
  const isHeroImage = normalizedRelative === 'home/cover.jpg' || introImages.has(publicPath);
  const widthsForImage = isHeroImage ? heroTargetWidths : targetWidths;
  const maxGeneratedWidth = isHeroImage ? 3840 : 1600;
  const webpQuality = isHeroImage ? 90 : 76;
  const usableWidths = widthsForImage.filter((targetWidth) => targetWidth < width);
  const largestGeneratedWidth = Math.min(width, maxGeneratedWidth);
  if (!usableWidths.includes(largestGeneratedWidth)) usableWidths.push(largestGeneratedWidth);

  const sourceStat = await fs.stat(sourcePath);
  const variants = [];
  let generated = 0;
  for (const targetWidth of [...new Set(usableWidths)].sort((a, b) => a - b)) {
    const outputName = toOutputName(relative, targetWidth);
    const outputPath = path.join(outputRoot, outputName);
    if (await isStale(outputPath, sourceStat)) {
      await sharp(sourcePath)
        .rotate()
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: webpQuality, effort: isHeroImage ? 5 : 3 })
        .toFile(outputPath);
      generated += 1;
    }
    variants.push({ width: targetWidth, src: toPublicPath(projectRoot, outputPath) });
  }

  return { publicPath, entry: { width, height, variants }, generated };
}

/** Update one manifest entry without scanning or rewriting the photo library. */
export async function updateResponsiveManifest(sourcePath, { projectRoot = process.cwd() } = {}) {
  const { manifestPath } = pathsFor(projectRoot);
  const result = await generateResponsiveVariants(sourcePath, { projectRoot });
  let manifest = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    // A missing manifest is rebuilt incrementally from this upload.
  }
  manifest[result.publicPath] = result.entry;
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return result;
}

/** Existing full-library command, retained for explicit manual regeneration. */
export async function generateResponsiveImages({ projectRoot = process.cwd() } = {}) {
  const { sourceRoot, outputRoot, manifestPath } = pathsFor(projectRoot);
  await fs.mkdir(outputRoot, { recursive: true });
  const files = await walk(sourceRoot, outputRoot);
  const manifest = {};
  for (const file of files) {
    const result = await generateResponsiveVariants(file, { projectRoot });
    manifest[result.publicPath] = result.entry;
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Generated ${Object.keys(manifest).length} responsive image entries.`);
  return manifest;
}

const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryFile === fileURLToPath(import.meta.url)) {
  generateResponsiveImages().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
