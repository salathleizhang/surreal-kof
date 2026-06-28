// A plain-DOM, step-by-step wizard for creating a custom fighter from a photo +
// name. It mirrors the King of Fighters select screen (layered arcade borders,
// red title gel, corner brackets, CRT scanlines, pixel font) and walks the user
// through review-gated stages, each backed by the local pipeline API:
//
//   1 信息    upload photo + name
//   2 BASE    review the base sprite      (重生成 / 下一步)
//   3 首尾帧  review the keyframes         (整体或单个重生成 / 下一步)
//   4 生成    videos -> frames -> done
//
// onComplete(manifest) fires once the fighter is fully generated.

const LOCAL_API = 'http://127.0.0.1:8787';
const STYLE_ID = 'kof-cc-style';
const FONT = '"Press Start 2P", "PingFang SC", "Microsoft YaHei", sans-serif';

// Friendly labels for each animation card on the keyframe-review step.
const ANIM_LABELS = {
  idle: '站立 IDLE',
  walk: '行走 WALK',
  attack1: '攻击1 ATK1',
  attack2: '攻击2 ATK2',
  intro: '入场 INTRO',
  death: '倒地 DEATH',
  super: '大招 SUPER',
};
const STEPS = ['信息', 'BASE 图', '首尾帧', '生成'];

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@keyframes kof-cc-in { 0% { opacity:0; transform: translateY(40px) scale(0.86); } 100% { opacity:1; transform: translateY(0) scale(1); } }
@keyframes kof-cc-glow { 0%,100% { box-shadow: 0 0 18px rgba(127,255,212,0.35); } 50% { box-shadow: 0 0 30px rgba(127,255,212,0.65); } }
@keyframes kof-cc-shine { 0% { left:-40%; } 100% { left:120%; } }
@keyframes kof-cc-blink { 0%,100% { opacity:1; } 50% { opacity:0.35; } }

.kof-cc-overlay { position:fixed; inset:0; z-index:10000; display:flex; align-items:center; justify-content:center;
  background: radial-gradient(circle at 50% 40%, rgba(10,22,52,0.78), rgba(2,5,14,0.92));
  font-family:${FONT}; -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px); }
.kof-cc-overlay::after { content:''; position:absolute; inset:0; pointer-events:none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px); mix-blend-mode:multiply; }
.kof-cc-panel { position:relative; width:min(620px,95vw); max-height:92vh; display:flex; flex-direction:column;
  background: linear-gradient(180deg, rgba(18,38,76,0.96), rgba(8,16,38,0.98)); color:#dff6ff;
  box-shadow: 0 0 0 3px #071330, 0 0 0 6px #7fffd4, 0 0 0 9px #071330, 0 0 0 12px #eaf2ff, 0 14px 50px rgba(0,0,0,0.6);
  animation: kof-cc-in 360ms cubic-bezier(0.34,1.56,0.64,1) both; image-rendering: pixelated; }
.kof-cc-corner { position:absolute; width:16px; height:16px; border:3px solid #ffcc33; z-index:3; }
.kof-cc-corner.tl{top:-12px;left:-12px;border-right:0;border-bottom:0;} .kof-cc-corner.tr{top:-12px;right:-12px;border-left:0;border-bottom:0;}
.kof-cc-corner.bl{bottom:-12px;left:-12px;border-right:0;border-top:0;} .kof-cc-corner.br{bottom:-12px;right:-12px;border-left:0;border-top:0;}

.kof-cc-header { position:relative; padding:13px 18px; overflow:hidden; flex:none;
  background: linear-gradient(180deg,#d12626,#8c1212); border-bottom:3px solid #071330;
  display:flex; align-items:center; justify-content:space-between; }
.kof-cc-header::before { content:''; position:absolute; top:0; bottom:0; left:-40%; width:30%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent); transform:skewX(-20deg); animation:kof-cc-shine 3.2s linear infinite; }
.kof-cc-title { position:relative; font-size:17px; letter-spacing:1px; color:#fff; text-shadow:2px 2px 0 #5a0c0c, 0 0 10px rgba(255,180,180,0.6); }
.kof-cc-title small { display:block; font-size:9px; margin-top:6px; color:#ffe0e0; letter-spacing:0; }
.kof-cc-close { position:relative; cursor:pointer; color:#ffd9d9; font-size:15px; width:26px; height:26px; line-height:24px; text-align:center; border:2px solid #ffd9d9; background:rgba(0,0,0,0.2); }
.kof-cc-close:hover { color:#fff; border-color:#fff; background:rgba(0,0,0,0.4); }

.kof-cc-steps { display:flex; gap:6px; padding:12px 18px 0; flex:none; }
.kof-cc-step { flex:1; font-size:8px; letter-spacing:0; color:#5f7aa0; text-align:center; padding:7px 2px; border:2px solid #233a63; background:#0a1730; position:relative; }
.kof-cc-step b { display:block; font-size:11px; margin-bottom:4px; color:#3a557f; }
.kof-cc-step.active { border-color:#7fffd4; color:#bff7e6; box-shadow:0 0 12px rgba(127,255,212,0.3) inset; }
.kof-cc-step.active b { color:#7fffd4; }
.kof-cc-step.done { border-color:#1f9c84; color:#7fd8c4; }
.kof-cc-step.done b { color:#39ff9a; }

.kof-cc-body { padding:18px 22px; overflow-y:auto; flex:1; }
.kof-cc-row { display:flex; gap:18px; align-items:stretch; }
.kof-cc-drop { position:relative; width:150px; min-height:188px; flex:none; border:2px dashed #4fd6c0; background:#08122a;
  display:flex; align-items:center; justify-content:center; text-align:center; color:#5f8fb0; font-size:9px; line-height:1.8; cursor:pointer; overflow:hidden; box-shadow:inset 0 0 0 2px #07142e; }
.kof-cc-drop:hover { border-color:#7fffd4; color:#9fd6ff; }
.kof-cc-drop img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
.kof-cc-drop .kof-cc-plus { font-size:30px; color:#4fd6c0; margin-bottom:8px; }
.kof-cc-fields { flex:1; display:flex; flex-direction:column; }
.kof-cc-label { font-size:9px; color:#7fffd4; letter-spacing:1px; margin-bottom:8px; }
.kof-cc-input { width:100%; box-sizing:border-box; padding:12px; margin-bottom:14px; background:#060f24; border:2px solid #2f60a0; color:#eaf6ff; font-family:inherit; font-size:12px; outline:none; box-shadow:inset 0 2px 0 rgba(0,0,0,0.4); }
.kof-cc-input:focus { border-color:#7fffd4; box-shadow:inset 0 2px 0 rgba(0,0,0,0.4), 0 0 12px rgba(127,255,212,0.4); }
.kof-cc-hint { font-size:9px; line-height:1.9; color:#8fa9cc; } .kof-cc-hint b { color:#ffcc55; }

/* checkerboard so transparent (matted) previews read clearly */
.kof-cc-checker { background-color:#0a1326;
  background-image: linear-gradient(45deg,#16233f 25%,transparent 25%), linear-gradient(-45deg,#16233f 25%,transparent 25%), linear-gradient(45deg,transparent 75%,#16233f 75%), linear-gradient(-45deg,transparent 75%,#16233f 75%);
  background-size:16px 16px; background-position:0 0,0 8px,8px -8px,-8px 0; image-rendering:pixelated; }

.kof-cc-base-wrap { display:flex; flex-direction:column; align-items:center; }
.kof-cc-base-img { width:200px; height:266px; object-fit:contain; border:2px solid #4fd6c0; box-shadow:0 0 16px rgba(127,255,212,0.25); }
.kof-cc-cap { font-size:9px; color:#8fa9cc; margin-top:10px; text-align:center; line-height:1.8; }

.kof-cc-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; }
.kof-cc-card { border:2px solid #2f4f86; background:#0a1730; padding:8px; }
.kof-cc-card h4 { margin:0 0 7px; font-size:9px; color:#bff7e6; letter-spacing:0; display:flex; justify-content:space-between; align-items:center; }
.kof-cc-card h4 .kof-cc-mini { cursor:pointer; color:#7fffd4; border:1px solid #2f6a5a; padding:2px 5px; font-size:9px; background:#08231c; }
.kof-cc-card h4 .kof-cc-mini:hover { background:#0c3a2e; }
.kof-cc-thumbs { display:flex; gap:6px; }
.kof-cc-thumb { flex:1; height:96px; object-fit:contain; border:1px solid #21406e; }
.kof-cc-reuse { font-size:8px; color:#6f86a8; text-align:center; padding:34px 4px; line-height:1.7; }

.kof-cc-status { font-size:9px; line-height:1.8; color:#9fb6d8; min-height:16px; margin:16px 0 8px; }
.kof-cc-status.work::before { content:'▶ '; color:#7fffd4; animation:kof-cc-blink 1s steps(1) infinite; }
.kof-cc-bar { display:none; height:16px; background:#000; border:2px solid #eaf2ff; position:relative; overflow:hidden; box-shadow:0 0 0 2px #07142e; margin-bottom:6px; }
.kof-cc-bar.show { display:block; }
.kof-cc-bar-fill { height:100%; width:0%; transition:width 0.35s ease; background: linear-gradient(180deg,#aeffe9,#2bd1ff 55%,#1f9c84); }
.kof-cc-bar-fill::after { content:''; position:absolute; top:0; bottom:0; width:30%; left:-40%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.6), transparent); animation:kof-cc-shine 1.4s linear infinite; }
.kof-cc-pct { position:absolute; right:6px; top:50%; transform:translateY(-50%); font-size:8px; color:#06310f; text-shadow:0 0 2px rgba(255,255,255,0.6); }

.kof-cc-footer { display:flex; gap:14px; justify-content:space-between; align-items:center; padding:14px 22px; border-top:2px solid #16294a; flex:none; }
.kof-cc-footer .right { display:flex; gap:12px; margin-left:auto; }
.kof-cc-btn { padding:13px 22px; font-family:inherit; font-size:11px; letter-spacing:1px; color:#eafff8; cursor:pointer; border:2px solid #07142e; position:relative; text-transform:uppercase; transition:transform 0.08s, filter 0.15s; }
.kof-cc-btn:active { transform:translateY(2px); }
.kof-cc-btn.cancel { background: linear-gradient(180deg,#3a4a68,#232f49); color:#cdd9ee; }
.kof-cc-btn.ghost { background: linear-gradient(180deg,#2a3c5e,#1b2840); color:#bfe6ff; }
.kof-cc-btn.cancel:hover, .kof-cc-btn.ghost:hover { filter:brightness(1.2); }
.kof-cc-btn.go { background: linear-gradient(180deg,#2bd1ff,#1f9c84); border-color:#eaf2ff; animation:kof-cc-glow 1.8s ease-in-out infinite; text-shadow:1px 1px 0 #0a4a3c; }
.kof-cc-btn.go:hover { filter:brightness(1.15); }
.kof-cc-btn[disabled] { opacity:0.5; cursor:default; animation:none; filter:grayscale(0.3); }
`;
  document.head.appendChild(style);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
// Pipeline asset paths are relative ("assets/..?v=.."); serve them from origin.
const asset = (u) => (u ? `/${u}` : '');

export function openCreateCharacterModal({ onComplete, onClose, mock = false } = {}) {
  injectStyle();

  let photoDataUrl = null;
  let jobId = null;
  let job = null;
  let closed = false;
  let busy = false;

  const overlay = document.createElement('div');
  overlay.className = 'kof-cc-overlay';
  overlay.innerHTML = `
    <div class="kof-cc-panel">
      <span class="kof-cc-corner tl"></span><span class="kof-cc-corner tr"></span>
      <span class="kof-cc-corner bl"></span><span class="kof-cc-corner br"></span>
      <div class="kof-cc-header">
        <div class="kof-cc-title">NEW FIGHTER<small>创建自定义斗士 · 分步生成</small></div>
        <div class="kof-cc-close" data-act="close">✕</div>
      </div>
      <div class="kof-cc-steps"></div>
      <div class="kof-cc-body"></div>
      <div class="kof-cc-footer"></div>
    </div>`;
  document.body.appendChild(overlay);

  const q = (sel) => overlay.querySelector(sel);
  const stepsEl = q('.kof-cc-steps');
  const bodyEl = q('.kof-cc-body');
  const footEl = q('.kof-cc-footer');

  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (onClose) onClose();
  }

  function setSteps(active) {
    stepsEl.innerHTML = STEPS.map((label, i) => {
      const cls = i < active ? 'done' : i === active ? 'active' : '';
      return `<div class="kof-cc-step ${cls}"><b>${i + 1}</b>${label}</div>`;
    }).join('');
  }

  // Poll the job until it stops running; reflect progress on an optional bar.
  async function pollSettled(onTick) {
    while (!closed) {
      let j;
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch(`${LOCAL_API}/api/generate-character/${jobId}`);
        // eslint-disable-next-line no-await-in-loop
        j = await r.json();
      } catch (e) {
        throw new Error(`连接本地服务失败：${e.message}`);
      }
      job = j;
      if (onTick) onTick(j);
      if (j.status !== 'running') return j;
      // eslint-disable-next-line no-await-in-loop
      await wait(1500);
    }
    return job;
  }

  // ---------- step 1: form ----------
  function renderForm() {
    setSteps(0);
    bodyEl.innerHTML = `
      <div class="kof-cc-row">
        <div class="kof-cc-drop" data-act="pick">
          <div><div class="kof-cc-plus">＋</div>点击上传照片<br>UPLOAD PHOTO</div>
        </div>
        <div class="kof-cc-fields">
          <div class="kof-cc-label">CODE NAME / 名字</div>
          <input class="kof-cc-input" type="text" maxlength="40" placeholder="科比 / Kobe" />
          <div class="kof-cc-hint">长相取自你的照片，<b>招式由视频模型随机生成（抽卡）</b>，不满意就重做再抽。<br>分四步：BASE 状态图 → 首尾帧 → 视频抽帧 → 入库，每步可预览。</div>
        </div>
      </div>
      <input type="file" accept="image/*" style="display:none" />
      <div class="kof-cc-status"></div>`;
    footEl.innerHTML = `
      <button class="kof-cc-btn cancel" data-act="close">取消</button>
      <div class="right"><button class="kof-cc-btn go" data-act="start">生成 BASE →</button></div>`;

    const drop = q('.kof-cc-drop');
    const fileInput = q('input[type=file]');
    const nameInput = q('.kof-cc-input');
    if (photoDataUrl) drop.innerHTML = `<img alt="preview" src="${photoDataUrl}"/>`;
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      photoDataUrl = await fileToDataUrl(file);
      drop.innerHTML = `<img alt="preview" src="${photoDataUrl}"/>`;
    });
    setTimeout(() => nameInput.focus(), 120);
  }

  function setStatus(text, color = '#9fb6d8', working = false) {
    const el = q('.kof-cc-status');
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    el.classList.toggle('work', working);
  }

  async function startJob() {
    const name = q('.kof-cc-input').value.trim();
    if (!name) { setStatus('请输入角色名字。', '#ffcc66'); return; }
    if (!photoDataUrl && !mock) { setStatus('请先上传一张照片。', '#ffcc66'); return; }
    busy = true;
    setStatus('提交任务，正在生成 BASE 图…', '#bfe6ff', true);
    try {
      const r = await fetch(`${LOCAL_API}/api/generate-character`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, photo: photoDataUrl, mock }),
      });
      const j = await r.json();
      if (!r.ok || !j.id) throw new Error(j.error || `HTTP ${r.status}`);
      jobId = j.id;
      await pollSettled((t) => setStatus(t.step, '#bfe6ff', true));
      route();
    } catch (e) {
      setStatus(`失败：${e.message}（本地 API 在跑吗？npm run local-api）`, '#ff8080');
    } finally { busy = false; }
  }

  // ---------- step 2: base review ----------
  function renderBaseReview() {
    setSteps(1);
    bodyEl.innerHTML = `
      <div class="kof-cc-base-wrap">
        <img class="kof-cc-base-img kof-cc-checker" alt="base" src="${asset(job.base)}"/>
        <div class="kof-cc-cap">这是角色的全身像素 BASE 图（所有动画都基于它保持一致）。<br>满意就下一步，否则重新生成。</div>
      </div>
      <div class="kof-cc-status"></div>`;
    footEl.innerHTML = `
      <button class="kof-cc-btn ghost" data-act="regen">↻ 重新生成</button>
      <div class="right"><button class="kof-cc-btn go" data-act="next">下一步：首尾帧 →</button></div>`;
  }

  // ---------- step 3: keyframes review ----------
  function renderKeyframesReview() {
    setSteps(2);
    const cards = Object.entries(job.keyframes || {}).map(([key, kf]) => {
      const label = ANIM_LABELS[key] || key;
      let body;
      if (!kf.generated) {
        body = '<div class="kof-cc-reuse">复用 BASE 图<br>（首尾帧都是站立，无需生成）</div>';
      } else if (kf.single) {
        body = `<div class="kof-cc-thumbs"><img class="kof-cc-thumb kof-cc-checker" src="${asset(kf.first)}"/></div>`;
      } else {
        body = `<div class="kof-cc-thumbs">
            <img class="kof-cc-thumb kof-cc-checker" src="${asset(kf.first)}"/>
            <img class="kof-cc-thumb kof-cc-checker" src="${asset(kf.last)}"/>
          </div>`;
      }
      const regen = kf.generated ? `<span class="kof-cc-mini" data-regen="${key}">↻</span>` : '';
      return `<div class="kof-cc-card"><h4>${label}${regen}</h4>${body}</div>`;
    }).join('');
    bodyEl.innerHTML = `<div class="kof-cc-grid">${cards}</div><div class="kof-cc-status"></div>`;
    footEl.innerHTML = `
      <button class="kof-cc-btn ghost" data-act="regen">↻ 全部重做</button>
      <div class="right"><button class="kof-cc-btn go" data-act="next">下一步：生成视频 →</button></div>`;
  }

  // ---------- step 4: frames (final) ----------
  function renderFramesProgress() {
    setSteps(3);
    bodyEl.innerHTML = `
      <div class="kof-cc-cap" style="margin:6px 0 14px;">正在为 7 套动画生成视频、抽帧、抠图并转成游戏帧。<br>这一步最久（每个动作一段视频），请稍候…</div>
      <div class="kof-cc-bar show"><div class="kof-cc-bar-fill"></div><span class="kof-cc-pct"></span></div>
      <div class="kof-cc-status"></div>`;
    footEl.innerHTML = '<button class="kof-cc-btn cancel" data-act="close">后台运行</button>';
  }

  function tickBar(j) {
    const fill = q('.kof-cc-bar-fill');
    const pct = q('.kof-cc-pct');
    const p = Math.round((j.progress || 0) * 100);
    if (fill) fill.style.width = `${p}%`;
    if (pct) pct.textContent = `${p}%`;
    setStatus(j.step || j.status, '#bfe6ff', true);
  }

  // Decide which step to show based on the job's current stage/status.
  function route() {
    if (!job) return;
    if (job.status === 'failed') { setStatus(`失败：${job.error || '未知错误'}`, '#ff8080'); return; }
    if (job.status === 'done' || job.stage === 'done') {
      (async () => { if (onComplete) await onComplete(job.manifest); close(); })();
      return;
    }
    if (job.stage === 'base') renderBaseReview();
    else if (job.stage === 'keyframes') renderKeyframesReview();
    else if (job.stage === 'frames') {
      renderFramesProgress();
      pollSettled(tickBar).then(route).catch((e) => setStatus(e.message, '#ff8080'));
    }
  }

  async function regenerate(target) {
    if (busy) return;
    busy = true;
    setStatus(target ? `重做「${target}」…` : '重新生成…', '#bfe6ff', true);
    try {
      const body = target ? JSON.stringify({ target }) : '{}';
      await fetch(`${LOCAL_API}/api/generate-character/${jobId}/regenerate`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
      });
      await pollSettled((t) => setStatus(t.step, '#bfe6ff', true));
      if (job.stage === 'base') renderBaseReview();
      else if (job.stage === 'keyframes') renderKeyframesReview();
    } catch (e) {
      setStatus(`重做失败：${e.message}`, '#ff8080');
    } finally { busy = false; }
  }

  async function advance() {
    if (busy) return;
    busy = true;
    setStatus('进入下一步…', '#bfe6ff', true);
    try {
      await fetch(`${LOCAL_API}/api/generate-character/${jobId}/advance`, { method: 'POST' });
      // base/keyframes settle quickly; frames streams its own progress via route().
      if (job.stage === 'keyframes') renderFramesProgress();
      await pollSettled((t) => (job && job.stage === 'frames' ? tickBar(t) : setStatus(t.step, '#bfe6ff', true)));
      route();
    } catch (e) {
      setStatus(`失败：${e.message}`, '#ff8080');
    } finally { busy = false; }
  }

  // Single delegated click handler for the whole modal.
  overlay.addEventListener('click', (e) => {
    const t = e.target;
    const regenKey = t.getAttribute && t.getAttribute('data-regen');
    if (regenKey) { regenerate(regenKey); return; }
    const act = t.getAttribute && t.getAttribute('data-act');
    if (act === 'start') startJob();
    else if (act === 'regen') regenerate(null);
    else if (act === 'next') advance();
    else if (act === 'pick') q('input[type=file]').click();
    else if (act === 'close') { if (!busy) close(); }
    else if (t === overlay && !busy) close();
  });

  renderForm();
  return { close };
}
