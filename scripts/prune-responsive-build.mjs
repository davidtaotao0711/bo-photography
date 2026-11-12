import { existsSync } from 'node:fs';
import { readdir, unlink } from 'node:fs/promises';
import { publicImageBaseUrl } from './image-origin.mjs';
import { isObsoleteResponsiveAsset, responsiveVariantPaths } from './responsive-build-assets.mjs';

const adapterOutput = new URL('../.vercel/output/static/', import.meta.url);
const imageOutput = new URL('images/', existsSync(adapterOutput) ? adapterOutput : new URL('../dist/', import.meta.url));

if (publicImageBaseUrl()) {
  if (existsSync(imageOutput)) throw new Error('R2 is enabled but dist/images was still bundled.');
  console.log('R2 is enabled. No local images in the deployment static directory.');
} else {
  const output = new URL('generated/', imageOutput);
  const variants = await responsiveVariantPaths();
  const files = await readdir(output, { withFileTypes: true });
  const obsolete = files.filter((file) =>
    file.isFile() && isObsoleteResponsiveAsset(`/images/generated/${file.name}`, variants)
  );

  for (const { name } of obsolete) {
    await unlink(new URL(encodeURIComponent(name), output));
  }
  console.log(`Removed ${obsolete.length} unused responsive images from the build.`);
}
