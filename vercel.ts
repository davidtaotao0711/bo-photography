import { publicImageBaseUrl } from './scripts/image-origin.mjs';
import baseConfig from './config/vercel.base.json' with { type: 'json' };

const imageOrigin = publicImageBaseUrl();

export const config = {
  ...baseConfig,
  ...(imageOrigin && {
    rewrites: [{ source: '/images/:path*', destination: `${imageOrigin}/images/:path*` }],
  }),
};
