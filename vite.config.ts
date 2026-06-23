import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Multi-entry build for a Manifest V3 extension.
//
// - serviceWorker / youtubeDetector / canalSurDetector are emitted as
//   standalone JS files. Each content script's runtime deps are inlined because
//   their module graphs are DISJOINT (YouTube imports videoState/*; Canal Sur
//   imports canalSurAdapter/vttParser; they share only type-only modules, which
//   erase at build time). That keeps Rollup from extracting a shared chunk and
//   emitting `import` statements a classic content script can't use.
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
        canalSurDetector: 'src/content/canalSurDetector.ts',
        captionInterceptor: 'src/content/captionInterceptor.ts',
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
