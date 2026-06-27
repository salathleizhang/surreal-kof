// Shared MuleRun CLI wrappers used by both the HTTP routes (local-api.mjs) and
// the character-generation pipeline (character-pipeline.mjs).
//
// - Image / video / audio go through `mulerun studio run <endpoint>`.
// - Language models go through `mulerun code -m <model> -- run "<prompt>"`
//   (opencode one-shot), executed in a throwaway cwd so the agent never touches
//   this project.
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PRESETS = {
  seedence: 'bytedance/seedance-2.0/text-to-video',
  seedance: 'bytedance/seedance-2.0/text-to-video',
  'seedance-fast': 'bytedance/seedance-2.0-fast/text-to-video',
  'seedance-i2v': 'bytedance/seedance-2.0/image-to-video',
  'chatgpt-image2': 'openai/gpt-image-2/generation',
  'gpt-image2': 'openai/gpt-image-2/generation',
  'nanobanana-pro': 'google/nano-banana-pro/generation',
  'nanobanana-pro-edit': 'google/nano-banana-pro/edit',
};

export const DEFAULT_CHAT_MODEL = process.env.LOCAL_CHAT_MODEL || 'openai/gpt-5.5';

const reservedKeys = new Set(['endpoint', 'preset', 'noWait', 'pollInterval', 'maxWait', 'site']);

function toKebab(key) {
  return key.replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function addParam(args, key, value) {
  if (value === undefined || value === null || reservedKeys.has(key)) return;
  const flag = `--${toKebab(key)}`;
  if (Array.isArray(value)) {
    for (const item of value) args.push(flag, String(item));
    return;
  }
  args.push(flag, String(value));
}

export function runMule(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn('mulerun', args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (error) => resolve({ ok: false, status: 500, stdout, stderr, error: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, status: code === 0 ? 200 : 502, code, stdout, stderr }));
  });
}

// Run a `mulerun studio` model endpoint, returning the parsed JSON result.
export async function runStudio(endpoint, body = {}) {
  if (!/^[-\w./]+$/.test(endpoint)) {
    return { status: 400, body: { error: 'Invalid endpoint.' } };
  }
  const args = ['studio', 'run', endpoint, '--json', '--quiet'];
  if (body.noWait) args.push('--no-wait');
  if (body.pollInterval) args.push('--poll-interval', String(body.pollInterval));
  if (body.maxWait) args.push('--max-wait', String(body.maxWait));
  if (body.site) args.push('--site', String(body.site));
  for (const [key, value] of Object.entries(body)) addParam(args, key, value);

  const result = await runMule(args);
  let parsed = null;
  try { parsed = result.stdout ? JSON.parse(result.stdout) : null; } catch { parsed = null; }

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

// opencode prints a one-line banner ("> build · gpt-5.5") and may colourise
// output; strip ANSI + the banner so callers get just the model's reply.
function cleanChatOutput(raw) {
  // eslint-disable-next-line no-control-regex
  const noAnsi = raw.replace(/\[[0-9;]*m/g, '');
  return noAnsi
    .split('\n')
    .filter((line) => !/^\s*>\s*\w+\s*·/.test(line))
    .join('\n')
    .trim();
}

// One-shot language-model call via `mulerun code`. Runs in a fresh temp dir.
export async function runChat({
  prompt, model = DEFAULT_CHAT_MODEL, agent, smallModel, effort, cwd,
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return { ok: false, error: 'Missing string field: prompt' };
  }
  const workdir = cwd || await mkdtemp(join(tmpdir(), 'kof-chat-'));
  const args = ['code'];
  if (agent) args.push('-a', String(agent));
  if (model) args.push('-m', String(model));
  if (smallModel) args.push('-s', String(smallModel));
  if (effort) args.push('--effort', String(effort));
  args.push('--', 'run', prompt);

  const result = await runMule(args, { cwd: workdir });
  return {
    ok: result.ok,
    model,
    cwd: workdir,
    content: cleanChatOutput(result.stdout || ''),
    stderr: result.stderr?.trim() || undefined,
    code: result.code,
    error: result.error,
  };
}
