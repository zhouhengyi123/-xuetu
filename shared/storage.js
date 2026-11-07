/**
 * 存储层 v0.4 — localStorage 封装
 */
const Storage = (() => {
  const P = 'xt_';
  function get(k, d = null) { try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : d; } catch { return d; } }
  function set(k, v) {
    localStorage.setItem(P + k, JSON.stringify(v));
    /**
     * ★ 关键配置变化时同步到磁盘（2026-10-24）
     *
     * 用户抱怨"每次都要重新输密钥"—— localStorage 会因清缓存/换版本丢。
     * 所以这几项额外写一份到 userData 下的 JSON 文件。
     *
     * 注意：用 typeof 保护 —— MIRROR_KEYS 和 mirrorToDisk 在这个文件靠下的位置，
     * 靠 const 提升的行为不可靠，所以运行时判断。
     */
    try {
      if (typeof mirrorToDisk === 'function' &&
          typeof MIRROR_KEYS !== 'undefined' &&
          MIRROR_KEYS.indexOf(k) >= 0) {
        mirrorToDisk();
      }
    } catch (e) {}
  }

  // ══ 学习目标 ══
  function getGoal() {
    const v = get('goal', {
      target: 600, current: 450, date: defaultDate(),
      grade: '高三', name: '', city: '', track: '',
      selectedSubjects: ['物理', '化学', '生物'],
      weakSubject: '数学', strongSubject: '英语',
      hours: '2-3小时', progress: '', focuses: [],
      examScore: 0, examDate: '',
    });
    // ★ 防御：旧镜像可能把 null 写进 goal，导致所有读 .selectedSubjects 的地方崩
    return (v && typeof v === 'object') ? v : {};
  }
  function setGoal(g) { set('goal', { ...getGoal(), ...g }); }
  function defaultDate() { const n = new Date(); return `${n.getMonth() >= 6 ? n.getFullYear() + 1 : n.getFullYear()}-06-07`; }

  // ══ 每科目标分（总分目标就是 goal.target） ══
  function getSubjectTargets() {
    const g = getGoal();
    return (g && g.subjectTargets) || {};
  }
  function getSubjectTarget(sub) { return getSubjectTargets()[sub]; }
  /** 单科目标：0/留空 = 删除；超过该科满分也拒收（用 DB.MAX_SCORES 校验） */
  function setSubjectTarget(sub, v) {
    const g = getGoal();
    const t = { ...(g.subjectTargets || {}) };
    const n = Number(v);
    const max = (typeof DB !== 'undefined' && DB.MAX_SCORES && DB.MAX_SCORES[sub]) || 150;
    if (!isFinite(n) || n <= 0 || n > max) delete t[sub];
    else t[sub] = Math.round(n * 100000) / 100000;
    setGoal({ ...g, subjectTargets: t });
    return t[sub] != null ? t[sub] : null;
  }
  function setTotalTarget(v) {
    const g = getGoal();
    const n = Number(v);
    const target = (isFinite(n) && n > 0 && n <= 750) ? Math.round(n * 100000) / 100000 : 600;
    setGoal({ ...g, target: target });
    return target;
  }

  // ══ 学习记录 ══
  function getRecords() { return get('records', []); }
  function addRecord(r) {
    const a = getRecords();
    a.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: new Date().toISOString(), ...r });
    set('records', a);
    return a[a.length - 1];
  }
  function delRecord(id) { set('records', getRecords().filter(r => r.id !== id)); }

  // ══ 错题本 ══
  function getMistakes() { return get('mistakes', []); }
  function addMistake(m) {
    const a = getMistakes();
    a.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: new Date().toISOString(), ...m });
    set('mistakes', a);
  }
  function delMistake(id) { set('mistakes', getMistakes().filter(m => m.id !== id)); }

  // ══ 每日任务 ══
  function getDaily() { return get('daily', { date: '', tasks: [], done: [] }); }
  function setDaily(p) { set('daily', p); }
  function toggleTask(tid) {
    const p = getDaily();
    p.done = p.done.includes(tid) ? p.done.filter(id => id !== tid) : [...p.done, tid];
    set('daily', p);
    return p;
  }

  // ══ 统计数据 ══
  function getStats() {
    const s = get('stats', { weeklyMin: 0, weeklyReset: null, monthlyQuiz: 0, monthlyReset: null, streak: 0, lastDate: null, totalMin: 0, points: 0 });
    const now = new Date();
    const wk = new Date();
    wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
    wk.setHours(0, 0, 0, 0);
    if (s.weeklyReset !== wk.toDateString()) { s.weeklyMin = 0; s.weeklyReset = wk.toDateString(); }
    const mk = `${now.getFullYear()}-${now.getMonth()}`;
    if (s.monthlyReset !== mk) { s.monthlyQuiz = 0; s.monthlyReset = mk; }
    set('stats', s);
    return s;
  }
  function addMin(m) {
    m = Number(m);
    if (!Number.isFinite(m) || m <= 0) return;
    const s = getStats();
    s.totalMin += m; s.weeklyMin += m;
    const now = new Date(), today = now.toDateString();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (s.lastDate !== today) {
      s.streak = s.lastDate === yesterday.toDateString() ? (s.streak || 0) + 1 : 1;
      s.lastDate = today;
    }
    set('stats', s);
  }
  function incQuiz() { const s = getStats(); s.monthlyQuiz++; set('stats', s); }

  // ══ 活动日志 ══
  function getActs() { return get('acts', []); }
  function addAct(a) {
    const arr = getActs();
    arr.unshift({ id: Date.now().toString(36), time: new Date().toISOString(), ...a });
    if (arr.length > 50) arr.length = 50;
    set('acts', arr);
  }

  // ══ 估算历史 ══
  function getEstHist() { return get('estHist', []); }
  function addEst(e) { const a = getEstHist(); a.push({ date: new Date().toISOString(), ...e }); set('estHist', a); }

  // ══ 上传进度 ══
  function getUploadProgress() { return get('upload_progress', {}); }
  function setUploadProgress(p) { set('upload_progress', p); }

  // ══════════════════════════════════════════════════════
  //  ★ 磁盘镜像（2026-10-24）
  //
  //  为什么需要：
  //    用户抱怨"每次都要重新输密钥"。localStorage 是浏览器存储，
  //    清缓存/换 Electron 版本/换 userData 目录都可能丢。
  //    所以关键的几项（API Key、目标、setup 状态）额外写一份到磁盘。
  //
  //  实现：
  //    Electron 里通过 preload 暴露的 bridge 写文件；
  //    浏览器里降级为不操作（不影响功能）。
  // ══════════════════════════════════════════════════════

  /**
   * ★ 2026-11-07 扩充：原来只镜像 5 项配置（API Key / goal / setup / aptitude），
   *   考试制度、作息、一节课、错题、AI 记忆、复习状态等一概不在里面。
   *   一旦 localStorage 因故被清（或旧版随机端口导致 origin 变了），
   *   这些用户数据就全丢了。现在改为「除明确可重建的缓存外，全部镜像」。
   *
   * 注意：不镜像大体积/可重建的缓存（student_model_v1 是预计算缓存、
   * textbook_coverage 可由教材进度重算），避免镜像文件膨胀。
   */
  const MIRROR_KEYS = [
    // —— 原有 5 项 ——
    'llm_config', 'provider_keys', 'setup_completed', 'goal', 'aptitude',
    // —— 设置与本轮新增配置 ——
    'region_v1', 'region_curriculum_v1', 'ui_lang', 'reasoning_effort',
    'routine_v1', 'usage_stats_enabled', 'usage_stats_endpoint',
    'workbuddy_enabled', 'chat_mode', 'tts_config',
    // —— 用户真实数据 ——
    'setup_data', 'papers', 'records', 'mistakes', 'lessons',
    'practice_log', 'quiz_stats', 'subject_targets', 'textbook_progress',
    'textbook_coverage', 'ai_memory', 'sp_facts', 'sp_facts_at',
    'mem_events', 'acts', 'review_state', 'daily', 'est_hist',
    'tutor_session_v1', 'tutor_session_history', 'total_estimate',
    'subject_analyses', 'agent_student_snapshot', 'agent_student_snapshot_meta',
    'last_plan', 'last_proctor_session', 'proctor_baseline',
    'usage_anon_id', 'backup_meta', 'stats',
  ];

  function mirrorBridge() {
    try {
      return (typeof window !== 'undefined' && window.appDataBridge) ? window.appDataBridge : null;
    } catch (e) { return null; }
  }

  let _mirrorTimer = null;

  /** 把关键配置写进磁盘（防抖 1.5 秒，避免频繁 IO） */
  function mirrorToDisk() {
    const b = mirrorBridge();
    if (!b || typeof b.save !== 'function') return;

    if (_mirrorTimer) clearTimeout(_mirrorTimer);
    _mirrorTimer = setTimeout(() => {
      try {
        const snap = {};
        MIRROR_KEYS.forEach(k => {
          const v = get(k, undefined);
          if (v !== undefined) snap[k] = v;
        });
        b.save(snap).catch(() => {});
      } catch (e) {}
    }, 1500);
  }

  /**
   * 启动时从磁盘恢复。
   *
   * ★ 2026-11-07 修：原来这个函数**定义了但从未在启动时被调用**，
   *   而且只恢复 5 项配置、还「只在本地没有时才补」。外部审计实测
   *   「每次重启所有用户数据全丢」—— 随机端口导致 origin 变化，
   *   localStorage 全空，而这个唯一能救命的函数根本没跑。
   *
   * 现在：
   *   ① 由 app.js init() 显式调用（见 autoRestore）
   *   ② 恢复范围扩到 MIRROR_KEYS 全部
   *   ③ 镜像为空时，再试一次 /api/backup/latest 快照兜底
   *   ④ 仍遵守「不覆盖用户已经写入的新值」，避免把旧数据盖回去
   */
  async function restoreFromDisk() {
    const b = mirrorBridge();
    if (!b || typeof b.load !== 'function') return { restored: 0, source: 'none' };

    let snap = null, source = 'mirror';
    try { snap = await b.load(); } catch (e) { snap = null; }

    // 镜像没有（或坏了）→ 退到备份快照
    if (!snap || typeof snap !== 'object') {
      source = 'backup';
      snap = await loadLatestBackupSnapshot();
    }
    if (!snap || typeof snap !== 'object') return { restored: 0, source: 'none' };

    // 备份快照的字段可能是 {key: value} 或 {data:{...}} 或 {localStorage:{...}}
    const data = (snap.data && typeof snap.data === 'object') ? snap.data
      : (snap.localStorage && typeof snap.localStorage === 'object') ? snap.localStorage
      : snap;

    let restored = 0;
    MIRROR_KEYS.forEach(k => {
      // 快照里可能带 xt_ 前缀，也可能不带
      const v = (data[k] !== undefined) ? data[k] : data[P + k];
      // ★ 绝不把 null/undefined 恢复进本地：getGoal() 这类函数依赖
      //   「键不存在才用默认值」，写进一个 null 会让 getGoal() 返回 null，
      //   进而 allSixSubjects() 读 .selectedSubjects 直接崩。
      if (v === undefined || v === null) return;
      const cur = get(k, undefined);
      // 只在本地确实没有时才补，绝不覆盖用户新改的
      if (cur === undefined || cur === null) {
        set(k, v);
        restored++;
      }
    });
    if (restored) console.log('[storage] 从磁盘' + (source === 'backup' ? '备份' : '镜像') + '恢复了 ' + restored + ' 项数据');
    return { restored, source };
  }

  /**
   * 从内置 HTTP 服务的 /api/backup/latest 读最新快照。
   * 只在这里用（浏览器版没有这个接口，会静默失败）。
   */
  async function loadLatestBackupSnapshot() {
    try {
      const r = await fetch('/api/backup/latest', { cache: 'no-store' });
      if (!r.ok) return null;
      const j = await r.json();
      // 快照结构见 shared/backup.js：常见是 {localStorage:{...}} 或 {data:{...}}
      return j;
    } catch (e) { return null; }
  }

  /**
   * 供 init() 调用的自动恢复入口。
   * 加一道判断：只有「本地确实几乎没有数据」时才全量恢复，
   * 避免正常启动时做无谓的磁盘 IO。
   */
  async function autoRestore() {
    try {
      // ★ 清掉历史镜像可能写进来的 null 值（getGoal() 会因此返回 null 而崩）
      //   只删值为 null/undefined 的 MIRROR_KEYS，不动其它键。
      MIRROR_KEYS.forEach(k => {
        const raw = localStorage.getItem(P + k);
        if (raw === 'null' || raw === 'undefined') localStorage.removeItem(P + k);
      });
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        if (String(localStorage.key(i) || '').indexOf(P) === 0) count++;
      }
      // 少于 3 项说明是空库（启动默认值会写 3~4 项），需要恢复
      if (count <= 4) return await restoreFromDisk();
      // 非空库也尝试补缺失的键（例如用户从旧版升级，新增的 key 没镜像过）
      return await restoreFromDisk();
    } catch (e) { return { restored: 0, source: 'error' }; }
  }

  // ══ 供应商 API Keys ══
  function getProviderKeys() { return get('provider_keys', {}); }
  function setProviderKey(provider, key) { const keys = getProviderKeys(); keys[provider] = key; set('provider_keys', keys); }
  function getProviderKey(provider) { return getProviderKeys()[provider] || ''; }

  // ══ AI 共享记忆（全局唯一，所有模块共用同一个"人"） ══
  function getMemory() { return get('ai_memory', []); }
  function setMemory(m) {
    // 只保留最近 40 条，避免 localStorage 膨胀
    const arr = Array.isArray(m) ? m.slice(-40) : [];
    set('ai_memory', arr);
    return arr;
  }
  function pushMemory(role, content, tag) {
    const arr = getMemory();
    arr.push({ role: role, content: content, tag: tag || '', time: new Date().toISOString() });
    return setMemory(arr);
  }
  function clearMemory() { set('ai_memory', []); }

  // ══ 单科分析（每科独立，满 5 份试卷后生成） ══
  function getSubjectAnalyses() { return get('subject_analyses', {}); }
  function setSubjectAnalysis(subject, data) {
    const all = getSubjectAnalyses();
    all[subject] = { ...data, date: new Date().toISOString() };
    set('subject_analyses', all);
    return all[subject];
  }
  // 某科目已上传的试卷数量
  function countPapers(subject) {
    return getPapers().filter(p => p.subject === subject).length;
  }
  function getPapers() { return get('papers', []); }
  function addPaper(p) {
    const a = getPapers();
    a.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: new Date().toISOString(), ...p });
    set('papers', a);
    return a[a.length - 1];
  }
  function getPaper(id) { return getPapers().find(p => p.id === id) || null; }
  function updatePaper(id, patch) {
    const a = getPapers();
    const i = a.findIndex(p => p.id === id);
    if (i < 0) return null;
    a[i] = { ...a[i], ...patch };
    set('papers', a);
    return a[i];
  }
  /**
   * 删掉某份试卷带来的错题。
   * src 可选：'question' 只删逐题判定产生的，'knowledge' 只删知识点级的。
   * 校正时只该删逐题那批 —— 否则会把知识点错题一起清掉（曾因此在保存校正时凭空少一条）。
   */
  function delMistakesByPaper(paperId, src) {
    set('mistakes', getMistakes().filter(m => {
      if (m.paperId !== paperId) return true;
      if (src && m.src !== src) return true;
      return false;
    }));
  }
  function getTotalEstimate() { return get('total_estimate', null); }
  function setTotalEstimate(e) {
    if (e == null) { set('total_estimate', null); return null; }
    set('total_estimate', { ...e, date: new Date().toISOString() });
    return get('total_estimate', null);
  }

  // ══ 教材进度（每科独立：上到哪了） ══
  function getTextbook() { return get('textbook_progress', {}); }
  function getSubjectTextbook(subject) {
    const t = getTextbook()[subject];
    return (t && (t.unit || t.edition)) ? t : null;
  }
  function setSubjectTextbook(subject, data) {
    const all = getTextbook();
    const cur = all[subject] || {};
    const next = { ...cur, ...data, updatedAt: new Date().toISOString() };
    // 清空则删掉这条
    if (!next.unit && !next.edition) delete all[subject];
    else all[subject] = next;
    set('textbook_progress', all);
    return all[subject] || null;
  }
  function setTextbookBulk(map) {
    const all = getTextbook();
    Object.keys(map || {}).forEach(sub => {
      const v = map[sub] || {};
      if (!v.unit && !v.edition) delete all[sub];
      else all[sub] = { ...(all[sub] || {}), ...v, updatedAt: new Date().toISOString() };
    });
    set('textbook_progress', all);
    return all;
  }
  /** 给大模型用的一行式描述，如「数学：人教A版 必修一 第三章；物理：必修二 第五章」 */
  function textbookDigest(subjects) {
    const all = getTextbook();
    const list = subjects || Object.keys(all);
    return list.map(s => {
      const t = all[s];
      if (!t || (!t.unit && !t.edition)) return null;
      return s + '：' + [t.edition, t.unit].filter(Boolean).join(' ');
    }).filter(Boolean).join('；');
  }

  // ══ 教材覆盖率（AI 把"上到哪了"折算成高考考点覆盖比，带签名缓存） ══
  function getTextbookCoverage() { return get('textbook_coverage', null); }
  function setTextbookCoverage(obj, sig) {
    set('textbook_coverage', { sig: sig || '', map: obj, date: new Date().toISOString() });
  }

  // ══ 高考难度折算系数（可在设置里按自己学校情况改） ══
  function getDifficultyFactors() { return get('difficulty_factors', {}); }
  function setDifficultyFactor(subject, v) {
    const all = getDifficultyFactors();
    const n = Number(v);
    if (!isFinite(n) || n <= 0 || n > 1.5) delete all[subject];   // 非法或留空 → 回落到默认
    else all[subject] = Math.round(n * 10000) / 10000;
    set('difficulty_factors', all);
    return all[subject];
  }
  function resetDifficultyFactors() { set('difficulty_factors', {}); }
  /**
   * 取某科最终生效的系数。**单一出口**：真正的公式只在 DB.difficultyFactor 里，
   * 这里只负责把"用户自定义的学科基准"喂进去。
   * ★ 这里曾经自己又算了一遍（调 DB.difficultyFactor 时不传 level，再自己乘 ±10%），
   *   结果 DB 里"难度覆盖先验"的逻辑永远拿不到 level —— 难度推断等于没生效。
   *   实测（_calib.js）10 份高考卷判成 3 档却被当校内卷，总分低估 97 分。
   */
  function getDifficultyFactor(subject, source, level) {
    const custom = getDifficultyFactors()[subject];
    if (typeof DB !== 'undefined' && DB.difficultyFactor) {
      return DB.difficultyFactor(subject, source, level, custom);
    }
    return 0.85;
  }

  // ══ 导出/导入/清除 ══
  /**
   * 列出所有本应用的存储 key。
   *
   * ★ 曾经写成 `Object.keys(localStorage)` —— 在真实浏览器里能用（原生对象支持），
   *   但它**依赖具体实现**：在 Node/测试替身里，`Object.keys` 返回的是方法名而不是键，
   *   导致导出结果永远是空对象（备份文件只有 67 字节，恢复时"备份里没有任何数据"）。
   *   改成标准遍历接口 `length` + `key(i)`，任何环境都可靠。
   */
  function allKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(P) === 0) out.push(k);
      }
    } catch (e) { /* 极端环境下取不到就返回已收集的 */ }
    return out;
  }

  function exportAll() {
    const d = {};
    allKeys().forEach(k => { d[k.slice(P.length)] = get(k.slice(P.length)); });
    return d;
  }

  /**
   * 导入整份数据（恢复备份用）。
   *
   * ★ 关键设计：
   *   · **先校验再动手** —— 格式不对直接抛错，绝不能把用户现有数据清一半
   *   · 默认**合并覆盖**（备份里有的 key 覆盖，备份里没有的保留），
   *     因为备份可能是很久以前的，直接清空会丢掉之后的新数据
   *   · 传 replace=true 才做"完全替换"
   *
   * @param {object} data 形如 exportAll() 的返回值（不带 xt_ 前缀）
   * @param {object} opts { replace:boolean }
   * @returns {{imported:number, skipped:string[]}}
   */
  function importAll(data, opts) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('备份内容格式不对（应为对象）');
    }
    const keys = Object.keys(data).filter(k => k && k !== 'snapshots' && k !== 'backup_meta');
    if (!keys.length) throw new Error('备份里没有任何数据');

    opts = opts || {};
    const skipped = [];
    if (opts.replace) {
      // 完全替换：只清学习数据，保留快照与元信息（否则恢复后就没有备份记录了）
      allKeys()
        .filter(k => k !== P + 'snapshots' && k !== P + 'backup_meta')
        .forEach(k => localStorage.removeItem(k));
    }
    let imported = 0;
    keys.forEach(k => {
      try {
        // 直接写 JSON 字符串，避免二次序列化差异
        localStorage.setItem(P + k, JSON.stringify(data[k]));
        imported++;
      } catch (e) {
        skipped.push(k);
      }
    });
    return { imported, skipped };
  }

  function clearAll() { allKeys().forEach(k => localStorage.removeItem(k)); }

  // ══════════════════════════════════════════════════════
  //  ★ 新增：上课记录 / 练习统计 / 能力测验
  //    （2026-10-18 估分 v2 需要——旧版只看做题得分率）
  // ══════════════════════════════════════════════════════

  /**
   * 上课记录
   *
   * 一条记录 = 一次学习活动，字段：
   *   { subject, minutes, focus(0~100), completion(0~1), interactions(次数),
   *     mastery(0~1 掌握度，可选), date, source }
   *
   * 为什么 focus/completion/interactions 都要记：
   *   文献（Macnamara 2014）说单纯学习时长只解释 ~1% 成绩方差，
   *   真正有用的是"刻意练习"——有反馈、有目标、难度匹配。
   *   所以时长必须配"有效性"才有意义，这些字段就是算有效性用的。
   */
  function getLessons() { return get('lessons', []); }

  function addLesson(l) {
    const a = getLessons();
    a.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString(),
      ...l,
    });
    // 只留最近 500 条，防止 localStorage 膨胀
    if (a.length > 500) a.splice(0, a.length - 500);
    set('lessons', a);
    return a[a.length - 1];
  }

  /** 某科的上课汇总 */
  function lessonSummary(subject) {
    const ls = getLessons().filter(l => !subject || l.subject === subject);
    let minutes = 0, effective = 0, focusSum = 0, focusN = 0;
    ls.forEach(l => {
      const m = Number(l.minutes) || 0;
      minutes += m;
      const f = Number(l.focus);
      if (isFinite(f)) { focusSum += f; focusN++; }
    });
    return {
      count: ls.length,
      minutes,
      avgFocus: focusN ? focusSum / focusN : null,
      items: ls,
    };
  }

  /**
   * 练习统计（用于估分）
   *
   * ★ 重要（2026-10-18）：这里汇总的题**可能已经算在 papers 里**。
   *   估分引擎必须去重，否则同一份卷子的题会被数两遍、
   *   SE 虚低、置信度虚高（实测：1 份卷被算成 2 份的可信度）。
   *   所以每条都带 fromPapers 标记，让引擎知道要不要跳过。
   */
  function getQuizStats() {
    const out = [];

    // ① 来自卷子逐题数据的汇总 —— 标 fromPapers: true
    const byPaper = {};
    getPapers().forEach(p => {
      if (!Array.isArray(p.questions)) return;
      const judged = p.questions.filter(q => q.isCorrect === true || q.isCorrect === false);
      if (!judged.length) return;
      if (!byPaper[p.subject]) {
        byPaper[p.subject] = { subject: p.subject, right: 0, total: 0, fromPapers: true };
      }
      byPaper[p.subject].right += judged.filter(q => q.isCorrect === true).length;
      byPaper[p.subject].total += judged.length;
    });
    Object.keys(byPaper).forEach(k => out.push(byPaper[k]));

    // ② 独立的练习会话（AI 出题、练一练等）—— 没有 fromPapers 标记
    const log = get('practice_log', []);
    const bySession = {};
    log.forEach(x => {
      const sub = x.subject;
      const total = Number(x.total) || 0;
      const right = Number(x.right) || 0;
      if (!sub || total <= 0) return;
      if (!bySession[sub]) bySession[sub] = { subject: sub, right: 0, total: 0, sessions: 0 };
      bySession[sub].right += right;
      bySession[sub].total += total;
      bySession[sub].sessions++;
    });
    Object.keys(bySession).forEach(k => out.push(bySession[k]));

    return out;
  }

  /** 记录一次练习（一次做题会话） */
  function addPractice(p) {
    const a = get('practice_log', []);
    a.push({
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      ...p,
    });
    if (a.length > 800) a.splice(0, a.length - 800);
    set('practice_log', a);
    // 缓存失效，下次重新汇总
    set('quiz_stats', null);
    return a[a.length - 1];
  }

  /**
   * 能力测验结果
   *
   * 结构：{ quant: {score,se,date}, verbal: {score,se,date}, raw: {...} }
   *
   * ★ 为什么只分 quant / verbal 两个维度：
   *   文献（Peng 2016）显示工作记忆对数学和阅读的预测力不同
   *   （数学 r≈0.40，阅读 r≈0.25），所以至少要分开。
   *   但 12 题的测验不足以支撑更细的维度划分（会过拟合）。
   */
  function getAptitude() { return get('aptitude', null); }
  function setAptitude(a) { set('aptitude', { ...a, date: new Date().toISOString() }); }
  function clearAptitude() { set('aptitude', null); }

  return {
    get, set,
    getGoal, setGoal, getSubjectTargets, getSubjectTarget, setSubjectTarget, setTotalTarget,
    getRecords, addRecord, delRecord,
    getMistakes, addMistake, delMistake,
    getDaily, setDaily, toggleTask,
    getStats, addMin, incQuiz,
    getActs, addAct,
    getEstHist, addEst,
    getUploadProgress, setUploadProgress,
    getProviderKeys, setProviderKey, getProviderKey,
    getMemory, setMemory, pushMemory, clearMemory,
    getSubjectAnalyses, setSubjectAnalysis,
    // ★ 新增
    getLessons, addLesson, lessonSummary,
    getQuizStats, addPractice,
    getAptitude, setAptitude, clearAptitude,
    // ★ 磁盘镜像
    mirrorToDisk, restoreFromDisk, autoRestore,
    getPapers, addPaper, countPapers, getPaper, updatePaper, delMistakesByPaper,
    getTotalEstimate, setTotalEstimate,
    getTextbook, getSubjectTextbook, setSubjectTextbook, setTextbookBulk, textbookDigest,
    getTextbookCoverage, setTextbookCoverage,
    getDifficultyFactors, setDifficultyFactor, resetDifficultyFactors, getDifficultyFactor,
    exportAll, importAll, clearAll,
  };
})();
