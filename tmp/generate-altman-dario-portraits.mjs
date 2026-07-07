import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runStudio } from '../server/mule.ts';

const ROOT = process.cwd();
const STYLE = join(ROOT, 'public/assets/player/fighter-87633c7b/portrait.png');

const DARIO_REF = '/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/codex-clipboard-a8d5f6d0-69e2-41ae-bea9-725e698603c4.png';
const ALTMAN_REF = '/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/codex-clipboard-c9618b6d-8ab7-4433-8536-dff5f19f8adb.png';

const STYLE_RULES = `Match the style-reference portrait's exact native 32 x 32 logical-pixel density enlarged to a 1024 x 1024 square with nearest-neighbor scaling, uniformly large square pixels, thick clean dark outlines, limited palette, cel shading, three-quarter head-and-shoulders crop facing right, subject scale and placement, and dark red checkerboard arcade background. Repaint the subject as a retro 16-bit King of Fighters-inspired character-select portrait. Keep the full hair silhouette, face, neck, shoulders, and upper chest inside frame. Crisp readable likeness at coarse 32 x 32 logical resolution. No text, player labels, frame border, UI, logo, watermark, extra person, extra accessories, antialiasing, smooth vector edges, tiny high-resolution pixel detail, photorealism, or crop outside the square.`;

const specs = [
  {
    id: 'sam-altman',
    input: ALTMAN_REF,
    out: join(ROOT, 'public/assets/player/sam-altman/_review-portrait-v1'),
    identity: 'Preserve the same adult male identity from Image 1: short tousled brown hair, fair complexion, friendly smile, slim face, casual mint-green T-shirt, relaxed startup-founder demeanor. Convert only the style; do not copy the style-reference person, glasses, black outfit, or face.',
  },
  {
    id: 'dario-amodei',
    input: DARIO_REF,
    out: join(ROOT, 'public/assets/player/dario-amodei/_review-portrait-v1'),
    identity: 'Preserve the same adult male identity from Image 1: curly dark-brown hair, rounded black glasses, slight stubble, gentle composed expression, navy blazer over open-collar white shirt. Convert only the style; do not copy the style-reference person, hairstyle, black outfit, or face.',
  },
];

async function generate(spec) {
  await mkdir(spec.out, { recursive: true });
  const prompt = `Use case: identity-preserve. Asset type: square fighting-game character-select portrait. Image 1 is the ONLY identity and clothing reference. Image 2 is STYLE, PIXEL GRID, CROP, LIGHTING, AND BACKGROUND REFERENCE ONLY; do not copy Image 2 identity, face, glasses, hairstyle, body shape, or clothing. ${spec.identity} ${STYLE_RULES}`;
  console.log(`START ${spec.id}`);
  const result = await runStudio('google/nano-banana-pro/edit', {
    prompt,
    images: [spec.input, STYLE],
    aspectRatio: '1:1',
    resolution: '1K',
    maxWait: 300,
  });
  if (!result.body.ok) throw new Error(`${spec.id}: ${result.body.stderr || result.body.error || 'generation failed'}`);
  const urls = result.body.result?.images || result.body.result?.data?.images || [];
  if (!urls.length) throw new Error(`${spec.id}: no image URLs returned`);
  const saved = [];
  for (let i = 0; i < urls.length; i += 1) {
    const suffix = String.fromCharCode(97 + i);
    const dest = join(spec.out, `portrait-v1-${suffix}.png`);
    const response = await fetch(urls[i]);
    if (!response.ok) throw new Error(`${spec.id}: download ${response.status}`);
    await writeFile(dest, Buffer.from(await response.arrayBuffer()));
    saved.push(dest);
  }
  console.log(`DONE ${spec.id}: ${saved.join(', ')}`);
  return { id: spec.id, saved };
}

const results = await Promise.allSettled(specs.map(generate));
let failed = false;
for (const result of results) {
  if (result.status === 'fulfilled') console.log(JSON.stringify(result.value));
  else {
    failed = true;
    console.error(result.reason?.stack || result.reason);
  }
}
if (failed) process.exitCode = 1;
