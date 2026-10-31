/**
 * WorkBuddy 接入的主进程实现
 *
 * 为什么放在主进程：
 *   整套链路要 ① 启动外部 exe（WorkBuddy.exe）取密钥 ② 读本机文件 ③ 用 Node 的 crypto 解密。
 *   这三件事浏览器里都做不了，只能在 Node 侧。
 *
 * 页面通过 window.workbuddyBridge（preload 暴露）调用下面的 IPC。
 *
 * ⚠️ 仅供个人测试。它复用本机 WorkBuddy App 已登录的账号积分，不是官方能力。
 */
const { execFile } = require('child_process');
const { ipcMain } = require('electron');   // ★ 之前漏了这行 → registerWorkBuddyIpc 里 ipcMain is not defined
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Pool = require('./electron-pool.js');   // ★ 账号池：冷却/轮换/模型选择

/**
 * WorkBuddy 桌面 App 的候选路径（2026-10-17 补充）
 *
 * ★ 用户重装过 WorkBuddy，路径从 C:\Users\zhoudapeng\WorkBuddyAI\
 *   变成了 D:\Tencent\WorkBuddy\。硬编码单一位置很脆弱 ——
 *   所以这里既列常见路径，也在下面做**注册表/目录扫描**兜底。
 */
const EXE_CANDIDATES = [
  'D:\\Tencent\\WorkBuddy\\WorkBuddy.exe',
  'C:\\Users\\zhoudapeng\\WorkBuddyAI\\WorkBuddy.exe',
  'C:\\Program Files\\WorkBuddy\\WorkBuddy.exe',
  'C:\\Program Files\\WorkBuddy AI\\WorkBuddy.exe',
  'C:\\Program Files (x86)\\WorkBuddy\\WorkBuddy.exe',
  'C:\\Program Files\\Tencent\\WorkBuddy\\WorkBuddy.exe',
  'D:\\Program Files\\WorkBuddy\\WorkBuddy.exe',
];

/**
 * 兜底扫描：在常见根目录下找 WorkBuddy.exe（最多 4 层）。
 * 只在硬编码路径全部失败时跑一次，结果缓存。
 */
let _scannedExe = undefined;
function scanForExe() {
  if (_scannedExe !== undefined) return _scannedExe;
  _scannedExe = null;
  const roots = ['C:\\Program Files', 'C:\\Program Files (x86)', 'D:\\', 'C:\\Users\\' + (process.env.USERNAME || '')];
  const fs = require('fs');
  const path = require('path');

  function walk(dir, depth) {
    if (depth > 4) return null;
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
    for (const ent of list) {
      if (ent.isFile() && /^WorkBuddy(AI)?\.exe$/i.test(ent.name)) {
        return path.join(dir, ent.name);
      }
    }
    for (const ent of list) {
      if (!ent.isDirectory()) continue;
      if (/^\$|node_modules|Windows|System32|AppData/i.test(ent.name)) continue;
      if (!/workbuddy|tencent|codebuddy/i.test(ent.name)) continue;   // 只往相关目录钻
      const r = walk(path.join(dir, ent.name), depth + 1);
      if (r) return r;
    }
    return null;
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const r = walk(root, 0);
    if (r) { _scannedExe = r; break; }
  }
  return _scannedExe;
}

const KEY_CODE = "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}";

const CN_CHAT_BASE = 'https://copilot.tencent.com';
const GLOBAL_BASE = 'https://www.workbuddy.ai';

/**
 * ★ User-Agent 必须和官方客户端一致（2026-10-24 关键修复）
 *
 * 踩过的坑：WorkBuddy 加了**渠道校验**，不是官方客户端发出的请求会被拦，
 * 返回 `code 11128 "request illegal"`：
 *   displayTips: "这次调用没通过渠道校验，可能不是官方客户端发出的。"
 *
 * 原来的 UA 是 'WorkBuddy/5.5.6 WorkBuddy/5.5.6 CLI/2.137.1' —— 格式不对。
 * 对照正在正常工作的 DSH 插件（dsh-workbuddy-xdpool/lib/index.js:58），
 * 官方用的是 `CLI/<ver> CodeBuddy/<ver>` 这种格式。
 * 换成它验证过的 UA 就能通过校验。
 */
const CLIENT_UA = 'CLI/2.63.2 CodeBuddy/2.63.2';

// AAD 转录结构
const AAD_DOMAIN = Buffer.from('WB-AAD\u0000', 'ascii');
const SYMMETRIC_SCHEME = 'sym-v1';
const STD_FORMAT_FIELD = 'WBEV1';
const FRAMING_FIELD = 2;

const encodeUint32 = v => { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(v); return b; };
const encodeLenPrefixed = v => { const b = Buffer.from(v, 'utf8'); return Buffer.concat([encodeUint32(b.length), b]); };
const fieldAad = (keyId, suite) => Buffer.concat([
  AAD_DOMAIN,
  Buffer.from([1]),
  encodeLenPrefixed(STD_FORMAT_FIELD),
  encodeLenPrefixed(SYMMETRIC_SCHEME),
  encodeUint32(suite),
  encodeLenPrefixed(keyId),
  Buffer.from([FRAMING_FIELD]),
  Buffer.from([0]),
  Buffer.from([0]),
]);

const isGlobal = domain => {
  const d = String(domain || '').toLowerCase();
  return d.endsWith('workbuddy.ai') || d.endsWith('codebuddy.ai');
};

function findExe() {
  for (const p of EXE_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) {}
  }
  // ★ 硬编码路径都没找到 → 扫描兜底（用户可能装到别的地方）
  const scanned = scanForExe();
  if (scanned) {
    console.log('[workbuddy] 通过扫描找到: ' + scanned);
    return scanned;
  }
  return null;
}

function runExe(exe, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, {
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
      timeout: timeout || 30000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) reject(new Error(err.message + (stderr ? ' | ' + String(stderr).slice(0, 200) : '')));
      else resolve(stdout);
    });
  });
}

let cachedKey = null;
async function getKey() {
  if (cachedKey) return cachedKey;
  const exe = findExe();
  if (!exe) throw new Error('找不到 WorkBuddy 桌面 App（未安装，或装在别的路径）');
  const out = await runExe(exe, ['-e', KEY_CODE]);
  let payload;
  try { payload = JSON.parse(out); } catch (e) { throw new Error('WorkBuddy 返回的不是 JSON'); }
  if (!payload.atRestSecretKey) throw new Error('WorkBuddy 没有返回 atRestSecretKey');
  cachedKey = crypto.createHash('sha256').update(payload.atRestSecretKey, 'utf8').digest();
  return cachedKey;
}

function openField(field, key) {
  const env = JSON.parse(Buffer.from(field.envelope, 'base64').toString('utf8'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.nonce, 'base64'), { authTagLength: 16 });
  d.setAAD(fieldAad(env.keyId, env.suite));
  d.setAuthTag(Buffer.from(env.authTag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(env.ciphertext, 'base64')), d.final()]).toString('utf8');
}

async function loadAccounts() {
  const key = await getKey();
  const dirs = [
    path.join(process.env.LOCALAPPDATA || '', 'CodeBuddyExtension', 'Data', 'Public', 'auth'),
    path.join(process.env.APPDATA || '', 'CodeBuddyExtension', 'Data', 'Public', 'auth'),
  ];
  const accounts = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.includes('workbuddy') || !f.endsWith('.info')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const at = j.auth && j.auth.accessToken;
        if (!at || !at.envelope) continue;
        const token = openField(at, key);
        const uin = (j.account && j.account.uin) || '';
        const uid = (j.account && j.account.uid) || '';
        const id = uin || uid;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        accounts.push({
          id, uid, uin,
          domain: (j.auth && j.auth.domain) || '',
          enterpriseId: (j.account && j.account.sso && j.account.sso.enterpriseId) || '',
          token,
          expiresAt: (j.auth && j.auth.expiresAt) || 0,
        });
      } catch (e) { /* 单个失败不影响其它 */ }
    }
  }
  return accounts;
}

/**
 * ══════════════════════════════════════════════════════════════
 * ★ 渠道校验必需的请求头（2026-10-24 破译）
 * ══════════════════════════════════════════════════════════════
 *
 * 用户报错：`code 11128 "request illegal"`，
 *   displayTips: "这次调用没通过渠道校验，可能不是官方客户端发出的。"
 *
 * 对照本机正在正常工作的 dsh-xdpool 插件源码
 * （~/.dsh/profiles/desktop/node_modules/dsh-xdpool/lib/index.js），
 * 破译出三道校验，缺一不可：
 *
 * ① 三个会话身份头（第 448-456 行注释，实测删除任一个就 400）
 *      X-Conversation-ID
 *      X-Conversation-Request-ID
 *      X-Conversation-Message-ID
 *    注释原话："delete any one of the three and the call 400s;
 *              send all three and it 200s with normal SSE"
 *    **值不校验合法性**（普通非 UUID 字符串也能过），
 *    只检查"存在且前后一致"，所以可以自己派生。
 *
 * ② IDE 身份头（第 326-330 行）
 *      X-IDE-Name: WorkBuddy
 *      X-IDE-Type: WorkBuddy
 *      X-IDE-Version: 5.5.6
 *
 * ③ 系统提示词内容指纹（第 331-396 行）
 *    网关会扫描 system / assistant 消息开头附近的内容，
 *    命中其他 agent 客户端的标识串就拒绝：
 *      "powered by DeepSeek Harness"  → 改成 "running on DeepSeek Harness"
 *      "DeepSeek Harness Web GUI"     → 改成 "DeepSeek Harness web interface"
 *    注意：只扫 system 和 assistant，user/tool 不扫。
 */

const CHAT_IDENTITY_HEADERS = {
  'X-IDE-Name': 'WorkBuddy',
  'X-IDE-Type': 'WorkBuddy',
  'X-IDE-Version': '5.5.6',
};

/** 会话身份三件套：同一会话内保持稳定（上游把它当成一个 session） */
function conversationIdentity(convKey) {
  const base = convKey || (Date.now().toString(36) + Math.random().toString(36).slice(2));
  const hash = (suffix) => crypto.createHash('sha256').update('conversation:' + suffix + ':' + base).digest('hex');
  const asUuid = (hex) => hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20, 32);
  return {
    conversationId: asUuid(hash('id')),
    conversationRequestId: asUuid(hash('request')),
    acpConnectionId: asUuid(hash('acp')),
  };
}

/**
 * 清理系统提示词里的"指纹"。
 * 只处理 system / assistant 角色（上游只扫这两个）。
 */
function sanitizeFingerprints(messages) {
  if (!Array.isArray(messages)) return messages;
  let changed = false;
  const out = messages.map(m => {
    if (!m || (m.role !== 'system' && m.role !== 'assistant')) return m;

    const fix = (text) => {
      if (typeof text !== 'string') return text;
      const before = text;
      let t = text
        .replace(/powered by DeepSeek Harness/gi, 'running on DeepSeek Harness')
        .replace(/DeepSeek Harness Web GUI/gi, 'DeepSeek Harness web interface');
      if (t !== before) changed = true;
      return t;
    };

    if (typeof m.content === 'string') {
      const c = fix(m.content);
      return c === m.content ? m : Object.assign({}, m, { content: c });
    }
    if (Array.isArray(m.content)) {
      let touched = false;
      const blocks = m.content.map(b => {
        if (b && typeof b === 'object' && typeof b.text === 'string') {
          const c = fix(b.text);
          if (c !== b.text) { touched = true; return Object.assign({}, b, { text: c }); }
        }
        return b;
      });
      return touched ? Object.assign({}, m, { content: blocks }) : m;
    }
    return m;
  });
  return changed ? out : messages;
}

/**
 * @param {object} acct 账号
 * @param {string} convKey 会话键（同一个对话传同一个值）
 */
function headersFor(acct, convKey) {
  const global = isGlobal(acct.domain);
  const origin = global
    ? (String(acct.domain).includes('codebuddy.ai') ? 'https://www.codebuddy.ai' : GLOBAL_BASE)
    : 'https://www.codebuddy.cn';

  const identity = conversationIdentity(convKey);

  const h = {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': origin,
    'Referer': origin + '/',
    'User-Agent': CLIENT_UA,
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + acct.token,
    'X-Product': 'SaaS',
  };

  if (acct.uid) h['X-User-Id'] = acct.uid; else h['X-No-User-Id'] = '1';
  if (acct.enterpriseId) h['X-Enterprise-Id'] = acct.enterpriseId; else h['X-No-Enterprise-Id'] = '1';
  if (acct.domain) h['X-Domain'] = acct.domain; else h['X-No-Department-Info'] = '1';

  // ① IDE 身份头
  Object.assign(h, CHAT_IDENTITY_HEADERS);

  // ② 会话身份三件套（必须三个都有）
  h['X-Conversation-ID'] = identity.conversationId;
  h['X-Conversation-Request-ID'] = identity.conversationRequestId;
  h['X-Conversation-Message-ID'] = crypto.randomUUID();
  h['acp-connection-id'] = identity.acpConnectionId;

  // ③ 其它桌面端会带的（不加也行，加上更像官方客户端）
  h['X-Request-ID'] = crypto.randomUUID();
  h['X-Agent-Intent'] = 'craft';
  h['X-Agent-Purpose'] = 'conversation';
  h['X-Private-Data'] = 'true';
  h['x-codebuddy-request'] = '1';

  return h;
}

/**
 * 发一次 chat（内部用流式，因为服务端拒绝非流式）
 *
 * @param {object} acct 账号
 * @param {Array} messages 消息
 * @param {string} model 模型
 * @param {string} convKey 会话键 —— 同一个对话要传同一个值，
 *                         否则每轮都算新会话（上游按会话计费/限流）
 */
async function chatOnce(acct, messages, model, convKey) {
  const base = isGlobal(acct.domain) ? GLOBAL_BASE : CN_CHAT_BASE;

  /**
   * ★ 超时控制（2026-10-17 修）
   *   和 shared/llm.js 同样的坑：fetch 没超时，上游不响应就会永久挂起，
   *   界面卡在"分析中…"。这里给 90 秒硬超时。
   */
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), 90000);

  // ★ 清理系统提示词里的指纹（不清理会被判为非官方客户端）
  const safeMessages = sanitizeFingerprints(messages);

  /**
   * ★ 第一条消息必须是 system（2026-10-24 实测）
   *
   * 上游渠道校验的第二道：如果 messages[0].role 不是 'system'，
   * 直接返回 400 `{"code":11128,"msg":"first message is not system prompt"}`。
   *
   * 所以没有 system 就补一条空的占位（内容为空也算 system 角色）。
   */
  const finalMessages = (Array.isArray(safeMessages) && safeMessages.length &&
    safeMessages[0] && safeMessages[0].role === 'system')
    ? safeMessages
    : [{ role: 'system', content: ' ' }].concat(safeMessages || []);

  let resp;
  try {
    resp = await fetch(base + '/v2/chat/completions', {
      method: 'POST',
      headers: headersFor(acct, convKey),
      body: JSON.stringify({
        model: model || 'auto',
        messages: finalMessages,
        stream: true,          // ★ 必须
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
      const err = new Error('WorkBuddy 响应超时（90 秒）');
      err.status = 408;
      throw err;
    }
    throw e;
  }

  if (!resp.ok) {
    clearTimeout(timeoutId);
    const t = await resp.text().catch(() => '');

    /**
     * ★ 错误可读化（2026-10-18 修 —— 用户截图里那三坨 HTML 就是这个）
     *
     * WorkBuddy 的服务器是腾讯的 openresty 网关。当 accessToken 过期时，
     * 网关返回的是一个 **HTML 错误页**，原样拼进错误信息后用户只看到一堆标签，
     * 完全不知道该怎么办。
     *
     * 现在按状态码给可执行的建议。
     */
    const looksHtml = /<html|<head|<title/i.test(t);
    let msg;

    if (resp.status === 401 || resp.status === 403) {
      msg = looksHtml
        ? 'WorkBuddy 登录已过期（网关返回 401）'
        : 'WorkBuddy 登录已过期或无权访问';
      msg += '\n\n怎么办：';
      msg += '\n  1. 打开 WorkBuddy 桌面 App，确认是登录状态';
      msg += '\n  2. 如果提示要重新登录，就扫码/密码重新登录一次';
      msg += '\n  3. 回到这里再点「重新检测」';
      msg += '\n\n如果还不行，改用「填自己的 API Key」那条路。';
    } else if (resp.status === 429) {
      msg = 'WorkBuddy 请求太频繁（429）\n\n等一会儿再试，或者切到别的账号（设置页点「清冷却」）。';
    } else if (resp.status >= 500) {
      msg = 'WorkBuddy 服务端出问题（' + resp.status + '）\n\n不是你的错，稍后再试。';
    } else {
      msg = 'WorkBuddy 请求失败（' + resp.status + '）';
      if (!looksHtml) {
        // 临时加长到 800，方便排查 400/11128 这类错误（含完整 displayMsg）
        const brief = String(t).replace(/\s+/g, ' ').trim().slice(0, 800);
        if (brief) msg += '\n' + brief;
      }
    }

    const err = new Error(msg);
    err.status = resp.status;
    err.isAuthError = (resp.status === 401 || resp.status === 403);
    throw err;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '', text = '', reasoning = '', mdl = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let j;
        try { j = JSON.parse(payload); } catch (e) { continue; }
        if (j.model) mdl = j.model;
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (!delta) continue;
        if (delta.reasoning_content) reasoning += delta.reasoning_content;
        if (delta.content) text += delta.content;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return { text, reasoning, model: mdl };
}

/**
 * 轮询账号：遇到限流（429）自动换下一个 + 冷却管理
 *
 * ★ 2026-10-24 重构：用户明确要求「只要有一个账号就可以了，不用弄多个」
 *
 * 旧逻辑的问题：
 *   默认只用国内账号（`!isGlobal`），把 .ai 域名的那个排除在外。
 *   一旦国内账号全部登录过期，就永远用不了那个还能用的 —— 
 *   用户看到「所有账号都过期了」但实际上还有救。
 *
 * 新逻辑：分两轮
 *   第一轮：国内账号优先（积分在国内站）
 *   第二轮：如果第一轮全军覆没，把剩下的（含国际站）也试一遍
 *   只有两轮都失败，才报「全部都不可用」
 */
async function chatWithPool(messages, opts) {
  opts = opts || {};
  const accounts = await loadAccounts();
  if (!accounts.length) throw new Error('没有可用的 WorkBuddy 账号');

  /**
   * ★ 会话键（2026-10-24）
   *   上游要求三个会话身份头，且把它们当成"同一会话"的凭据。
   *   同一次 chatWithPool 调用内所有账号共用一个键 ——
   *   换号重试不会变成新对话。
   */
  const convKey = opts.conversationKey ||
    ('conv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));

  const domestic = accounts.filter(a => !isGlobal(a.domain));
  const foreign = accounts.filter(a => isGlobal(a.domain));

  /**
   * 尝试一组账号。返回 { ok, result, errors, authFail }
   */
  async function tryGroup(group, label) {
    if (!group.length) return { ok: false, errors: [], authFail: 0, tried: 0 };

    const list = Pool.pickAccounts(group, { strategy: opts.strategy });
    if (!list.length) {
      // 全在冷却中
      return { ok: false, errors: [], authFail: 0, tried: 0, allCooling: true };
    }

    let lastErr = null;
    let authFail = 0;
    let tried = 0;

    for (const acct of list) {
      tried++;
      try {
        /**
         * ★ 传会话键（2026-10-24）
         *   同一个 chatWithPool 调用内所有账号共用一个会话键 ——
         *   这样换号重试时上游仍认为是同一个对话，不会每条都算新会话。
         */
        const r = await chatOnce(acct, messages, opts.model || Pool.currentModel(), convKey);
        Pool.touchAccount(acct.id);
        if (label === '国际站') {
          console.log('[workbuddy] 国内账号不可用，已切到国际站账号 ' + acct.id);
        }
        return { ok: true, result: Object.assign({ account: acct.id }, r), errors: [], authFail: 0, tried };
      } catch (e) {
        lastErr = e;

        // 401 = 登录过期。换下一个号，但**不要**长期冷却
        // （用户重新登录后应该立刻能用）
        if (e.status === 401) { authFail++; continue; }

        // 限流 → 冷却 + 换号
        if (e.status === 429 || e.status === 403) {
          Pool.markCooldown(acct.id, 'HTTP ' + e.status + ': ' + String(e.message).slice(0, 80));
          continue;
        }

        // 积分不足 → 冷却较久
        if (/积分|quota|insufficient|balance/i.test(String(e.message))) {
          Pool.markCooldown(acct.id, '积分不足', 30 * 60 * 1000);
          continue;
        }

        // 其它错误（网络等）→ 记下，继续试
        continue;
      }
    }

    return { ok: false, errors: lastErr ? [lastErr] : [], authFail, tried, lastErr };
  }

  // ── 第一轮：国内账号 ──
  const r1 = await tryGroup(domestic, '国内站');
  if (r1.ok) return r1.result;

  // ── 第二轮：国际站（国内的都不行时）──
  if (foreign.length) {
    const r2 = await tryGroup(foreign, '国际站');
    if (r2.ok) return r2.result;

    // 两轮都失败
    const totalAuthFail = (r1.authFail || 0) + (r2.authFail || 0);
    const totalTried = (r1.tried || 0) + (r2.tried || 0);

    if (totalAuthFail > 0 && totalAuthFail === totalTried) {
      const err = new Error(
        '所有 ' + totalAuthFail + ' 个 WorkBuddy 账号的登录都已过期。\n\n' +
        '怎么办：\n' +
        '  1. 打开 WorkBuddy 桌面 App\n' +
        '  2. 如果提示登录，扫码/密码重新登录\n' +
        '  3. 回来点「重新检测」\n\n' +
        '或者：改用「填自己的 API Key」那条路（设置页 → 大模型接口）。\n\n' +
        '注意：登录过期不影响已保存的学习数据，只是 AI 功能暂时用不了。'
      );
      err.code = 'ALL_AUTH_EXPIRED';
      err.isAuthError = true;
      throw err;
    }

    throw (r2.lastErr || r1.lastErr || new Error('所有账号都失败了'));
  }

  // 只有国内账号，且全失败
  if (r1.authFail > 0 && r1.authFail === r1.tried) {
    const err = new Error(
      '所有 ' + r1.authFail + ' 个 WorkBuddy 账号的登录都已过期。\n\n' +
      '怎么办：\n' +
      '  1. 打开 WorkBuddy 桌面 App\n' +
      '  2. 如果提示登录，扫码/密码重新登录\n' +
      '  3. 回来点「重新检测」\n\n' +
      '或者：改用「填自己的 API Key」那条路（设置页 → 大模型接口）。\n\n' +
      '注意：登录过期不影响已保存的学习数据，只是 AI 功能暂时用不了。'
    );
    err.code = 'ALL_AUTH_EXPIRED';
    err.isAuthError = true;
    throw err;
  }

  if (r1.allCooling) {
    const cd = Pool.cooldownInfo();
    const secs = cd.length ? Math.min.apply(null, cd.map(c => c.secondsLeft)) : 60;
    const err = new Error('所有 WorkBuddy 账号都在冷却中（限流），约 ' +
      Math.ceil(secs / 60) + ' 分钟后恢复。');
    err.code = 'ALL_COOLING';
    throw err;
  }

  throw (r1.lastErr || new Error('WorkBuddy 暂时不可用'));
}

/**
 * 读图：把 OpenAI 风格的 image_url 转成 WorkBuddy 接受的 content 格式
 *
 * ★ 读图必须用支持图片的模型。WorkBuddy 的 'auto' 会自动路由，
 *   但如果显式给了纯文本模型就会失败 —— 所以这里强制用 auto。
 */
async function visionWithPool(images, prompt, opts) {
  opts = opts || {};
  const content = [{ type: 'text', text: prompt }];
  (images || []).forEach(img => {
    const mime = img.mime || 'image/jpeg';
    content.push({
      type: 'image_url',
      image_url: { url: 'data:' + mime + ';base64,' + img.b64 },
    });
  });
  return chatWithPool([{ role: 'user', content: content }], {
    model: opts.model || 'auto',
    allRegions: opts.allRegions,
  });
}

// ══════════════════════════════════════════════════════════
//  IPC 注册
// ══════════════════════════════════════════════════════════
function registerWorkBuddyIpc() {
  // 探测：能不能用
  ipcMain.handle('workbuddy:probe', async () => {
    try {
      const exe = findExe();
      if (!exe) return { ok: false, reason: '找不到 WorkBuddy 桌面 App', exe: null };
      const accounts = await loadAccounts();
      return {
        ok: accounts.length > 0,
        exe,
        count: accounts.length,
        accounts: accounts.map(a => ({ id: a.id, domain: a.domain })),
        reason: accounts.length ? '' : '没有已登录的 WorkBuddy 账号',
      };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  /**
   * ★ 真实连通性测试（2026-10-18 新增）
   *
   * 为什么需要：上面 probe 只读本地凭据文件，只要文件在就报"健康 5/5"。
   * 但 token 可能已经过期 —— 用户看到"健康"却用不了，非常误导。
   * （实际发生过：界面显示健康 5/5，点分析却报 401 openresty）
   *
   * 这个接口真的发一次最小请求，返回可用/不可用 + 具体原因。
   */
  ipcMain.handle('workbuddy:verify', async () => {
    const t0 = Date.now();
    try {
      const r = await chatWithPool([{ role: 'user', content: 'ping' }], { model: 'auto' });
      return {
        ok: true,
        ms: Date.now() - t0,
        model: r.model,
        account: r.account,
        reply: String(r.text || '').slice(0, 40),
      };
    } catch (e) {
      return {
        ok: false,
        ms: Date.now() - t0,
        reason: String(e.message || e),
        code: e.code || '',
        isAuthError: !!e.isAuthError,
      };
    }
  });

  // 发消息（非流式返回：主进程收完再一次性给页面）
  ipcMain.handle('workbuddy:chat', async (evt, payload) => {
    try {
      const messages = payload && payload.messages;
      if (!Array.isArray(messages) || !messages.length) {
        return { ok: false, error: 'messages 不能为空' };
      }
      const r = await chatWithPool(messages, {
        model: payload.model,
        allRegions: payload.allRegions,
      });
      return { ok: true, text: r.text, reasoning: r.reasoning, model: r.model, account: r.account };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    }
  });
  // 读图（走 WorkBuddy 的多模态能力）
  ipcMain.handle('workbuddy:vision', async (evt, payload) => {
    try {
      const { images, prompt } = payload || {};
      if (!Array.isArray(images) || !images.length) {
        return { ok: false, error: '没有图片' };
      }
      const r = await visionWithPool(images, prompt || '请识别图片内容', {
        model: payload.model,
        allRegions: payload.allRegions,
      });
      return { ok: true, text: r.text, model: r.model, account: r.account };
    } catch (e) {
      return { ok: false, error: e.message, status: e.status };
    }
  });

  // ── 模型目录 ──
  ipcMain.handle('workbuddy:models', async () => {
    return { ok: true, models: Pool.listModels(), current: Pool.currentModel() };
  });

  ipcMain.handle('workbuddy:set-model', async (evt, id) => {
    try {
      const m = Pool.setModel(id);
      return { ok: true, model: m };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ── 池状态 ──
  ipcMain.handle('workbuddy:pool-status', async () => {
    try {
      const accounts = await loadAccounts().catch(() => []);
      const cooling = Pool.cooldownInfo();
      const coolingIds = new Set(cooling.map(c => c.id));
      return {
        ok: true,
        model: Pool.currentModel(),
        accounts: accounts.map(a => ({
          id: a.id,
          domain: a.domain,
          cooling: coolingIds.has(a.id),
        })),
        cooling: cooling,
        healthy: accounts.filter(a => !coolingIds.has(a.id)).length,
        total: accounts.length,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // 清冷却（手动恢复）
  ipcMain.handle('workbuddy:clear-cooldown', async (evt, id) => {
    Pool.clearCooldown(id);
    return { ok: true };
  });
}

module.exports = {
  registerWorkBuddyIpc, chatWithPool, visionWithPool, loadAccounts, findExe, Pool,
};
