import { readFile } from 'node:fs/promises';

export async function responsiveVariantPaths() {
  const manifest = JSON.parse(await readFile(new URL('../src/data/image-manifest.json', import.meta.url), 'utf8'));
  return new Set(Object.values(manifest).flatMap(({ variants }) => variants.map(({ src }) => src)));
}

export function isObsoleteResponsiveAsset(publicPath, variants) {
  return /^\/images\/generated\/[^/]+-\d+\.webp$/.test(publicPath) && !variants.has(publicPath);
}
