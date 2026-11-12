export function publicImageBaseUrl(value = process.env.PUBLIC_IMAGE_BASE_URL) {
  if (!value?.trim()) return '';

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('PUBLIC_IMAGE_BASE_URL must be a valid HTTPS base URL.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('PUBLIC_IMAGE_BASE_URL must be an HTTPS base URL without credentials, query or fragment.');
  }
  return url.href.replace(/\/+$/, '');
}
