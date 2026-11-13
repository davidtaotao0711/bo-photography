import { readFile } from 'node:fs/promises';
import { catalogQuery, seedCatalog } from '../src/server/editor-catalog.mjs';

const schema = await readFile(new URL('./editor-catalog.sql', import.meta.url), 'utf8');
await catalogQuery([{ sql: schema }]);
const imported = await seedCatalog();
const [assets, aliases] = await catalogQuery([
  { sql: 'SELECT count(*) AS count FROM editor_assets' },
  { sql: 'SELECT count(*) AS count FROM editor_asset_aliases' },
]);
console.log(`Verified ${imported} source records; D1 has ${assets.results[0].count} assets and ${aliases.results[0].count} compatible paths.`);
