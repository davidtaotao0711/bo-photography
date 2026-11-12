import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const cookieName = '__Host-bo-photo-editor';
const sessionSeconds = 8 * 60 * 60;
const equals = (left, right) => timingSafeEqual(...[left, right].map(value => createHash('sha256').update(value).digest()));

export function signEditorValue(payload) {
  const secret = process.env.BO_EDITOR_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
  if (!secret) throw Object.assign(new Error('编辑器访问尚未配置。'), { status: 503 });
  const value = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

export function verifyEditorValue(token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  try {
    const value = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
    return equals(token, signEditorValue(value)) && value.expires > Date.now() ? value : null;
  } catch { return null; }
}

export function editorAuthorized(context) {
  if (import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(context.url.hostname) &&
      /^(?:127\.|::1$|::ffff:127\.)/.test(context.clientAddress)) return true;
  return verifyEditorValue(context.cookies.get(cookieName)?.value)?.kind === 'session';
}

export function signInEditor(context, key) {
  const expected = process.env.BO_EDITOR_ACCESS_KEY;
  if (!expected || typeof key !== 'string' || key.length > 256 || !equals(key, expected)) return false;
  context.cookies.set(cookieName, signEditorValue({ kind: 'session', expires: Date.now() + sessionSeconds * 1000 }), {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: sessionSeconds,
  });
  return true;
}
