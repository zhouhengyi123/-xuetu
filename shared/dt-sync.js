/**
 * DeepTutor 数据同步层（2026-10-24）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要这个
 * ══════════════════════════════════════════════════════════════
 * 用户核心诉求："把生成课程、弱点分析、错题这些都跟 DeepTutor 打通"
 *
 * 之前的状态：学徒和 DeepTutor 各存各的，完全不通。
 *   学徒：localStorage（卷子/错题/上课/能力测验）
 *   DeepTutor：它自己的 SQLite/知识库
 *
 * 这个文件做**单向主同步**（学徒 → DeepTutor），因为：
 *   · 学徒是数据源头（用户在这里录卷子、做题）
 *   · DeepTutor 是消费方（用它做分析、生成课程）
 *   反向只同步"会话记录"回来，用于在学徒侧展示。
 *
 * ══════════════════════════════════════════════════════════════
 * 接口依据（实测自 /openapi.json）
 * ══════════════════════════════════════════════════════════════
 *   错题本：POST /api/question-notebook/entries/upsert
 *           必填 question_id / question，其余 23 个字段可选
 *   课程：  POST /api/courses  { name, description, ... }
 *           PUT  /api/courses/{id}/syllabus  { units: [...] }
 *   知识库：POST /api/knowledge-bases
 *           POST /api/knowledge-bases/{kb}/upload
 */
const DTSync = (() => {

  const BASE = 'http://127.0.0.1:8001';
  const TIMEOUT = 15000;

  // ══════════════════════════════════════════════════
  //  基础 HTTP
  // ══════════════════════════════════════════════════
  async function api(path, options) {
    const o = options || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || TIMEOUT);

    try {
      const resp = await fetch(BASE + path, {
        method: o.method || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}),
        body: o.body ? JSON.stringify(o.body) : undefined,
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      const text = await resp.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }

      if (!resp.ok) {
        const msg = (data && (data.detail || data.message || data.error)) || ('HTTP ' + resp.status);
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200));
      }
      return { ok: true, data };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('DeepTutor 请求超时（' + Math.round((o.timeout || TIMEOUT) / 1000) + '秒）');
      throw e;
    }
  }

  /** 服务是否在线 */
  async function available() {
    try {
      const r = await api('/', { timeout: 3000 });
      return !!(r && r.ok);
    } catch (e) {
      return false;
    }
  }

  // ══════════════════════════════════════════════════
  //  ① 错题同步
  // ══════════════════════════════════════════════════

  /**
   * 把学徒的一条错题转成 DeepTutor 的 upsert 格式。
   *
   * 字段映射（依据 UpsertEntryRequest 的 25 个字段）：
   *   question_id   ← 用学徒记录的 id（保证幂等，重复 upsert 不会产生多条）
   *   question      ← 题目文本
   *   question_type ← 选择题 / 解答题
   *   correct_answer← 正确答案
   *   user_answer   ← 学生答案
   *   explanation   ← 解析
   *   difficulty    ← 难度（1~5 转成字符串）
   *   is_correct    ← false（错题本就是错的）
   *   source        ← 来源
   *   attempt_count ← 错了几次
   */
  function mistakeToEntry(m) {
    const qid = 'xt-m-' + (m.id || (m.subject + '_' + (m.knowledge || '') + '_' + (m.question || '').slice(0, 20)));

    return {
      question_id: String(qid).replace(/\s+/g, '-').slice(0, 120),
      question: String(m.question || '(无题干)').slice(0, 4000),
      question_type: m.type === 'choice' ? 'choice' : 'open',
      correct_answer: String(m.correctAnswer || ''),
      user_answer: String(m.wrongAnswer || ''),
      explanation: String(m.explanation || ''),
      difficulty: m.difficulty != null ? String(m.difficulty) : '',
      is_correct: false,
      /**
       * ★ 字段必须是枚举值（实测自 deeptutor/core/assessment.py）
       *
       * origin_type:      conversation | external_import | document_analysis
       * source:           deep_question | mastery_path | immersive_reading | book | partner_chat | import
       * assessment_type:  quiz | focus_check | qualitative | review
       * result:           correct | incorrect | partial | ungraded | voided
       *
       * 另外 origin_type 默认是 "conversation"，那条路要求 session_id。
       * 我们用 external_import + origin_ref，才不需要会话。
       */
      origin_type: 'external_import',
      source: 'import',
      origin_ref: String(m.subject || '') + (m.knowledge ? ' · ' + m.knowledge : '') || '学徒错题',
      attempt_count: Number(m.count) || 1,
      assessment_type: 'quiz',
      result: 'incorrect',
    };
  }

  /**
   * 同步全部错题。
   * @returns {{ok:boolean, synced:number, failed:number, errors:string[]}}
   */
  async function syncMistakes(opts) {
    const o = opts || {};
    const mistakes = (Storage.getMistakes && Storage.getMistakes()) || [];
    if (!mistakes.length) return { ok: true, synced: 0, failed: 0, errors: [] };

    let synced = 0, failed = 0;
    const errors = [];

    for (const m of mistakes) {
      try {
        await api('/api/question-notebook/entries/upsert', {
          method: 'POST',
          body: mistakeToEntry(m),
        });
        synced++;
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(e.message);
      }
      if (!o.all && synced >= 200) break;   // 安全上限
    }

    return { ok: failed === 0, synced, failed, errors };
  }

  // ══════════════════════════════════════════════════
  //  ② 课程同步
  // ══════════════════════════════════════════════════

  /**
   * 把学徒生成的课程推进 DeepTutor。
   *
   * 学徒的课程结构：{ title, subject, outline: [{title, body, bullets}], pages: [...] }
   * DeepTutor 的结构：Course { name, description } + Syllabus { units: [...] }
   */
  async function syncCourse(course) {
    if (!course || !course.title) throw new Error('课程没有标题');

    // ① 建课程
    /**
     * ★ 返回结构实测（2026-10-24）：
     *   { course: { id: "course_d4da57323efa", name, description, syllabus: [], ... } }
     *   不是直接返回 id，要取 data.course.id
     */
    const created = await api('/api/courses', {
      method: 'POST',
      body: {
        name: String(course.title).slice(0, 100),
        description: String(course.subject || '') + ' · 由学徒生成',
        color: '#4176e6',
      },
    });

    const cData = (created.data && created.data.course) || created.data || {};
    const courseId = cData.id || cData.course_id;
    if (!courseId) {
      throw new Error('创建课程失败：返回 ' + JSON.stringify(created.data || {}).slice(0, 150));
    }

    // ② 写大纲
    const outline = Array.isArray(course.outline) ? course.outline : [];
    if (outline.length) {
      const units = outline.map((u, i) => ({
        title: String(u.title || ('第 ' + (i + 1) + ' 节')).slice(0, 200),
        content: String(u.body || '').slice(0, 5000),
        order: i,
      }));

      await api('/api/courses/' + encodeURIComponent(courseId) + '/syllabus', {
        method: 'PUT',
        body: { units },
      });
    }

    return { courseId, units: outline.length };
  }

  /** 同步学徒的所有课程 */
  async function syncAllCourses() {
    let courses = [];
    try {
      courses = (typeof CourseEngine !== 'undefined' && CourseEngine.list) ? CourseEngine.list() : [];
    } catch (e) { courses = []; }

    if (!courses.length) return { ok: true, synced: 0, failed: 0, errors: [] };

    let synced = 0, failed = 0;
    const errors = [];

    for (const c of courses) {
      try {
        await syncCourse(c);
        synced++;
      } catch (e) {
        failed++;
        if (errors.length < 3) errors.push(e.message);
      }
    }
    return { ok: failed === 0, synced, failed, errors };
  }

  // ══════════════════════════════════════════════════
  //  ③ 学习概况同步（作为一条"笔记"喂给 DeepTutor）
  // ══════════════════════════════════════════════════

  /**
   * 把学徒的完整学情摘要写成一段 markdown，作为一条错题本的"背景条目"。
   *
   * 为什么这样做：DeepTutor 没有"学生档案"这个概念端点，
   * 但错题本条目里可以放题干 —— 用一条特殊条目承载学情概览，
   * 检索时能捞到。这是在不改 DeepTutor 源码的前提下的务实做法。
   */
  function buildProfileMarkdown() {
    const g = Storage.getGoal() || {};
    const papers = Storage.getPapers() || [];
    const mistakes = Storage.getMistakes() || [];
    const apt = Storage.getAptitude ? Storage.getAptitude() : null;
    const est = Storage.getTotalEstimate ? Storage.getTotalEstimate() : null;

    const L = [];
    L.push('# 学生学情档案');
    L.push('');
    L.push('> 由「学徒」自动同步，用于让辅导更贴合这个学生。');
    L.push('');
    L.push('## 基本情况');
    L.push('- 地区：' + (g.city || '未填'));
    L.push('- 年级：' + (g.grade || '高三'));
    L.push('- 选科：' + ((g.selectedSubjects || []).join('、') || '未填'));
    L.push('- 目标分：' + (g.target || '未填'));
    L.push('- 起点分：' + (g.current || g.examScore || '未填'));
    L.push('');
    L.push('## 已录成绩');
    L.push('- 卷子数：' + papers.length);

    if (papers.length) {
      const bySub = {};
      papers.forEach(p => {
        if (!bySub[p.subject]) bySub[p.subject] = [];
        bySub[p.subject].push(p);
      });
      Object.keys(bySub).forEach(s => {
        const ps = bySub[s];
        const avg = ps.reduce((a, p) => a + (Number(p.score) || 0) / (Number(p.fullScore) || 100), 0) / ps.length;
        L.push('  - ' + s + '：' + ps.length + ' 份，平均得分率 ' + Math.round(avg * 100) + '%');
      });
    }
    L.push('');
    L.push('## 薄弱知识点');
    if (mistakes.length) {
      const byK = {};
      mistakes.forEach(m => {
        const k = (m.subject || '') + ' · ' + (m.knowledge || '未分类');
        byK[k] = (byK[k] || 0) + 1;
      });
      Object.keys(byK).sort((a, b) => byK[b] - byK[a]).slice(0, 12).forEach(k => {
        L.push('  - ' + k + '：错 ' + byK[k] + ' 次');
      });
    } else {
      L.push('  （暂无错题记录）');
    }
    L.push('');
    L.push('## 推理能力');
    if (apt && apt.raw) {
      L.push('- 百分位：约 ' + Math.round((apt.raw.percentile || 0) * 100) + '%');
      L.push('- 答对：' + (apt.raw.correct || 0) + '/' + (apt.raw.total || 12));
    } else {
      L.push('  （未测）');
    }
    L.push('');
    L.push('## 当前估分');
    if (est && est.total != null) {
      L.push('- 总分：' + est.total.toFixed(1) + (est.totalRange ? '（区间 ' + est.totalRange.low.toFixed(0) + '~' + est.totalRange.high.toFixed(0) + '）' : ''));
    } else {
      L.push('  （数据不足，无法估分）');
    }

    return L.join('\n');
  }

  /** 同步学情档案 */
  async function syncProfile() {
    const md = buildProfileMarkdown();
    await api('/api/question-notebook/entries/upsert', {
      method: 'POST',
      body: {
        question_id: 'xt-student-profile',
        question: md,
        question_type: 'note',
        origin_type: 'external_import',      // 枚举，见 mistakeToEntry
        source: 'import',
        origin_ref: '学徒 · 学情档案',
        assessment_type: 'qualitative',      // 枚举：quiz/focus_check/qualitative/review
        result: 'ungraded',                  // 枚举：correct/incorrect/partial/ungraded/voided
        is_correct: true,
      },
    });
    return { ok: true, length: md.length };
  }

  // ══════════════════════════════════════════════════
  //  ④ 一键全量同步
  // ══════════════════════════════════════════════════

  async function syncAll() {
    const t0 = Date.now();
    const out = { ok: true, steps: [], errors: [] };

    if (!(await available())) {
      return { ok: false, reason: 'DeepTutor 服务未启动', steps: [], errors: [] };
    }

    // 1) 学情档案
    try {
      const r = await syncProfile();
      out.steps.push({ name: '学情档案', ok: true, detail: r.length + ' 字符' });
    } catch (e) {
      out.steps.push({ name: '学情档案', ok: false, detail: e.message });
      out.errors.push('学情档案：' + e.message);
      out.ok = false;
    }

    // 2) 错题
    try {
      const r = await syncMistakes();
      out.steps.push({ name: '错题本', ok: r.ok, detail: '成功 ' + r.synced + ' / 失败 ' + r.failed });
      if (!r.ok) { out.ok = false; out.errors.push('错题：' + r.errors.join('; ')); }
    } catch (e) {
      out.steps.push({ name: '错题本', ok: false, detail: e.message });
      out.ok = false;
    }

    // 3) 课程
    try {
      const r = await syncAllCourses();
      out.steps.push({ name: '课程', ok: r.ok, detail: '成功 ' + r.synced + ' / 失败 ' + r.failed });
      if (!r.ok) { out.ok = false; out.errors.push('课程：' + r.errors.join('; ')); }
    } catch (e) {
      out.steps.push({ name: '课程', ok: false, detail: e.message });
      out.ok = false;
    }

    out.ms = Date.now() - t0;
    out.at = new Date().toISOString();

    try {
      Storage.set('dt_last_sync', { at: out.at, ok: out.ok, steps: out.steps, ms: out.ms });
    } catch (e) {}

    return out;
  }

  /** 上次同步时间 */
  function lastSync() {
    try { return Storage.get('dt_last_sync', null); } catch (e) { return null; }
  }

  // ══════════════════════════════════════════════════
  //  ★ 反向同步：DeepTutor → 学徒（2026-10-24）
  // ══════════════════════════════════════════════════

  /**
   * 拉 DeepTutor 的课程列表。
   * 返回 { ok, courses: [{ id, name, description, syllabus, ... }] }
   */
  async function pullCourses() {
    const r = await api('/api/courses');
    const list = (r.data && (r.data.courses || r.data)) || [];
    return {
      ok: true,
      courses: (Array.isArray(list) ? list : []).map(c => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
        units: Array.isArray(c.syllabus) ? c.syllabus.length : 0,
        status: c.status || 'active',
        createdAt: c.created_at,
      })),
    };
  }

  /**
   * 拉 DeepTutor 的错题统计。
   * 用它对比学徒本地的错题数，能发现"在 DeepTutor 里做错的题"。
   */
  async function pullStats() {
    try {
      const r = await api('/api/question-notebook/stats');
      return { ok: true, stats: r.data || {} };
    } catch (e) {
      // 这个端点可能不存在（openapi 里没列），静默降级
      return { ok: false, error: e.message, stats: null };
    }
  }

  /**
   * 拉 DeepTutor 的会话列表（最近在深度辅导里聊了什么）。
   */
  async function pullSessions() {
    try {
      const r = await api('/api/sessions');
      const list = (r.data && (r.data.sessions || r.data)) || [];
      return {
        ok: true,
        sessions: (Array.isArray(list) ? list : []).slice(0, 20).map(x => ({
          id: x.id || x.session_id,
          title: x.title || x.name || '(无标题)',
          at: x.updated_at || x.created_at,
        })),
      };
    } catch (e) {
      return { ok: false, error: e.message, sessions: [] };
    }
  }

  /**
   * 全量拉取 + 存进 Storage。
   */
  async function pullAll() {
    const t0 = Date.now();
    const out = { ok: true, courses: 0, sessions: 0, errors: [] };

    if (!(await available())) {
      return { ok: false, reason: 'DeepTutor 服务未启动', courses: 0, sessions: 0, errors: [] };
    }

    // 课程
    try {
      const r = await pullCourses();
      out.courses = r.courses.length;
      Storage.set('dt_courses', r.courses);
    } catch (e) {
      out.errors.push('课程: ' + e.message);
      out.ok = false;
    }

    // 会话
    try {
      const r = await pullSessions();
      out.sessions = r.sessions.length;
      Storage.set('dt_sessions', r.sessions);
    } catch (e) {
      out.errors.push('会话: ' + e.message);
    }

    out.ms = Date.now() - t0;
    out.at = new Date().toISOString();
    Storage.set('dt_pull_last', { at: out.at, courses: out.courses, sessions: out.sessions, ms: out.ms });

    return out;
  }

  /** 上次拉取时间 */
  function lastPull() {
    try { return Storage.get('dt_pull_last', null); } catch (e) { return null; }
  }

  return {
    available, api,
    syncMistakes, syncCourse, syncAllCourses,
    syncProfile, syncAll, lastSync,
    buildProfileMarkdown,
    // ★ 反向同步
    pullCourses, pullStats, pullSessions, pullAll, lastPull,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DTSync;
