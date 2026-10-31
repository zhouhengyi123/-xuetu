# WorkBuddy 云服务部署提示词

> 直接复制下面整段，粘给 WorkBuddy。

---

## 提示词（复制从这里开始）

```
请帮我部署一个使用统计服务，我用的是 Node.js。

【背景】
我做了一个开源的桌面软件「学徒 · AI 学习系统」，想统计有多少人在用。
客户端会往一个 HTTP 地址 POST 匿名计数，我需要一个服务端接收并做统计展示。

【要部署的文件】
文件名：stats-server.cjs
内容如下（完整复制）：

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8791;
const DATA_FILE = path.join(__dirname, 'stats-data.json');

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { users: {}, events: [] };
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { return { users: {}, events: [] }; }
}

function save(data) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('保存失败:', e.message); }
}

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
  data.events.push({ id, at: new Date().toISOString(), version: payload.version });
  if (data.events.length > 5000) data.events = data.events.slice(-5000);
  save(data);
}

function summary() {
  const data = load();
  const users = Object.values(data.users);
  const now = Date.now();
  const DAY = 86400000;
  return {
    total: users.length,
    today: users.filter(u => (now - new Date(u.lastSeen).getTime()) < DAY).length,
    week: users.filter(u => (now - new Date(u.lastSeen).getTime()) < 7 * DAY).length,
    month: users.filter(u => (now - new Date(u.lastSeen).getTime()) < 30 * DAY).length,
    lastEvent: data.events.length ? data.events[data.events.length - 1].at : null,
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/collect') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        record(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(summary(), null, 2));
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const s = summary();
    const users = Object.values(load().users)
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)).slice(0, 50);
    const rows = users.map(u => `<tr><td><code>${u.id.slice(0,18)}…</code></td><td>${u.launches}</td><td>${u.version}</td><td>${u.platform}</td><td>${u.lastSeen.slice(0,16).replace('T',' ')}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>学徒 · 使用统计</title>
<style>body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px}h1{font-size:22px}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin:24px 0}.card{background:#1e293b;border-radius:10px;padding:18px;text-align:center}.num{font-size:30px;font-weight:700;color:#60a5fa}.label{font-size:12px;color:#94a3b8;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;color:#94a3b8;padding:8px 10px;border-bottom:1px solid #334155}td{padding:8px 10px;border-bottom:1px solid #1e293b}code{color:#93c5fd}</style>
</head><body><h1>学徒 · 使用统计</h1><div style="color:#94a3b8;font-size:13px">只统计匿名计数，不含任何个人信息</div>
<div class="cards"><div class="card"><div class="num">${s.total}</div><div class="label">累计用户</div></div><div class="card"><div class="num">${s.today}</div><div class="label">今日活跃</div></div><div class="card"><div class="num">${s.week}</div><div class="label">本周活跃</div></div><div class="card"><div class="num">${s.month}</div><div class="label">本月活跃</div></div></div>
<table><thead><tr><th>匿名 ID</th><th>启动次数</th><th>版本</th><th>平台</th><th>最近活跃</th></tr></thead><tbody>${rows || '<tr><td colspan="5" style="color:#64748b;padding:20px;text-align:center">还没有数据</td></tr>'}</tbody></table></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  res.writeHead(404); res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('学徒统计服务已启动: http://localhost:' + PORT);
});

【我要你做的】
1. 把这个服务部署起来（用你云服务里能跑 Node.js 的方式）
2. 确保它能被公网访问，给我一个 HTTPS 地址
3. 端口如果不方便用 8791，随便给我一个可用的
4. 帮我验证三个接口能访问：
   - GET  /            → 返回统计面板网页
   - POST /collect     → 接收 JSON，返回 {"ok":true}
   - GET  /api/stats   → 返回 JSON 统计
5. 告诉我最终拿到的两个地址：
   - 面板地址（我自己看人数用）
   - 接收地址（填到软件设置里，形如 https://xxx/collect）

【接口说明】
POST /collect 收到的 JSON 长这样（客户端发的）：
{
  "id": "xt-xxxx",           // 随机匿名 ID，不是个人信息
  "firstSeen": "2026-10-31T10:00:00Z",
  "lastSeen": "2026-10-31T14:00:00Z",
  "launches": 3,              // 累计启动次数
  "version": "v111",          // 软件版本
  "platform": "Win32"
}

服务端只需要累加去重，按 id 存一个用户表就行。

【注意】
- 不需要数据库，存 JSON 文件就够了
- 不用做用户认证（客户端只发匿名计数）
- 数据量很小（每个用户只有几条记录）
- 如果云服务不支持常驻 Node 进程，请告诉我它支持什么（云函数/容器/别的），改成对应的写法

麻烦帮我把服务跑起来，跑好后把两个地址给我。
```

---

## 复制完之后

拿到 WorkBuddy 给你的地址后：

1. 打开「学徒」→ 设置 → 找到「匿名使用统计」
2. 上报地址填：`https://你拿到的地址/collect`
3. 点「开启匿名统计」
4. 让我验证一下能不能通（你说一声就行）

---

## 如果他问你要什么

可能被问到这几件事，答复如下：

| 他问 | 你答 |
|---|---|
| 服务要不要求 HTTPS | 要，客户端在桌面应用里，走 HTTPS 更稳 |
| 用哪个端口 | 随便，8791 或他给的都行 |
| 要不要数据库 | 不要，JSON 文件就够了 |
| 数据量多大 | 很小，每个用户几条记录，几百人也就几百 KB |
| 要跑多久 | 长期常驻 |
