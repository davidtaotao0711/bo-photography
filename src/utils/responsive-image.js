import manifest from '../data/image-manifest.json';

export function getResponsiveImage(src) {
  const entry = manifest[src];
  if (!entry) return null;

  const variants = Array.isArray(entry.variants) ? entry.variants : [];
  return {
    width: entry.width,
    height: entry.height,
    webpSrcset: variants.map((variant) => `${variant.src} ${variant.width}w`).join(', '),
    fallback: variants.at(-1)?.src || src,
  };
}
