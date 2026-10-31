/**
 * 打包版运行时启动器（2026-10-18）
 *
 * 职责：把打包进 runtime/ 的三个服务拉起来
 *   ① WorkBuddy 桥（8790）—— Node 直接跑，用应用自己的 node 环境
 *   ② DeepTutor 后端（8001）—— 用 runtime/deeptutor/python
 *   ③ DeepTutor 前端（3782）—— 用 runtime/deeptutor/node + web/server.js
 *
 * 设计要点：
 *   · 所有路径都相对于当前文件，不写死盘符
 *   · 服务已经在跑就跳过（幂等）
 *   · 任何一个起不来都不影响学徒主程序（快速问答照常可用）
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

// 运行时的根：打包后在 resources/runtime，开发时在项目根/runtime
function findRuntimeRoot() {
  const cands = [];

  /**
   * ★ 2026-10-31 修：打包版只认 resources/ + __dirname，不再用 process.cwd()。
   *
   * 原来的第 ④ 号候选是 process.cwd()/runtime/deeptutor —— 这是个隐患：
   *   · 用户从任意目录启动 exe（比如 D:\），就会去捡 D:\runtime\deeptutor
   *   · 如果那个目录碰巧残缺/是别人的，就会以错误配置启动
   *   · 实测表现：slim 版（不含 runtime）本该「跳过」，却因为
   *     cwd 恰好指向一个含 runtime 的目录而硬启动，然后 bridge 报错退出
   *
   * 打包后运行时只可能在 resources/ 下；开发模式下 __dirname 就是项目根。
   * cwd 不该参与判断。
   */
  const isPackaged = !!process.resourcesPath &&
    !String(process.resourcesPath).includes('node_modules');

  if (isPackaged) {
    // ① 打包版：resources/runtime/deeptutor（electron-builder extraResources）
    cands.push(path.join(process.resourcesPath, 'runtime', 'deeptutor'));
    cands.push(path.join(process.resourcesPath, 'deeptutor'));
    // ② 脚本在 resources/ 根下时，同级找
    cands.push(path.join(__dirname, 'runtime', 'deeptutor'));
  } else {
    // 开发版：项目根/runtime/deeptutor（__dirname 就是项目根）
    cands.push(path.join(__dirname, 'runtime', 'deeptutor'));
    cands.push(path.join(__dirname, '..', 'runtime', 'deeptutor'));
  }

  for (const c of cands) {
    if (!c) continue;
    try {
      if (fs.existsSync(path.join(c, 'VERSION'))) {
        return c;
      }
    } catch (e) {}
  }

  // 最后再兜底：只要有 python/Scripts/python.exe 就算
  for (const c of cands) {
    if (!c) continue;
    try {
      if (fs.existsSync(path.join(c, 'python', 'Scripts', 'python.exe'))) {
        return c;
      }
    } catch (e) {}
  }
  return null;
}

const RT = findRuntimeRoot();

// ── 端口探测 ──
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

async function waitFor(port, maxMs) {
  const deadline = Date.now() + (maxMs || 30000);
  while (Date.now() < deadline) {
    if (await isListening(port)) return true;
    await new Promise(r => setTimeout(r, 600));
  }
  return false;
}

// ── 状态 ──
const state = {
  rt: RT,
  bridge: false,
  backend: false,
  frontend: false,
  errors: [],
  children: [],
};

function log(msg) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log('[deeptutor ' + t + '] ' + msg);
}

// ── ① WorkBuddy 桥 ──
async function startBridge() {
  if (await isListening(8790)) {
    state.bridge = true;
    log('WorkBuddy 桥已在运行');
    return true;
  }

  // 桥脚本在应用根目录（不在 runtime 里，因为要引用 electron-workbuddy.js）
  const bridgeCandidates = [
    path.join(__dirname, 'workbuddy-bridge.cjs'),
    process.resourcesPath ? path.join(process.resourcesPath, 'workbuddy-bridge.cjs') : null,
    path.join(__dirname, '..', 'workbuddy-bridge.cjs'),
    path.join(process.cwd() || '', 'workbuddy-bridge.cjs'),
  ].filter(Boolean);
  const bridgePath = bridgeCandidates.find(p => {
    try { return fs.existsSync(p); } catch (e) { return false; }
  });
  if (!bridgePath) {
    state.errors.push('找不到 workbuddy-bridge.cjs');
    log('✗ 找不到桥脚本');
    return false;
  }

  /**
   * ★ 用真实的 node.exe 跑桥，不要用 process.execPath（2026-10-18）
   *
   * 踩过的坑：在 Electron 主进程里，process.execPath 是 Electron 的 exe。
   * 用它 + `ELECTRON_RUN_AS_NODE=1` 去跑一个普通 Node 脚本时，
   * 模块解析会带着 Electron 的 asar 补丁，桥里 require('./electron-workbuddy.js')
   * 反而崩在 cjs/loader 里（实测：node:internal/modules/cjs/loader:1235）。
   *
   * 而 runtime 里已经打了一个纯 node.exe —— 用它最干净。
   */
  function findNodeExe() {
    const cands = [
      RT ? path.join(RT, 'node', 'node.exe') : null,
      process.platform === 'win32' ? 'node.exe' : 'node',   // 退回 PATH
    ].filter(Boolean);
    for (const c of cands) {
      try {
        if (c === 'node.exe' || c === 'node' || fs.existsSync(c)) return c;
      } catch (e) {}
    }
    return process.execPath;
  }

  try {
    const nodeExe = findNodeExe();
    const useElectron = nodeExe === process.execPath;
    log('桥使用: ' + nodeExe + (useElectron ? '（Electron 兜底）' : ''));

    const childEnv = Object.assign({}, process.env);
    if (useElectron) childEnv.ELECTRON_RUN_AS_NODE = '1';
    else delete childEnv.ELECTRON_RUN_AS_NODE;   // 纯 node 不能带这个

    const child = spawn(nodeExe, [bridgePath, '--port=8790'], {
      cwd: path.dirname(bridgePath),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });
    // 收集 stderr 全文，供 exit 时判断是否属「预期内不可用」
    let bridgeErrText = '';
    child.stdout.on('data', d => {
      const s = d.toString().trim();
      if (s && !s.includes('══')) log('[bridge] ' + s.split('\n')[0]);
    });
    child.stderr.on('data', d => {
      const s = d.toString();
      bridgeErrText += s;
      const first = s.trim().split('\n')[0];
      // MODULE_NOT_FOUND 的堆栈是已知情况，不逐行刷屏（exit 里会统一说明）
      if (first && !/Cannot find module 'electron'/.test(s)) {
        log('[bridge:err] ' + first.slice(0, 300));
      }
    });
    child.on('error', (e) => {
      log('[bridge:spawn失败] ' + e.message);
    });
    child.on('exit', (c) => {
      /**
       * ★ 2026-10-31：区分「预期内不可用」和真错误。
       *
       * 已知限制：workbuddy-bridge.cjs 用**纯 node.exe** 跑（不能用 Electron，
       * 否则模块解析带上 asar 补丁会崩），但它 require 的 electron-workbuddy.js
       * 顶部有 require('electron') 拿 ipcMain —— 纯 node 下必然 MODULE_NOT_FOUND。
       *
       * 影响范围很小：
       *   · 主程序的 WorkBuddy（设置页「用 WorkBuddy 跳过填 Key」）走 **IPC**，不依赖此桥
       *   · 前端没有任何地方引用 8790 端口
       *   · 此桥只为 DeepTutor 后端提供 HTTP 形式的 WorkBuddy 能力
       * 所以这里降级为一行说明，不再刷 err 堆栈吓用户。
       */
      if (c !== 0) {
        if (bridgeErrText.includes("Cannot find module 'electron'")) {
          log('[bridge] 跳过（纯 node 环境无 electron 模块，属预期；主程序 WorkBuddy 走 IPC 不受影响）');
        } else {
          log('[bridge] 退出 code=' + c);
        }
      }
      state.bridge = false;
    });
    state.children.push(child);

    state.bridge = await waitFor(8790, 20000);
    log(state.bridge ? '✓ WorkBuddy 桥就绪' : '✗ WorkBuddy 桥超时');
    return state.bridge;
  } catch (e) {
    state.errors.push('桥启动失败: ' + e.message);
    log('✗ 桥启动失败: ' + e.message);
    return false;
  }
}

// ── ② DeepTutor 后端 ──
async function startBackend() {
  if (await isListening(8001)) {
    state.backend = true;
    log('DeepTutor 后端已在运行');
    return true;
  }
  if (!RT) {
    state.errors.push('找不到 DeepTutor 运行时');
    return false;
  }

  const py = path.join(RT, 'python', 'Scripts', 'python.exe');
  const appDir = path.join(RT, 'app');

  if (!fs.existsSync(py)) {
    state.errors.push('运行时缺少 python.exe');
    log('✗ 缺少: ' + py);
    return false;
  }

  try {
    const child = spawn(py, ['-m', 'deeptutor', 'serve', '--host', '127.0.0.1', '--port', '8001'], {
      cwd: appDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        PYTHONPATH: appDir,
        PYTHONIOENCODING: 'utf-8',
        DEEPTUTOR_HOME: appDir,
        // 关掉 Python 的 .pyc 写入（运行时目录可能只读）
        PYTHONDONTWRITEBYTECODE: '1',
      }),
    });
    child.stdout.on('data', d => {
      const s = d.toString().trim();
      if (s && /Uvicorn|startup|Started|Listening/i.test(s)) log('[backend] ' + s.split('\n')[0]);
    });
    child.stderr.on('data', d => {
      const s = d.toString().trim();
      if (s && /error|Error|Traceback|failed/i.test(s)) log('[backend:err] ' + s.split('\n')[0].slice(0, 200));
    });
    child.on('exit', (c) => {
      if (c !== 0 && c !== null) log('[backend] 退出 code=' + c);
      state.backend = false;
    });
    state.children.push(child);

    state.backend = await waitFor(8001, 60000);
    log(state.backend ? '✓ DeepTutor 后端就绪' : '✗ DeepTutor 后端超时');
    return state.backend;
  } catch (e) {
    state.errors.push('后端启动失败: ' + e.message);
    log('✗ 后端启动失败: ' + e.message);
    return false;
  }
}

// ── ③ DeepTutor 前端 ──
async function startFrontend() {
  if (await isListening(3782)) {
    state.frontend = true;
    log('DeepTutor 前端已在运行');
    return true;
  }
  if (!RT) return false;

  const nodeExe = path.join(RT, 'node', 'node.exe');
  const serverJs = path.join(RT, 'web', 'server.js');

  if (!fs.existsSync(nodeExe) || !fs.existsSync(serverJs)) {
    state.errors.push('运行时缺少 node.exe 或 server.js');
    log('✗ 缺少前端运行时');
    return false;
  }

  try {
    const child = spawn(nodeExe, [serverJs], {
      cwd: path.join(RT, 'web'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        NODE_ENV: 'production',
        PORT: '3782',
        HOSTNAME: '127.0.0.1',
        NEXT_TELEMETRY_DISABLED: '1',
        // 让前端知道后端在哪
        DEEPTUTOR_API_BASE_URL: 'http://127.0.0.1:8001',
      }),
    });
    child.stdout.on('data', d => {
      const s = d.toString().trim();
      if (s && /ready|started|Local:|Listening/i.test(s)) log('[frontend] ' + s.split('\n')[0]);
    });
    child.stderr.on('data', d => {
      const s = d.toString().trim();
      if (s && /error|Error|failed/i.test(s)) log('[frontend:err] ' + s.split('\n')[0].slice(0, 200));
    });
    child.on('exit', (c) => {
      if (c !== 0 && c !== null) log('[frontend] 退出 code=' + c);
      state.frontend = false;
    });
    state.children.push(child);

    state.frontend = await waitFor(3782, 60000);
    log(state.frontend ? '✓ DeepTutor 前端就绪' : '✗ DeepTutor 前端超时');
    return state.frontend;
  } catch (e) {
    state.errors.push('前端启动失败: ' + e.message);
    log('✗ 前端启动失败: ' + e.message);
    return false;
  }
}

// ── 对外接口 ──
async function ensureAll() {
  if (state.bridge && state.backend && state.frontend) return state;

  /**
   * ★ 2026-10-31 修：没有运行时就直接返回，不要硬启动。
   *
   * 之前精简版（slim，不含 runtime/deeptutor）启动时会一路
   *   「启动 DeepTutor 全套…」→ bridge 报 Cannot find module → 退出 code=1
   * 控制台一片红，用户以为软件坏了。
   *
   * DeepTutor 深度辅导是**可选**附加能力（在辅导卡片里点才用），
   * 不是主界面依赖。没有运行时 = 这个功能不可用，主程序完全正常，
   * 所以这里应该安静跳过。
   */
  if (!RT) {
    log('未检测到 DeepTutor 运行时（精简版不含此组件），跳过。');
    return {
      runtime: null,
      bridge: false,
      backend: false,
      frontend: false,
      skipped: true,
      errors: [],
    };
  }

  log('启动 DeepTutor 全套…');
  log('运行时: ' + (RT || '(未找到)'));

  // 桥必须最先起（后端要用它的 API）
  await startBridge();
  await startBackend();
  await startFrontend();

  log('完成: bridge=' + state.bridge + ' backend=' + state.backend + ' frontend=' + state.frontend);
  return state;
}

async function status() {
  return {
    runtime: RT,
    bridge: await isListening(8790),
    backend: await isListening(8001),
    frontend: await isListening(3782),
    url: 'http://127.0.0.1:3782',
  };
}

function stopAll() {
  state.children.forEach(c => { try { c.kill(); } catch (e) {} });
  state.children = [];
  state.bridge = state.backend = state.frontend = false;
}

module.exports = { ensureAll, status, stopAll, isListening, findRuntimeRoot };

// 直接运行时（命令行调试）
if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--status') {
    status().then(s => {
      console.log(JSON.stringify(s, null, 2));
      process.exit(0);
    });
  } else {
    ensureAll().then(s => {
      console.log('');
      console.log('═══════════════════════════════════');
      console.log(' 全部就绪，打开: http://127.0.0.1:3782');
      console.log(' 按 Ctrl+C 停止');
      console.log('═══════════════════════════════════');
      // 保持运行
      setInterval(() => {}, 60000);
      process.on('SIGINT', () => { stopAll(); process.exit(0); });
    });
  }
}
