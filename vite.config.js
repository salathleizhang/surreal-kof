import { defineConfig } from 'vite';

// Static assets (the original GIF art) live in `public/` and are served at the
// site root, e.g. `/assets/player/kyo/0.gif`.
export default defineConfig({
  base: './',
  server: {
    open: true,
  },
  build: {
    outDir: 'dist',
  },
});
