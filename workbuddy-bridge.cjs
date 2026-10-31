/**
 * WorkBuddy → OpenAI 兼容桥
 *
 * 目的：让 DeepTutor（以及任何别的 OpenAI 兼容客户端）能用上 WorkBuddy 的积分，
 *      不用再单独买 API Key。
 *
 * 为什么需要这层：
 *   WorkBuddy 的接口不是标准 OpenAI 格式（要 native binding 解密 token、
 *   必须流式、域名是 copilot.tencent.com），DeepTutor 用的是 openai SDK。
 *   所以在中间放一个本地 HTTP 服务做格式转换。
 *
 * 暴露的端点：
 *   GET  /v1/models                 模型列表
 *   POST /v1/chat/completions       对话（支持 stream: true/false）
 *   GET  /health                    健康检查
 *
 * 用法：
 *   node workbuddy-bridge.cjs [--port 8790]
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * ★ 依赖解析（2026-10-18）
 *
 * 打包后这个脚本被放在 resources/ 下（不在 asar 里），
 * 而 electron-workbuddy.js / electron-pool.js 还在 app.asar 里。
 * 所以要按多个候选路径找，不能只认 __dirname。
 */
function resolveDep(name) {
  const cands = [
    path.join(__dirname, name),
    path.join(__dirname, 'app', name),
    process.resourcesPath ? path.join(process.resourcesPath, name) : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'app', name) : null,
    path.join(__dirname, '..', name),
    path.join(process.cwd() || '', name),
  ].filter(Boolean);

  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (e) {}
  }
  return null;
}

const wbPath = resolveDep('electron-workbuddy.js');
if (!wbPath) {
  console.error('找不到 electron-workbuddy.js（查找了 __dirname / resources / cwd）');
  process.exit(1);
}

const wb = require(wbPath);

const poolPath = resolveDep('electron-pool.js');
if (!poolPath) {
  console.error('找不到 electron-pool.js');
  process.exit(1);
}
const Pool = require(poolPath);

/**
 * 池状态目录
 * 打包后 __dirname 是 resources/，可能没有写权限（Program Files 场景），
 * 所以优先用 APPDATA。
 */
function pickStateDir() {
  const cands = [
    path.join(process.env.APPDATA || process.env.LOCALAPPDATA || __dirname, '学徒', 'wb-bridge'),
    path.join(__dirname, '.wb-bridge'),
  ];
  for (const d of cands) {
    try {
      fs.mkdirSync(d, { recursive: true });
      // 测一下能不能写
      const test = path.join(d, '.w');
      fs.writeFileSync(test, 'x');
      fs.unlinkSync(test);
      return d;
    } catch (e) {}
  }
  return path.join(__dirname, '.wb-bridge');
}

const STATE_DIR = pickStateDir();
Pool.initState(STATE_DIR);

const PORT = Number((process.argv.find(a => a.startsWith('--port=')) || '').split('=')[1]) ||
  Number(process.env.WB_BRIDGE_PORT) || 8790;

// ── 工具 ──
function log(...args) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log('[' + t + ']', ...args);
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 20 * 1024 * 1024) { reject(new Error('请求体太大')); req.destroy(); }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('JSON 解析失败: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

/** OpenAI 的 messages → WorkBuddy 的 content 数组格式 */
function toWbMessages(messages) {
  return messages.map(m => {
    // 纯文本直接过
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content };
    }
    // 多模态：把 image_url 转成 WorkBuddy 认的格式
    if (Array.isArray(m.content)) {
      const parts = [];
      for (const p of m.content) {
        if (p.type === 'text') {
          parts.push({ type: 'text', text: p.text });
        } else if (p.type === 'image_url') {
          const url = (p.image_url && p.image_url.url) || '';
          // data:image/png;base64,xxx → 拆出 mime 和 base64
          const mm = url.match(/^data:([^;]+);base64,(.+)$/);
          if (mm) {
            parts.push({ type: 'image_url', image_url: { url: url } });
          } else {
            parts.push({ type: 'image_url', image_url: { url: url } });
          }
        }
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: String(m.content || '') };
  });
}

/** 估算 token（粗略：中文 1 字 ≈ 1 token，英文 4 字符 ≈ 1 token） */
function roughTokens(text) {
  if (!text) return 0;
  let cjk = 0, other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fa5]/.test(ch)) cjk++;
    else other++;
  }
  return Math.ceil(cjk + other / 4);
}

// ── 路由 ──
const server = http.createServer(async (req, res) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end();
    return;
  }

  const url = (req.url || '').split('?')[0];

  // 健康检查
  if (url === '/health' || url === '/') {
    let acctCount = 0, exe = null;
    try {
      exe = wb.findExe();
      acctCount = (await wb.loadAccounts()).length;
    } catch (e) {}
    sendJSON(res, 200, {
      ok: !!exe && acctCount > 0,
      service: 'workbuddy-bridge',
      exe: exe || null,
      accounts: acctCount,
      model: Pool.currentModel(),
    });
    return;
  }

  // 模型列表
  if (url === '/v1/models' && req.method === 'GET') {
    const models = (Pool.listModels ? Pool.listModels() : []).map(m => ({
      id: m.id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'workbuddy',
      name: m.name,
    }));
    // auto 排前面
    models.sort((a, b) => (a.id === 'auto' ? -1 : b.id === 'auto' ? 1 : 0));
    sendJSON(res, 200, { object: 'list', data: models });
    return;
  }

  // 对话
  if (url === '/v1/chat/completions' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      sendJSON(res, 400, { error: { message: e.message, type: 'invalid_request_error' } });
      return;
    }

    const messages = body.messages;
    if (!Array.isArray(messages) || !messages.length) {
      sendJSON(res, 400, { error: { message: 'messages 不能为空', type: 'invalid_request_error' } });
      return;
    }

    const model = body.model || Pool.currentModel() || 'auto';
    const stream = body.stream === true;
    const t0 = Date.now();

    try {
      const wbMsgs = toWbMessages(messages);
      log('→ chat model=' + model + ' msgs=' + wbMsgs.length + ' stream=' + stream);

      const r = await wb.chatWithPool(wbMsgs, { model });
      const text = String(r.text || '');
      const elapsed = Date.now() - t0;

      log('← ok model=' + (r.model || model) + ' len=' + text.length + ' ' + elapsed + 'ms');

      // 估算 token
      const promptTok = roughTokens(JSON.stringify(wbMsgs));
      const compTok = roughTokens(text);
      const id = 'chatcmpl-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const created = Math.floor(Date.now() / 1000);

      if (!stream) {
        sendJSON(res, 200, {
          id,
          object: 'chat.completion',
          created,
          model: r.model || model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: promptTok,
            completion_tokens: compTok,
            total_tokens: promptTok + compTok,
          },
        });
        return;
      }

      // ── 流式（SSE）──
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      const send = (obj) => res.write('data: ' + JSON.stringify(obj) + '\n\n');

      // 首帧：role
      send({
        id, object: 'chat.completion.chunk', created, model: r.model || model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      });

      // 正文分块（直接一次性给也行，但分块更像真的流式，客户端兼容更好）
      const CHUNK = 60;
      for (let i = 0; i < text.length; i += CHUNK) {
        send({
          id, object: 'chat.completion.chunk', created, model: r.model || model,
          choices: [{ index: 0, delta: { content: text.slice(i, i + CHUNK) }, finish_reason: null }],
        });
      }

      // 末帧
      send({
        id, object: 'chat.completion.chunk', created, model: r.model || model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: promptTok, completion_tokens: compTok, total_tokens: promptTok + compTok },
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e) {
      const msg = String(e.message || e);
      log('✗ 错误: ' + msg.split('\n')[0]);

      if (res.headersSent) {
        // 已经在流式里了，只能发一个错误块再结束
        try {
          res.write('data: ' + JSON.stringify({
            error: { message: msg, type: 'upstream_error' },
          }) + '\n\n');
          res.write('data: [DONE]\n\n');
        } catch (e2) {}
        res.end();
      } else {
        sendJSON(res, e.status || 500, {
          error: {
            message: msg,
            type: e.isAuthError ? 'authentication_error' : 'upstream_error',
            code: e.code || '',
          },
        });
      }
    }
    return;
  }

  sendJSON(res, 404, { error: { message: '不支持的端点: ' + url, type: 'invalid_request_error' } });
});

server.listen(PORT, '127.0.0.1', () => {
  log('══════════════════════════════════════════');
  log(' WorkBuddy → OpenAI 兼容桥');
  log(' 地址: http://127.0.0.1:' + PORT + '/v1');
  log(' 模型: http://127.0.0.1:' + PORT + '/v1/models');
  log(' 健康: http://127.0.0.1:' + PORT + '/health');
  log('══════════════════════════════════════════');
  const exe = wb.findExe();
  log('WorkBuddy: ' + (exe || '未找到'));
  wb.loadAccounts().then(a => log('账号: ' + a.length + ' 个')).catch(() => {});
});

process.on('SIGINT', () => { log('退出'); process.exit(0); });
process.on('SIGTERM', () => { log('退出'); process.exit(0); });
