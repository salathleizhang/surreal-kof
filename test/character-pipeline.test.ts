import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function waitForSettled(
  getJob: (id: string) => any,
  id: string,
  timeoutMs = 60_000,
): Promise<any> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = getJob(id);
    if (job?.status !== 'running') return job;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`Timed out waiting for job ${id}`);
}

test('mock pipeline emits guard, idle-anchored jump/hit and split super assets', async () => {
  const playerDir = await mkdtemp(join(tmpdir(), 'kof-pipeline-'));
  process.env.KOF_GENERATED_PLAYER_DIR = playerDir;

  try {
    const pipeline = await import('../server/character-pipeline.ts');
    assert.match(pipeline.SPRITE_PIXEL_GRID_STANDARD, /96 x 128 logical-pixel/);
    assert.match(pipeline.SPRITE_PIXEL_GRID_STANDARD, /112 logical pixels tall/);
    assert.match(pipeline.SPRITE_FRAMING_STANDARD, /baseline at 96%/);
    const baseReferences = pipeline.baseImageReferences('/tmp/target-person.png');
    assert.equal(baseReferences[0], '/tmp/target-person.png');
    assert.equal(baseReferences.length, 2);
    assert.match(baseReferences[1], /fighter-87633c7b\/idle\/0001\.png$/);
    assert.match(pipeline.BASE_REFERENCE_ROLES, /STYLE REFERENCE ONLY/);
    assert.doesNotMatch(baseReferences[1], /attack|intro|super/);
    const guardPlan = pipeline.ANIMS.find((anim) => anim.key === 'guard');
    assert.equal(guardPlan?.startKf, 'base');
    assert.equal(guardPlan?.endKf, 'gen');
    assert.equal(guardPlan?.playback, 'hold');
    let job: any = pipeline.startCharacterJob({ name: 'Pipeline Test', photoPath: null, mock: true });

    job = await waitForSettled(pipeline.getJob, job.id);
    assert.equal(job.stage, 'base');
    assert.equal(job.status, 'awaiting');

    pipeline.advanceJob(job.id);
    job = await waitForSettled(pipeline.getJob, job.id);
    assert.equal(job.stage, 'keyframes');
    assert.equal(job.status, 'awaiting');
    assert.ok(job.keyframes.portrait);
    assert.ok(job.keyframes.jump);
    assert.equal(job.keyframes.jump.first, job.keyframes.jump.last);
    assert.equal(job.keyframes.jump.generated, false);
    assert.ok(job.keyframes.guard);
    assert.notEqual(job.keyframes.guard.first, job.keyframes.guard.last);
    assert.equal(job.keyframes.guard.generated, true);
    assert.match(job.keyframes.guard.first, /base\.preview\.png/);
    assert.match(job.keyframes.guard.last, /kf\/guard-end\.preview\.png/);
    assert.ok(job.keyframes.hit);
    assert.equal(job.keyframes.hit.first, job.keyframes.hit.last);
    assert.equal(job.keyframes.hit.generated, false);
    assert.ok(job.keyframes.super);
    assert.ok(job.keyframes.superBackground);

    pipeline.advanceJob(job.id);
    job = await waitForSettled(pipeline.getJob, job.id);
    assert.equal(job.status, 'done');
    assert.equal(job.manifest.portrait, `assets/player/${job.charId}/portrait.png`);
    assert.equal(job.manifest.anims.jump.engineState, 3);
    assert.equal(job.manifest.anims.guard.engineState, 10);
    assert.equal(job.manifest.anims.guard.playback, 'hold');
    assert.equal(job.manifest.anims.hit.engineState, 5);
    assert.equal(job.manifest.anims.hit.playback, 'forward');
    assert.equal(job.manifest.anims.super.matte, true);
    assert.equal(job.manifest.anims.super.fullscreen, undefined);
    assert.equal(job.manifest.superBackground.matte, false);
    assert.equal(job.manifest.superBackground.fullscreen, true);

    const manifest = JSON.parse(await readFile(join(playerDir, job.charId, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.superBackground, job.manifest.superBackground);
    assert.equal((await readdir(join(playerDir, job.charId, 'jump'))).length, 8);
    assert.equal((await readdir(join(playerDir, job.charId, 'guard'))).length, 8);
    assert.equal((await readdir(join(playerDir, job.charId, 'hit'))).length, 8);
    assert.equal((await readdir(join(playerDir, job.charId, 'super'))).length, 25);
    assert.equal((await readdir(join(playerDir, job.charId, 'super-background'))).length, 25);
  } finally {
    delete process.env.KOF_GENERATED_PLAYER_DIR;
    await rm(playerDir, { recursive: true, force: true });
  }
});
