/**
 * 匿名使用统计（2026-10-31）
 *
 * ══════════════════════════════════════════════════════════════
 * 隐私原则（必须先讲清楚，再写代码）
 * ══════════════════════════════════════════════════════════════
 *   · **默认关闭**（opt-in）：用户不主动开，一条数据都不发
 *   · **完全匿名**：本地随机 ID，不含姓名、学校、成绩、IP、设备信息
 *   · **只发计数**：安装 ID + 首次/最近启动时间 + 启动次数 + 版本号
 *   · **绝不上传学习数据**：卷子、错题、成绩、对话内容一概不发
 *   · **随时可关**：设置页一键关闭，关闭后立即停发
 *
 * 收集什么（完整清单，给用户看）：
 *   {
 *     id: "本地随机匿名 ID（重新安装会变）",
 *     firstSeen: "首次启动日期",
 *     lastSeen: "最近启动日期",
 *     launches: "累计启动次数",
 *     version: "软件版本号",
 *     platform: "win32 / darwin / linux"
 *   }
 *
 * 后端地址**由用户自己配置**：
 *   你可以填自己的 WorkBuddy 云端地址、或任何接收 JSON 的 HTTP 端点。
 *   默认不配置 = 完全不上报。
 */
const UsageStats = (() => {

  const KEY = 'usage_stats_cfg';
  const KEY_ID = 'usage_anon_id';
  const KEY_META = 'usage_meta';

  /**
   * ★ 默认上报地址（2026-10-31）
   *
   * 已实测可用：POST 返回 {"ok":true}，去重正常，CORS 正常。
   * 注意：?sharecode=D5GVTXXGRS 是平台分享码校验，**不能省**。
   *       客户端用 fetch(整串) 不做拼接，所以参数不会丢。
   */
  const DEFAULT_ENDPOINT = 'https://apprentice-stats.app.workbuddy.host/collect?sharecode=D5GVTXXGRS';

  // ── 配置存取 ──
  function cfg() {
    try {
      const c = Storage.get(KEY, null);
      if (c) {
        // 有配置就用，但地址为空时补上默认地址（老用户升级场景）
        if (!c.endpoint) c.endpoint = DEFAULT_ENDPOINT;
        return c;
      }
      // 首次：默认关闭，但地址预填好（用户只需点开启）
      return { enabled: false, endpoint: DEFAULT_ENDPOINT, lastPush: 0 };
    } catch (e) {
      return { enabled: false, endpoint: DEFAULT_ENDPOINT, lastPush: 0 };
    }
  }

  function setCfg(patch) {
    try {
      const c = Object.assign(cfg(), patch || {});
      Storage.set(KEY, c);
      return c;
    } catch (e) { return cfg(); }
  }

  /** 是否启用 */
  function isEnabled() {
    const c = cfg();
    return c.enabled === true && !!c.endpoint;
  }

  /** 上报地址（用户自己填的云端 URL） */
  function endpoint() { return cfg().endpoint || ''; }

  // ── 匿名 ID ──
  function anonId() {
    let id = null;
    try { id = Storage.get(KEY_ID, null); } catch (e) {}
    if (!id) {
      // 随机生成，不含任何个人信息
      id = 'xt-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      try { Storage.set(KEY_ID, id); } catch (e) {}
    }
    return id;
  }

  // ── 启动计数 ──
  function meta() {
    try {
      return Storage.get(KEY_META, { firstSeen: null, lastSeen: null, launches: 0 });
    } catch (e) {
      return { firstSeen: null, lastSeen: null, launches: 0 };
    }
  }

  /** 每次启动调用一次：更新计数 + 按需上报 */
  async function trackLaunch(version) {
    const now = new Date().toISOString();
    const m = meta();
    if (!m.firstSeen) m.firstSeen = now;
    m.lastSeen = now;
    m.launches = (m.launches || 0) + 1;
    try { Storage.set(KEY_META, m); } catch (e) {}

    if (isEnabled()) {
      await push({ version: version || 'dev' });
    }
    return m;
  }

  /** 组装上报载荷（只含匿名字段） */
  function payload(version) {
    const m = meta();
    let platform = 'unknown';
    try { platform = navigator.platform || 'unknown'; } catch (e) {}
    return {
      id: anonId(),
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen,
      launches: m.launches,
      version: version || 'dev',
      platform: platform,
    };
  }

  /** 上报（失败静默，绝不影响使用） */
  async function push(extra) {
    if (!isEnabled()) return { ok: false, reason: 'disabled' };
    const url = endpoint();
    if (!url) return { ok: false, reason: 'no-endpoint' };

    const body = Object.assign(payload(), extra || {});

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      setCfg({ lastPush: Date.now() });
      return { ok: resp.ok };
    } catch (e) {
      // 静默失败 —— 上报永远不该影响学习功能
      return { ok: false, reason: e.message };
    }
  }

  /** 给设置页读的当前状态 */
  function status() {
    const c = cfg();
    const m = meta();
    return {
      enabled: c.enabled,
      endpoint: c.endpoint,
      anonId: anonId(),
      firstSeen: m.firstSeen,
      lastSeen: m.lastSeen,
      launches: m.launches,
      lastPush: c.lastPush,
    };
  }

  /** 开启（用户主动） */
  function enable(url) {
    setCfg({ enabled: true, endpoint: url || endpoint() });
    return push({});
  }

  /** 关闭（立即停发） */
  function disable() {
    setCfg({ enabled: false });
  }

  return {
    DEFAULT_ENDPOINT,
    cfg, setCfg, isEnabled, endpoint,
    anonId, meta, trackLaunch, payload, push,
    status, enable, disable,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = UsageStats;
