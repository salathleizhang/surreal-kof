# 自定义格斗角色生成手册（手动流水线 / 不改仓库代码）

把一张人物照片 + 招式设定 + 招式姿势参考图，变成一个**可直接进游戏选用的 KOF 角色**。
本流程**绕过 app 里的「+」自动流水线**（`server/character-pipeline.ts`，那个 prompt 写死、动作随机），
改为**手动用自定义 prompt + 你的参考图**驱动后端模型，产物落到 `public/assets/player/<id>/`。
**全程不修改任何仓库源码**，脚本只 `import` 现成的 `server/mule.ts` 和 `server/matte.ts`。

---

## 0. 前置条件

- `mulerun` CLI 已登录（`mulerun studio run ...` 能用）。版本 ≥ 0.2.4。
- `ffmpeg` 在 PATH 里。
- Node ≥ 20，仓库已 `npm install`（需要 `pngjs`，已是依赖）。
- 临时脚本放 scratchpad，不要进 git。参考图放 `scratchpad-refs/`（已在 .gitignore 风格之外，提交前请清理或忽略）。

> 注意：本流程**直接调 `mulerun studio run`**，不需要启动 `server/local-api.ts`。

---

## 1. 已验证的 API 事实（别再自己试错）

- **文/图生图 / 图生视频**：`mulerun studio run <endpoint> --json --quiet --<param> <value> ...`
  - 数组型参数（如 `images`）传 **一个 JSON 数组字符串**：`--images '["/abs/a.png","/abs/b.png"]'`。
  - 查参数：`mulerun studio params <endpoint>`（底层是 mulerouter）。
- **nano-banana Pro（图）**
  - 文生图：`google/nano-banana-pro/generation`
  - 图生图/编辑：`google/nano-banana-pro/edit`，`--images` 接受**本地路径**（自动转 base64），支持**多图**。
  - 返回 `result.images[]` 是**临时 HTTPS URL，必须立刻下载**。
  - **多图用法（关键）**：`images:[人物图, 姿势参考图]` → 第一张定身份，第二张定姿势。**nano-banana 对全身/同比例的保持很稳。**
- **seedance 2.0（视频，i2v）**：`bytedance/seedance-2.0/image-to-video`
  - 参数只有：`image`(首帧) / `last-frame-image`(尾帧) / `prompt`(动作文字) / `resolution`(480p/720p/1080p) / `aspect-ratio` / `duration`(4..15) / `generate-audio` / `seed`。
  - 返回 `result.videos[]` 是临时 URL，立刻下载。
  - ⚠️ **没有任何「镜头控制」参数**（见 §5 的坑）。
- 抠图：洋红 `#FF00FF` 背景 → `import { matteFile } from server/matte.ts`（`matteFile(srcAbs, destAbs)`）。

---

## 2. 角色需要的 7 个动画（引擎约定）

| key | engineState | frames | playback | matte | 锚点（首/尾帧） | 稳定? |
|---|---|---|---|---|---|---|
| idle    | 0 | 8 | loop | 是 | base / base | 是 |
| walk    | 1 | 8 | loop | 是 | walk姿势 / 同首帧 | 是 |
| attack1 | 4 | 7 | yoyo | 是 | base / attack1尾帧 | 看姿势* |
| attack2 | 'attack2' | 7 | yoyo | 是 | base / attack2尾帧 | 看姿势* |
| intro   | 'intro' | 8 | forward | 是 | base / intro尾帧 | 是 |
| death   | 6 | 10 | hold | 是 | base / death尾帧 | 否 |
| super   | 'super' | 25 | forward, frameRate:10, fullscreen:true | **否** | super姿势 / 同首帧 | 否 |

- `matte:true` = 洋红抠图透明；super 保留戏剧背景（`matte:false`，16:9 全屏）。
- playback：loop 循环 / yoyo 去回 / forward 单向 / hold 停在末帧。
- *稳定与否见 §5：**只对「全程直立」的动作做稳定**；会蹲/倒/大幅变高的（铁山靠下蹲、death 倒地、super）**不稳定**，否则会把矮姿势错误放大。

---

## 3. 逐角色流程（每步都让用户审核，并 `open` 预览图给用户看）

设 `CHARID`（英文 kebab，如 `caixukun`）、`DIR=public/assets/player/$CHARID`。

### 3.1 存参考图
人物照片 + 每个「指定姿势」的招式参考图，复制到 `scratchpad-refs/`。

### 3.2 base 全身像素图（nano-banana edit，多图参考）
prompt 要点：retro 16-bit KOF 像素 sprite、**全身头到脚、不裁切、洋红背景**、保留照片人物的脸/发/服装。
保留 `base.png`（洋红原图，做后续 i2v 锚点）；`matteFile` 出 `base.preview.png` 给用户审。
→ **用户确认 base 后再继续。**

### 3.3 关键帧（nano-banana edit，FROM base）
- 没给姿势参考的动作（walk/intro/death）：单图 `images:[base]` + 文字姿势。
- **给了姿势参考的招式（attack1/attack2/super…）：双图 `images:[base, 姿势参考图]`**，prompt 说「保持图1人物，严格复刻图2姿势」。**直接喂图，不要只用文字总结姿势。**
- super 关键帧：`aspect 16:9`、`resolution 2K`、`matte:false`、戏剧背景。
- 每张抠图出 `*.preview.png` 给用户审。→ **确认后再做视频。**

### 3.4 视频（seedance i2v）+ 抽帧 + 抠图 + 稳定
对每个动作：seedance(首帧+尾帧+**固定机位 prompt**+动作文字) → `ffmpeg` 抽帧 → `pickEvenly` 取目标帧数 → 抠图 →（直立动作）缩放稳定。

### 3.5 写 manifest + 注册
写 `manifest.json`，并把条目 upsert 进 `public/assets/player/generated-index.json`，游戏选人界面即可见。

---

## 4. manifest.json 格式

```json
{
  "id": "caixukun",
  "name": "CAI XUKUN",
  "cn": "蔡徐坤",
  "summary": "一句话简介",
  "base": "assets/player/caixukun/base.png",
  "portrait": "assets/player/caixukun/idle/0001.png",
  "anims": {
    "idle":   { "engineState": 0, "dir": "assets/player/caixukun/idle", "frames": 8, "playback": "loop", "matte": true },
    "super":  { "engineState": "super", "dir": "assets/player/caixukun/super", "frames": 25, "playback": "forward", "matte": false, "frameRate": 10, "fullscreen": true }
  },
  "moves": {
    "attack1": { "name": "铁山靠", "damage": 22 },
    "attack2": { "name": "擦玻璃", "damage": 18 },
    "super":   { "name": "你干嘛·打篮球", "damage": 40 }
  },
  "createdAt": 1700000000000
}
```
`generated-index.json` 是数组，元素：`{ id, name, cn, portrait, manifest }`（按 id upsert，先过滤同 id 再 push）。

---

## 5. ⚠️ 必看：seedance 镜头推近 bug 与修复

**现象**：seedance i2v 会在动作中途**自己推镜头**，导致中间帧人物被放大/裁成半身/大头——
即使首尾帧锚点都是全身（首尾是你给的关键帧的「重渲染」，不是像素级拷贝）。

**seedance 没有固定镜头参数**，光靠参数锁不了。可靠修复 = **两手一起上**：

1. **固定机位 prompt（前置、强措辞）**，加在每个动作的 motion 文字前：
   > Static locked-off camera that is completely fixed and never moves: no zoom, no push-in, no dolly, no pan, no tilt, no camera motion at all. Medium full-body wide shot, the character stays at a constant distance, fully visible from the top of the head down to the feet in every single frame with headroom above and floor below the feet, never cropped.

2. **后处理缩放稳定**（仅对「全程直立」的动作）：抠图后算每帧 alpha 包围盒，按「身高 = 第0帧身高」缩放、脚底对齐基线，**水平位置不动**（保留行走位移/出拳伸展）。缩放比**钳制到 [0.85, 1.18]** 防过度修正。
   - **不要对会真实变矮的动作做稳定**：下蹲式攻击、death 倒地、super 全屏——这些身高本就该变，稳定会把它们错误放大。这些只靠 prompt 1。

实测：prompt 1 基本就能压住（修正幅度 <6%），稳定 2 是兜底。

---

## 6. 可直接运行的脚本（复制到 scratchpad 跑）

> 把路径里的仓库根 `/Users/junwei/Documents/GitHub/kof-ai` 换成实际 `ROOT`。
> 三个脚本：`genbase`（base，用下方 §6.1 的 bash 也行）、`genkf`（关键帧）、`genvid`（视频+manifest）。

### 6.1 base（bash 直调）
```bash
ROOT=/Users/junwei/Documents/GitHub/kof-ai
CHARID=caixukun; DIR="$ROOT/public/assets/player/$CHARID"; mkdir -p "$DIR"
R1="$ROOT/scratchpad-refs/front.png"   # 正脸
R2="$ROOT/scratchpad-refs/fullbody.png" # 全身/服装
PROMPT='retro 16-bit pixel-art fighting game sprite in King of Fighters style, single full-body character head to toe, standing upright, entire body visible top of head to shoes, both feet and legs in frame, full-length wide shot, side view facing right, NOT a portrait, NOT a bust, NOT a close-up, do not cut off legs or feet, crisp clean pixels, no text, no UI, sharp silhouette. Neutral idle stance. Keep the same person as the reference photos: <在此描述发型/服装/配色>. Render the COMPLETE full body. flat solid pure magenta #FF00FF background, evenly lit, no shadows, one uniform magenta color only.'
mulerun studio run google/nano-banana-pro/edit --json --quiet \
  --prompt "$PROMPT" --aspect-ratio 3:4 --resolution 1K --max-wait 300 \
  --images "[\"$R1\",\"$R2\"]" > /tmp/base.json
URL=$(grep -o 'https://[^"]*result_00.png' /tmp/base.json | head -1)
curl -s "$URL" -o "$DIR/base.png"
npx tsx -e "import {matteFile} from '$ROOT/server/matte.ts'; await matteFile('$DIR/base.png','$DIR/base.preview.png');"
open "$DIR/base.preview.png"
```

### 6.2 关键帧 `genkf.ts`
```ts
// 注意：静态 import 用绝对路径字面量（不能用模板字符串）。把下面两行的仓库根换成实际路径。
import { spawn } from 'node:child_process';
import { writeFile, mkdir, copyFile } from 'node:fs/promises';
import { runStudio } from '/Users/junwei/Documents/GitHub/kof-ai/server/mule.ts';
import { matteFile } from '/Users/junwei/Documents/GitHub/kof-ai/server/matte.ts';
const ROOT = '/Users/junwei/Documents/GitHub/kof-ai';
const CHARID = 'caixukun';
const CHAR = `${ROOT}/public/assets/player/${CHARID}`, REF = `${ROOT}/scratchpad-refs`, BASE = `${CHAR}/base.png`, KF = `${CHAR}/kf`;
await mkdir(KF, { recursive: true });
const STYLE = 'retro 16-bit pixel-art KOF fighting game sprite, single full-body character head to toe, entire body visible top of head to shoes, both feet and legs in frame, full-length wide shot, NOT a portrait/bust/close-up, do not cut off legs or feet, crisp clean pixels, no text, no UI, sharp silhouette';
const CHARREF = '<发型/服装/配色一句话>';
const MAGENTA = 'flat solid pure magenta #FF00FF background, evenly lit, no shadows, one uniform magenta color only';
const POSE = (desc, bg = MAGENTA) => `Two reference images. FIRST = the CHARACTER, keep his exact face/hair/outfit: ${CHARREF}. SECOND = the POSE, pose the character in the EXACT same body position/stance/limbs/torso angle/view as the second image (${desc}). Copy that pose faithfully. Render as a ${STYLE}. ${bg}.`;
const PLAIN = (pose) => `${STYLE}, standing upright, side view facing right. ${pose}. Same character: ${CHARREF}. ${MAGENTA}.`;
const SPECS = [
  { name: 'walk-start', images: [BASE], prompt: PLAIN('walking forward mid-stride, one leg forward one back'), matte: true },
  { name: 'attack1-end', images: [BASE, `${REF}/pose-skill1.png`], prompt: POSE('<招式1姿势描述>'), matte: true },
  { name: 'attack2-end', images: [BASE, `${REF}/pose-skill2.png`], prompt: POSE('<招式2姿势描述>'), matte: true },
  { name: 'intro-end', images: [BASE], prompt: PLAIN('<登场姿势>'), matte: true },
  { name: 'death-end', images: [BASE], prompt: `${STYLE}. Knocked down, collapsed lying on the ground after falling backward, K.O. pose. Same character: ${CHARREF}. ${MAGENTA}.`, matte: true },
  { name: 'super-start', images: [BASE, `${REF}/pose-super.png`], prompt: POSE('<大招姿势描述> plus dramatic effects', 'Dynamic dramatic energy-filled background with motion lines'), aspect: '16:9', res: '2K', matte: false },
];
for (const s of SPECS) {
  const out = await runStudio('google/nano-banana-pro/edit', { prompt: s.prompt, images: s.images, aspectRatio: s.aspect || '3:4', resolution: s.res || '1K', maxWait: 300 });
  if (!out.body.ok) { console.log('FAILED', s.name, out.body.stderr || out.body.error); continue; }
  const url = (out.body.result?.images || [])[0]; if (!url) { console.log('NO URL', s.name); continue; }
  const raw = `${KF}/${s.name}.png`; await writeFile(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));
  const prev = `${KF}/${s.name}.preview.png`; if (s.matte) await matteFile(raw, prev); else await copyFile(raw, prev);
  console.log('OK', s.name); spawn('open', [prev]);
}
console.log('DONE');
```
> 注：`import ... from \`${ROOT}/...\`` 的模板字符串写法在静态 import 里不合法——实际用绝对路径字面量，或 `await import(...)` 动态导入。下方 §6.3 用的是绝对路径字面量，照那个写。

### 6.3 视频 + manifest `genvid.ts`
旧版临时脚本迁移为 `.ts` 后，核心仍是上表 7 个动作 + §5 的 `CAM` 前缀 + 钳制稳定（`clamp(H0/h, 0.85, 1.18)`，仅 `stabilize:true` 的动作），最后写 manifest 和 generated-index。关键片段：

```ts
// 每个动作：
const out = await runStudio('bytedance/seedance-2.0/image-to-video', {
  image: a.first, lastFrameImage: a.last, prompt: CAM + a.motion,   // CAM = §5 固定机位措辞
  duration: a.duration, resolution: a.res, aspectRatio: a.aspect,
  generateAudio: false, seed: Math.floor(Math.random()*4294967295), maxWait: 900,
});
const url = (out.body.result?.videos||[])[0];
// 下载 -> ffmpeg -i video.mp4 -vsync 0 raw/%04d.png -> pickEvenly(raws, a.frames)
// matte 每帧；若 a.stabilize：算 bbox，scale=clamp(H0/bb.h,0.85,1.18)，按脚底基线+本帧水平中心重绘
```

并发用 `mapPool(ANIMS, 4, ...)`。stabilize 的 bbox/place/clamp 实现见 §5 描述（alpha>16 求包围盒；最近邻缩放写回固定画布）。

---

## 7. 验收清单

- [ ] 每个动作把所有帧用 `ffmpeg -i %04d.png -vf "scale=-1:320,tile=Nx1" strip.png` 拼成横条，`open` 看：**全程全身、同比例、无忽大忽小**。
- [ ] 指定姿势的招式与参考图一致。
- [ ] `manifest.json` 帧数与目录实际帧数一致；super 有 `frameRate`+`fullscreen`。
- [ ] `generated-index.json` 有该角色，`portrait` 指向 `idle/0001.png`。
- [ ] 进游戏：`npm run dev`，选人界面能看到、能选、能打。
- [ ] 清理 `public/assets/player/<id>/_work/`（mp4+中间帧，几十 MB，别进 git）。

## 8. 易错点
- nano-banana 返回的是**临时 URL**，必须立刻 `curl`/`fetch` 下载。
- seedance **不能**额外塞参考图；姿势只能通过「关键帧图」带进去。
- 稳定**别**用在会变矮的动作上（蹲/倒/全屏）。
- 中文名 `slugify` 会变成 `fighter`，所以 `CHARID` 自己指定英文 kebab。

---

## 9. 本批待生成角色规格

> 下面是当前要做的几个自定义角色。先按 §3 生成 base，再按本节招式规格替换 §6.2 的 `SPECS` 和 `manifest.moves`。
> 注意：聊天里的 Image 1 / Image 2 当前无法被模型读取；实际生成前需要把可访问图片素材放到对应 `scratchpad-refs/<charid>/` 路径，或补一段清晰的文字姿势描述。

### 9.1 峰哥亡命天涯

- `CHARID`: `fengge-wangming-tianya`
- `name`: `FENGGE WANGMING TIANYA`
- `cn`: `峰哥亡命天涯`
- `summary`: `亡命天涯的狠角色，近身拳脚压迫，靠情绪爆发打出大招。`
- 参考图目录：`scratchpad-refs/fengge-wangming-tianya/`

| 动作 | manifest key | 招式名 | 建议关键帧 / prompt 要点 | 稳定? |
|---|---|---|---|---|
| 1 | `attack1` | `拳击` | 侧身向右出直拳或摆拳，拳头伸出，另一手护脸，保持全身像素格斗角色。 | 是 |
| 2 | `attack2` | `踢人` | 侧身向右踢人，单腿踢出，重心腿站稳，脚和头都完整入画。 | 看姿势，若高踢仍直立可稳定 |
| 3 | `super` | `性压抑` | 使用 Image 1 作为大招姿势/氛围参考；16:9 全屏戏剧背景，情绪爆发、压迫感、能量线。 | 否 |

`manifest.moves` 建议：

```json
{
  "attack1": { "name": "拳击", "damage": 18 },
  "attack2": { "name": "踢人", "damage": 20 },
  "super": { "name": "性压抑", "damage": 40 }
}
```

### 9.2 speed

- `CHARID`: `speed`
- `name`: `SPEED`
- `cn`: `speed`
- `summary`: `高速整活型选手，用拳击和后空翻拉开节奏，大招以 siu 收尾。`
- 参考图目录：`scratchpad-refs/speed/`

| 动作 | manifest key | 招式名 | 建议关键帧 / prompt 要点 | 稳定? |
|---|---|---|---|---|
| 1 | `attack1` | `拳击` | 快速向右出拳，身体前压，拳击命中感强。 | 是 |
| 2 | `attack2` | `后空翻` | 原地后空翻，身体倒转或腾空，完整全身入画。 | 否 |
| 3 | `super` | `siu` | 使用 Image 2 作为大招姿势/氛围参考；做 siu 标志性庆祝姿势，16:9 全屏，夸张舞台灯光和冲击波。 | 否 |

`manifest.moves` 建议：

```json
{
  "attack1": { "name": "拳击", "damage": 18 },
  "attack2": { "name": "后空翻", "damage": 16 },
  "super": { "name": "siu", "damage": 40 }
}
```

### 9.3 科比

- `CHARID`: `kobe`
- `name`: `KOBE`
- `cn`: `科比`
- `summary`: `篮球巨星风格格斗角色，拳脚近战后接后仰跳投终结。`
- 参考图目录：`scratchpad-refs/kobe/`
- 人物参考：聊天里提供了 `data:image/jpeg;base64,...` 图片；实际生成时先转成可访问图片文件，例如 `scratchpad-refs/kobe/person.jpg`。

| 动作 | manifest key | 招式名 | 建议关键帧 / prompt 要点 | 稳定? |
|---|---|---|---|---|
| 1 | `attack1` | `拳击` | 侧身向右出拳，保持篮球运动员体型和球衣特征。 | 是 |
| 2 | `attack2` | `踢腿` | 侧身向右踢腿，运动员式爆发力，脚和头都完整入画。 | 看姿势，若高踢仍直立可稳定 |
| 3 | `super` | `后仰跳投` | 后仰跳投大招，身体向后倾斜、投篮出手、篮球轨迹/能量弧线，16:9 全屏戏剧背景。 | 否 |

`manifest.moves` 建议：

```json
{
  "attack1": { "name": "拳击", "damage": 18 },
  "attack2": { "name": "踢腿", "damage": 20 },
  "super": { "name": "后仰跳投", "damage": 42 }
}
```
