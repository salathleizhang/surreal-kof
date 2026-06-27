import http from 'node:http';
import { spawn } from 'node:child_process';

const host = process.env.LOCAL_API_HOST || '127.0.0.1';
const port = Number(process.env.LOCAL_API_PORT || 8787);
const maxBodyBytes = 10 * 1024 * 1024;

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

  if (Array.isArray(value)) {
    for (const item of value) {
      args.push(flag, String(item));
    }
    return;
  }

  args.push(flag, String(value));
}

function runMuleRun(args) {
  return new Promise((resolve) => {
    const child = spawn('mulerun', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, presets });
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
      routes: ['GET /health', 'GET /api/models', 'POST /api/run', ...Object.keys(presets).map((name) => `POST /api/${name}`)],
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Local MuleRun Studio API listening on http://${host}:${port}`);
  console.log('Routes: GET /health, GET /api/models, POST /api/{seedence|chatgpt-image2|nanobanana-pro}');
});
