import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runStudio } from '../server/mule.ts';

const ROOT = process.cwd();
const STYLE = join(ROOT, 'public/assets/player/fighter-87633c7b/portrait.png');
const COMMON = `Image 1 is the ONLY identity, face, hairstyle, expression, skin tone, and clothing reference. Image 2 is STYLE, PIXEL GRID, CROP, LIGHTING, AND BACKGROUND REFERENCE ONLY; do not copy Image 2 identity, face, glasses, hairstyle, body shape, or clothing. Match Image 2 exact native 32 x 32 logical-pixel density enlarged to a 1024 x 1024 square with nearest-neighbor scaling, uniformly large square pixels, thick clean dark outlines, limited palette, cel shading, three-quarter head-and-shoulders crop facing right, subject scale and placement, and dark red checkerboard arcade background. Repaint Image 1 as a retro 16-bit King of Fighters-inspired character-select portrait. Keep the full hair silhouette, face, neck, shoulders, and upper chest inside frame. Crisp readable likeness at coarse 32 x 32 logical resolution. No text, player labels, frame border, UI, logo, watermark, extra person, antialiasing, smooth vector edges, tiny high-resolution pixel detail, photorealism, or crop outside the square.`;

const specs = [
  {
    id: 'speed',
    source: '/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/codex-clipboard-92b0f156-b5d1-429e-93bb-95c7b7beea4c.png',
    out: join(ROOT, 'public/assets/player/speed/_review-portrait-v2'),
    identity: 'Preserve the recognizable youthful Black male face, warm broad smile, short separated black dreadlocks framing the forehead and temples, dark eyes, and green hoodie from Image 1. Do not turn the hairstyle into an afro, do not lengthen the dreadlocks, and do not replace the hoodie.',
  },
  {
    id: 'fengge-wangming-tianya',
    source: '/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/codex-clipboard-e5e46755-74df-4acf-927a-32c5f50cc1a7.png',
    out: join(ROOT, 'public/assets/player/fengge-wangming-tianya/_review-portrait-v2'),
    identity: 'Preserve the recognizable East Asian adult male face, medium-long swept-back dark hair reaching the neck, thick eyebrows, moustache connected to a full goatee and short beard, cheek mole, calm neutral expression, beige overshirt, and light inner shirt from Image 1. Do not shorten the hair, remove the facial hair, add glasses, or include the car and seat belt.',
  },
];

async function generate(spec) {
  await mkdir(spec.out, { recursive: true });
  console.log(`START ${spec.id}`);
  const result = await runStudio('google/nano-banana-pro/edit', {
    images: [spec.source, STYLE],
    prompt: `Use case: identity-preserve. Asset type: square fighting-game character-select portrait. ${spec.identity} ${COMMON}`,
    aspectRatio: '1:1',
    resolution: '1K',
    maxWait: 300,
  });
  if (!result.body.ok) throw new Error(`${spec.id}: ${result.body.stderr || result.body.error || 'generation failed'}`);
  const urls = result.body.result?.images || result.body.result?.data?.images || [];
  if (!urls.length) throw new Error(`${spec.id}: no image URLs returned`);
  const saved = [];
  for (let i = 0; i < urls.length; i += 1) {
    const dest = join(spec.out, `portrait-v2-${String.fromCharCode(97 + i)}.png`);
    const response = await fetch(urls[i]);
    if (!response.ok) throw new Error(`${spec.id}: download ${response.status}`);
    await writeFile(dest, Buffer.from(await response.arrayBuffer()));
    saved.push(dest);
  }
  console.log(`DONE ${spec.id}: ${saved.join(', ')}`);
}

await Promise.all(specs.map(generate));
