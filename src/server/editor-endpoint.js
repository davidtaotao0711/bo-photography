import sharp from 'sharp';
import { readEditorData, writeEditorData } from './editor-data.mjs';
import { editorAuthorized, signInEditor } from './editor-auth.mjs';
import { attachImages, CATEGORIES, editorHandlers } from './editor-service.mjs';
import { imageUpload, storeImage } from './editor-images.mjs';
import { alreadyAdded, originalPath, readSharedLibrary, sharedImportForm } from '../../scripts/shared-photo-library.mjs';

const json = (body, status = 200, revision) => Response.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', ...(revision !== undefined && { 'X-Editor-Revision': revision || 'initial' }),
} });
const uploadActions = new Set(['begin', 'part', 'complete', 'abort']);

async function sharedLibrary(context, route) {
  if (!import.meta.env.DEV) return json({ error: '共享图库仅在本地 Editor 可用。' }, 404);
  const library = await readSharedLibrary();
  if (route.endsWith('/image') && context.request.method === 'GET') {
    const photo = library.photos.find(item => item.id === context.url.searchParams.get('id'));
    if (!photo) return json({ error: '找不到图片。' }, 404);
    const file = await originalPath(library.root, photo);
    const bytes = await sharp(file).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    return new Response(bytes, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=300' } });
  }
  const { data, revision } = await readEditorData();
  const post = context.request.method === 'POST';
  if (post && context.request.headers.get('x-editor-revision') !== (revision || 'initial')) {
    return json({ error: '编辑内容已更新，请刷新后重试。' }, 409);
  }
  const body = post ? await context.request.json() : { category: context.url.searchParams.get('category') };
  const category = String(body.category || '');
  const isSeries = category.startsWith('series:');
  const slug = isSeries ? category.slice(7) : '';
  if (isSeries ? !data.series.some(item => item.slug === slug) : !CATEGORIES.has(category)) {
    return json({ error: '请先选择有效的照片分类或 Series。' }, 400);
  }
  if (!post) return json({ photos: library.photos.map(photo => ({
    id: photo.id, alt: photo.alt, width: photo.width, height: photo.height,
    added: alreadyAdded(photo, data.photos, category), thumbnail: `/__editor/shared-library/image?id=${encodeURIComponent(photo.id)}`,
  })) });
  const selection = await sharedImportForm(library, body.ids, category, data.photos);
  if (!selection.count) return json({ photos: [], photoData: data.photos, skipped: selection.skipped }, 200, revision);
  const metadata = JSON.parse(selection.form.get('metadata'));
  const images = [];
  for (const [index, file] of selection.form.getAll('photos').entries()) {
    const asset = await storeImage(Buffer.from(await file.arrayBuffer()));
    images.push({ hash: asset.hash, sharedLibraryId: metadata[index].sharedLibraryId });
  }
  const result = await attachImages({ category, slug, images }, data, isSeries);
  const next = await writeEditorData(data, revision);
  return json({ ...result, skipped: result.skipped + selection.skipped }, 200, next);
}

export async function ALL(context) {
  const { request, url } = context;
  const route = context.params.route || '';
  const post = request.method === 'POST';
  if (!post && request.method !== 'GET') return json({ error: '请求方式无效。' }, 405);
  if (post && (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site')) {
    return json({ error: '只允许从本站编辑器提交。' }, 403);
  }
  try {
    if (route === 'session' && post) {
      const form = await request.formData();
      return new Response(null, { status: 303, headers: {
        Location: signInEditor(context, form.get('key')) ? '/editor/' : '/editor/sign-in?invalid=1',
        'Cache-Control': 'private, no-store',
      } });
    }
    if (!editorAuthorized(context)) return json({ error: '请重新登录编辑器。' }, 401);
    if (route === 'health' && !post) return json({ editorApiVersion: 11 });
    if (route === 'shared-library' || route === 'shared-library/image') return await sharedLibrary(context, route);
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
