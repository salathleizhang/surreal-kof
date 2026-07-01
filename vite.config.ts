import { defineConfig } from 'vite';

// Static assets (the original GIF art) live in `public/` and are served at the
// site root, e.g. `/assets/player/kyo/0.gif`.
export default defineConfig({
  base: './',
  server: {
    // `npm run dev` opens the default browser; the `dev:music` launcher sets
    // NO_OPEN so it can open Chrome itself (with the autoplay flag) instead.
    open: !process.env.NO_OPEN,
  },
  build: {
    outDir: 'dist',
  },
});
