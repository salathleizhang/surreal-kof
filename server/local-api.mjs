import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  startCharacterJob, advanceJob, regenerateJob, getJob, listJobs,
} from './character-pipeline.mjs';

const host = process.env.LOCAL_API_HOST || '127.0.0.1';
const port = Number(process.env.LOCAL_API_PORT || 8787);
const maxBodyBytes = 32 * 1024 * 1024; // base64-encoded upload photos can be a few MB
const defaultChatModel = process.env.LOCAL_CHAT_MODEL || 'openai/gpt-5.5';
const defaultChatCwd = process.env.LOCAL_CHAT_CWD || '/var/folders/4q/t5h2g2fs0cz7sz_p4c0my5y40000gn/T/opencode';

const presets = {
  seedence: 'bytedance/seedance-2.0/text-to-video',
  seedance: 'bytedance/seedance-2.0/text-to-video',
  'seedance-fast': 'bytedance/seedance-2.0-fast/text-to-video',
  'chatgpt-image2': 'openai/gpt-image-2/generation',
  'gpt-image2': 'openai/gpt-image-2/generation',
  'nanobanana-pro': 'google/nano-banana-pro/generation',
  'nanobanana-pro-edit': 'google/nano-banana-pro/edit',
};

const reservedKeys = new Set(['endpoint', 'preset', 'noWait', 'pollInterval', 'maxWait', 'site']);

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new Error('Request body is too large.');
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

function toKebab(key) {
  return key
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function addParam(args, key, value) {
  if (value === undefined || value === null || reservedKeys.has(key)) return;
  const flag = `--${toKebab(key)}`;

  // mulerouter's array-typed params (e.g. nano-banana edit's `images`) expect a
  // single JSON-array string, not a repeated flag.
  if (Array.isArray(value)) {
    args.push(flag, JSON.stringify(value.map(String)));
    return;
  }

  args.push(flag, String(value));
}

function runMuleRun(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn('mulerun', args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      resolve({ ok: false, status: 500, stdout, stderr, error: error.message });
    });

    child.on('close', (code) => {
      resolve({ ok: code === 0, status: code === 0 ? 200 : 502, code, stdout, stderr });
    });
  });
}

async function runStudio(endpoint, body) {
  if (!/^[-\w./]+$/.test(endpoint)) {
    return { status: 400, body: { error: 'Invalid endpoint.' } };
  }

  const args = ['studio', 'run', endpoint, '--json', '--quiet'];

  if (body.noWait) args.push('--no-wait');
  if (body.pollInterval) args.push('--poll-interval', String(body.pollInterval));
  if (body.maxWait) args.push('--max-wait', String(body.maxWait));
  if (body.site) args.push('--site', String(body.site));

  for (const [key, value] of Object.entries(body)) {
    addParam(args, key, value);
  }

  const result = await runMuleRun(args);
  let parsed = null;
  try {
    parsed = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {
    parsed = null;
  }

  return {
    status: result.status,
    body: {
      ok: result.ok,
      endpoint,
      result: parsed,
      stdout: parsed ? undefined : result.stdout.trim(),
      stderr: result.stderr.trim() || undefined,
      code: result.code,
      error: result.error,
    },
  };
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return null;

  return messages
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const role = typeof message.role === 'string' ? message.role : 'user';
      const content = typeof message.content === 'string' ? message.content : '';
      return content ? `${role}: ${content}` : null;
    })
    .filter(Boolean)
    .join('\n\n');
}

async function runChat(body) {
  const prompt = typeof body.prompt === 'string' ? body.prompt : normalizeMessages(body.messages);

  if (!prompt) {
    return { status: 400, body: { error: 'Missing string field: prompt, or non-empty messages array.' } };
  }

  const model = typeof body.model === 'string' ? body.model : defaultChatModel;
  if (!/^[-\w./:]+$/.test(model)) {
    return { status: 400, body: { error: 'Invalid model.' } };
  }

  const args = ['--no-color', 'code'];
  if (body.agent) args.push('-a', String(body.agent));
  args.push('-m', model);
  if (body.smallModel) args.push('-s', String(body.smallModel));
  if (body.effort) args.push('--effort', String(body.effort));
  args.push('--', prompt);

  const cwd = typeof body.cwd === 'string' ? body.cwd : defaultChatCwd;
  const result = await runMuleRun(args, { cwd });

  return {
    status: result.status,
    body: {
      ok: result.ok,
      model,
      cwd,
      content: result.stdout.trim(),
      stderr: result.stderr.trim() || undefined,
      code: result.code,
      error: result.error,
    },
  };
}

// Decode a data: URI (or bare base64) upload into a temp file, keeping the real
// extension so the downstream model can sniff the right MIME type.
const MIME_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
};
async function saveDataUriPhoto(dataUri) {
  const m = /^data:(image\/[\w+.-]+)?;base64,(.*)$/s.exec(dataUri) || [];
  const b64 = m[2] || dataUri;
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length) throw new Error('Empty photo payload.');
  const ext = MIME_EXT[(m[1] || '').toLowerCase()] || 'png';
  const dir = await mkdtemp(join(tmpdir(), 'kof-photo-'));
  const path = join(dir, `source.${ext}`);
  await writeFile(path, buf);
  return path;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, presets, chat: { defaultModel: defaultChatModel } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/chat/models') {
      const result = await runMuleRun(['code', 'models']);
      sendJson(res, result.status, {
        ok: result.ok,
        content: result.stdout.trim(),
        stderr: result.stderr.trim() || undefined,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/models') {
      const result = await runMuleRun(['studio', 'list', '--json']);
      sendJson(res, result.status, {
        ok: result.ok,
        result: result.stdout ? JSON.parse(result.stdout) : null,
        stderr: result.stderr.trim() || undefined,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      const body = await readJson(req);
      const endpoint = body.endpoint;

      if (!endpoint || typeof endpoint !== 'string') {
        sendJson(res, 400, { error: 'Missing string field: endpoint' });
        return;
      }

      const output = await runStudio(endpoint, body);
      sendJson(res, output.status, output.body);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = await readJson(req);
      const output = await runChat(body);
      sendJson(res, output.status, output.body);
      return;
    }

    // Custom-character generation: start a job, then poll it.
    if (req.method === 'POST' && url.pathname === '/api/generate-character') {
      const body = await readJson(req);
      if (!body.name || typeof body.name !== 'string') {
        sendJson(res, 400, { error: 'Missing string field: name' });
        return;
      }
      let photoPath = null;
      if (body.photo) {
        try {
          photoPath = await saveDataUriPhoto(body.photo);
        } catch (e) {
          sendJson(res, 400, { error: `Bad photo: ${e.message}` });
          return;
        }
      }
      if (!photoPath && !body.mock) {
        sendJson(res, 400, { error: 'Missing photo (data URI) — or pass mock:true to dry-run.' });
        return;
      }
      const job = startCharacterJob({ name: body.name, photoPath, mock: !!body.mock });
      sendJson(res, 202, job);
      return;
    }

    // Approve the current stage and run the next one.
    const advanceMatch = url.pathname.match(/^\/api\/generate-character\/([\w-]+)\/advance$/);
    if (req.method === 'POST' && advanceMatch) {
      const job = advanceJob(advanceMatch[1]);
      if (!job) { sendJson(res, 404, { error: 'Unknown job.' }); return; }
      sendJson(res, 200, job);
      return;
    }

    // Redo the current stage (optionally a single keyframe via { target }).
    const regenMatch = url.pathname.match(/^\/api\/generate-character\/([\w-]+)\/regenerate$/);
    if (req.method === 'POST' && regenMatch) {
      const body = await readJson(req);
      const job = regenerateJob(regenMatch[1], body.target);
      if (!job) { sendJson(res, 404, { error: 'Unknown job.' }); return; }
      sendJson(res, 200, job);
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/generate-character\/([\w-]+)$/);
    if (req.method === 'GET' && jobMatch) {
      const job = getJob(jobMatch[1]);
      if (!job) {
        sendJson(res, 404, { error: 'Unknown job.' });
        return;
      }
      sendJson(res, 200, job);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/generate-character') {
      sendJson(res, 200, { jobs: listJobs() });
      return;
    }

    const presetMatch = url.pathname.match(/^\/api\/([^/]+)$/);
    if (req.method === 'POST' && presetMatch) {
      const preset = presetMatch[1];
      const endpoint = presets[preset];

      if (!endpoint) {
        sendJson(res, 404, { error: 'Unknown preset.', presets });
        return;
      }

      const body = await readJson(req);
      const output = await runStudio(endpoint, body);
      sendJson(res, output.status, { preset, ...output.body });
      return;
    }

    sendJson(res, 404, {
      error: 'Not found.',
      routes: [
        'GET /health',
        'GET /api/models',
        'GET /api/chat/models',
        'POST /api/chat',
        'POST /api/run',
        ...Object.keys(presets).map((name) => `POST /api/${name}`),
      ],
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Local MuleRun Studio API listening on http://${host}:${port}`);
  console.log('Routes: GET /health, GET /api/models, GET /api/chat/models, POST /api/chat, POST /api/{seedence|chatgpt-image2|nanobanana-pro}');
});
