/// <reference types="vitest" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  root: 'src',
  build: {
    target: 'es2020',
    outDir: '../dist',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
