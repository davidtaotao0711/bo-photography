import sharp from 'sharp';

export async function legacyDisplayImage(input, key) {
  const meta = await sharp(input).metadata();
  const { width, height } = meta.autoOrient ?? meta;
  if (!width || !height || !['jpeg', 'png', 'webp'].includes(meta.format)) {
    throw new Error(`Unsupported display image: ${key}`);
  }
  const photo = !/^images\/(?:generated\/|social\/|grain\.png$)/.test(key);
  if (!photo && Math.max(width, height) <= 2000) return input;

  let pipeline = sharp(input).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).keepIccProfile();
  if (meta.format === 'jpeg') pipeline = pipeline.jpeg({ quality: 90, mozjpeg: true });
  if (meta.format === 'webp') pipeline = pipeline.webp({ quality: 89, effort: 5 });
  if (meta.format === 'png') pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
  const output = await pipeline.toBuffer();
  if (photo && output.equals(input)) throw new Error(`Display image equals the source file: ${key}`);
  return output;
}
