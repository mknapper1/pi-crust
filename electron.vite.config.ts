import path from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { dependencies as nativeDependencies } from './release/app/package.json';

const root = __dirname;
const nativeModules = Object.keys(nativeDependencies || {});
// Pi loads extensions through runtime-relative dynamic imports (including Jiti).
// Keep the release dependencies external so Rollup cannot turn those imports
// into hashed chunks that are missing from the packaged utility process.
const external = nativeModules.flatMap((name) => [
  name,
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`),
]);

export default defineConfig({
  main: {
    resolve: {
      dedupe: ['@earendil-works/pi-ai'],
    },
    build: {
      outDir: 'release/app/dist/main',
      emptyOutDir: true,
      sourcemap: true,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          main: path.join(root, 'src/main/main.ts'),
          'agent-utility': path.join(root, 'src/utility/agent-utility.ts'),
        },
        external,
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      outDir: 'release/app/dist/preload',
      sourcemap: true,
      externalizeDeps: false,
      rollupOptions: {
        input: path.join(root, 'src/main/preload.ts'),
        external,
        output: { entryFileNames: 'preload.js' },
      },
    },
  },
  renderer: {
    root: path.join(root, 'src/renderer'),
    base: './',
    plugins: [react({}), svgr()],
    server: {
      host: 'localhost',
      port: Number(process.env.PORT || 1212),
      strictPort: true,
    },
    build: {
      outDir: path.join(root, 'release/app/dist/renderer'),
      emptyOutDir: true,
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        input: path.join(root, 'src/renderer/index.html'),
        output: { entryFileNames: 'renderer.js' },
      },
    },
  },
});
