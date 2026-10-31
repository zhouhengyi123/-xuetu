/**
 * 视频导出工具（2026-10-24）
 *
 * 用户要求："或者说是生成一些视频"
 *
 * 实现路径：
 *   ① 用 Puppeteer/Electron 的离线渲染把 HTML 动画逐帧截下来
 *   ② 用 ffmpeg 合成 MP4
 *
 * 这条路径可行是因为：
 *   · 本机有 ffmpeg（实测）
 *   · Electron 自带 Chromium，能截图
 *   · 生成的 HTML 动画是纯 CSS/SVG，帧率稳定
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

// ══════════════════════════════════════════════════
//  ffmpeg 探测
// ══════════════════════════════════════════════════

let _ffmpeg = undefined;

function findFfmpeg() {
  if (_ffmpeg !== undefined) return _ffmpeg;

  const candidates = [
    'ffmpeg',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'D:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  ];

  for (const c of candidates) {
    try {
      execFileSync(c, ['-version'], { timeout: 5000, stdio: 'ignore' });
      _ffmpeg = c;
      return c;
    } catch (e) {}
  }
  _ffmpeg = null;
  return null;
}

function hasFfmpeg() { return !!findFfmpeg(); }

// ══════════════════════════════════════════════════
//  图片 → 视频
// ══════════════════════════════════════════════════

/**
 * 把一串图片合成 MP4。
 *
 * ★ 2026-10-24 重写：改用 image2 序列输入
 *   之前用 concat 协议，实测新版 ffmpeg 报
 *   "Nothing was written into output file, because at least one of its streams received no packets"
 *   —— concat + duration 对图片序列不可靠。
 *
 *   改用 -framerate + 序列通配符，这是 ffmpeg 官方的图片转视频标准做法。
 *
 * @param {string[]} images 图片路径（需同目录、同尺寸、文件名有序）
 * @param {string} outPath 输出路径
 * @param {object} opts { fps }
 */
function imagesToVideo(images, outPath, opts) {
  return new Promise((resolve, reject) => {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return reject(new Error('没有 ffmpeg，无法导出视频'));
    if (!images.length) return reject(new Error('没有图片'));

    const o = opts || {};
    const fps = o.fps || 24;

    /**
     * 序列输入要求：
     *   · 所有图片在同一目录
     *   · 文件名连续编号（我们录制时用的是 00000.png 格式）
     *   · 用 %05d.png 匹配
     */
    const dir = path.dirname(images[0]);
    const first = path.basename(images[0]);

    // 从文件名推断编号格式
    const m = first.match(/^(\d+)\.png$/i);
    if (!m) {
      return reject(new Error('图片命名不符合序列格式（需为 00000.png）'));
    }
    const digits = m[1].length;
    const pattern = '%0' + digits + 'd.png';

    const args = [
      '-y',
      '-framerate', String(fps),
      '-i', path.join(dir, pattern),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '20',
      // 确保宽高是偶数（yuv420p 要求）
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      outPath,
    ];

    execFile(ffmpeg, args, { timeout: 180000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        return reject(new Error('ffmpeg 失败: ' + String(stderr || err.message).slice(-400)));
      }
      if (!fs.existsSync(outPath)) {
        return reject(new Error('ffmpeg 没生成文件'));
      }
      const size = fs.statSync(outPath).size;
      if (size === 0) {
        return reject(new Error('ffmpeg 生成了空文件'));
      }
      resolve({
        ok: true,
        path: outPath,
        size,
        frames: images.length,
        fps,
      });
    });
  });
}

/**
 * 单张图 → 视频（做"延时展示"，用于静态图表）
 */
function imageToVideo(imagePath, outPath, opts) {
  return new Promise((resolve, reject) => {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) return reject(new Error('没有 ffmpeg，无法导出视频'));

    const o = opts || {};
    const seconds = o.seconds || 5;

    const args = [
      '-y',
      '-loop', '1',
      '-i', imagePath,
      '-c:v', 'libx264',
      '-t', String(seconds),
      '-pix_fmt', 'yuv420p',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',   // 必须是偶数
      '-r', '24',
      outPath,
    ];

    execFile(ffmpeg, args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error('ffmpeg 失败: ' + String(stderr || err.message).slice(-300)));
      if (!fs.existsSync(outPath)) return reject(new Error('没生成文件'));
      resolve({ ok: true, path: outPath, size: fs.statSync(outPath).size, seconds });
    });
  });
}

/**
 * 判断能不能做视频导出
 */
function capabilities() {
  const ff = findFfmpeg();
  return {
    ffmpeg: !!ff,
    ffmpegPath: ff,
    canExportVideo: !!ff,
    formats: ff ? ['mp4'] : [],
  };
}

module.exports = { hasFfmpeg, findFfmpeg, imagesToVideo, imageToVideo, capabilities };
