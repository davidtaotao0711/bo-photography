const partSize = 4 * 1024 * 1024;

export async function editorFetch(url, options) {
  const meta = document.querySelector('meta[name="bo-editor-revision"]');
  const headers = new Headers(options?.headers);
  headers.set('X-Editor-Revision', meta?.content || 'initial');
  const response = await fetch(url, { ...options, headers });
  const revision = response.headers.get('x-editor-revision');
  if (response.ok && revision && meta) meta.content = revision;
  return response;
}

export async function editorPost(url, value) {
  const response = await editorFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
  return readResult(response);
}

async function readResult(response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || '图片上传或保存失败，请重试。'), { status: response.status });
  return result;
}

async function uploadPart(token, index, part) {
  for (let attempt = 0; ; attempt++) {
    try {
      await readResult(await editorFetch('/__editor/upload/part', {
        method: 'POST', body: part, headers: { 'Content-Type': 'application/octet-stream', 'X-Editor-Upload': token, 'X-Editor-Part': String(index) },
      }));
      return;
    } catch (error) {
      if (attempt === 2 || (error.status && error.status < 500)) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

export async function syncEditorImages(files, showProgress) {
  if (files.length > 100) throw new Error('每次最多选择 100 张照片。');
  const images = [];
  for (const [index, file] of files.entries()) {
    if (!file.size || file.size > 128 * 1024 * 1024) throw new Error(`${file.name} 超出单张 128 MiB 的上传上限。`);
    const position = `${index + 1}/${files.length}`;
    showProgress(`检查重复 ${position}`);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    const { token, reused } = await editorPost('/__editor/upload/begin', { hash, size: file.size });
    if (!reused) {
      const headers = { 'X-Editor-Upload': token };
      try {
        for (let offset = 0; offset < file.size; offset += partSize) {
          showProgress(`上传 ${position} · ${Math.floor(offset / file.size * 100)}%`);
          await uploadPart(token, offset / partSize, file.slice(offset, offset + partSize));
        }
        showProgress(`处理图片 ${position}`);
        await readResult(await editorFetch('/__editor/upload/complete', { method: 'POST', headers }));
      } catch (error) {
        await editorFetch('/__editor/upload/abort', { method: 'POST', headers }).catch(() => {});
        throw error;
      }
    }
    images.push({ hash });
  }
  showProgress('保存照片记录…');
  return images;
}
