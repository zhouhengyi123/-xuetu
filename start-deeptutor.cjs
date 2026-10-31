/**
 * DeepTutor 启动器
 *
 * 一键起三个服务：
 *   1. WorkBuddy 桥（8790）—— 提供 OpenAI 兼容接口，用 WorkBuddy 的额度
 *   2. DeepTutor 后端（8001）—— FastAPI
 *   3. DeepTutor 前端（3782）—— Next.js
 *
 * 用法：
 *   node start-deeptutor.cjs          启动全部
 *   node start-deeptutor.cjs --check  只检查状态
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const DT_ROOT = 'D:\\DeepTutor\\DeepTutor';
const DT_PY = path.join(DT_ROOT, '.venv', 'Scripts', 'python.exe');

// ── 端口检查 ──
function isListening(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitFor(port, name, maxMs) {
  const deadline = Date.now() + (maxMs || 30000);
  while (Date.now() < deadline) {
    if (await isListening(port)) {
      console.log('  ✓ ' + name + ' 就绪 (:' + port + ')');
      return true;
    }
    await new Promise(r => setTimeout(r, 700));
  }
  console.log('  ✗ ' + name + ' 启动超时 (:' + port + ')');
  return false;
}

// ── 状态检查 ──
async function check() {
  console.log('=== 服务状态 ===');
  const bridge = await isListening(8790);
  const backend = await isListening(8001);
  const frontend = await isListening(3782);
  console.log('  WorkBuddy 桥 (8790): ' + (bridge ? '✓ 运行中' : '✗ 未启动'));
  console.log('  DeepTutor 后端 (8001): ' + (backend ? '✓ 运行中' : '✗ 未启动'));
  console.log('  DeepTutor 前端 (3782): ' + (frontend ? '✓ 运行中' : '✗ 未启动'));

  if (bridge) {
    try {
      const r = await fetch('http://127.0.0.1:8790/health');
      const j = await r.json();
      console.log('    → ' + j.accounts + ' 个 WorkBuddy 账号，模型 ' + j.model);
    } catch (e) {}
  }
  return { bridge, backend, frontend };
}

// ── 启动 ──
async function main() {
  const isCheck = process.argv.includes('--check');
  if (isCheck) {
    const st = await check();
    process.exit(st.bridge && st.backend && st.frontend ? 0 : 1);
  }

  console.log('═══════════════════════════════════════');
  console.log(' 启动 DeepTutor 全家桶');
  console.log('═══════════════════════════════════════');
  console.log('');

  // 前置检查
  if (!fs.existsSync(DT_PY)) {
    console.error('✗ 找不到 DeepTutor 的 Python 环境: ' + DT_PY);
    process.exit(1);
  }
  if (!fs.existsSync(path.join(DT_ROOT, 'web', '.next', 'BUILD_ID'))) {
    console.error('✗ DeepTutor 前端还没构建。先跑：cd ' + path.join(DT_ROOT, 'web') + ' && npm run build');
    process.exit(1);
  }

  const children = [];
  const cleanup = () => {
    children.forEach(c => { try { c.kill(); } catch (e) {} });
  };
  process.on('SIGINT', () => { console.log('\n停止中…'); cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  // ① WorkBuddy 桥
  console.log('[1/3] WorkBuddy 桥…');
  if (await isListening(8790)) {
    console.log('  · 已在运行，跳过');
  } else {
    const bridge = spawn(process.execPath, [path.join(__dirname, 'workbuddy-bridge.cjs'), '--port=8790'], {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
    });
    bridge.stdout.on('data', d => {
      const s = d.toString().trim();
      if (s && !s.includes('══')) console.log('  [bridge] ' + s.split('\n')[0]);
    });
    children.push(bridge);
    await new Promise(r => setTimeout(r, 2500));
  }

  // ② DeepTutor 后端
  console.log('[2/3] DeepTutor 后端…');
  if (await isListening(8001)) {
    console.log('  · 已在运行，跳过');
  } else {
    const backend = spawn(DT_PY, ['-m', 'deeptutor', 'serve', '--host', '127.0.0.1', '--port', '8001'], {
      cwd: DT_ROOT,
      env: Object.assign({}, process.env, {
        PYTHONIOENCODING: 'utf-8',
        DEEPTUTOR_HOME: DT_ROOT,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    backend.stdout.on('data', d => {
      const s = d.toString().trim();
      if (s && /Uvicorn|Application startup|Started/i.test(s)) console.log('  [backend] ' + s.split('\n')[0]);
    });
    children.push(backend);
  }

  // ③ DeepTutor 前端
  console.log('[3/3] DeepTutor 前端…');
  if (await isListening(3782)) {
    console.log('  · 已在运行，跳过');
  } else {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const frontend = spawn(npmCmd, ['run', 'start'], {
      cwd: path.join(DT_ROOT, 'web'),
      env: Object.assign({}, process.env, {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        PORT: '3782',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });
    frontend.stdout.on('data', d => {
      const s = d.toString().trim();
      if (s && /ready|started|Local:/i.test(s)) console.log('  [frontend] ' + s.split('\n')[0]);
    });
    children.push(frontend);
  }

  console.log('');
  console.log('等待服务就绪…');
  await waitFor(8790, 'WorkBuddy 桥', 15000);
  await waitFor(8001, 'DeepTutor 后端', 45000);
  await waitFor(3782, 'DeepTutor 前端', 45000);

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(' 全部就绪');
  console.log(' 打开: http://127.0.0.1:3782');
  console.log(' 按 Ctrl+C 停止');
  console.log('═══════════════════════════════════════');

  // 保持运行
  setInterval(() => {}, 60000);
}

main().catch(e => {
  console.error('启动失败: ' + e.message);
  process.exit(1);
});
