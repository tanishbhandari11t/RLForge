import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Fixed asset names: the extension host references dist/assets/index.js and index.css directly.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/index.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (asset) => (asset.name?.endsWith('.css') ? 'assets/index.css' : 'assets/[name][extname]'),
      },
    },
  },
});
