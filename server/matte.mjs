// Chroma-key matting, ported from desktop-pet's sprite-processor `matteBuffer`.
//
// The generation pipeline renders every sprite on a flat pure-magenta
// (#FF00FF) backdrop. This module turns that backdrop transparent while keeping
// the character intact — even where the character itself happens to contain a
// magenta-ish pixel — by:
//   1) flood-filling the background inward from the frame edges (connectivity),
//      so only background that touches the border is removed;
//   2) an extra "enclosed blob" cut for balanced lifts toward the key sealed
//      inside the silhouette;
//   3) a short feather ramp for a soft edge; and
//   4) a despill pass that removes the even magenta tint bleeding onto the rim.
//
// We operate on RGBA buffers (pngjs layout), so the channel offsets are [0,1,2].
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';

const DEFAULT_KEY = [255, 0, 255]; // magenta
const DEFAULT_SIMILARITY = 0.40;
const DEFAULT_BLEND = 0.12;
const KEY_LIFT_CUT = 52; // min even lift toward the key to count as background
const KEY_LEAN_MAX = 42; // max spread between high channels before it's a feature
const FEATHER_RADIUS = 2; // px the silhouette feather may grow inward
const MAX_RGB_DISTANCE = Math.sqrt(3) * 255;

// Mutates `data` (RGBA) in place: background -> alpha 0, rim -> ramped alpha.
export function matteBuffer(data, width, height, {
  key = DEFAULT_KEY,
  similarity = DEFAULT_SIMILARITY,
  blend = DEFAULT_BLEND,
  keyLiftCut = KEY_LIFT_CUT,
  keyLeanMax = KEY_LEAN_MAX,
} = {}) {
  const [kr, kg, kb] = key;
  const [rOff, gOff, bOff] = [0, 1, 2];
  const simThreshold = similarity * MAX_RGB_DISTANCE;
  const blendWidth = blend * MAX_RGB_DISTANCE;
  const pixelCount = width * height;
  let transparentPixelCount = 0;
  let visiblePixelCount = 0;

  // Split channels into the key's "high" set (channels the background lifts) and
  // "low" set. For magenta (255,0,255): high = R,B; low = G.
  const midKey = (kr + kg + kb) / 3;
  const highChannels = [];
  const lowChannels = [];
  for (const [channelOffset, keyValue] of [[rOff, kr], [gOff, kg], [bOff, kb]]) {
    (keyValue > midKey ? highChannels : lowChannels).push(channelOffset);
  }

  // Pass 1 — distance to key colour + "core" background mask (essentially pure
  // key, or already transparent). Only the core seeds the flood fill.
  const distance = new Float32Array(pixelCount);
  const isCore = new Uint8Array(pixelCount);
  for (let p = 0, offset = 0; p < pixelCount; p += 1, offset += 4) {
    const dr = data[offset + rOff] - kr;
    const dg = data[offset + gOff] - kg;
    const db = data[offset + bOff] - kb;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    distance[p] = d;
    if (data[offset + 3] === 0 || d < simThreshold) isCore[p] = 1;
  }

  // Pass 2 — flood fill the background inward from the four borders through core
  // pixels only. Anything not reached stays opaque.
  const cut = new Uint8Array(pixelCount);
  const stack = [];
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (cut[p] || !isCore[p]) return;
    cut[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < width; x += 1) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y += 1) { seed(0, y); seed(width - 1, y); }
  while (stack.length) {
    const p = stack.pop();
    const x = p % width;
    const y = (p - x) / width;
    seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
  }

  // Pass 2b — unconditional cut for a strong, balanced lift toward the key
  // sealed inside the silhouette (background tint darkened by the subject).
  if (highChannels.length && lowChannels.length) {
    for (let p = 0, offset = 0; p < pixelCount; p += 1, offset += 4) {
      if (cut[p] || data[offset + 3] === 0) continue;
      let minHigh = 255;
      let maxHigh = 0;
      for (const ch of highChannels) {
        const v = data[offset + ch];
        if (v < minHigh) minHigh = v;
        if (v > maxHigh) maxHigh = v;
      }
      let maxLow = 0;
      for (const ch of lowChannels) if (data[offset + ch] > maxLow) maxLow = data[offset + ch];
      if (minHigh - maxLow >= keyLiftCut && maxHigh - minHigh <= keyLeanMax) cut[p] = 1;
    }
  }

  // Pass 3 — feather. Grow at most FEATHER_RADIUS px out from the cut through
  // blend-band pixels, giving each an alpha ramp.
  const featherAlpha = new Int16Array(pixelCount).fill(-1);
  let frontier = [];
  for (let p = 0; p < pixelCount; p += 1) if (cut[p]) frontier.push(p);
  for (let step = 0; step < FEATHER_RADIUS && frontier.length; step += 1) {
    const next = [];
    for (const p of frontier) {
      const x = p % width;
      const y = (p - x) / width;
      const neighbours = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const q = ny * width + nx;
        if (cut[q] || featherAlpha[q] >= 0) continue;
        const d = distance[q];
        if (d >= simThreshold + blendWidth) continue;
        const ramp = Math.round(255 * (d - simThreshold) / blendWidth);
        featherAlpha[q] = ramp < 0 ? 0 : ramp;
        next.push(q);
      }
    }
    frontier = next;
  }

  // Pass 4 — write alpha.
  for (let p = 0, offset = 0; p < pixelCount; p += 1, offset += 4) {
    const a = data[offset + 3];
    let alpha;
    if (cut[p]) alpha = 0;
    else if (featherAlpha[p] >= 0) alpha = Math.min(a, featherAlpha[p]);
    else alpha = a;

    data[offset + 3] = alpha;
    if (alpha === 0) {
      data[offset] = 0;
      data[offset + 1] = 0;
      data[offset + 2] = 0;
      transparentPixelCount += 1;
    } else {
      visiblePixelCount += 1;
    }
  }

  // Pass 5 — despill. Remove the even background lift from rim pixels bordering
  // transparency.
  if (highChannels.length && lowChannels.length) {
    const source = Buffer.from(data);
    const bordersTransparency = (x, y) => {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (source[(ny * width + nx) * 4 + 3] === 0) return true;
        }
      }
      return false;
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        if (source[offset + 3] === 0) continue;
        if (!bordersTransparency(x, y)) continue;
        let lowRef = 0;
        for (const ch of lowChannels) if (source[offset + ch] > lowRef) lowRef = source[offset + ch];
        let minHigh = 255;
        for (const ch of highChannels) if (source[offset + ch] < minHigh) minHigh = source[offset + ch];
        const spill = minHigh - lowRef;
        if (spill <= 0) continue;
        for (const ch of highChannels) {
          data[offset + ch] = Math.max(lowRef, source[offset + ch] - spill);
        }
      }
    }
  }

  return { transparentPixelCount, visiblePixelCount };
}

// Read a PNG file, chroma-key it, and write a transparent PNG. Returns the
// tight bounding box of the visible pixels so callers can trim/centre.
export async function matteFile(inputPath, outputPath, options = {}) {
  const png = PNG.sync.read(await readFile(inputPath));
  const { width, height, data } = png;
  matteBuffer(data, width, height, options);

  // Tight bounding box of remaining opaque pixels (for trimming dead space).
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  await writeFile(outputPath, PNG.sync.write(png));
  const bbox = maxX >= minX
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : { x: 0, y: 0, w: width, h: height };
  return { width, height, bbox };
}
