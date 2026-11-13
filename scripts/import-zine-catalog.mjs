import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createR2Client } from './r2-client.mjs';
import { originalPath, readSharedLibrary } from './shared-photo-library.mjs';
import { catalogQuery, registerCatalogAsset } from '../src/server/editor-catalog.mjs';
import { storeImage } from '../src/server/editor-images.mjs';

const [mode, root] = process.argv.slice(2);
if (!['--dry-run', '--apply'].includes(mode) || !root) {
  throw new Error('Usage: node scripts/import-zine-catalog.mjs --dry-run|--apply <zine-repo>');
}

const library = await readSharedLibrary(root);
const paths = new Map();
for (const photo of library.photos) {
  const path = await originalPath(library.root, photo);
  const bytes = await readFile(path);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (!paths.has(hash)) paths.set(hash, { path, name: photo.alt || photo.id });
}
console.log(`${library.photos.length} Zine library records; ${paths.size} unique SHA-256 files.`);
if (mode === '--apply') {
  await catalogQuery([{ sql: 'SELECT count(*) FROM editor_assets' }]);
  createR2Client({ privateBucket: true }).client.destroy();
  let imported = 0;
  for (const [hash, { path, name }] of paths) {
    const bytes = await readFile(path);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('A Zine source changed during import.');
    await registerCatalogAsset(await storeImage(bytes, hash), name);
    if (++imported % 25 === 0) console.log(`${imported}/${paths.size} indexed.`);
  }
  console.log(`${imported} Zine assets available in the cloud library.`);
}
