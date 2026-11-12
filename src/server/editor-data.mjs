import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createR2Client } from '../../scripts/r2-client.mjs';
import photos from '../data/photos.json' with { type: 'json' };
import series from '../data/series.json' with { type: 'json' };
import site from '../data/site.json' with { type: 'json' };
import portraitBooks from '../data/portrait-books.json' with { type: 'json' };
import portfolioCategories from '../data/portfolio-categories.json' with { type: 'json' };
import imageManifest from '../data/image-manifest.json' with { type: 'json' };
import galleryLayouts from '../data/gallery-layouts.json' with { type: 'json' };

const baseline = { photos, series, site, portraitBooks, portfolioCategories, imageManifest, galleryLayouts };
const stateKey = () => `editor-state/${process.env.BO_EDITOR_STATE_KEY || (process.env.VERCEL_ENV === 'preview' ? 'preview' : 'production')}.json.enc`;
let connection;

function encryptionKey() {
  const value = process.env.BO_EDITOR_DATA_KEY;
  if (!/^[a-f0-9]{64}$/i.test(value ?? '')) {
    throw Object.assign(new Error('编辑数据存储尚未配置。'), { status: 503 });
  }
  return Buffer.from(value, 'hex');
}

async function send(Command, options) {
  connection ??= createR2Client();
  return connection.client.send(new Command({ Bucket: connection.bucket, Key: stateKey(), ...options }));
}

export async function readEditorData() {
  if (!process.env.BO_EDITOR_DATA_KEY) return { data: structuredClone(baseline), revision: '' };
  let result;
  try { result = await send(GetObjectCommand, {}); }
  catch (error) {
    if (error.$metadata?.httpStatusCode === 404) return { data: structuredClone(baseline), revision: '' };
    throw error;
  }
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  decipher.setAAD(Buffer.from(stateKey()));
  const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  return { data: { ...structuredClone(baseline), ...data }, revision: result.ETag };
}

export async function writeEditorData(data, revision) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(stateKey()));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  try {
    const result = await send(PutObjectCommand, {
      Body: body, ContentType: 'application/octet-stream', CacheControl: 'private, no-store',
      ContentMD5: createHash('md5').update(body).digest('base64'),
      ...(revision ? { IfMatch: revision } : { IfNoneMatch: '*' }),
    });
    return result.ETag;
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 412) {
      throw Object.assign(new Error('编辑内容已更新，请刷新后重试。'), { status: 409 });
    }
    throw error;
  }
}
