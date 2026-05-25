import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('astro').AstroUserConfig} */
export default defineConfig({
  srcDir: './src/app',
  outDir: './dist/astro',
  output: 'server',
  adapter: node({ mode: 'middleware' }),
  vite: {
    resolve: {
      alias: {
        '@kerf/core': path.resolve(__dirname, './src/index.ts'),
        '@app': path.resolve(__dirname, './src/app'),
        '@api': path.resolve(__dirname, './src/api'),
      },
    },
  },
});
