/**
 * 逐帧录制器（2026-10-24）
 *
 * 用户要求："或者说是生成一些视频"
 *
 * 实现思路：
 *   用一个隐藏的 Electron BrowserWindow 加载 HTML，
 *   用 webContents.capturePage() 逐帧截图，
 *   再交给 ffmpeg 合成 MP4。
 *
 * 为什么用 Electron 而不是 Puppeteer：
 *   应用本身就是 Electron，自带 Chromium，不用额外装依赖（省 300MB）。
 *
 * 用法（主进程内）：
 *   const rec = require('./electron-recorder.js');
 *   const r = await rec.recordHtml(htmlPath, { seconds: 6, fps: 24 });
 *   → { ok, frames, dir }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { BrowserWindow } = require('electron');
const Video = require('./electron-video.js');

/**
 * 录制一个 HTML 页面。
 *
 * @param {string} htmlPath 本地 HTML 路径
 * @param {object} opts { seconds, fps, width, height }
 * @returns {Promise<{ok, frames, frameDir, error}>}
 */
async function recordHtml(htmlPath, opts) {
  const o = opts || {};
  const seconds = Math.max(1, Math.min(30, Number(o.seconds) || 6));
  const fps = Math.max(8, Math.min(30, Number(o.fps) || 20));
  const W = o.width || 1280;
  const H = o.height || 800;

  if (!fs.existsSync(htmlPath)) {
    return { ok: false, error: 'HTML 文件不存在: ' + htmlPath };
  }

  const frameDir = path.join(os.tmpdir(), 'xt-rec-' + Date.now());
  fs.mkdirSync(frameDir, { recursive: true });

  const total = Math.round(seconds * fps);

  let win = null;
  try {
    win = new BrowserWindow({
      width: W,
      height: H,
      show: false,                 // 无头
      frame: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        offscreen: true,           // ★ 离屏渲染，不占屏幕
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // 加载 HTML
    const url = 'file:///' + htmlPath.replace(/\\/g, '/').replace(/ /g, '%20');
    await win.loadURL(url);

    // 等页面稳定（动画和字体加载）
    await new Promise(r => setTimeout(r, 800));

    // 逐帧截图
    const captured = [];
    for (let i = 0; i < total; i++) {
      const img = await win.webContents.capturePage();
      const png = img.toPNG();
      const framePath = path.join(frameDir, String(i).padStart(5, '0') + '.png');
      fs.writeFileSync(framePath, png);
      captured.push(framePath);

      // 等一帧的时间
      await new Promise(r => setTimeout(r, Math.round(1000 / fps)));
    }

    return { ok: true, frames: captured.length, frameDir, fps, seconds };
  } catch (e) {
    return { ok: false, error: String(e.message || e), frameDir };
  } finally {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) {}
  }
}

/**
 * 录制并合成 MP4（一步到位）
 */
async function recordToMp4(htmlPath, outPath, opts) {
  const o = opts || {};

  const rec = await recordHtml(htmlPath, o);
  if (!rec.ok) return rec;

  if (!Video.hasFfmpeg()) {
    return { ok: false, error: '没有 ffmpeg，无法合成视频（帧已保留在 ' + rec.frameDir + '）', frameDir: rec.frameDir };
  }

  // 收集帧
  const frames = fs.readdirSync(rec.frameDir)
    .filter(f => f.endsWith('.png'))
    .sort()
    .map(f => path.join(rec.frameDir, f));

  if (!frames.length) {
    return { ok: false, error: '没有截到帧' };
  }

  try {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const r = await Video.imagesToVideo(frames, outPath, { fps: rec.fps });

    // 清理临时帧
    try { fs.rmSync(rec.frameDir, { recursive: true, force: true }); } catch (e) {}

    return {
      ok: true,
      path: outPath,
      size: r.size,
      frames: r.frames,
      fps: r.fps,
      seconds: rec.seconds,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), frameDir: rec.frameDir };
  }
}

module.exports = { recordHtml, recordToMp4 };
