// A plain-DOM modal for creating a custom fighter from a photo + name.
//
// It lives outside Phaser (a fixed overlay above the canvas) because an <input
// type=file> and live progress text are far easier in HTML than in the WebGL
// scene. Visually it apes the King of Fighters select screen: layered arcade
// borders, a red title gel, corner brackets, CRT scanlines and the pixel font.
// It talks to the local pipeline API, polls the job to completion, and hands the
// finished manifest back through onComplete.

const LOCAL_API = 'http://127.0.0.1:8787';
const STYLE_ID = 'kof-cc-style';

// Press Start 2P for Latin/digits with a CJK fallback (mirrors PIXEL_FONT_CN).
const FONT = '"Press Start 2P", "PingFang SC", "Microsoft YaHei", sans-serif';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@keyframes kof-cc-in {
  0%   { opacity: 0; transform: translateY(40px) scale(0.86); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes kof-cc-glow {
  0%,100% { box-shadow: 0 0 18px rgba(127,255,212,0.35); }
  50%     { box-shadow: 0 0 30px rgba(127,255,212,0.65); }
}
@keyframes kof-cc-shine { 0% { left: -40%; } 100% { left: 120%; } }
@keyframes kof-cc-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

.kof-cc-overlay {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(circle at 50% 40%, rgba(10,22,52,0.78), rgba(2,5,14,0.92));
  font-family: ${FONT};
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
}
.kof-cc-overlay::after { /* CRT scanlines */
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 1px, transparent 1px 3px);
  mix-blend-mode: multiply;
}
.kof-cc-panel {
  position: relative; width: min(580px, 94vw); max-height: 92vh; overflow: visible;
  background:
    linear-gradient(180deg, rgba(18,38,76,0.96), rgba(8,16,38,0.98));
  color: #dff6ff;
  padding: 0;
  /* layered Neo-Geo border: navy / cyan / navy / white */
  box-shadow:
    0 0 0 3px #071330,
    0 0 0 6px #7fffd4,
    0 0 0 9px #071330,
    0 0 0 12px #eaf2ff,
    0 14px 50px rgba(0,0,0,0.6);
  animation: kof-cc-in 360ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  image-rendering: pixelated;
}
.kof-cc-corner {
  position: absolute; width: 16px; height: 16px; border: 3px solid #ffcc33; z-index: 3;
}
.kof-cc-corner.tl { top: -12px; left: -12px; border-right: 0; border-bottom: 0; }
.kof-cc-corner.tr { top: -12px; right: -12px; border-left: 0; border-bottom: 0; }
.kof-cc-corner.bl { bottom: -12px; left: -12px; border-right: 0; border-top: 0; }
.kof-cc-corner.br { bottom: -12px; right: -12px; border-left: 0; border-top: 0; }

.kof-cc-header {
  position: relative; padding: 14px 18px; overflow: hidden;
  background: linear-gradient(180deg, #d12626, #8c1212);
  border-bottom: 3px solid #071330;
  display: flex; align-items: center; justify-content: space-between;
}
.kof-cc-header::before { /* diagonal shine sweeping the title bar */
  content: ''; position: absolute; top: 0; bottom: 0; left: -40%; width: 30%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.45), transparent);
  transform: skewX(-20deg); animation: kof-cc-shine 3.2s linear infinite;
}
.kof-cc-title { position: relative; font-size: 18px; letter-spacing: 1px; color: #fff;
  text-shadow: 2px 2px 0 #5a0c0c, 0 0 10px rgba(255,180,180,0.6); }
.kof-cc-title small { display: block; font-size: 9px; margin-top: 7px; color: #ffe0e0; letter-spacing: 0; }
.kof-cc-close {
  position: relative; cursor: pointer; color: #ffd9d9; font-size: 16px;
  width: 28px; height: 28px; line-height: 26px; text-align: center;
  border: 2px solid #ffd9d9; background: rgba(0,0,0,0.2);
}
.kof-cc-close:hover { color: #fff; border-color: #fff; background: rgba(0,0,0,0.4); }

.kof-cc-body { padding: 20px 22px; }
.kof-cc-row { display: flex; gap: 18px; align-items: stretch; }
.kof-cc-drop {
  position: relative; width: 150px; min-height: 188px; flex: none;
  border: 2px dashed #4fd6c0; background: #08122a;
  display: flex; align-items: center; justify-content: center; text-align: center;
  color: #5f8fb0; font-size: 9px; line-height: 1.8; cursor: pointer; overflow: hidden;
  box-shadow: inset 0 0 0 2px #07142e;
}
.kof-cc-drop:hover { border-color: #7fffd4; color: #9fd6ff; }
.kof-cc-drop img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.kof-cc-drop .kof-cc-plus { font-size: 30px; color: #4fd6c0; margin-bottom: 8px; }
.kof-cc-fields { flex: 1; display: flex; flex-direction: column; }
.kof-cc-label { font-size: 9px; color: #7fffd4; letter-spacing: 1px; margin-bottom: 8px; }
.kof-cc-input {
  width: 100%; box-sizing: border-box; padding: 12px; margin-bottom: 14px;
  background: #060f24; border: 2px solid #2f60a0; color: #eaf6ff;
  font-family: inherit; font-size: 12px; outline: none;
  box-shadow: inset 0 2px 0 rgba(0,0,0,0.4);
}
.kof-cc-input:focus { border-color: #7fffd4; box-shadow: inset 0 2px 0 rgba(0,0,0,0.4), 0 0 12px rgba(127,255,212,0.4); }
.kof-cc-hint { font-size: 9px; line-height: 1.9; color: #8fa9cc; }
.kof-cc-hint b { color: #ffcc55; }

.kof-cc-status { font-size: 9px; line-height: 1.8; color: #9fb6d8; min-height: 16px; margin: 16px 0 8px; }
.kof-cc-status.work::before { content: '▶ '; color: #7fffd4; animation: kof-cc-blink 1s steps(1) infinite; }
.kof-cc-bar {
  display: none; height: 16px; background: #000; border: 2px solid #eaf2ff;
  position: relative; overflow: hidden; box-shadow: 0 0 0 2px #07142e;
}
.kof-cc-bar-fill {
  height: 100%; width: 0%; transition: width 0.35s ease;
  background: linear-gradient(180deg, #aeffe9, #2bd1ff 55%, #1f9c84);
}
.kof-cc-bar-fill::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 30%; left: -40%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,0.6), transparent);
  animation: kof-cc-shine 1.4s linear infinite;
}
.kof-cc-pct { position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  font-size: 8px; color: #06310f; text-shadow: 0 0 2px rgba(255,255,255,0.6); }

.kof-cc-footer { display: flex; gap: 14px; justify-content: flex-end; margin-top: 18px; }
.kof-cc-btn {
  padding: 13px 22px; font-family: inherit; font-size: 11px; letter-spacing: 1px;
  color: #eafff8; cursor: pointer; border: 2px solid #07142e; position: relative;
  text-transform: uppercase; transition: transform 0.08s, box-shadow 0.15s, filter 0.15s;
}
.kof-cc-btn:active { transform: translateY(2px); }
.kof-cc-btn.cancel { background: linear-gradient(180deg, #3a4a68, #232f49); color: #cdd9ee; }
.kof-cc-btn.cancel:hover { filter: brightness(1.2); }
.kof-cc-btn.go {
  background: linear-gradient(180deg, #2bd1ff, #1f9c84);
  border-color: #eaf2ff; animation: kof-cc-glow 1.8s ease-in-out infinite;
  text-shadow: 1px 1px 0 #0a4a3c;
}
.kof-cc-btn.go:hover { filter: brightness(1.15); }
.kof-cc-btn[disabled] { opacity: 0.55; cursor: default; animation: none; filter: grayscale(0.3); }
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

// onComplete(manifest) is called once a character is fully generated.
export function openCreateCharacterModal({ onComplete, onClose } = {}) {
  injectStyle();

  let photoDataUrl = null;
  let polling = false;
  let closed = false;

  const overlay = document.createElement('div');
  overlay.className = 'kof-cc-overlay';
  overlay.innerHTML = `
    <div class="kof-cc-panel">
      <span class="kof-cc-corner tl"></span><span class="kof-cc-corner tr"></span>
      <span class="kof-cc-corner bl"></span><span class="kof-cc-corner br"></span>
      <div class="kof-cc-header">
        <div class="kof-cc-title">NEW FIGHTER<small>创建自定义斗士</small></div>
        <div class="kof-cc-close" data-act="close">✕</div>
      </div>
      <div class="kof-cc-body">
        <div class="kof-cc-row">
          <div class="kof-cc-drop" data-act="pick">
            <div><div class="kof-cc-plus">＋</div>点击上传照片<br>UPLOAD PHOTO</div>
          </div>
          <div class="kof-cc-fields">
            <div class="kof-cc-label">CODE NAME / 名字</div>
            <input class="kof-cc-input" type="text" maxlength="40" placeholder="科比 / Kobe" />
            <div class="kof-cc-hint">
              AI 会研究这个角色，生成<b>全身像素形象</b>与 <b>7 套动画</b><br>
              （站立 / 行走 / 攻击×2 / 大招 / 入场 / 倒地）。<br>
              全程约 <b>几分钟</b>，请保持本地服务运行。
            </div>
          </div>
        </div>
        <div class="kof-cc-status"></div>
        <div class="kof-cc-bar"><div class="kof-cc-bar-fill"></div><span class="kof-cc-pct"></span></div>
        <div class="kof-cc-footer">
          <button class="kof-cc-btn cancel" data-act="close">取消</button>
          <button class="kof-cc-btn go" data-act="go">生成 START</button>
        </div>
      </div>
      <input type="file" accept="image/*" style="display:none" />
    </div>`;
  document.body.appendChild(overlay);

  const q = (sel) => overlay.querySelector(sel);
  const drop = q('.kof-cc-drop');
  const fileInput = q('input[type=file]');
  const nameInput = q('.kof-cc-input');
  const statusEl = q('.kof-cc-status');
  const bar = q('.kof-cc-bar');
  const barFill = q('.kof-cc-bar-fill');
  const pct = q('.kof-cc-pct');
  const genBtn = q('[data-act=go]');

  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    if (onClose) onClose();
  }

  function setStatus(text, color = '#9fb6d8', working = false) {
    statusEl.textContent = text;
    statusEl.style.color = color;
    statusEl.classList.toggle('work', working);
  }

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    photoDataUrl = await fileToDataUrl(file);
    drop.innerHTML = `<img alt="preview" src="${photoDataUrl}" />`;
  });

  async function poll(jobId) {
    polling = true;
    bar.style.display = 'block';
    while (polling && !closed) {
      let job;
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await fetch(`${LOCAL_API}/api/generate-character/${jobId}`);
        // eslint-disable-next-line no-await-in-loop
        job = await r.json();
      } catch (e) {
        setStatus(`连接本地服务失败：${e.message}`, '#ff8080');
        break;
      }
      const p = Math.round((job.progress || 0) * 100);
      barFill.style.width = `${p}%`;
      pct.textContent = `${p}%`;
      setStatus(job.step || job.status, '#bfe6ff', true);

      if (job.status === 'done') {
        barFill.style.width = '100%';
        pct.textContent = '100%';
        setStatus('完成！正在加入选人列表…', '#7fffd4');
        polling = false;
        // eslint-disable-next-line no-await-in-loop
        if (onComplete) await onComplete(job.manifest);
        close();
        return;
      }
      if (job.status === 'failed') {
        setStatus(`生成失败：${job.error || '未知错误'}`, '#ff8080');
        genBtn.disabled = false;
        genBtn.textContent = '重试 RETRY';
        return;
      }
      // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
      await new Promise((res) => setTimeout(res, 2000));
    }
  }

  async function start() {
    const name = nameInput.value.trim();
    if (!name) { setStatus('请输入角色名字。', '#ffcc66'); nameInput.focus(); return; }
    if (!photoDataUrl) { setStatus('请先上传一张照片。', '#ffcc66'); return; }

    genBtn.disabled = true;
    genBtn.textContent = '生成中…';
    setStatus('提交生成任务…', '#bfe6ff', true);

    try {
      const r = await fetch(`${LOCAL_API}/api/generate-character`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, photo: photoDataUrl }),
      });
      const job = await r.json();
      if (!r.ok || !job.id) throw new Error(job.error || `HTTP ${r.status}`);
      await poll(job.id);
    } catch (e) {
      setStatus(`无法启动：${e.message}（本地 API 在跑吗？npm run local-api）`, '#ff8080');
      genBtn.disabled = false;
      genBtn.textContent = '生成 START';
    }
  }

  overlay.addEventListener('click', (e) => {
    const act = e.target.getAttribute && e.target.getAttribute('data-act');
    if (act === 'go') start();
    else if (act === 'close') { if (!polling) close(); }
    else if (e.target === overlay && !polling) close();
  });

  setTimeout(() => nameInput.focus(), 120);
  return { close };
}
