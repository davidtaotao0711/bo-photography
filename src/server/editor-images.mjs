import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { createR2Client } from '../../scripts/r2-client.mjs';
import legacy from '../data/editor-image-hashes.json' with { type: 'json' };
import manifest from '../data/image-manifest.json' with { type: 'json' };
import { signEditorValue, verifyEditorValue } from './editor-auth.mjs';

export const chunkSize = 4 * 1024 * 1024;
const maxFileSize = 128 * 1024 * 1024;
const formats = { jpeg: ['jpg', 'image/jpeg'], png: ['png', 'image/png'], webp: ['webp', 'image/webp'] };
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = (value, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(value).digest(encoding);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const prefix = hash => `images/editor/${hash}`;
const assetKey = hash => `${prefix(hash)}/asset.json`;
const partKey = (upload, index) => `editor-upload-staging/${upload.id}/${index}`;
let connection;

async function send(Command, options) {
  connection ??= createR2Client();
  return connection.client.send(new Command({ Bucket: connection.bucket, ...options }));
}

async function readObject(key) {
  try {
    const result = await send(GetObjectCommand, { Key: key });
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function putImmutable(key, bytes, type, contentHash = digest(bytes), staging = false) {
  try {
    await send(PutObjectCommand, {
      Key: key, Body: bytes, ContentLength: bytes.length, ContentType: type,
      ContentMD5: digest(bytes, 'md5', 'base64'), IfNoneMatch: '*', Metadata: { sha256: contentHash },
      CacheControl: staging ? 'private, no-store' : 'public, max-age=31536000, immutable',
    });
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 412) throw error;
    const existing = await send(HeadObjectCommand, { Key: key });
    if (existing.ContentLength !== bytes.length || existing.Metadata?.sha256 !== contentHash) {
      throw fail('R2 中已有不同内容，未覆盖原文件。', 409);
    }
  }
}

export async function lookupImage(hash) {
  if (!isHash(hash)) throw fail('图片哈希无效。');
  const aliases = legacy[hash];
  if (aliases) return { hash, image: aliases[0], aliases, entry: manifest[aliases[0]] };
  const asset = await readObject(assetKey(hash));
  return asset ? JSON.parse(asset.toString('utf8')) : null;
}

export async function storeImage(bytes, knownHash = digest(bytes)) {
  const existing = await lookupImage(knownHash);
  if (existing) return existing;
  const source = sharp(bytes, { limitInputPixels: 100_000_000 });
  let metadata;
  try { metadata = await source.metadata(); } catch { throw fail('图片无法解码。'); }
  const format = formats[metadata.format];
  if (!format || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
    throw fail('请选择单帧 JPG、PNG 或 WebP 图片。');
  }
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const [extension, mimeType] = format;
  const key = `${prefix(knownHash)}/original.${extension}`;
  const asset = { hash: knownHash, image: `/${key}`, entry: { width, height, variants: [], placeholder: '' } };
  const pipeline = () => source.clone().rotate();
  const maxWidth = Math.min(width, 1600);
  const widths = [...new Set([480, 800, 1200].filter(size => size < maxWidth).concat(maxWidth))];
  const placeholder = await pipeline().resize({ width: 24, height: 24, fit: 'inside', withoutEnlargement: true }).blur(8).webp({ quality: 36 }).toBuffer();
  asset.entry.placeholder = `data:image/webp;base64,${placeholder.toString('base64')}`;
  await putImmutable(key, bytes, mimeType, knownHash);
  for (const size of widths) {
    if (metadata.format === 'webp' && size === width && !rotated) {
      asset.entry.variants.push({ width: size, src: asset.image });
      continue;
    }
    const variant = await pipeline().resize({ width: size, withoutEnlargement: true }).webp({ quality: 76, effort: 3 }).toBuffer();
    const variantKey = `${prefix(knownHash)}/${size}.webp`;
    await putImmutable(variantKey, variant, 'image/webp');
    asset.entry.variants.push({ width: size, src: `/${variantKey}` });
  }
  await putImmutable(assetKey(knownHash), Buffer.from(JSON.stringify(asset)), 'application/json');
  return asset;
}

export async function addHeroVariants(image, entry) {
  if (!entry || !image.startsWith('/images/')) return entry;
  const maxWidth = Math.min(entry.width, 3840);
  const currentWidth = Math.max(0, ...entry.variants.map(variant => variant.width));
  if (maxWidth <= currentWidth) return entry;
  const bytes = await readObject(image.slice(1));
  if (!bytes) throw fail('首页封面原图不在 R2。', 409);
  const widths = [...new Set([2400, 3200, maxWidth])].filter(width => width > currentWidth && width <= maxWidth);
  const hash = digest(bytes);
  const variants = [...entry.variants];
  for (const width of widths) {
    const key = `${prefix(hash)}/hero-${width}.webp`;
    const variant = await sharp(bytes, { limitInputPixels: 100_000_000 }).rotate()
      .resize({ width, withoutEnlargement: true }).webp({ quality: 90, effort: 5 }).toBuffer();
    await putImmutable(key, variant, 'image/webp');
    variants.push({ width, src: `/${key}` });
  }
  return { ...entry, variants };
}

function stagingCipherKey(upload, index) {
  return createHash('sha256').update(process.env.R2_SECRET_ACCESS_KEY).update(partKey(upload, index)).digest();
}

function encryptPart(upload, index, bytes) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', stagingCipherKey(upload, index), iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decryptPart(upload, index, bytes) {
  const decipher = createDecipheriv('aes-256-gcm', stagingCipherKey(upload, index), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
}

async function clearParts(upload) {
  const Objects = Array.from({ length: Math.ceil(upload.size / chunkSize) }, (_, index) => ({ Key: partKey(upload, index) }));
  const result = await send(DeleteObjectsCommand, { Delete: { Objects, Quiet: true } });
  if (result.Errors?.length) throw fail('R2 临时分片清理失败，请重试。', 502);
}

export async function imageUpload(request, action) {
  if (action === 'begin') {
    const { hash, size } = await request.json();
    if (!isHash(hash) || !Number.isInteger(size) || size < 1 || size > maxFileSize) throw fail('图片大小或哈希无效（单张上限 128 MiB）。');
    if (await lookupImage(hash)) return { hash, reused: true };
    return { token: signEditorValue({ kind: 'upload', id: randomUUID(), hash, size, expires: Date.now() + 3600_000 }) };
  }
  const upload = verifyEditorValue(request.headers.get('x-editor-upload'));
  if (upload?.kind !== 'upload') throw fail('上传会话已失效，请重新选择图片。');
  if (action === 'part') {
    const rawIndex = request.headers.get('x-editor-part');
    const index = Number(rawIndex);
    if (!rawIndex || !Number.isInteger(index) || index < 0 || index >= Math.ceil(upload.size / chunkSize)) throw fail('图片分片编号无效。');
    const length = Math.min(chunkSize, upload.size - index * chunkSize);
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length !== length) throw fail('图片分片不完整。');
    await putImmutable(partKey(upload, index), encryptPart(upload, index, bytes), 'application/octet-stream', digest(bytes), true);
    return {};
  }
  if (action === 'abort') {
    await clearParts(upload);
    return {};
  }
  if (action !== 'complete') throw fail('未知上传操作。', 404);
  try {
    if (await lookupImage(upload.hash)) return { hash: upload.hash, reused: true };
    const bytes = Buffer.alloc(upload.size);
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const index = offset / chunkSize;
      const part = await readObject(partKey(upload, index));
      if (!part) throw fail('图片分片缺失，请重试。', 409);
      const plain = decryptPart(upload, index, part);
      if (plain.length !== Math.min(chunkSize, bytes.length - offset)) throw fail('图片分片不完整。');
      plain.copy(bytes, offset);
    }
    if (digest(bytes) !== upload.hash) throw fail('图片校验失败，请重试。');
    await storeImage(bytes, upload.hash);
    return { hash: upload.hash, reused: false };
  } finally {
    await clearParts(upload);
  }
}
