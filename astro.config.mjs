import { editorUploadPlugin } from './scripts/editor-upload-plugin.mjs';

function stabilizeBuildOptimizeDeps() {
  const isBuildRun = process.argv.includes('build') || process.env.npm_lifecycle_event === 'build';

  return {
    name: 'bo-david-build-optimize-deps-fix',
    configResolved(config) {
      if (!isBuildRun) return;

      const stripCssesc = (value) =>
        Array.isArray(value) ? value.filter((entry) => entry !== 'astro > cssesc' && entry !== 'cssesc') : value;

      config.optimizeDeps.include = stripCssesc(config.optimizeDeps?.include);
      config.environments?.client?.optimizeDeps && (config.environments.client.optimizeDeps.include = stripCssesc(config.environments.client.optimizeDeps.include));
      config.optimizeDeps.exclude = [...new Set([...(config.optimizeDeps?.exclude || []), 'cssesc'])];
      if (config.environments?.client?.optimizeDeps) {
        config.environments.client.optimizeDeps.exclude = [
          ...new Set([...(config.environments.client.optimizeDeps.exclude || []), 'cssesc']),
        ];
      }
    },
  };
}

export default {
  output: 'static',
  devToolbar: {
    enabled: false,
  },
  vite: {
    plugins: [stabilizeBuildOptimizeDeps(), editorUploadPlugin()],
  },
};
