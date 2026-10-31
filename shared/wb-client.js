/**
 * WorkBuddy 接入（页面侧）
 *
 * 页面不能直接调 exe 或解密，所以真正的实现在 Electron 主进程里，
 * 这里只做三件事：
 *   ① 记住"是否启用"（存 localStorage，跨会话保留）
 *   ② 提供 chat() 统一入口，包一层 workbuddyBridge
 *   ③ 在浏览器（非桌面应用）里自动禁用，不报错
 *
 * ⚠️ 自用测试性质：复用本机 WorkBuddy App 的登录态与积分，非官方能力。
 */
const WB = (() => {
  const KEY = 'workbuddy_enabled';

  function bridge() {
    try { return window.workbuddyBridge || null; } catch (e) { return null; }
  }

  /** 当前环境支不支持（只有桌面应用里有桥） */
  function available() {
    return !!bridge();
  }

  /** 是否已启用（浏览器里永远 false） */
  function isEnabled() {
    if (!available()) return false;
    try { return Storage.get(KEY, false) === true; } catch (e) { return false; }
  }

  function setEnabled(v) {
    try { Storage.set(KEY, !!v); } catch (e) {}
  }

  /** 探测本机账号 */
  async function probe() {
    const b = bridge();
    if (!b) return { ok: false, reason: '这不是桌面应用（浏览器里用不了）' };
    try {
      return await b.probe();
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
   * ★ 真实连通性测试（2026-10-18 新增）
   *
   * probe() 只读本地凭据文件，token 过期也会显示"健康"。
   * 这个函数真的发一次请求，能发现"看起来健康但用不了"的情况。
   *
   * @returns {{ok:boolean, ms:number, model?:string, reply?:string, reason?:string, code?:string, isAuthError?:boolean}}
   */
  async function verify() {
    const b = bridge();
    if (!b) return { ok: false, reason: '这不是桌面应用（浏览器里用不了）' };
    if (typeof b.verify !== 'function') {
      return { ok: false, reason: '当前版本不支持连通性检测' };
    }
    try {
      return await b.verify();
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  /**
   * 发一次对话。
   * @returns {{text:string, model:string, account:string}}
   */
  async function chat(messages, opts) {
    const b = bridge();
    if (!b) throw new Error('WorkBuddy 只能在桌面应用里用');
    opts = opts || {};

    // ★ 模型优先级：调用方指定 > 用户选的 > auto
    const model = opts.model || currentModel() || 'auto';

    const r = await b.chat({
      messages: messages,
      model: model,
    });

    if (!r || !r.ok) {
      const err = new Error((r && r.error) || 'WorkBuddy 调用失败');
      err.code = r && r.status;
      throw err;
    }
    return {
      text: r.text || '',
      reasoning: r.reasoning || '',
      model: r.model || model,
      account: r.account || '',
    };
  }

  /**
   * 读图（识别试卷）
   * @param {Array<{mime:string,b64:string}>} images
   * @param {string} prompt
   */
  async function vision(images, prompt, opts) {
    const b = bridge();
    if (!b) throw new Error('WorkBuddy 只能在桌面应用里用');
    opts = opts || {};
    const r = await b.vision({
      images: (images || []).map(i => ({ mime: i.mime || 'image/jpeg', b64: i.b64 })),
      prompt: prompt,
      model: opts.model || 'auto',
    });
    if (!r || !r.ok) throw new Error((r && r.error) || 'WorkBuddy 读图失败');
    return { text: r.text || '', model: r.model || '', account: r.account || '' };
  }

  // ── 模型选择 ──
  let _modelsCache = null;
  async function models() {
    const b = bridge();
    if (!b) return { ok: false, models: [] };
    if (_modelsCache) return _modelsCache;
    try {
      _modelsCache = await b.models();
      return _modelsCache;
    } catch (e) {
      return { ok: false, error: e.message, models: [] };
    }
  }
  async function setModel(id) {
    const b = bridge();
    if (!b) return { ok: false };
    _modelsCache = null;
    return await b.setModel(id);
  }
  function currentModel() {
    try { return Storage.get('workbuddy_model', 'auto') || 'auto'; } catch (e) { return 'auto'; }
  }

  // ── 池状态 ──
  async function poolStatus() {
    const b = bridge();
    if (!b) return { ok: false, accounts: [], cooling: [] };
    try { return await b.poolStatus(); } catch (e) { return { ok: false, error: e.message }; }
  }
  async function clearCooldown(id) {
    const b = bridge();
    if (!b) return;
    try { await b.clearCooldown(id); } catch (e) {}
  }

  return {
    available, isEnabled, setEnabled, probe, verify, chat, vision,
    models, setModel, currentModel, poolStatus, clearCooldown,
  };
})();
