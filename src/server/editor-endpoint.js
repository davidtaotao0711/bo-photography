import { readEditorData, writeEditorData } from './editor-data.mjs';
import { editorAuthorized, signInEditor } from './editor-auth.mjs';
import { addCatalogImageToBook, attachImages, CATEGORIES, editorHandlers } from './editor-service.mjs';
import { imageUpload } from './editor-images.mjs';
import { browseCatalog, catalogHashes, tagCatalogAsset } from './editor-catalog.mjs';

const json = (body, status = 200, revision) => Response.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', ...(revision !== undefined && { 'X-Editor-Revision': revision || 'initial' }),
} });
const uploadActions = new Set(['begin', 'part', 'complete', 'abort']);

function sameOrigin(request, url) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false;
  const origin = URL.parse(request.headers.get('origin') || '');
  if (!origin) return false;
  if (import.meta.env.DEV) return origin.origin === url.origin;
  if (origin.protocol !== 'https:') return false;
  return [url.host, request.headers.get('host'), request.headers.get('x-forwarded-host'),
    process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].includes(origin.host);
}

async function sharedLibrary(context, route) {
  const post = context.request.method === 'POST';
  if (route === 'shared-library/tags') {
    if (!post) return json({ error: '请求方式无效。' }, 405);
    const { id, tags } = await context.request.json();
    return json(await tagCatalogAsset(id, tags));
  }
  const { data, revision } = await readEditorData();
  if (post && context.request.headers.get('x-editor-revision') !== (revision || 'initial')) {
    return json({ error: '编辑内容已更新，请刷新后重试。' }, 409);
  }
  const body = post ? await context.request.json() : { category: context.url.searchParams.get('category') };
  const target = String(body.category || 'library');
  const book = target.startsWith('book:') ? data.portraitBooks.books.find(item => item.slug === target.slice(5)) : null;
  const category = book ? 'portrait' : target;
  const isSeries = category.startsWith('series:');
  const slug = isSeries ? category.slice(7) : '';
  if (isSeries ? !data.series.some(item => item.slug === slug) : !CATEGORIES.has(category) && (post || target !== 'library')) {
    return json({ error: '请先选择有效的照片分类或 Series。' }, 400);
  }
  if (!post) return json(await browseCatalog(data, context.url.searchParams, target));
  const images = catalogHashes(body.ids, book ? 1 : 100).map(hash => ({ hash }));
  if (book && !book.layout.groups.some(group => group.id === body.group)) return json({ error: '找不到此跨页。' }, 404);
  const result = await attachImages({ category, slug, images }, data, isSeries);
  if (book) await addCatalogImageToBook(data, book, body.group, images[0].hash);
  const next = book || result.photos.length ? await writeEditorData(data, revision) : revision;
  return json({ ...result, ...(book && { books: data.portraitBooks }) }, 200, next);
}

export async function ALL(context) {
  const { request, url } = context;
  const route = context.params.route || '';
  const post = request.method === 'POST';
  if (!post && request.method !== 'GET') return json({ error: '请求方式无效。' }, 405);
  if (post && !sameOrigin(request, url)) {
    return json({ error: '只允许从本站编辑器提交。' }, 403);
  }
  try {
    if (route === 'session' && post) {
      const { key } = await request.json();
      return signInEditor(context, key) ? json({ authenticated: true }) : json({ error: '编辑口令不正确。' }, 401);
    }
    if (!editorAuthorized(context)) return json({ error: '请重新登录编辑器。' }, 401);
    if (route === 'health' && !post) return json({ editorApiVersion: 12 });
    if (route === 'shared-library' || route === 'shared-library/tags') return await sharedLibrary(context, route);
    if (!post) return json({ error: '请求方式无效。' }, 405);
    const action = route.startsWith('upload/') ? route.slice(7) : '';
    if (uploadActions.has(action)) return json(await imageUpload(request, action));
    const handler = editorHandlers.get(route);
    if (!handler) return json({ error: '找不到编辑接口。' }, 404);
    const { data, revision } = await readEditorData();
    const expected = request.headers.get('x-editor-revision');
    if (expected !== (revision || 'initial')) return json({ error: '编辑内容已更新，请刷新后重试。' }, 409);
    const result = await handler(request, data);
    return json(result, 200, await writeEditorData(data, revision));
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: '请求内容无效。' }, 400);
    if (error.status && error.status < 500) return json({ error: error.message }, error.status);
    console.error('[photo-editor]', route, error.name, error.$metadata?.httpStatusCode || error.status || '');
    return json({ error: error.status === 503 ? error.message : '保存或上传未完成，请重试。' }, error.status || 502);
  }
}
