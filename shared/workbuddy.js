/**
 * WorkBuddy 免费 Token 接入（自用测试）
 *
 * ⚠️ 仅供个人测试、减少 Token 开销使用。
 *    它复用本机 WorkBuddy 桌面 App 已登录的账号与积分，
 *    不是官方支持的能力；平台改接口/风控时可能失效。
 *
 * 已验证的链路（2026-10-17）：
 *   ① 用 WorkBuddy.exe 的 native binding 取 at-rest 密钥
 *      execFile(exe, ['-e', "process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()"], { env: { ELECTRON_RUN_AS_NODE: '1' } })
 *   ② 用 sha256(atRestSecretKey) 派生 32 字节密钥，再 sha256(key) 取前 16 位 hex 当 keyId
 *   ③ AES-256-GCM 解开凭据文件里的 accessToken（AAD 是特定转录结构，见 fieldAad）
 *   ④ POST https://copilot.tencent.com/v2/chat/completions
 *      ★ 必须 stream: true —— 服务端明确拒绝非流式（code 11101）
 *   ⑤ 返回是 SSE（data: {...} 每行一个 chunk）
 */
const WorkBuddy = (() => {
  const EXE_CANDIDATES = [
    'C:\\Users\\zhoudapeng\\WorkBuddyAI\\WorkBuddy.exe',
    'C:\\Program Files\\WorkBuddy\\WorkBuddy.exe',
    'C:\\Program Files\\WorkBuddy AI\\WorkBuddy.exe',
  ];

  const KEY_CODE = "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch(e){process.exitCode=3;process.stderr.write(String(e&&e.message||e))}";

  const CN_CHAT_BASE = 'https://copilot.tencent.com';
  const GLOBAL_BASE = 'https://www.workbuddy.ai';
  const CLIENT_UA = 'WorkBuddy/5.5.6 WorkBuddy/5.5.6 CLI/2.137.1';

  // ── AAD 转录结构（复刻自插件，缺一字节都解不开）──
  const AAD_DOMAIN = Buffer.from('WB-AAD\u0000', 'ascii');
  const SYMMETRIC_SCHEME = 'sym-v1';
  const STD_FORMAT_FIELD = 'WBEV1';
  const FRAMING_FIELD = 2;

  function encodeUint32(v) { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(v); return b; }
  function encodeLenPrefixed(v) { const b = Buffer.from(v, 'utf8'); return Buffer.concat([encodeUint32(b.length), b]); }
  function fieldAad(keyId, suite) {
    return Buffer.concat([
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
  }

  function isGlobal(domain) {
    const d = String(domain || '').toLowerCase();
    return d.endsWith('workbuddy.ai') || d.endsWith('codebuddy.ai');
  }

  function findExe() {
    const fs = require('fs');
    for (const p of EXE_CANDIDATES) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
    return null;
  }

  function run(exe, args, timeout) {
    return new Promise((resolve, reject) => {
      const { execFile } = require('child_process');
      execFile(exe, args, {
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
        timeout: timeout || 30000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        if (err) reject(new Error(err.message + (stderr ? ' ' + String(stderr).slice(0, 200) : '')));
        else resolve(stdout);
      });
    });
  }

  /** 取 at-rest 密钥（缓存） */
  let cachedKey = null;
  async function getKey() {
    if (cachedKey) return cachedKey;
    const exe = findExe();
    if (!exe) throw new Error('找不到 WorkBuddy 桌面 App（未安装？）');
    const out = await run(exe, ['-e', KEY_CODE]);
    const payload = JSON.parse(out);
    const secret = payload.atRestSecretKey;
    if (!secret) throw new Error('WorkBuddy 没有返回 atRestSecretKey');
    const crypto = require('crypto');
    const key = crypto.createHash('sha256').update(secret, 'utf8').digest();
    cachedKey = key;
    return key;
  }

  /** 解密一个加密字段 */
  function openField(field, key) {
    const crypto = require('crypto');
    const env = JSON.parse(Buffer.from(field.envelope, 'base64').toString('utf8'));
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.nonce, 'base64'), { authTagLength: 16 });
    d.setAAD(fieldAad(env.keyId, env.suite));
    d.setAuthTag(Buffer.from(env.authTag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(env.ciphertext, 'base64')), d.final()]).toString('utf8');
  }

  /** 扫描本机所有 WorkBuddy 账号 */
  async function loadAccounts() {
    const fs = require('fs');
    const path = require('path');
    const key = await getKey();

    const dirs = [
      path.join(process.env.LOCALAPPDATA || '', 'CodeBuddyExtension', 'Data', 'Public', 'auth'),
      path.join(process.env.APPDATA || '', 'CodeBuddyExtension', 'Data', 'Public', 'auth'),
    ];

    const accounts = [];
    const seen = new Set();

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.includes('workbuddy') && f.endsWith('.info'));
      for (const f of files) {
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
            id: id,
            uid: uid,
            uin: uin,
            domain: (j.auth && j.auth.domain) || '',
            enterpriseId: (j.account && j.account.sso && j.account.sso.enterpriseId) || '',
            token: token,
            expiresAt: (j.auth && j.auth.expiresAt) || 0,
            file: f,
          });
        } catch (e) { /* 单个文件失败不影响其它 */ }
      }
    }
    return accounts;
  }

  function headersFor(acct) {
    const global = isGlobal(acct.domain);
    const origin = global
      ? (String(acct.domain).includes('codebuddy.ai') ? 'https://www.codebuddy.ai' : GLOBAL_BASE)
      : 'https://www.codebuddy.cn';
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
    return h;
  }

  /** 解析 SSE 流，拼出完整文本；回调 onDelta 可实现打字机 */
  async function chatStream(acct, messages, opts) {
    opts = opts || {};
    const base = isGlobal(acct.domain) ? GLOBAL_BASE : CN_CHAT_BASE;
    const url = base + '/v2/chat/completions';

    const body = {
      model: opts.model || 'auto',
      messages: messages,
      stream: true,            // ★ 必须：非流式被服务端拒绝
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: headersFor(acct),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      const err = new Error('WorkBuddy 返回 HTTP ' + resp.status + ': ' + t.slice(0, 200));
      err.status = resp.status;
      throw err;
    }

    // ── 逐行解析 SSE ──
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let text = '';
    let reasoning = '';
    let model = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();                 // 最后一行可能不完整，留到下次
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        let j;
        try { j = JSON.parse(payload); } catch (e) { continue; }
        if (j.model) model = j.model;
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (!delta) continue;
        if (delta.reasoning_content) reasoning += delta.reasoning_content;
        if (delta.content) {
          text += delta.content;
          if (opts.onDelta) { try { opts.onDelta(delta.content, text); } catch (e) {} }
        }
      }
    }
    return { text: text, reasoning: reasoning, model: model };
  }

  /** 探测：能不能用（不消耗积分 —— 只查账号和密钥） */
  async function probe() {
    try {
      const exe = findExe();
      if (!exe) return { ok: false, reason: '找不到 WorkBuddy 桌面 App' };
      const accounts = await loadAccounts();
      if (!accounts.length) return { ok: false, reason: '没有找到已登录的 WorkBuddy 账号' };
      return { ok: true, accounts: accounts.map(a => ({ id: a.id, domain: a.domain })), count: accounts.length };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  return {
    probe, loadAccounts, chatStream,
    isGlobal, findExe,
    CN_CHAT_BASE, GLOBAL_BASE,
  };
})();
