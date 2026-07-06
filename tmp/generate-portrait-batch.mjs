import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runStudio } from '../server/mule.ts';

const ROOT = process.cwd();
const STYLE = join(ROOT, 'public/assets/player/fighter-87633c7b/portrait.png');
const DOUBAO = '/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/codex-clipboard-08ae2852-1ff1-4bbc-83c2-33597117f792.png';

const STYLE_RULES = `Match the style-reference portrait's exact native 32 x 32 logical-pixel density enlarged to a 1024 x 1024 square with nearest-neighbor scaling, uniformly large square pixels, thick clean dark outlines, limited palette, cel shading, three-quarter head-and-shoulders crop facing right, subject scale and placement, and dark red checkerboard arcade background. Repaint the subject as a retro 16-bit King of Fighters-inspired character-select portrait. Keep the full hair silhouette, face, neck, shoulders, and upper chest inside frame. Crisp readable likeness at coarse 32 x 32 logical resolution. No text, player labels, frame border, UI, logo, watermark, extra person, extra accessories, antialiasing, smooth vector edges, tiny high-resolution pixel detail, photorealism, or crop outside the square.`;

const specs = [
  {
    id: 'caixukun',
    input: join(ROOT, 'public/assets/player/caixukun/base.png'),
    out: join(ROOT, 'public/assets/player/caixukun/_review-portrait-v1'),
    identity: 'Preserve exactly the same male character identity, face, hairstyle, expression, skin tone, outfit, colors, and proportions from Image 1.',
  },
  {
    id: 'fengge-wangming-tianya',
    input: join(ROOT, 'public/assets/player/fengge-wangming-tianya/base.png'),
    out: join(ROOT, 'public/assets/player/fengge-wangming-tianya/_review-portrait-v1'),
    identity: 'Preserve exactly the same male character identity, face, hairstyle, expression, skin tone, outfit, colors, and proportions from Image 1.',
  },
  {
    id: 'speed',
    input: join(ROOT, 'public/assets/player/speed/base.png'),
    out: join(ROOT, 'public/assets/player/speed/_review-portrait-v1'),
    identity: 'Preserve exactly the same male character identity, face, hairstyle, expression, skin tone, outfit, colors, and proportions from Image 1.',
  },
  {
    id: 'kobe',
    input: join(ROOT, 'public/assets/player/kobe/base.png'),
    out: join(ROOT, 'public/assets/player/kobe/_review-portrait-v1'),
    identity: 'Preserve exactly the same male character identity, face, hairstyle, expression, skin tone, basketball outfit, colors, and proportions from Image 1.',
  },
  {
    id: 'donald-trump',
    out: join(ROOT, 'public/assets/player/donald-trump/_review-v1'),
    identity: 'Create a recognizable portrait of Donald Trump: distinctive swept blond hair, mature facial structure, light tan complexion, confident stern expression, dark navy suit jacket, white shirt, and red tie. Do not copy the style-reference person or add glasses.',
  },
  {
    id: 'mark-zuckerberg',
    out: join(ROOT, 'public/assets/player/mark-zuckerberg/_review-v1'),
    identity: 'Create a recognizable portrait of Mark Zuckerberg: short brown hair, fair complexion, youthful adult male facial structure, calm focused expression, and a simple charcoal-gray crewneck T-shirt. Do not copy the style-reference person or add glasses.',
  },
  {
    id: 'doubao',
    input: DOUBAO,
    out: join(ROOT, 'public/assets/player/doubao/_review-v1'),
    identity: 'Preserve the same stylized female avatar identity from Image 1: large dark eyes, short straight dark-brown bob with center part, gentle smile, red scarf, and dark sweater. Remove the phone, inset avatar, Chinese text, captions, and all UI.',
  },
];

async function generate(spec) {
  await mkdir(spec.out, { recursive: true });
  const images = spec.input ? [spec.input, STYLE] : [STYLE];
  const roles = spec.input
    ? 'Image 1 is the ONLY identity and clothing reference. Image 2 is STYLE, PIXEL GRID, CROP, LIGHTING, AND BACKGROUND REFERENCE ONLY; do not copy Image 2 identity, face, glasses, hairstyle, body shape, or clothing.'
    : 'Image 1 is STYLE, PIXEL GRID, CROP, LIGHTING, AND BACKGROUND REFERENCE ONLY; do not copy Image 1 identity, face, glasses, hairstyle, body shape, or clothing.';
  const prompt = `Use case: identity-preserve. Asset type: square fighting-game character-select portrait. ${roles} ${spec.identity} ${STYLE_RULES}`;
  console.log(`START ${spec.id}`);
  const result = await runStudio('google/nano-banana-pro/edit', {
    prompt,
    images,
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
