import { publicImageBaseUrl } from '../../../../scripts/image-origin.mjs';

export function GET({ url, redirect }) {
  const base = publicImageBaseUrl();
  return base ? redirect(`${base}${url.pathname}`, 302) : new Response(null, { status: 404 });
}
