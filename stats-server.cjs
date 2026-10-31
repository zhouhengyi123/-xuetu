/**
 * 学徒 · 使用统计接收服务（2026-10-31）
 *
 * ══════════════════════════════════════════════════════════════
 * 这是部署在**你 WorkBuddy 云端**的小服务。
 * 开源版的「学徒」客户端会把匿名计数发到这里，你就能看到多少人在用。
 *
 * 怎么用：
 *   1. 把这个文件放到 WorkBuddy 云端（或任何能跑 Node 的地方）
 *   2. 运行：node stats-server.cjs --port=8791
 *   3. 把 http://你的云端地址:8791/collect 填到客户端「设置 → 匿名使用统计」
 *   4. 打开 http://你的云端地址:8791/ 就能看到使用人数
 *
 * 数据只存在本文件同目录的 stats-data.json，不上传到任何第三方。
 * 接口极简：
 *   POST /collect   接收一条匿名计数
 *   GET  /          查看统计面板（多少人在用）
 *   GET  /api/stats 返回 JSON 统计
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8791;
const DATA_FILE = path.join(__dirname, 'stats-data.json');

// ── 数据存取 ──
function load() {
  // 主文件
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('主文件读取失败，尝试备份:', e.message);
  }

  // ★ 主文件坏了/不存在 → 读备份
  try {
    const bak = DATA_FILE + '.bak';
    if (fs.existsSync(bak)) {
      console.log('已从备份恢复');
      return JSON.parse(fs.readFileSync(bak, 'utf8'));
    }
  } catch (e) {}

  // ★ 与已下载的本地副本合并（如果用户往目录里放了）
  return { users: {}, events: [] };
}

/**
 * ★ 双写 + 时间戳备份（2026-10-31）
 *
 * WorkBuddy 沙箱的文件不是持久卷：
 *   · 重新发布会重置
 *   · 沙箱回收可能丢
 *
 * 应对：
 *   ① 主文件（DATA_FILE）
 *   ② 备份文件（DATA_FILE.bak）—— 主文件坏了能救
 *   ③ 按天归档（backups/stats-YYYY-MM-DD.json）—— 能看到历史
 *   ④ /export 接口随时下载全量
 *
 * 真正的长期方案还是换云端数据库，但这是当下最稳的兜底。
 */
function save(data) {
  const json = JSON.stringify(data, null, 2);

  // ① 主文件
  try {
    fs.writeFileSync(DATA_FILE, json, 'utf8');
  } catch (e) {
    console.error('主文件保存失败:', e.message);
  }

  // ② 备份文件
  try {
    fs.writeFileSync(DATA_FILE + '.bak', json, 'utf8');
  } catch (e) {}

  // ③ 按天归档（每天第一次写入时生成）
  try {
    const dir = path.join(__dirname, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const dayFile = path.join(dir, 'stats-' + day + '.json');
    if (!fs.existsSync(dayFile)) {
      fs.writeFileSync(dayFile, json, 'utf8');
    }
  } catch (e) {}
}

// ── 接收匿名计数 ──
function record(payload) {
  if (!payload || !payload.id) return;

  const data = load();
  const id = String(payload.id);

  if (!data.users[id]) {
    data.users[id] = {
      id,
      firstSeen: payload.firstSeen || new Date().toISOString(),
      lastSeen: payload.lastSeen || new Date().toISOString(),
      launches: 0,
      version: payload.version || 'unknown',
      platform: payload.platform || 'unknown',
    };
  }

  const u = data.users[id];
  u.lastSeen = payload.lastSeen || new Date().toISOString();
  u.launches = Math.max(u.launches, payload.launches || 0);
  if (payload.version) u.version = payload.version;
  if (payload.platform) u.platform = payload.platform;

  // 记录一条事件（用于趋势图）
  data.events.push({ id, at: new Date().toISOString(), version: payload.version });
  // 只保留最近 5000 条
  if (data.events.length > 5000) data.events = data.events.slice(-5000);

  save(data);
}

// ── 统计汇总 ──
function summary() {
  const data = load();
  const users = Object.values(data.users);
  const now = Date.now();
  const DAY = 86400000;

  const today = users.filter(u => (now - new Date(u.lastSeen).getTime()) < DAY).length;
  const week = users.filter(u => (now - new Date(u.lastSeen).getTime()) < 7 * DAY).length;
  const month = users.filter(u => (now - new Date(u.lastSeen).getTime()) < 30 * DAY).length;

  // 版本分布
  const versions = {};
  users.forEach(u => { versions[u.version] = (versions[u.version] || 0) + 1; });

  return {
    total: users.length,
    today, week, month,
    versions,
    lastEvent: data.events.length ? data.events[data.events.length - 1].at : null,
  };
}

// ── HTTP 服务 ──
const server = http.createServer((req, res) => {
  // CORS（允许客户端跨域上报）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── 接收匿名计数 ──
  if (req.method === 'POST' && req.url === '/collect') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        record(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  // ── JSON 统计接口 ──
  if (req.method === 'GET' && req.url === '/api/stats') {
    const s = summary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(s, null, 2));
    return;
  }

  // ── 查看面板 ──
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const s = summary();
    const data = load();
    const users = Object.values(data.users)
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .slice(0, 50);

    const rows = users.map(u => `
      <tr>
        <td><code>${u.id.slice(0, 18)}…</code></td>
        <td>${u.launches}</td>
        <td>${u.version}</td>
        <td>${u.platform}</td>
        <td>${u.lastSeen.slice(0, 16).replace('T', ' ')}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>学徒 · 使用统计</title>
<style>
  body { font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif; background:#0f172a; color:#e2e8f0; padding:32px; }
  h1 { font-size:22px; margin-bottom:6px; }
  .sub { color:#94a3b8; font-size:13px; margin-bottom:24px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px; margin-bottom:28px; }
  .card { background:#1e293b; border-radius:10px; padding:18px; text-align:center; }
  .num { font-size:30px; font-weight:700; color:#60a5fa; }
  .label { font-size:12px; color:#94a3b8; margin-top:4px; }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th { text-align:left; color:#94a3b8; font-weight:500; padding:8px 10px; border-bottom:1px solid #334155; }
  td { padding:8px 10px; border-bottom:1px solid #1e293b; }
  code { color:#93c5fd; }
  .versions { margin-bottom:20px; font-size:13px; color:#94a3b8; }
  .versions span { background:#1e293b; padding:3px 10px; border-radius:5px; margin-right:6px; }
</style>
</head>
<body>
  <h1>学徒 · 使用统计</h1>
  <div class="sub">只统计匿名计数，不含任何个人信息</div>

  <div class="cards">
    <div class="card"><div class="num">${s.total}</div><div class="label">累计用户</div></div>
    <div class="card"><div class="num">${s.today}</div><div class="label">今日活跃</div></div>
    <div class="card"><div class="num">${s.week}</div><div class="label">本周活跃</div></div>
    <div class="card"><div class="num">${s.month}</div><div class="label">本月活跃</div></div>
  </div>

  <div class="versions">
    版本分布：
    ${Object.entries(s.versions).map(([v, c]) => `<span>${v} × ${c}</span>`).join('') || '（暂无）'}
  </div>

  <div style="margin-bottom:16px">
    <a href="/export" style="display:inline-block;padding:8px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:7px;font-size:13px">↓ 导出全量数据（防丢）</a>
    <span style="color:#64748b;font-size:12px;margin-left:12px">建议每周导出一份存本地</span>
  </div>

  <table>
    <thead><tr><th>匿名 ID</th><th>启动次数</th><th>版本</th><th>平台</th><th>最近活跃</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" style="color:#64748b;padding:20px;text-align:center">还没有数据</td></tr>'}</tbody>
  </table>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── 导出全量数据（防丢，随时下载）──
  if (req.method === 'GET' && req.url.split('?')[0] === '/export') {
    const data = load();
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="xuetu-stats-' + new Date().toISOString().slice(0, 10) + '.json"',
    });
    res.end(JSON.stringify(data, null, 2));
    return;
  }

  // ── 导入（迁移/恢复）──
  if (req.method === 'POST' && req.url.split('?')[0] === '/import') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body);
        const current = load();
        // 合并：按 id 去重，保留较大的 launches
        Object.keys(incoming.users || {}).forEach(id => {
          const inc = incoming.users[id];
          const cur = current.users[id];
          if (!cur) {
            current.users[id] = inc;
          } else {
            cur.launches = Math.max(cur.launches || 0, inc.launches || 0);
            if (new Date(inc.lastSeen) > new Date(cur.lastSeen)) cur.lastSeen = inc.lastSeen;
            if (new Date(inc.firstSeen) < new Date(cur.firstSeen)) cur.firstSeen = inc.firstSeen;
          }
        });
        save(current);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, total: Object.keys(current.users).length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  学徒 · 使用统计接收服务已启动');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log('  统计面板:   http://localhost:' + PORT + '/');
  console.log('  接收地址:   http://localhost:' + PORT + '/collect');
  console.log('  JSON 接口:  http://localhost:' + PORT + '/api/stats');
  console.log('');
  console.log('  把接收地址填到客户端「设置 → 匿名使用统计」即可。');
  console.log('');
});
