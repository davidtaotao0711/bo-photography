import { editorUploadPlugin } from './scripts/editor-upload-plugin.mjs';

export default {
  output: 'static',
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [editorUploadPlugin()],
  },
};
