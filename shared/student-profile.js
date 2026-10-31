/**
 * 学生档案层（2026-10-31 新增）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要这个
 * ══════════════════════════════════════════════════════════════
 * 用户原话："看似有好几个 AI，其实应该是一个"；
 *          "内置关于所有 AI 的记忆要共享"；
 *          "AI 要先了解我，不了解就别乱编"。
 *
 * 现状：快速问答用 persona()、Agent 用 get_student_data 工具、
 *      深度辅导靠 DTSync 推学情档案、出卷用 textbook 字段——
 *      四套拼装，各看各的，谁也不完整。
 *
 * 这个模块是**唯一事实来源**：
 *   · 收集：问卷、卷子、错题+复习状态、上课、练习、能力测验、
 *           课程记录、对话里 AI 学到的事实（记忆写入统一走这里）
 *   · 输出：
 *       profile()          —— 全量档案（喂给任何 AI 的系统提示）
 *       brief()            —— 一段话摘要（塞进 prompt 的"学生画像"）
 *       knowsStudent()     —— 了解程度（0~100%），供功能门禁
 *       learningGap()      —— 在学什么/要学什么（教科书+知识点覆盖）
 *       fact(key, value)   —— AI 学到的持久事实（写入即共享）
 *
 * 所有模块只从这里读学生状态，不再各自拼装。
 */
const StudentProfile = (() => {

  const FACTS_KEY = 'sp_facts';
  const FACTS_UPDATED_KEY = 'sp_facts_at';

  // ══════════════════════════════════════════════════
  //  基础信息
  // ══════════════════════════════════════════════════

  function safeGet(fn, fallback) {
    try { const v = fn(); return (v == null || v === undefined) ? fallback : v; }
    catch (e) { return fallback; }
  }

  /** 全量档案（对象形式，给代码用） */
  function profile() {
    const g = safeGet(() => Storage.getGoal(), {});
    const setup = safeGet(() => Storage.get('setup_data', null), null) || {};
    const papers = safeGet(() => Storage.getPapers(), []);
    const mistakes = safeGet(() => Storage.getMistakes(), []);
    const lessons = safeGet(() => (Storage.getLessons ? Storage.getLessons() : []), []);
    const aptitude = safeGet(() => (Storage.getAptitude ? Storage.getAptitude() : null), null);
    const facts = safeGet(() => Storage.get(FACTS_KEY, {}), {}) || {};

    // 每科卷面概况
    const perSubject = {};
    papers.forEach(p => {
      if (!p || !p.subject) return;
      if (!perSubject[p.subject]) perSubject[p.subject] = { papers: 0, avgRate: 0, _sum: 0 };
      const s = perSubject[p.subject];
      s.papers++;
      s._sum += (Number(p.score) || 0) / (Number(p.fullScore) || 100);
    });
    Object.keys(perSubject).forEach(k => {
      perSubject[k].avgRate = Math.round((perSubject[k]._sum / Math.max(1, perSubject[k].papers)) * 100);
      delete perSubject[k]._sum;
    });

    // 知识点覆盖（来自问卷勾选 + 课程记录）
    const covered = knowledgeCovered();

    return {
      // 基本情况
      grade: g.grade || setup.grade || '高三',
      city: g.city || setup.city || '',
      selectedSubjects: g.selectedSubjects || [],
      target: g.target || null,
      baseline: g.current || g.examScore || null,
      examYear: g.examYear || null,
      hoursPerDay: g.hours || null,

      // 证据概况
      papers: papers.length,
      perSubject: perSubject,
      mistakes: mistakes.length,
      lessons: lessons.length,
      hasAptitude: !!(aptitude && aptitude.raw),
      aptitudePercentile: (aptitude && aptitude.raw && aptitude.raw.percentile != null)
        ? Math.round(aptitude.raw.percentile * 100) : null,

      // 知识点
      knowledgeCovered: covered,

      // AI 学到的持久事实
      facts: facts,

      updatedAt: new Date().toISOString(),
    };
  }

  /** 问卷勾选 + 课程记录合并出的"已学知识点" */
  function knowledgeCovered() {
    const out = {};
    // 问卷勾选
    try {
      const setup = Storage.get('setup_data', null);
      if (setup && setup.knowledgePoints) {
        Object.keys(setup.knowledgePoints).forEach(sub => {
          if (!out[sub]) out[sub] = new Set();
          (setup.knowledgePoints[sub] || []).forEach(k => out[sub].add(k));
        });
      }
    } catch (e) {}
    // 课程记录（学完的课算已学）
    try {
      const courses = (typeof CourseEngine !== 'undefined' && CourseEngine.list) ? CourseEngine.list() : [];
      courses.forEach(c => {
        const sub = c.subject || '综合';
        if (!out[sub]) out[sub] = new Set();
        (c.outline || []).forEach(l => {
          if (l.done && (l.title || l.goal)) out[sub].add(l.title || l.goal);
        });
      });
    } catch (e) {}
    const serial = {};
    Object.keys(out).forEach(k => { serial[k] = Array.from(out[k]); });
    return serial;
  }

  // ══════════════════════════════════════════════════
  //  文字画像（塞 prompt 用）
  // ══════════════════════════════════════════════════

  /**
   * 一段话的学生画像。任何 AI 发请求前都带上它，
   * 从此四个 AI 看到的是同一个学生。
   */
  function brief() {
    const p = profile();
    const L = [];

    L.push('【学生档案（所有 AI 共用，请基于此回答，不要编造他没提供的信息）】');
    L.push('- ' + (p.grade || '高三') + (p.city ? '，' + p.city : '') +
      (p.selectedSubjects.length ? '，选考：' + p.selectedSubjects.join('、') : ''));
    if (p.baseline) L.push('- 月考起点 ' + p.baseline + ' 分' + (p.target ? '，目标 ' + p.target + ' 分' : ''));
    if (p.examYear) L.push('- ' + p.examYear + ' 年 6 月高考');

    if (p.papers > 0) {
      L.push('- 已录入 ' + p.papers + ' 份试卷');
      Object.keys(p.perSubject).forEach(s => {
        L.push('    · ' + s + '：' + p.perSubject[s].papers + ' 份，平均得分率 ' + p.perSubject[s].avgRate + '%');
      });
    } else {
      L.push('- 还没录入任何试卷（不知道单科水平，不要假设）');
    }

    if (p.mistakes > 0) {
      L.push('- 错题 ' + p.mistakes + ' 道');
      try {
        const st = (typeof Review !== 'undefined' && Review.stats) ? Review.stats() : null;
        if (st) L.push('    · 待复习 ' + st.due + '，复习中 ' + st.learning + '，已掌握 ' + st.mastered);
      } catch (e) {}
    }

    if (p.hasAptitude) {
      L.push('- 推理测验百分位约 ' + p.aptitudePercentile + '%（12 题短测，仅供参考）');
    }

    const coveredKeys = Object.keys(p.knowledgeCovered);
    if (coveredKeys.length) {
      coveredKeys.forEach(s => {
        const ks = p.knowledgeCovered[s];
        if (ks && ks.length) L.push('- 已学知识点（' + s + '）：' + ks.slice(0, 12).join('、') + (ks.length > 12 ? ' 等' : ''));
      });
    } else {
      L.push('- 知识点覆盖未登记（不要假设他学过什么）');
    }

    const factKeys = Object.keys(p.facts || {});
    if (factKeys.length) {
      L.push('- AI 记住的事实：');
      factKeys.slice(0, 12).forEach(k => {
        const f = p.facts[k];
        L.push('    · ' + (f.text || k) + (f.at ? '（' + f.at.slice(0, 10) + '）' : ''));
      });
    }

    const gap = learningGap();
    if (gap.nextExam) L.push('- 下次考试：' + gap.nextExam.date + '（' + gap.nextExam.kind + '，约 ' + gap.nextExam.daysLeft + ' 天后）');

    return L.join('\n');
  }

  // ══════════════════════════════════════════════════
  //  在学什么 / 要学什么（老师视角）
  // ══════════════════════════════════════════════════

  function learningGap() {
    const p = profile();
    const subjects = ['数学', '英语'].concat(p.selectedSubjects);

    // 每科：已学/证据/建议下一步
    const per = {};
    subjects.forEach(s => {
      const cov = (p.knowledgeCovered[s] || []).length;
      const ps = p.perSubject[s];
      per[s] = {
        coveredCount: cov,
        papers: ps ? ps.papers : 0,
        avgRate: ps ? ps.avgRate : null,
      };
    });

    // 下次考试（问卷推算逻辑复用）
    const nextExam = nextExamInfo();

    // 薄弱知识点 top5（错题+复习状态聚合）
    const weak = [];
    try {
      const mistakes = Storage.getMistakes() || [];
      const byK = {};
      mistakes.forEach(m => {
        const k = (m.subject || '') + ' · ' + (m.knowledge || '未分类');
        byK[k] = (byK[k] || 0) + (m.count || 1);
      });
      Object.keys(byK).sort((a, b) => byK[b] - byK[a]).slice(0, 5).forEach(k => weak.push(k));
    } catch (e) {}

    return {
      subjects: subjects,
      perSubject: per,
      weakPoints: weak,
      nextExam: nextExam,
    };
  }

  /** 下次考试推算（浙江高中常规节奏） */
  function nextExamInfo() {
    try {
      const g = Storage.getGoal();
      const setup = Storage.get('setup_data', null) || {};
      let date = setup.nextExam || (g && g.nextExam) || '';

      if (!date) {
        const now = new Date();
        const m = now.getMonth() + 1, y = now.getFullYear();
        if (m >= 9 && m <= 10) date = y + '-11-15';
        else if (m >= 11) date = (y + 1) + '-01-15';
        else if (m >= 3 && m <= 4) date = y + '-04-15';
        else if (m >= 5) date = y + '-06-15';
        else { const d = new Date(y, m, 0).getDate(); date = y + '-' + String(m).padStart(2, '0') + '-' + d; }
      }

      const daysLeft = Math.max(0, Math.ceil((new Date(date) - new Date()) / 86400000));
      const m2 = parseInt(date.split('-')[1], 10);
      const kind = (m2 === 11 || m2 === 4) ? '期中考' : (m2 === 1 || m2 === 6) ? '期末考' : '月考';
      return { date: date, kind: kind, daysLeft: daysLeft };
    } catch (e) {
      return null;
    }
  }

  // ══════════════════════════════════════════════════
  //  了解程度（功能门禁用）
  // ══════════════════════════════════════════════════

  /**
   * AI 对学生的了解程度（0~100）。
   *
   * 打分依据（有就加分，没有就是不了解）：
   *   问卷基本信息       20（选科+起点分+目标）
   *   有试卷证据         30（每科 5 分，六科封顶）
   *   知识点覆盖登记     15（每科 2.5 分）
   *   错题+复习在跑      15（有错题 8，复习状态 7）
   *   能力测验           10
   *   AI 学到的事实      10（每条 2 分）
   *
   * 阈值（对应功能解锁）：
   *   ≥ 40  出卷（知道考什么才出题）
   *   ≥ 50  学习规划（知道弱项才排计划）
   *   ≥ 55  个性化课程（知道起点才推荐）
   */
  function knowsStudent() {
    let score = 0;
    const p = profile();

    // 问卷
    // ★ 用 examScore 判"真填过问卷"：默认 goal 里 current=450/target=600 都是
    //   出厂默认值，只有 examScore 默认是 0 —— 真填过的人一定 > 0。
    //   注意不能用 baseline（= g.current 默认 450）判断。
    const g = safeGet(() => Storage.getGoal(), {});
    if (p.selectedSubjects.length && Number(g.examScore) > 0) score += 20;

    // 试卷（每科 5）
    score += Math.min(30, Object.keys(p.perSubject).length * 5 *
      (Object.values(p.perSubject).some(x => x.papers > 0) ? 1 : 0));
    // 更准确：按有卷子的科目数
    score -= Math.min(30, Object.keys(p.perSubject).length * 5);
    const subjectsWithPapers = Object.values(p.perSubject).filter(x => x.papers > 0).length;
    score += Math.min(30, subjectsWithPapers * 5);

    // 知识点（每科 2.5）
    const subjectsWithCoverage = Object.keys(p.knowledgeCovered)
      .filter(s => (p.knowledgeCovered[s] || []).length > 0).length;
    score += Math.min(15, subjectsWithCoverage * 2.5);

    // 错题+复习
    if (p.mistakes > 0) score += 8;
    try {
      const st = (typeof Review !== 'undefined' && Review.stats) ? Review.stats() : null;
      if (st && (st.learning + st.mastered) > 0) score += 7;
    } catch (e) {}

    // 能力测验
    if (p.hasAptitude) score += 10;

    // AI 事实（每条 2，封顶 10）
    score += Math.min(10, Object.keys(p.facts || {}).length * 2);

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      score: score,
      percent: score,
      // 门禁
      canQuiz: score >= 35,
      canPlan: score >= 45,
      canCourse: score >= 50,
      // 缺什么（引导文案用）
      missing: missingList(p, score),
    };
  }

  function missingList(p, score) {
    const out = [];
    if (!p.selectedSubjects.length || !p.baseline) out.push('完成问卷（选科 + 月考起点）');
    const subjectsWithPapers = Object.values(p.perSubject).filter(x => x.papers > 0).length;
    if (subjectsWithPapers < 3) out.push('上传试卷（已覆盖 ' + subjectsWithPapers + '/6 科）');
    const cov = Object.keys(p.knowledgeCovered).filter(s => (p.knowledgeCovered[s] || []).length > 0).length;
    if (cov < 3) out.push('登记已学知识点');
    if (p.mistakes === 0) out.push('做一次 AI 出卷，让系统看到你的真实作答');
    if (!p.hasAptitude) out.push('做一次推理能力测验（5 分钟）');
    return out;
  }

  // ══════════════════════════════════════════════════
  //  AI 学到的持久事实（写入即全 AI 共享）
  // ══════════════════════════════════════════════════

  /**
   * 记一条事实。任何 AI（快速问答/Agent/深度辅导）在对话里
   * 学到关于学生的稳定事实，都调这个 —— 下次所有 AI 都知道。
   *
   * @param {string} key  稳定键（同 key 覆盖），如 '偏好讲解方式'
   * @param {string} text 事实内容
   */
  function fact(key, text) {
    if (!key || !text) return;
    try {
      const facts = Storage.get(FACTS_KEY, {}) || {};
      facts[key] = { text: String(text).slice(0, 300), at: new Date().toISOString() };
      Storage.set(FACTS_KEY, facts);
      Storage.set(FACTS_UPDATED_KEY, new Date().toISOString());
    } catch (e) {}
  }

  function getFact(key) {
    try {
      const facts = Storage.get(FACTS_KEY, {}) || {};
      return facts[key] || null;
    } catch (e) { return null; }
  }

  function allFacts() {
    /**
     * ★ 双源合并（2026-10-31）
     *   · localStorage（页面侧 AI 写的）
     *   · 工作区 .ai-facts.json（Agent 主进程写的）
     * 两边按 key 合并，Agent 写的带 _ai 标记来源。
     */
    let out = {};
    try { out = Storage.get(FACTS_KEY, {}) || {}; } catch (e) {}
    try {
      const ws = (typeof window !== 'undefined' && window.agentBridge && window.agentBridge.workspace);
      // 工作区文件由 preload 暴露的 fs 读取太重——页面侧改用 fetch 不行（file://）。
      // 简单方案：Agent 主进程写完后通过事件推送，或者页面定时拉。
      // 最务实：Agent 每次运行前，主进程已经会把 .ai-facts.json 的内容
      // 注入到快照里（见 agent-ui.js 的 send 逻辑），这里只读 localStorage，
      // 然后合并 window.__aiFactsPush（主进程推送过来的）。
      const pushed = (typeof window !== 'undefined' && window.__aiFactsPush) || {};
      Object.keys(pushed).forEach(k => {
        if (!out[k]) out[k] = pushed[k];
      });
    } catch (e) {}
    return out;
  }

  return {
    profile, brief, learningGap, knowsStudent,
    fact, getFact, allFacts, nextExamInfo,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = StudentProfile;
