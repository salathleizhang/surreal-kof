# Local MuleRun API

本地 API 服务地址：

```text
http://127.0.0.1:8787
```

该服务只监听本机 `127.0.0.1`，通过本机已登录/已配置的 MuleRun CLI 调用模型。

- 图片、视频、音频、音乐接口使用 `mulerun studio`。
- 语言模型接口使用 `mulerun code`。

## 启动

```bash
npm run local-api
```

可选端口和监听地址：

```bash
LOCAL_API_PORT=8787 LOCAL_API_HOST=127.0.0.1 npm run local-api
```

## 停止

先查端口对应进程：

```bash
lsof -n -P -iTCP:8787 -sTCP:LISTEN
```

然后停止对应 PID：

```bash
kill <PID>
```

## 健康检查

```http
GET /health
```

示例：

```bash
curl http://127.0.0.1:8787/health
```

返回内容包含当前预置接口：

```json
{
  "ok": true,
  "presets": {
    "seedence": "bytedance/seedance-2.0/text-to-video",
    "seedance": "bytedance/seedance-2.0/text-to-video",
    "seedance-fast": "bytedance/seedance-2.0-fast/text-to-video",
    "chatgpt-image2": "openai/gpt-image-2/generation",
    "gpt-image2": "openai/gpt-image-2/generation",
    "nanobanana-pro": "google/nano-banana-pro/generation",
    "nanobanana-pro-edit": "google/nano-banana-pro/edit"
  },
  "chat": {
    "defaultModel": "openai/gpt-5.5"
  }
}
```

## 查看模型

```http
GET /api/models
```

示例：

```bash
curl http://127.0.0.1:8787/api/models
```

## 查看语言模型

```http
GET /api/chat/models
```

示例：

```bash
curl http://127.0.0.1:8787/api/chat/models
```

该接口返回 `mulerun code models` 的文本输出，包含当前可用的语言模型。

## 语言模型对话

```http
POST /api/chat
```

默认模型是 `openai/gpt-5.5`。可以用环境变量修改默认值：

```bash
LOCAL_CHAT_MODEL=google/gemini-3.1-pro-preview npm run local-api
```

请求体：

```json
{
  "model": "openai/gpt-5.5",
  "prompt": "你好，帮我写一段产品介绍",
  "effort": "medium"
}
```

也支持 OpenAI 风格的 `messages` 数组，服务会合并成一次 prompt：

```json
{
  "model": "google/gemini-3.1-pro-preview",
  "messages": [
    { "role": "system", "content": "你是一个简洁的中文助手。" },
    { "role": "user", "content": "写一个 50 字产品介绍。" }
  ]
}
```

参数：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 否 | 用户输入；和 `messages` 二选一 |
| `messages` | 否 | OpenAI 风格消息数组；和 `prompt` 二选一 |
| `model` | 否 | 语言模型 ID，默认 `openai/gpt-5.5` |
| `agent` | 否 | `mulerun code` agent，默认由 MuleRun 决定 |
| `smallModel` | 否 | opencode 标题/摘要/子任务小模型 |
| `effort` | 否 | `low`、`medium`、`high` |
| `cwd` | 否 | 执行目录；默认是临时目录，避免误改当前项目 |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/chat \
  -H 'content-type: application/json' \
  -d '{"model":"openai/gpt-5.5","prompt":"用一句话解释什么是反向代理"}'
```

响应示例：

```json
{
  "ok": true,
  "model": "openai/gpt-5.5",
  "cwd": "/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/opencode",
  "content": "反向代理是代替后端服务接收客户端请求并转发到真实服务的中间层。",
  "code": 0
}
```

注意：`/api/chat` 底层是 `mulerun code`，不是纯 REST LLM SDK。默认执行目录放在临时目录；如果你传入 `cwd` 指向项目目录，模型可能会按提示执行编码任务并修改文件。

## ChatGPT Image 2 生图

```http
POST /api/chatgpt-image2
```

请求体：

```json
{
  "prompt": "A cinematic robot panda",
  "quality": "high",
  "size": "1024x1024",
  "n": 1,
  "format": "png"
}
```

参数：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 生图提示词 |
| `quality` | 否 | `high`、`medium`、`low`、`auto` |
| `size` | 否 | `1024x1024`、`1536x1024`、`1024x1536`、`2048x2048`、`2048x1152`、`3840x2160`、`2160x3840`、`auto` |
| `n` | 否 | 图片数量，`1-4` |
| `format` | 否 | `png`、`jpeg`、`webp` |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/chatgpt-image2 \
  -H 'content-type: application/json' \
  -d '{"prompt":"A cinematic robot panda","size":"1024x1024"}'
```

## Nano Banana Pro 生图

```http
POST /api/nanobanana-pro
```

请求体：

```json
{
  "prompt": "A cinematic robot panda",
  "aspectRatio": "1:1",
  "resolution": "1K"
}
```

参数：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 生图提示词 |
| `aspectRatio` | 否 | `1:1`、`3:4`、`4:3`、`9:16`、`16:9`、`2:3`、`3:2`、`9:21`、`21:9`、`4:5` |
| `resolution` | 否 | `1K`、`2K` |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/nanobanana-pro \
  -H 'content-type: application/json' \
  -d '{"prompt":"A cinematic robot panda","aspectRatio":"1:1","resolution":"1K"}'
```

## Nano Banana Pro 改图

```http
POST /api/nanobanana-pro-edit
```

请求体：

```json
{
  "prompt": "Make it cyberpunk",
  "images": ["/path/to/input.png"],
  "aspectRatio": "1:1",
  "resolution": "1K"
}
```

参数：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 改图提示词 |
| `images` | 是 | 输入图片 URL 或本地文件路径数组，`1-10` 张 |
| `aspectRatio` | 否 | 输出比例 |
| `resolution` | 否 | `1K`、`2K` |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/nanobanana-pro-edit \
  -H 'content-type: application/json' \
  -d '{"prompt":"Make it cyberpunk","images":["/path/to/input.png"],"aspectRatio":"1:1"}'
```

## Seedance 视频

```http
POST /api/seedence
POST /api/seedance
```

请求体：

```json
{
  "prompt": "A cinematic robot panda walking in rain",
  "resolution": "720p",
  "aspectRatio": "16:9",
  "duration": 5,
  "generateAudio": true,
  "seed": -1,
  "webSearch": false,
  "cameraFixed": false,
  "watermark": false
}
```

参数：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 视频提示词 |
| `resolution` | 否 | `480p`、`720p`、`1080p` |
| `aspectRatio` | 否 | `16:9`、`4:3`、`1:1`、`3:4`、`9:16`、`21:9`、`adaptive` |
| `duration` | 否 | 秒数，`4-15`，或 `-1` 让模型决定 |
| `generateAudio` | 否 | 是否生成音频 |
| `seed` | 否 | 随机种子，`-1` 到 `4294967295` |
| `webSearch` | 否 | 是否启用联网搜索 grounding |
| `cameraFixed` | 否 | 是否锁定相机 |
| `watermark` | 否 | 是否加水印 |

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/seedence \
  -H 'content-type: application/json' \
  -d '{"prompt":"A cinematic robot panda walking in rain","duration":5,"resolution":"720p"}'
```

## 通用调用

```http
POST /api/run
```

用于直接调用任意 MuleRun Studio endpoint。

请求体：

```json
{
  "endpoint": "google/nano-banana-pro/generation",
  "prompt": "A red sports car",
  "aspectRatio": "1:1"
}
```

示例：

```bash
curl -X POST http://127.0.0.1:8787/api/run \
  -H 'content-type: application/json' \
  -d '{"endpoint":"google/nano-banana-pro/generation","prompt":"A red sports car","aspectRatio":"1:1"}'
```

## 字段命名规则

JSON 字段支持驼峰或下划线，服务会自动转成 CLI 参数：

| JSON 字段 | CLI 参数 |
| --- | --- |
| `aspectRatio` | `--aspect-ratio` |
| `generateAudio` | `--generate-audio` |
| `webSearch` | `--web-search` |
| `cameraFixed` | `--camera-fixed` |
| `pollInterval` | `--poll-interval` |
| `maxWait` | `--max-wait` |

## 响应格式

成功时通常返回：

```json
{
  "preset": "nanobanana-pro",
  "ok": true,
  "endpoint": "google/nano-banana-pro/generation",
  "result": {}
}
```

失败时通常返回：

```json
{
  "ok": false,
  "endpoint": "google/nano-banana-pro/generation",
  "stderr": "error message",
  "code": 1
}
```

## 自定义角色生成

```http
POST /api/generate-character
GET  /api/generate-character/:id
GET  /api/generate-character
```

上传一张照片 + 名字，服务端跑完整流水线（研究角色 → 全身像素 base 图 → 7 套动画的首尾帧 → seedance 图生视频 → 抽帧 → 抠图 → 写 manifest），产物落在 `public/assets/player/<id>/`，由 Vite 直接静态服务给游戏。

任务是长耗时异步作业：`POST` 立即返回一个 `id`，再 `GET /api/generate-character/:id` 轮询进度。

请求体：

```json
{
  "name": "科比",
  "photo": "data:image/png;base64,...",
  "mock": false
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 角色名字，驱动 LLM 研究 |
| `photo` | 是* | data URI 或 base64 照片；`mock:true` 时可省略 |
| `mock` | 否 | 跳过所有真实模型调用，本地合成帧用于联调整条管线 |

轮询返回：

```json
{
  "id": "ab12cd34",
  "charId": "kobe-ab12cd34",
  "status": "running",
  "step": "生成「attack1」动画视频…",
  "progress": 0.42,
  "log": ["研究角色与设计动画提示词…", "..."],
  "manifest": null,
  "error": null
}
```

`status` 为 `done` 时 `manifest` 字段为最终角色清单；`failed` 时 `error` 为原因。

每个生成角色还会登记进 `public/assets/player/generated-index.json`，游戏在 PreloadScene 启动时读取它，刷新页面后角色仍在选人列表里。

## 日志

当前后台启动日志：

```text
/tmp/kof-ai-local-api.log
```
