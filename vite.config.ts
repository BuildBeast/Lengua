import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-entry build for a Manifest V3 extension.
//
// - serviceWorker / youtubeDetector are emitted as standalone JS files.
//   The content script imports ONLY types (erased at build time), so it has
//   no runtime imports and is safe to load as a classic content script.
// - sidepanel.html is a normal Vite HTML entry (React, ES module).
//
// public/ (incl. manifest.json) is copied verbatim into dist/.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        serviceWorker: 'src/background/serviceWorker.ts',
        youtubeDetector: 'src/content/youtubeDetector.ts',
        sidepanel: 'sidepanel.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
