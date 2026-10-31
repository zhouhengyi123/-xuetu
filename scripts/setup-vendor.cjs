/**
 * 下载第三方前端库（2026-10-31）
 *
 * 这些库体积大（MediaPipe 16 MB + Three.js 0.7 MB），
 * 不适合放进 git 仓库。首次 clone 后运行一次：
 *
 *   node scripts/setup-vendor.cjs
 *
 * 全程零依赖：用自己的 tar 解压（Windows 的 tar 处理不了 C:\ 路径）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'web', 'vendor');
const TMP = path.join(os.tmpdir(), 'xuetu-vendor-' + Date.now());

// ── 极简 tar 解析（只处理普通文件）──
function untar(buffer) {
  const files = [];
  let off = 0;

  while (off + 512 <= buffer.length) {
    const header = buffer.slice(off, off + 512);
    // 全 0 表示结束
    if (header.every(b => b === 0)) break;

    // 文件名（0-99）
    let name = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '');
    // 大小（124-135，八进制）
    const sizeStr = header.slice(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    // 类型标记（156）
    const type = String.fromCharCode(header[156] || 48);

    off += 512;

    if (type === '0' || type === '\0') {
      if (name && size >= 0) {
        const data = buffer.slice(off, off + size);
        files.push({ name, data });
      }
    } else if (type === 'L') {
      // GNU 长文件名扩展，下一个 header 用这个名字
      const longName = buffer.slice(off, off + size).toString('utf8').replace(/\0.*$/, '');
      off += Math.ceil(size / 512) * 512;
      if (off + 512 <= buffer.length) {
        const h2 = buffer.slice(off, off + 512);
        const size2 = parseInt(h2.slice(124, 136).toString('utf8').replace(/\0.*$/, '').trim(), 8) || 0;
        off += 512;
        files.push({ name: longName, data: buffer.slice(off, off + size2) });
        off += Math.ceil(size2 / 512) * 512;
        continue;
      }
    }

    off += Math.ceil(size / 512) * 512;
  }

  return files;
}

function extractTgz(buf) {
  // 先解 gzip
  const raw = zlib.gunzipSync(buf);
  return untar(raw);
}

async function download(url, dest) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return buf.length;
}

function saveFiles(files, filter, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  let n = 0;
  for (const f of files) {
    const rel = filter(f.name);
    if (!rel) continue;
    const dest = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, f.data);
    n++;
  }
  return n;
}

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(VENDOR, { recursive: true });

  console.log('下载第三方库到: ' + VENDOR);
  console.log('');

  // ═══ MediaPipe face_mesh ═══
  console.log('→ MediaPipe FaceMesh（约 7 MB）');
  try {
    const tgz = path.join(TMP, 'face_mesh.tgz');
    await download('https://registry.npmmirror.com/@mediapipe/face_mesh/-/face_mesh-0.4.1633559619.tgz', tgz);
    const files = extractTgz(fs.readFileSync(tgz));
    console.log('  解压 ' + files.length + ' 个条目');
    const n = saveFiles(files, name => {
      if (!name.startsWith('package/')) return null;
      const f = name.slice(8);
      if (!f || f.includes('/')) return null;
      return f;
    }, path.join(VENDOR, 'mediapipe'));
    console.log('  ✓ ' + n + ' 个文件');
  } catch (e) { console.log('  ✗ ' + e.message); }

  // ═══ MediaPipe camera_utils ═══
  console.log('→ MediaPipe Camera Utils');
  try {
    const tgz = path.join(TMP, 'camera.tgz');
    await download('https://registry.npmmirror.com/@mediapipe/camera_utils/-/camera_utils-0.3.1675466862.tgz', tgz);
    const files = extractTgz(fs.readFileSync(tgz));
    const n = saveFiles(files, name => {
      if (name === 'package/camera_utils.js') return 'camera_utils.js';
      return null;
    }, path.join(VENDOR, 'mediapipe'));
    console.log('  ✓ ' + n + ' 个文件');
  } catch (e) { console.log('  ✗ ' + e.message); }

  // ═══ Three.js ═══
  console.log('→ Three.js（约 9 MB）');
  try {
    const tgz = path.join(TMP, 'three.tgz');
    await download('https://registry.npmmirror.com/three/-/three-0.160.0.tgz', tgz);
    const files = extractTgz(fs.readFileSync(tgz));
    console.log('  解压 ' + files.length + ' 个条目');
    const n = saveFiles(files, name => {
      if (name === 'package/build/three.module.min.js') return 'three.module.min.js';
      if (name === 'package/build/three.min.js') return 'three.min.js';
      if (name === 'package/examples/jsm/controls/OrbitControls.js') return 'OrbitControls.js';
      return null;
    }, path.join(VENDOR, 'three'));
    console.log('  ✓ ' + n + ' 个文件');
  } catch (e) { console.log('  ✗ ' + e.message); }

  // 清理
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

  // ═══ 验证 ═══
  console.log('');
  console.log('验一下关键文件：');
  const checks = [
    ['web/vendor/mediapipe/face_mesh.js', 'MediaPipe 主脚本'],
    ['web/vendor/mediapipe/face_mesh.binarypb', '模型配置'],
    ['web/vendor/mediapipe/face_mesh_solution_wasm_bin.wasm', 'WASM 模型'],
    ['web/vendor/mediapipe/camera_utils.js', '摄像头工具'],
    ['web/vendor/three/three.module.min.js', 'Three.js'],
    ['web/vendor/three/OrbitControls.js', 'OrbitControls'],
  ];
  let ok = 0;
  for (const [rel, label] of checks) {
    const p = path.join(ROOT, rel);
    if (fs.existsSync(p)) {
      console.log('  ✓ ' + label + ' (' + Math.round(fs.statSync(p).size / 1024) + ' KB)');
      ok++;
    } else {
      console.log('  ✗ 缺失: ' + label);
    }
  }

  console.log('');
  if (ok === checks.length) {
    console.log('═══ 全部就绪，现在可以运行 npm start ═══');
  } else {
    console.log('⚠️ 有 ' + (checks.length - ok) + ' 个文件缺失，可能影响 3D/监控功能');
  }
})();
