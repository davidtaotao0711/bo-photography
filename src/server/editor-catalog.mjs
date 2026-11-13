import legacy from '../data/editor-image-hashes.json' with { type: 'json' };
import manifest from '../data/image-manifest.json' with { type: 'json' };
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { createR2Client } from '../../scripts/r2-client.mjs';

const pageSize = 36;
const hashPattern = /^[a-f0-9]{64}$/;
const byPath = new Map(Object.entries(legacy).flatMap(([hash, paths]) => paths.map(path => [path, hash])));
const error = (message, status = 503) => Object.assign(new Error(message), { status });

function d1Config() {
  const { R2_ACCOUNT_ID: account, BO_D1_DATABASE_ID: database, BO_D1_API_TOKEN: token } = process.env;
  if (!database && !token) return null;
  if (!/^[a-f\d]{32}$/i.test(account ?? '') || !/^[a-f\d-]{36}$/i.test(database ?? '') || !token) {
    throw error('Cloudflare D1 配置不完整。');
  }
  return { account, database, token };
}

export async function catalogQuery(batch) {
  const config = d1Config();
  if (!config) throw error('Cloudflare D1 尚未配置。');
  const { account, database, token } = config;
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch }), signal: AbortSignal.timeout(12000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.result) || payload.result.some(item => !item.success)) {
    throw error('云端图库数据库暂时不可用，请重试。');
  }
  return payload.result;
}

function imageHash(image) {
  return byPath.get(image) ?? /^\/images\/editor\/([a-f0-9]{64})\//.exec(image ?? '')?.[1];
}

function assetRow({ hash, image, entry }, name = '', created = 0) {
  const thumbnail = entry.variants.find(variant => variant.width >= 320)?.src || image;
  return { hash, image, thumbnail, width: entry.width, height: entry.height,
    name: String(name).split(/[\\/]/).at(-1).trim().slice(0, 180), tags: '[]', created_at: created };
}

const legacyAssets = Object.entries(legacy).filter(([, paths]) => !/^\/images\/(?:social\/|grain\.png$)/.test(paths[0]))
  .map(([hash, [image]]) => assetRow({ hash, image, entry: manifest[image] }, image.split('/').at(-1)));

function assetStatement(row) {
  const { hash, image, thumbnail, width, height, name, created_at } = row;
  return { sql: `INSERT INTO editor_assets (hash,image,thumbnail,width,height,name,created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(hash) DO UPDATE SET name = CASE WHEN editor_assets.name = '' THEN excluded.name ELSE editor_assets.name END`,
  params: [hash, image, thumbnail, width, height, name, created_at] };
}

function aliasStatement(image, hash) {
  return { sql: 'INSERT INTO editor_asset_aliases (image,hash) VALUES (?,?) ON CONFLICT(image) DO NOTHING', params: [image, hash] };
}

export async function registerCatalogAsset(asset, name) {
  if (!d1Config() || byPath.has(asset.image)) return;
  await catalogQuery([assetStatement(assetRow(asset, name, Date.now())), aliasStatement(asset.image, asset.hash)]);
}

export async function readCloudDescriptors() {
  const { client, bucket: Bucket } = createR2Client();
  const keys = [];
  try {
    let token;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: 'images/editor/', ContinuationToken: token }));
      keys.push(...(page.Contents ?? []).filter(item => /^images\/editor\/[a-f0-9]{64}\/asset\.json$/.test(item.Key)));
      token = page.NextContinuationToken;
    } while (token);
    const assets = [];
    for (let offset = 0; offset < keys.length; offset += 8) {
      assets.push(...await Promise.all(keys.slice(offset, offset + 8).map(async ({ Key, LastModified }) => {
        const object = await client.send(new GetObjectCommand({ Bucket, Key }));
        const asset = JSON.parse(await object.Body.transformToString());
        if (!asset.entry || `images/editor/${asset.hash}/asset.json` !== Key || asset.image !== `/${Key.slice(0, -10)}display.webp`) {
          throw error('R2 图库存在无效的素材记录。');
        }
        return assetRow(asset, '', LastModified?.getTime());
      })));
    }
    return assets;
  } finally {
    client.destroy();
  }
}

export async function seedCatalog() {
  const rows = [...legacyAssets, ...await readCloudDescriptors()];
  for (let offset = 0; offset < rows.length; offset += 25) {
    await catalogQuery(rows.slice(offset, offset + 25).flatMap(row => [assetStatement(row),
      ...(legacy[row.hash] ?? [row.image]).map(image => aliasStatement(image, row.hash))]));
  }
  return rows.length;
}

function describeUsage(data, target, scope, query) {
  const scopeIds = new Set();
  const matched = new Set();
  const added = new Set();
  const byId = new Map();
  for (const photo of data.photos) {
    const hash = imageHash(photo.image);
    if (!hash) continue;
    byId.set(photo.id, hash);
    const membership = photo.series ? `series:${photo.series}` : photo.category;
    if (scope === membership || (scope === 'series' && photo.series)) scopeIds.add(hash);
    if ([photo.id, photo.title, photo.alt, photo.location, photo.image, ...(Array.isArray(photo.tags) ? photo.tags : [])]
      .some(value => String(value ?? '').toLowerCase().includes(query))) matched.add(hash);
    if (membership === target) added.add(hash);
  }
  const bookSlug = target.startsWith('book:') ? target.slice(5) : '';
  for (const book of data.portraitBooks.books) {
    for (const group of book.layout.groups) {
      for (const { photoId } of group.items) {
        const hash = byId.get(photoId);
        if (!hash) continue;
        if (scope === 'portrait-books') scopeIds.add(hash);
        if (book.slug === bookSlug) added.add(hash);
      }
    }
  }
  return { scopeIds, matched, added };
}

export async function browseCatalog(data, search, target) {
  const query = (search.get('q') ?? '').trim().toLowerCase().slice(0, 120);
  const direction = search.get('direction') ?? 'all';
  const scope = search.get('scope') ?? 'all';
  if (!['all', 'portrait', 'landscape', 'square'].includes(direction)) throw error('无效的照片方向。', 400);
  const requestedPage = Number(search.get('page'));
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(10000, requestedPage)) : 1;
  const idsOnly = search.get('ids') === '1';
  const { scopeIds, matched, added } = describeUsage(data, target, scope, query);
  const configured = Boolean(d1Config());
  const selectable = row => !added.has(row.hash);
  let rows;
  let total;
  if (configured) {
    const conditions = [];
    const params = [];
    if (query) {
      conditions.push('(instr(lower(name), ?) OR instr(lower(image), ?) OR instr(hash, ?) OR EXISTS (SELECT 1 FROM json_each(tags) WHERE instr(lower(value), ?)) OR hash IN (SELECT value FROM json_each(?)))');
      params.push(query, query, query, query, JSON.stringify([...matched]));
    }
    if (scope !== 'all') {
      conditions.push('hash IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify([...scopeIds]));
    }
    if (direction === 'portrait') conditions.push('height > width');
    if (direction === 'landscape') conditions.push('width > height');
    if (direction === 'square') conditions.push('width = height');
    if (idsOnly) {
      conditions.push('hash NOT IN (SELECT value FROM json_each(?))');
      params.push(JSON.stringify([...added]));
    }
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const base = `FROM editor_assets${where}`;
    const queryBatch = [{ sql: `SELECT ${idsOnly ? 'hash' : '*'} ${base} ORDER BY created_at DESC, hash LIMIT ? OFFSET ?`,
      params: [...params, idsOnly ? 101 : pageSize, idsOnly ? 0 : (page - 1) * pageSize] }];
    if (!idsOnly) queryBatch.push({ sql: `SELECT count(*) AS total ${base}`, params });
    const results = await catalogQuery(queryBatch);
    rows = results[0].results;
    total = results[1]?.results[0].total ?? rows.length;
  } else {
    const assets = [...legacyAssets, ...await readCloudDescriptors()];
    const filtered = assets.filter(row => {
      const orientation = row.width === row.height ? 'square' : row.width > row.height ? 'landscape' : 'portrait';
      return (scope === 'all' || scopeIds.has(row.hash)) && (direction === 'all' || orientation === direction)
        && (!query || matched.has(row.hash) || `${row.name} ${row.image} ${row.hash}`.toLowerCase().includes(query))
        && (!idsOnly || selectable(row));
    }).sort((a, b) => b.created_at - a.created_at || a.hash.localeCompare(b.hash));
    total = filtered.length;
    rows = idsOnly ? filtered.slice(0, 101) : filtered.slice((page - 1) * pageSize, page * pageSize);
  }
  if (idsOnly) return { ids: rows.map(row => row.hash) };
  return { page, pageSize, total, catalogTags: configured, photos: rows.map(row => ({ id: row.hash, alt: row.name || row.image.split('/').at(-2),
    width: row.width, height: row.height, thumbnail: row.thumbnail, added: !selectable(row),
    tags: JSON.parse(row.tags), image: row.image })) };
}

export function catalogHashes(ids, limit = 100) {
  if (!Array.isArray(ids) || !ids.length || ids.length > limit || ids.some(hash => typeof hash !== 'string' || !hashPattern.test(hash))) {
    throw error(`请选择 1–${limit} 张照片。`, 400);
  }
  return [...new Set(ids)];
}

export async function tagCatalogAsset(hash, tags) {
  catalogHashes([hash]);
  if (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || tag.length > 40)) throw error('标签最多 20 个，每个不超过 40 字。', 400);
  const labels = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))];
  const [result] = await catalogQuery([{ sql: 'UPDATE editor_assets SET tags = ? WHERE hash = ?', params: [JSON.stringify(labels), hash] }]);
  if (!result.meta.changes) throw error('找不到这张照片。', 404);
  return { tags: labels };
}
