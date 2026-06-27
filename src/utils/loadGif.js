import { GIF } from './gif.js';

// Decode an animated GIF into its individual frames.
//
// The bundled `gif.js` decoder composites every frame onto its own
// `<canvas>` element (`frame.image`). We resolve once all frames are ready so
// the caller can hand those canvases straight to Phaser's texture manager.
export function loadGif(url) {
  return new Promise((resolve, reject) => {
    const gif = GIF();
    // We only read the decoded frames; we don't want the decoder's own
    // playback timer mutating state in the background.
    gif.playOnLoad = false;
    gif.waitTillDone = true; // fire `onload` after every frame is decoded
    gif.onload = () => resolve(gif);
    gif.onerror = (e) => reject(new Error(`Failed to load GIF ${url}: ${e && e.type}`));
    gif.load(url);
  });
}

// Decode a GIF and register each of its frames as a Phaser canvas texture.
//
// Frames are registered under keys of the form `${prefix}-${index}`, matching
// how the players look them up at render time. Returns the number of frames so
// callers can drive their own frame counters.
export async function registerGifTextures(scene, prefix, url) {
  const gif = await loadGif(url);

  gif.frames.forEach((frame, index) => {
    const key = `${prefix}-${index}`;
    if (scene.textures.exists(key)) {
      scene.textures.remove(key);
    }
    scene.textures.addCanvas(key, frame.image);
  });

  return gif.frames.length;
}
