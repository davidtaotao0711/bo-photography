import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { publicImageBaseUrl } from './image-origin.mjs';
import { isObsoleteResponsiveAsset, responsiveVariantPaths } from './responsive-build-assets.mjs';

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const mediaTypes = {
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

async function inventory(directory, variants) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await inventory(path, variants));
      continue;
    }
    const key = relative(publicDirectory, path).split(sep).join('/');
    if (isObsoleteResponsiveAsset(`/${key}`, variants)) continue;
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    const contentType = mediaTypes[extension];
    if (!entry.isFile() || !contentType) throw new Error(`Unexpected image asset: ${key}`);
    files.push({ key, path, contentType, size: (await stat(path)).size });
  }
  return files;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function streamSha256(body) {
  const hash = createHash('sha256');
  for await (const chunk of body) hash.update(chunk);
  return hash.digest('hex');
}

async function remoteMatches(client, object, size, digest, contentType) {
  let head;
  try {
    head = await client.send(new HeadObjectCommand(object));
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
  if (head.ContentLength !== size) throw new Error('Existing object has a different size.');
  if (head.ContentType !== contentType) throw new Error('Existing object has a different content type.');
  const recorded = head.Metadata?.sha256;
  const actual = recorded ?? await streamSha256((await client.send(new GetObjectCommand(object))).Body);
  if (actual !== digest) throw new Error('Existing object has different contents.');
  return true;
}

export async function syncImage(client, bucket, file, { upload = false, publicBase = '' } = {}) {
  const object = { Bucket: bucket, Key: file.key };
  const body = await readFile(file.path);
  if (body.length !== file.size) throw new Error('Local image size changed during the run.');
  const digest = sha256(body);
  let status = upload ? 'skipped' : 'verified';
  if (!await remoteMatches(client, object, body.length, digest, file.contentType)) {
    if (!upload) throw new Error('Missing object in R2.');
    try {
      await client.send(new PutObjectCommand({
        ...object,
        Body: body,
        ContentLength: body.length,
        ContentType: file.contentType,
        ContentMD5: createHash('md5').update(body).digest('base64'),
        Metadata: { sha256: digest },
        IfNoneMatch: '*',
      }));
      status = 'uploaded';
    } catch (error) {
      // A retry can encounter the object created by the original PUT.
      if (error.$metadata?.httpStatusCode !== 412) throw error;
    }
    if (!await remoteMatches(client, object, body.length, digest, file.contentType)) {
      throw new Error('Object missing after upload.');
    }
  }
  if (publicBase) {
    const encodedKey = file.key.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${publicBase}/${encodedKey}`, { signal: AbortSignal.timeout(120_000) });
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || type !== file.contentType) {
      await response.body?.cancel();
      throw new Error(`Public URL returned HTTP ${response.status} with content type ${type || '(missing)'}.`);
    }
    if (!response.body || await streamSha256(response.body) !== digest) {
      throw new Error('Public URL returned different image bytes.');
    }
  }
  return status;
}

async function main() {
  const { values } = parseArgs({ options: {
    'dry-run': { type: 'boolean' }, upload: { type: 'boolean' }, verify: { type: 'boolean' },
    'verify-public': { type: 'boolean' }, key: { type: 'string', multiple: true },
  } });
  if ([values['dry-run'], values.upload, values.verify].filter(Boolean).length > 1) {
    throw new Error('Choose one of --dry-run, --upload or --verify.');
  }
  const active = values.upload || values.verify;
  if (values['verify-public'] && !active) throw new Error('--verify-public requires --upload or --verify.');

  const variants = await responsiveVariantPaths();
  const allFiles = await inventory(resolve(publicDirectory, 'images'), variants);
  const filesByKey = new Map(allFiles.map((file) => [file.key, file]));
  for (const variant of variants) {
    if (!filesByKey.has(variant.slice(1))) throw new Error(`Missing responsive variant: ${variant}`);
  }
  const files = values.key ? [...new Set(values.key)].map((key) => {
    const file = filesByKey.get(key);
    if (!file) throw new Error(`Unknown image key: ${key}`);
    return file;
  }) : allFiles;
  if (files.length === 0) throw new Error('No images selected.');
  const groups = new Map();
  for (const { key, size } of files) {
    const folder = key.split('/').slice(0, -1).slice(0, 2).join('/');
    const group = groups.get(folder) ?? { files: 0, bytes: 0 };
    group.files++;
    group.bytes += size;
    groups.set(folder, group);
  }
  console.table(Object.fromEntries(groups));
  console.log(`${files.length} images, ${files.reduce((sum, file) => sum + file.size, 0)} bytes.`);
  if (values.key) files.forEach(({ key, size }) => console.log(`${key} (${size} bytes)`));
  if (!active) return;

  try {
    process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
  if (!/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID ?? '') || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    throw new Error('Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME in .env.local.');
  }
  const publicBase = values['verify-public'] ? publicImageBaseUrl() : '';
  if (values['verify-public'] && !publicBase) throw new Error('Set PUBLIC_IMAGE_BASE_URL for public verification.');
  const client = new S3Client({
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    region: 'auto', forcePathStyle: true, retryMode: 'standard', maxAttempts: 4,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 120_000, throwOnRequestTimeout: true },
  });
  const totals = { uploaded: 0, skipped: 0, verified: 0, failed: 0 };
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++];
      try {
        const status = await syncImage(client, R2_BUCKET_NAME, file, { upload: values.upload, publicBase });
        totals[status]++;
        if (values.key) console.log(`${status}: ${file.key}`);
      } catch (error) {
        totals.failed++;
        console.error(`${file.key}: ${error.message}`);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker));
  } finally {
    client.destroy();
  }
  console.log(totals);
  if (totals.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
