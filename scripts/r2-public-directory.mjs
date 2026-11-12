import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicImageBaseUrl } from './image-origin.mjs';

export function r2PublicDirectory() {
  let stagingDirectory;
  return {
    name: 'r2-public-directory',
    hooks: {
      async 'astro:config:setup'({ command, config, updateConfig }) {
        if (command !== 'build' || !publicImageBaseUrl()) return;

        const publicDirectory = fileURLToPath(config.publicDir);
        const imagesDirectory = resolve(publicDirectory, 'images');
        stagingDirectory = await mkdtemp(join(tmpdir(), 'bo-photography-public-'));
        try {
          await cp(publicDirectory, stagingDirectory, {
            recursive: true,
            filter: (source) => resolve(source) !== imagesDirectory,
          });
          updateConfig({ publicDir: pathToFileURL(stagingDirectory + sep).href });
        } catch (error) {
          await rm(stagingDirectory, { recursive: true, force: true });
          throw error;
        }
      },
      async 'astro:build:done'() {
        if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
      },
    },
  };
}
