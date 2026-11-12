import { defineMiddleware } from 'astro:middleware';
import { readEditorData } from './server/editor-data.mjs';
import { editorAuthorized } from './server/editor-auth.mjs';

export const onRequest = defineMiddleware(async (context, next) => {
  if (/^\/editor\/?$/.test(context.url.pathname) && !editorAuthorized(context)) {
    return context.redirect('/editor/sign-in');
  }
  if (!/^\/(?:__editor|images)\//.test(context.url.pathname) && !context.url.pathname.startsWith('/editor/sign-in')) {
    context.locals.editor = await readEditorData();
  }
  return next();
});
