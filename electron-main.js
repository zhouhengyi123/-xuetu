/**
 * Electron 主进程 —— 学徒 · AI 学习系统桌面版
 *
 * 设计要点：
 *  ① **内置静态服务器**：页面原本要靠 python server.py 才能跑（file:// 下 fetch 备份接口会失败），
 *     这里用 Node 原生 http 起一个本地服务，端口自动选，顺便实现 /api/backup 那套接口。
 *  ② **数据目录固定在项目下**：备份写到 <项目>/backups/，跟网页版共用同一份，
 *     所以你之前的数据（导出文件）可以直接恢复进来。
 *  ③ **数据迁移**：首次启动如果本地没有数据，会尝试从 backups/ 里最近的一份自动恢复，
 *     避免"打包后看不到原来的数据"。
 *  ④ **窗口状态记忆**：记住大小/位置，下次打开还原。
 */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

const ROOT = __dirname;                    // 项目根（打包后在 app.asar 里）
const BACKUP_DIR = path.join(ROOT, 'backups');
const MAX_BACKUPS = 60;

/** 打包后 resources 是只读的，备份目录要放到可写位置 */
function dataDir() {
  // 开发时用项目目录；打包后放到 userData（可写）
  if (app.isPackaged) return path.join(app.getPath('userData'), 'backups');
  return BACKUP_DIR;
}

// ══════════════════════════════════════════════════════════
//  本地 HTTP 服务（静态文件 + 备份接口）
// ══════════════════════════════════════════════════════════
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function ensureBackupDir() {
  const d = dataDir();
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}

function listBackups() {
  const d = ensureBackupDir();
  let files = [];
  try { files = fs.readdirSync(d).filter(f => /^backup-.*\.json$/.test(f)); } catch (e) { return []; }
  return files.map(f => {
    const p = path.join(d, f);
    let st;
    try { st = fs.statSync(p); } catch (e) { return null; }
    return { name: f, size: st.size, mtime: st.mtimeMs, time: new Date(st.mtimeMs).toLocaleString('zh-CN') };
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);
}

function pruneBackups() {
  const items = listBackups();
  const d = ensureBackupDir();
  items.slice(MAX_BACKUPS).forEach(it => {
    try { fs.unlinkSync(path.join(d, it.name)); } catch (e) {}
  });
}

function json(res, obj, code) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function handleApi(req, res, pathname) {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end();
  }

  // POST /api/backup
  if (req.method === 'POST' && pathname === '/api/backup') {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 64 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!payload || typeof payload !== 'object' || !payload.data) {
          return json(res, { ok: false, error: 'payload must be {"data": {...}}' }, 400);
        }
        // 拒绝空数据：清空后的"保护性备份"会写出空壳，抢占"最新"位置
        const data = payload.data || {};
        let hasContent = false;
        for (const k of Object.keys(data)) {
          if (k === 'at' || k === 'count') continue;
          const v = data[k];
          if (Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : (v != null && v !== ''))) {
            hasContent = true; break;
          }
        }
        if (!hasContent) return json(res, { ok: false, error: '数据是空的，不写入备份' }, 400);

        const d = ensureBackupDir();
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        let file = path.join(d, `backup-${ts}.json`);
        let n = 1;
        while (fs.existsSync(file)) { file = path.join(d, `backup-${ts}-${n}.json`); n++; }

        fs.writeFileSync(file, JSON.stringify(payload, null, 1), 'utf8');
        pruneBackups();
        json(res, { ok: true, file: path.basename(file), size: fs.statSync(file).size, time: ts });
      } catch (e) {
        json(res, { ok: false, error: String(e.message || e) }, 400);
      }
    });
    return;
  }

  // GET /api/backups
  if (pathname === '/api/backups') {
    return json(res, { ok: true, items: listBackups() });
  }

  // GET /api/backup/latest
  if (pathname === '/api/backup/latest') {
    const items = listBackups();
    if (!items.length) return json(res, { ok: false, error: '还没有任何快照' }, 404);
    try {
      const raw = fs.readFileSync(path.join(ensureBackupDir(), items[0].name));
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': raw.length,
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(raw);
    } catch (e) {
      return json(res, { ok: false, error: String(e.message || e) }, 500);
    }
  }

  // GET /api/data-dir  —— 告诉用户备份到底存在哪
  if (pathname === '/api/data-dir') {
    return json(res, { ok: true, dir: ensureBackupDir(), packaged: app.isPackaged });
  }

  return json(res, { ok: false, error: 'not found' }, 404);
}

function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/' || p === '') p = '/web/index.html';
  // 防目录穿越
  const safe = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 ' + safe);
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': buf.length,
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(buf);
  });
}

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const { pathname } = url.parse(req.url);
      if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
      return serveStatic(req, res, pathname);
    });

    /**
     * ★ 2026-11-07 修：端口必须固定，否则每次启动 origin 都变。
     *
     * 原来的 `server.listen(0)` 让系统分配随机端口（注释说「避免和
     * python server.py 抢」）。但 localStorage 是按 **origin（含端口）**
     * 隔离的：端口一变，浏览器就认为是一个全新的站点，所有用户数据
     * （设置、错题、记忆、作息、制度）全部「消失」。外部审计实测
     * 每次启动端口 50932→60955→59069→59639，数据归零。
     *
     * 现在把端口写进 userData/port.json，只分配一次、之后永远复用：
     *   · 首次启动：从 50932 起试，被占用就 +1，找到空闲端口后落盘
     *   · 后续启动：直接读回同一个端口 → origin 稳定 → localStorage 不丢
     *   · 万一落盘的端口被别的程序占了，仍自动往后找一个并更新记录
     *     （这种极少见；真发生了，下面还有磁盘镜像 + 备份自动恢复兜底）
     */
    const portFile = path.join(app.getPath('userData'), 'port.json');
    const BASE_PORT = 50932;
    const MAX_TRY = 50;

    function readSavedPort() {
      try {
        const j = JSON.parse(fs.readFileSync(portFile, 'utf8'));
        const p = Number(j && j.port);
        return Number.isInteger(p) && p > 0 && p < 65536 ? p : null;
      } catch (e) { return null; }
    }
    function savePort(p) {
      try {
        fs.mkdirSync(path.dirname(portFile), { recursive: true });
        fs.writeFileSync(portFile, JSON.stringify({ port: p, savedAt: new Date().toISOString() }, null, 2), 'utf8');
      } catch (e) { console.error('[server] 端口落盘失败:', e.message); }
    }

    const candidates = [];
    const saved = readSavedPort();
    if (saved) candidates.push(saved);              // 优先复用上次的
    for (let i = 0; i < MAX_TRY; i++) {
      const p = BASE_PORT + i;
      if (p !== saved) candidates.push(p);
    }

    let idx = 0;
    const tryNext = () => {
      if (idx >= candidates.length) {
        console.error('[server] 没有可用端口，回退到随机端口');
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
        return;
      }
      const p = candidates[idx++];
      const onError = (e) => {
        server.removeListener('listening', onListening);
        if (e && e.code === 'EADDRINUSE') { tryNext(); return; }
        console.error('[server] 启动失败:', e);
        resolve({ server: null, port: null });
      };
      const onListening = () => {
        server.removeListener('error', onError);
        savePort(p);
        console.log('[server] 固定端口 ' + p + (saved === p ? '（复用）' : '（新分配并落盘）'));
        resolve({ server, port: p });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, '127.0.0.1');
    };
    tryNext();
  });
}

// ══════════════════════════════════════════════════════════
//  窗口
// ══════════════════════════════════════════════════════════
let mainWindow = null;
let winState = { width: 1440, height: 940 };

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

/**
 * ★ 窗口位置校验（2026-10-17 修 —— 这是个真 bug）
 *
 * 之前的错：直接把 winState.x / winState.y 传给 BrowserWindow。
 *   首次运行时 winState 只有 width/height，x/y 是 **undefined**；
 *   而保存时如果窗口被最小化，`getNormalBounds()` 可能给出 -32000
 *   （Windows 标记最小化的哨兵值）。
 *
 * 后果：窗口跑到 (-32000, -32000) —— **屏幕外**。
 *   进程活着、标题正常、UI 自动化也能看到句柄，但**用户根本看不见窗口**。
 *   我自己测的时候只查了"进程存活"，没查坐标，所以没发现。
 */
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (!s || typeof s !== 'object') return;
    const w = Number(s.width), h = Number(s.height);
    if (w > 400 && h > 300) { winState.width = w; winState.height = h; }

    // 位置：必须是有限数，且不能是 -32000 之类的哨兵值
    const x = Number(s.x), y = Number(s.y);
    if (isFinite(x) && isFinite(y) && x > -10000 && y > -10000 && x < 20000 && y < 20000) {
      winState.x = x;
      winState.y = y;
    } else {
      delete winState.x;
      delete winState.y;
    }
    winState.maximized = s.maximized === true;
  } catch (e) {}
}

function saveState() {
  if (!mainWindow) return;
  try {
    // 最小化时不保存（此时 bounds 是哨兵值，存了下次就跑到屏幕外）
    if (mainWindow.isMinimized()) return;
    const b = mainWindow.getNormalBounds();
    if (!isFinite(b.x) || !isFinite(b.y) || b.x <= -10000 || b.y <= -10000) return;
    fs.writeFileSync(stateFile(), JSON.stringify({
      width: b.width, height: b.height, x: b.x, y: b.y,
      maximized: mainWindow.isMaximized(),
    }), 'utf8');
  } catch (e) {}
}

async function createWindow() {
  loadState();
  const { port } = await startServer();

  const winOpts = {
    width: winState.width,
    height: winState.height,
    minWidth: 1000,
    minHeight: 640,
    title: '学徒 · AI 学习系统',
    backgroundColor: '#eef2f8',
    autoHideMenuBar: true,
    show: false,                       // ★ 先不显示，等 ready-to-show
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, 'electron-preload.js'),
    },
  };
  // ★ 只有位置合法才传（否则让系统自己居中）
  if (isFinite(winState.x) && isFinite(winState.y)) {
    winOpts.x = winState.x;
    winOpts.y = winState.y;
  }

  mainWindow = new BrowserWindow(winOpts);

  if (winState.maximized) mainWindow.maximize();

  const target = port ? `http://127.0.0.1:${port}/web/index.html` : path.join(ROOT, 'web', 'index.html');
  await mainWindow.loadURL(target);

  /**
   * ★ 页面就绪后再显示（2026-10-17）
   *   show:false 创建 → ready-to-show 时 show()：
   *   既避免白屏闪烁，也避免"窗口建了但内容没出来"的空窗。
   *   如果 3 秒还没 ready（极端情况），兜底强显，绝不留下看不见的窗口。
   */
  let shown = false;
  const doShow = (why) => {
    if (shown || !mainWindow) return;
    shown = true;
    try {
      console.log('[window] show() 触发（' + why + '）');
      mainWindow.show();
      mainWindow.focus();
      const b = mainWindow.getBounds();
      console.log('[window] 显示后 bounds: ' + JSON.stringify(b) +
        ' visible=' + mainWindow.isVisible() +
        ' minimized=' + mainWindow.isMinimized() +
        ' offscreen=' + mainWindow.isOffscreen?.());
    } catch (e) {
      console.error('[window] show 失败: ' + e.message);
    }
  };

  mainWindow.once('ready-to-show', () => doShow('ready-to-show'));
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('[window] did-finish-load');
    setTimeout(() => doShow('did-finish-load'), 200);
  });
  mainWindow.webContents.once('did-fail-load', (e, code, desc, url) => {
    console.error('[window] did-fail-load: ' + code + ' ' + desc + ' ' + url);
    doShow('did-fail-load');
  });
  // 兜底：2.5 秒无论如何显示
  setTimeout(() => doShow('timeout'), 2500);

  console.log('[window] 创建完成, 等待 show… target=' + target);

  // 外部链接用系统浏览器打开，不在应用内跳走
  mainWindow.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:\/\//i.test(u) && !u.startsWith('http://127.0.0.1')) {
      shell.openExternal(u);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('close', saveState);
  mainWindow.on('closed', () => { mainWindow = null; });

  // F12 打开开发者工具（方便排查）
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

// 单实例：再次双击时聚焦已有窗口，而不是开第二个
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    /**
     * ★ 配置持久化 IPC（2026-10-24）
     *
     * 用户抱怨"每次都要重新输密钥"。
     * 这里把页面里的关键配置额外存一份到 userData，
     * localStorage 被清也能恢复。
     */
    try {
      const { ipcMain } = require('electron');
      const cfgFile = path.join(app.getPath('userData'), 'config-mirror.json');

      ipcMain.handle('appdata:save', async (evt, snap) => {
        try {
          const dir = path.dirname(cfgFile);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(cfgFile, JSON.stringify({
            savedAt: new Date().toISOString(),
            data: snap,
          }, null, 2), 'utf8');
          return { ok: true, path: cfgFile };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      });

      ipcMain.handle('appdata:load', async () => {
        try {
          if (!fs.existsSync(cfgFile)) return null;
          const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
          return j && j.data ? j.data : null;
        } catch (e) {
          return null;
        }
      });

      ipcMain.handle('appdata:path', async () => cfgFile);

      console.log('[appdata] 配置镜像已启用: ' + cfgFile);

      /**
       * ★ Agent + 工具 IPC（2026-10-24）
       *
       * 让 AI 能真正调用本机能力：读写文件、跑代码、生成图表/3D/动画。
       * 工作区固定在 userData/workspace，所有文件操作都在里面。
       */
      try {
        const Tools = require('./electron-tools.js');
        const Agent = require('./electron-agent.js');

        const ws = path.join(app.getPath('userData'), 'workspace');
        Tools.setWorkspace(ws);
        console.log('[agent] 工作区: ' + ws);
        console.log('[agent] 工具数: ' + Tools.TOOLS.length);

        ipcMain.handle('agent:tools', async () => ({
          ok: true,
          tools: Tools.TOOLS.map(t => ({
            name: t.function.name,
            description: t.function.description,
          })),
        }));

        ipcMain.handle('agent:workspace', async () => Tools.workspace());

        ipcMain.handle('agent:logs', async () => ({ ok: true, logs: Tools.getLogs() }));

        ipcMain.handle('agent:run', async (evt, payload) => {
          try {
            const cfg = payload || {};
            // API Key 从 payload 拿（页面传），没传就报错
            if (!cfg.apiKey) return { ok: false, error: '缺少 API Key' };

            const r = await Agent.runAgent({
              apiKey: cfg.apiKey,
              model: cfg.model || 'deepseek-chat',
              messages: cfg.messages || [],
              onTool: (info) => {
                // 实时推给页面（工具调用进度）
                try { evt.sender.send('agent:tool', info); } catch (e) {}
              },
            });
            return r;
          } catch (e) {
            return { ok: false, error: String(e.message || e) };
          }
        });

        // 打开生成的文件
        ipcMain.handle('agent:open', async (evt, filePath) => {
          try {
            const p = String(filePath || '');
            const wsRoot = Tools.workspace();
            // 只允许打开工作区内的文件
            if (!p.startsWith(wsRoot)) return { ok: false, error: '只能打开工作区内的文件' };
            if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };
            require('electron').shell.openPath(p);
            return { ok: true };
          } catch (e) {
            return { ok: false, error: String(e.message || e) };
          }
        });

        // 列出工作区里生成的文件
        ipcMain.handle('agent:list-outputs', async () => {
          try {
            const root = Tools.workspace();
            const out = [];
            // ★ videos 也要扫（2026-10-24）—— 之前漏了，导出的 MP4 不在列表里
            ['charts', 'scenes', 'animations', 'videos'].forEach(kind => {
              const d = path.join(root, kind);
              if (!fs.existsSync(d)) return;
              fs.readdirSync(d).forEach(f => {
                const full = path.join(d, f);
                try {
                  const st = fs.statSync(full);
                  if (st.isFile()) out.push({
                    kind,
                    name: f,
                    path: full,
                    size: st.size,
                    at: st.mtime.toISOString(),
                  });
                } catch (e) {}
              });
            });
            out.sort((a, b) => b.at.localeCompare(a.at));
            return { ok: true, files: out.slice(0, 50) };
          } catch (e) {
            return { ok: false, error: String(e.message || e), files: [] };
          }
        });

        console.log('[agent] IPC 已注册');
      } catch (e) {
        console.error('[agent] IPC 注册失败（不影响主程序）: ' + e.message);
      }
    } catch (e) {
      console.error('[appdata] IPC 注册失败: ' + e.message);
    }

    ensureBackupDir();
    Menu.setApplicationMenu(null);       // 去掉默认菜单（File/Edit...），更像个应用

    /**
     * ★ 后台拉起 DeepTutor（2026-10-18）
     *
     * 打进 runtime/ 的 DeepTutor 运行时（Python + 前端 + Node），
     * 由 deeptutor-runtime.cjs 统一拉起：
     *   · WorkBuddy 桥 8790
     *   · DeepTutor 后端 8001
     *   · DeepTutor 前端 3782
     *
     * 关键设计：**异步、不阻塞主窗口**。
     *   主界面先出来，DeepTutor 在后台慢慢起（约 40 秒）。
     *   起不来也不影响使用（快速问答照常），只是「深度辅导」会提示未启动。
     */
    setTimeout(() => {
      try {
        /**
         * ★ 从 resources/ 加载，而不是从 asar（2026-10-18）
         *
         * 这个脚本要 spawn python 和 node 子进程，
         * 子进程的 cwd 必须是真实目录。
         * 在 asar 里 `__dirname` 是虚拟路径，spawn 会静默失败
         * （实测表现：日志停在"运行时: ..."后再无输出）。
         *
         * 所以 _build_exe.cjs 把它作为 extraResource 放在 resources/ 下。
         */
        let rtPath = path.join(__dirname, 'deeptutor-runtime.cjs');
        const resCandidates = [
          process.resourcesPath ? path.join(process.resourcesPath, 'deeptutor-runtime.cjs') : null,
          path.join(__dirname, '..', 'deeptutor-runtime.cjs'),
        ].filter(Boolean);

        for (const c of resCandidates) {
          if (fs.existsSync(c)) { rtPath = c; break; }
        }
        console.log('[deeptutor] 加载启动器: ' + rtPath);

        const rt = require(rtPath);
        console.log('[deeptutor] 开始后台启动…');
        rt.ensureAll().then(s => {
          console.log('[deeptutor] bridge=' + s.bridge +
            ' backend=' + s.backend + ' frontend=' + s.frontend);
          if (s.errors && s.errors.length) {
            console.log('[deeptutor] 警告: ' + s.errors.join(' | '));
          }
        }).catch(e => {
          console.error('[deeptutor] 启动失败（不影响主程序）: ' + e.message);
        });
      } catch (e) {
        console.error('[deeptutor] 模块加载失败（不影响主程序）: ' + e.message);
      }
    }, 1200);

    // ★ 注册 WorkBuddy 免费 Token 接入的 IPC（自用测试用）
    try {
      console.log('[workbuddy] 开始加载模块…');
      const wbMod = require('./electron-workbuddy.js');
      // 账号池状态存到 userData（重启记得冷却/模型选择）
      wbMod.Pool.initState(app.getPath('userData'));
      wbMod.Pool.loadState();
      console.log('[workbuddy] 池状态已加载');
      console.log('[workbuddy] 模块已加载, 导出: ' + Object.keys(wbMod).join(','));
      wbMod.registerWorkBuddyIpc();
      console.log('[workbuddy] ✓ IPC 已注册');
    } catch (e) {
      console.error('[workbuddy] ✗ IPC 注册失败: ' + e.message);
      console.error(e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : '');
    }

    await createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
