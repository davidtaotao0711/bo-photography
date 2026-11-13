import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { createR2Client } from '../../scripts/r2-client.mjs';
import legacy from '../data/editor-image-hashes.json' with { type: 'json' };
import manifest from '../data/image-manifest.json' with { type: 'json' };
import { signEditorValue, verifyEditorValue } from './editor-auth.mjs';
import { registerCatalogAsset } from './editor-catalog.mjs';

export const chunkSize = 4 * 1024 * 1024;
const maxFileSize = 128 * 1024 * 1024;
const formats = new Set(['jpeg', 'png', 'webp']);
const displayEdge = 2000;
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const digest = (value, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(value).digest(encoding);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const prefix = hash => `images/editor/${hash}`;
const assetKey = hash => `${prefix(hash)}/asset.json`;
const partKey = (upload, index) => `editor-upload-staging/${upload.id}/${index}`;
let connection;
let privateConnection;

function privateStorage() {
  return privateConnection ??= createR2Client({ privateBucket: true });
}

async function send(Command, options, privateBucket = false) {
  const storage = privateBucket ? privateStorage() : (connection ??= createR2Client());
  return storage.client.send(new Command({ Bucket: storage.bucket, ...options }));
}

async function readObject(key, privateBucket = false) {
  try {
    const result = await send(GetObjectCommand, { Key: key }, privateBucket);
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function putImmutable(key, bytes, type, contentHash = digest(bytes), privateBucket = false) {
  try {
    await send(PutObjectCommand, {
      Key: key, Body: bytes, ContentLength: bytes.length, ContentType: type,
      ContentMD5: digest(bytes, 'md5', 'base64'), IfNoneMatch: '*', Metadata: { sha256: contentHash },
      CacheControl: privateBucket ? 'private, no-store' : 'public, max-age=31536000, immutable',
    }, privateBucket);
  } catch (error) {
    if (error.$metadata?.httpStatusCode !== 412) throw error;
    const existing = await send(HeadObjectCommand, { Key: key }, privateBucket);
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
  if (!asset) return null;
  const result = JSON.parse(asset.toString('utf8'));
  if (result.image !== `/${prefix(hash)}/display.webp`) throw fail('旧照片的公开原片需要先迁移。', 409);
  return result;
}

export async function storeImage(bytes, knownHash = digest(bytes)) {
  const existing = await lookupImage(knownHash);
  if (existing) return existing;
  const source = sharp(bytes, { limitInputPixels: 100_000_000 });
  let metadata;
  try { metadata = await source.metadata(); } catch { throw fail('图片无法解码。'); }
  if (!formats.has(metadata.format) || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) {
    throw fail('请选择单帧 JPG、PNG 或 WebP 图片。');
  }
  const pipeline = () => source.clone().rotate().keepIccProfile();
  const display = await pipeline().resize({ width: displayEdge, height: displayEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, effort: 5 }).toBuffer({ resolveWithObject: true });
  const { width, height } = display.info;
  const key = `${prefix(knownHash)}/display.webp`;
  const asset = { hash: knownHash, image: `/${key}`, entry: { width, height, variants: [], placeholder: '' } };
  const maxWidth = Math.min(width, 1600);
  const widths = [...new Set([480, 800, 1200].filter(size => size < maxWidth).concat(maxWidth))];
  const placeholder = await pipeline().resize({ width: 24, height: 24, fit: 'inside', withoutEnlargement: true }).blur(8).webp({ quality: 36 }).toBuffer();
  asset.entry.placeholder = `data:image/webp;base64,${placeholder.toString('base64')}`;
  await archiveOriginal(bytes, knownHash);
  await putImmutable(key, display.data, 'image/webp');
  for (const size of widths) {
    if (size === width) {
      asset.entry.variants.push({ width: size, src: asset.image });
      continue;
    }
    const variant = await pipeline().resize({ width: size, height: displayEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 76, effort: 3 }).toBuffer({ resolveWithObject: true });
    const variantKey = `${prefix(knownHash)}/${size}.webp`;
    await putImmutable(variantKey, variant.data, 'image/webp');
    asset.entry.variants.push({ width: variant.info.width, src: `/${variantKey}` });
  }
  await putImmutable(assetKey(knownHash), Buffer.from(JSON.stringify(asset)), 'application/json');
  return asset;
}

async function archiveOriginal(bytes, hash) {
  const secret = process.env.BO_EDITOR_DATA_KEY;
  if (!/^[a-f0-9]{64}$/i.test(secret ?? '')) throw fail('原片加密存储尚未配置。', 503);
  const key = `editor-originals/${hash}.enc`;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  cipher.setAAD(Buffer.from(key));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  await putImmutable(key, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), 'application/octet-stream', hash, true);
}

export async function addHeroVariants(image, entry) {
  if (!entry || !image.startsWith('/images/')) return entry;
  const maxWidth = Math.min(entry.width, Math.floor(entry.width * displayEdge / Math.max(entry.width, entry.height)));
  const currentWidth = Math.max(0, ...entry.variants.map(variant => variant.width));
  if (maxWidth <= currentWidth) return entry;
  if (image.endsWith('.webp')) return { ...entry, variants: [...entry.variants, { width: maxWidth, src: image }] };
  const bytes = await readObject(image.slice(1));
  if (!bytes) throw fail('首页封面原图不在 R2。', 409);
  const hash = digest(bytes);
  const key = `${prefix(hash)}/hero-${maxWidth}.webp`;
  const variant = await sharp(bytes, { limitInputPixels: 100_000_000 }).rotate().keepIccProfile()
    .resize({ width: maxWidth, height: displayEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, effort: 5 }).toBuffer({ resolveWithObject: true });
  await putImmutable(key, variant.data, 'image/webp');
  return { ...entry, variants: [...entry.variants, { width: variant.info.width, src: `/${key}` }] };
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
  const result = await send(DeleteObjectsCommand, { Delete: { Objects, Quiet: true } }, true);
  if (result.Errors?.length) throw fail('R2 临时分片清理失败，请重试。', 502);
}

export async function imageUpload(request, action) {
  if (action === 'begin') {
    const { hash, size, name } = await request.json();
    if (!isHash(hash) || !Number.isInteger(size) || size < 1 || size > maxFileSize) throw fail('图片大小或哈希无效（单张上限 128 MiB）。');
    const existing = await lookupImage(hash);
    const filename = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} ._()\-]/gu, '').slice(0, 100) : '';
    if (existing) {
      await registerCatalogAsset(existing, filename);
      return { hash, reused: true };
    }
    privateStorage();
    return { token: signEditorValue({ kind: 'cloud-upload', id: randomUUID(), hash, size, name: filename, expires: Date.now() + 3600_000 }) };
  }
  const upload = verifyEditorValue(request.headers.get('x-editor-upload'));
  if (upload?.kind !== 'cloud-upload') throw fail('上传会话已失效，请重新选择图片。');
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
    const existing = await lookupImage(upload.hash);
    if (existing) {
      await registerCatalogAsset(existing, upload.name);
      return { hash: upload.hash, reused: true };
    }
    const bytes = Buffer.alloc(upload.size);
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const index = offset / chunkSize;
      const part = await readObject(partKey(upload, index), true);
      if (!part) throw fail('图片分片缺失，请重试。', 409);
      const plain = decryptPart(upload, index, part);
      if (plain.length !== Math.min(chunkSize, bytes.length - offset)) throw fail('图片分片不完整。');
      plain.copy(bytes, offset);
    }
    if (digest(bytes) !== upload.hash) throw fail('图片校验失败，请重试。');
    const asset = await storeImage(bytes, upload.hash);
    await registerCatalogAsset(asset, upload.name);
    return { hash: upload.hash, reused: false };
  } finally {
    await clearParts(upload);
  }
}
