/**
 * 数据安全模块（2026-10-10）
 *
 * 背景：所有学习数据都存在浏览器 localStorage 里，清缓存/换浏览器就没了。
 * 这个项目已经被清空过三次，所以必须做真正的持久化。
 *
 * 三层保护：
 *   ① **自动快照到磁盘** —— 数据变化后（防抖 20 秒）把整份数据 POST 到本地 server，
 *      存成 ./backups/backup-YYYYMMDD-HHMMSS.json。即使 localStorage 被清，
 *      磁盘上还有，一键就能恢复。
 *   ② **localStorage 内的最近快照** —— 服务没开时兜底（保留最近 5 份）。
 *   ③ **手动导出/导入** —— 最原始也最可靠，导出的是完整 JSON。
 *
 * 设计原则：
 *   · 备份失败**绝不能影响正常使用**（try/catch 全包，静默降级）
 *   · 恢复前先把当前数据再备份一次（防止"恢复"变成"再丢一次"）
 *   · 明确告诉用户备份到底有没有成功 —— 不能假装备份了
 */
const BackupGuard = (() => {
  const LOCAL_KEY = 'snapshots';      // localStorage 内的快照
  const META_KEY = 'backup_meta';     // 上次成功备份的时间/方式
  const MAX_LOCAL = 5;
  const DEBOUNCE_MS = 20000;          // 数据变化后 20 秒才备份（避免频繁写盘）

  let timer = null;
  let inflight = false;

  function nowIso() { return new Date().toISOString(); }

  function getMeta() {
    try { return Storage.get(META_KEY, null) || {}; } catch (e) { return {}; }
  }
  function setMeta(m) {
    try { Storage.set(META_KEY, m); } catch (e) {}
  }

  /** 取整份数据（就是「导出备份」的格式） */
  function snapshot() {
    try {
      return Storage.exportAll ? Storage.exportAll() : null;
    } catch (e) { return null; }
  }

  /** 数据指纹：只比大小和关键字段，避免每次都序列化整份数据 */
  function fingerprint() {
    try {
      // ★ 用标准遍历接口（length + key(i)），不要用 Object.keys(localStorage)——
      //   后者依赖具体实现，在某些环境里返回方法名，指纹就恒为空了。
      let n = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('xt_') === 0) n += (localStorage.getItem(k) || '').length + k.length;
      }
      return n;
    } catch (e) { return 0; }
  }

  // ─────────────────────────────────────────────
  //  ① 写盘备份
  // ─────────────────────────────────────────────
  async function pushToServer(silent) {
    if (inflight) return { ok: false, error: 'busy' };
    const data = snapshot();
    if (!data) return { ok: false, error: '没有可备份的数据' };

    inflight = true;
    try {
      const resp = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: data, at: nowIso(), count: Object.keys(data).length }),
      });
      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json.ok) {
        setMeta({ lastOk: nowIso(), lastFile: json.file, lastSize: json.size, mode: 'disk' });
        return { ok: true, file: json.file, size: json.size };
      }
      // 服务在但写入失败 → 本地兜底
      localSnapshot();
      return { ok: false, error: json.error || ('HTTP ' + resp.status), fellBackToLocal: true };
    } catch (e) {
      // 服务没开（用户可能直接用 file:// 打开） → 本地兜底
      localSnapshot();
      return { ok: false, error: '连不上本地服务（server.py 没开？）', fellBackToLocal: true };
    } finally {
      inflight = false;
    }
  }

  // ─────────────────────────────────────────────
  //  ② localStorage 内快照（服务没开时兜底）
  // ─────────────────────────────────────────────
  function localSnapshot() {
    try {
      const data = snapshot();
      if (!data) return null;
      const list = Storage.get(LOCAL_KEY, []) || [];
      list.push({ at: nowIso(), data: data });
      while (list.length > MAX_LOCAL) list.shift();
      Storage.set(LOCAL_KEY, list);
      const m = getMeta();
      m.lastLocal = nowIso();
      if (!m.lastOk) m.mode = 'local';
      setMeta(m);
      return list[list.length - 1];
    } catch (e) {
      // localStorage 满 → 丢掉最老的再试一次
      try {
        const list = Storage.get(LOCAL_KEY, []) || [];
        if (list.length > 1) {
          list.shift();
          Storage.set(LOCAL_KEY, list);
        }
      } catch (e2) {}
      return null;
    }
  }

  function localSnapshots() {
    try { return Storage.get(LOCAL_KEY, []) || []; } catch (e) { return []; }
  }

  // ─────────────────────────────────────────────
  //  ③ 自动备份调度（防抖）
  // ─────────────────────────────────────────────
  let lastFp = null;

  function schedule(reason) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      const fp = fingerprint();
      if (fp === lastFp) return;          // 数据没变，不重复备份
      lastFp = fp;
      const r = await pushToServer(true);
      updateBadge(r);
    }, DEBOUNCE_MS);
  }

  /** 立即备份（用户点按钮时用） */
  async function backupNow() {
    const r = await pushToServer(false);
    lastFp = fingerprint();
    updateBadge(r);
    return r;
  }

  // ─────────────────────────────────────────────
  //  ④ 恢复
  // ─────────────────────────────────────────────
  async function listDiskBackups() {
    try {
      const resp = await fetch('/api/backups');
      const json = await resp.json();
      return (json && json.items) || [];
    } catch (e) { return []; }
  }

  async function restoreFromDisk(name) {
    /**
     * ★ 顺序很重要（2026-10-17 实测踩坑）：
     *
     * 错误做法：先"保护性备份当前状态" → 再取 latest 恢复。
     *   因为保护性备份写出的文件会变成"最新的"，接着取 latest 就取到了**自己刚写的当前状态**，
     *   恢复等于什么都没做（实测：把 target 改成 999 后恢复，结果还是 999）。
     *
     * 正确做法：**先按名字/时间确定要恢复哪一份 → 读取它的内容 → 再写保护性备份。**
     *   这样"最新"在被读取之后才变化，不会自我干扰。
     */
    const url = name ? ('/backups/' + encodeURIComponent(name)) : '/api/backup/latest';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('取不到备份文件（HTTP ' + resp.status + '）');
    const payload = await resp.json();

    /**
     * 兼容三种备份文件结构（历史原因会有差异）：
     *   {data:{...}, at, count}   ← 本模块写入的格式
     *   {data:{...}}              ← 早期格式
     *   {...}                     ← 前端「导出备份」直接存的原始数据
     *
     * ★ 这里刻意用 JSON 往返做一次"边界归一"：
     *   从 fetch 拿到的对象可能来自另一个 realm（比如在 vm/iframe/worker 里调用），
     *   跨 realm 直接读属性有时会拿到 undefined。JSON 序列化是唯一确定安全的穿越方式。
     */
    let normalized;
    try {
      normalized = JSON.parse(JSON.stringify(payload));
    } catch (e) {
      throw new Error('备份文件不是合法 JSON');
    }

    let data = null;
    if (normalized && normalized.data && typeof normalized.data === 'object' && !Array.isArray(normalized.data)) {
      data = normalized.data;
    } else if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
      data = normalized;
    }
    if (!data) throw new Error('备份文件格式不对');
    const keys = Object.keys(data).filter(k => k !== 'at' && k !== 'count');
    if (!keys.length) {
      throw new Error('这份备份是空的（可能是清空数据时自动留下的空壳）—— 换一份更早的试试');
    }

    // ★ 内容已拿到手，现在才写保护性备份（不会干扰上面读到的数据）
    try { await pushToServer(true); } catch (e) { /* 保护性备份失败不阻断恢复 */ }

    if (!Storage.importAll) throw new Error('缺少导入接口');
    Storage.importAll(data);
    return data;
  }

  function restoreFromLocal(index) {
    const list = localSnapshots();
    const item = list[index];
    if (!item || !item.data) throw new Error('这份快照是空的');
    if (Storage.importAll) Storage.importAll(item.data);
    else throw new Error('缺少导入接口');
    return item.data;
  }

  // ─────────────────────────────────────────────
  //  ⑤ 状态展示
  // ─────────────────────────────────────────────
  function status() {
    const m = getMeta();
    const local = localSnapshots();
    let ageH = null;
    if (m.lastOk) {
      ageH = (Date.now() - new Date(m.lastOk).getTime()) / 3600000;
    }
    return {
      lastOk: m.lastOk || null,
      lastFile: m.lastFile || null,
      lastSize: m.lastSize || null,
      mode: m.mode || null,
      ageHours: ageH,
      localCount: local.length,
      /** 该不该提醒用户：超过 7 天没成功备份 */
      shouldWarn: !m.lastOk || (ageH != null && ageH > 24 * 7),
      /** 数据危险（从没备份过） */
      neverBackedUp: !m.lastOk && local.length === 0,
    };
  }

  function updateBadge(result) {
    try {
      const el = document.getElementById('backup-state');
      if (!el) return;
      const s = status();
      if (result && result.ok) {
        el.textContent = '已备份到磁盘（' + (s.lastFile || '') + '）';
        el.style.color = 'var(--green)';
      } else if (s.lastOk) {
        el.textContent = '上次备份 ' + agoText(s.lastOk) + '（磁盘）';
        el.style.color = 'var(--label-secondary)';
      } else if (s.localCount) {
        el.textContent = '只在浏览器内留了 ' + s.localCount + ' 份快照 —— 建议开 server.py 存到磁盘';
        el.style.color = 'var(--amber)';
      } else {
        el.textContent = '还没有任何备份';
        el.style.color = 'var(--red)';
      }
    } catch (e) {}
  }

  function agoText(iso) {
    const h = (Date.now() - new Date(iso).getTime()) / 3600000;
    if (h < 1) return Math.round(h * 60) + ' 分钟前';
    if (h < 24) return Math.round(h) + ' 小时前';
    return Math.round(h / 24) + ' 天前';
  }

  /** 首页提醒条：超过 7 天没备份就提示 */
  function warnIfNeeded() {
    const s = status();
    if (!s.shouldWarn) return;
    const box = document.getElementById('backup-warn');
    if (!box) return;
    box.classList.remove('hidden');
    box.innerHTML = s.neverBackedUp
      ? '⚠️ <b>还没有任何备份</b>。数据只存在浏览器里，清缓存就没了 —— 现在导出一份，或点「立即备份」。'
      : '⚠️ 已经 ' + agoText(s.lastOk) + '没备份了，建议现在备份一次。';
  }

  /** 初始化：挂上自动备份 */
  function init() {
    // 数据变化时自动备份（拦截 Storage.set）
    try {
      const origSet = Storage.set;
      if (origSet && !origSet.__wrapped) {
        Storage.set = function (k, v) {
          const r = origSet.apply(Storage, arguments);
          // 快照本身和元信息不触发备份，否则会无限循环
          if (k !== LOCAL_KEY && k !== META_KEY) schedule('data-change');
          return r;
        };
        Storage.set.__wrapped = true;
      }
    } catch (e) {}
    lastFp = fingerprint();
    updateBadge(null);
    warnIfNeeded();
  }

  return {
    init, status, updateBadge, warnIfNeeded,
    backupNow, pushToServer,
    listDiskBackups, restoreFromDisk,
    localSnapshots, restoreFromLocal,
    fingerprint,
  };
})();
