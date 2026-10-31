/**
 * 统一记忆中枢（2026-10-31）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要这个
 * ══════════════════════════════════════════════════════════════
 * 审计发现 4 个 AI 里只有 2 个用共享档案：
 *   快速问答    ✓ 用 persona()
 *   TutorHub    ✓ 用 brief()
 *   Agent       ✗ 完全不知道学生是谁
 *   深度辅导    ✗ 完全不知道学生是谁
 *
 * 用户原话："这几个 AI 的记忆也要打通"。
 *
 * 这个模块是**唯一入口**：任何 AI 发请求前，都调 Memory.context()
 * 拿到同一份学生上下文。谁也不能自己拼。
 *
 * ══════════════════════════════════════════════════════════════
 * 三层记忆
 * ══════════════════════════════════════════════════════════════
 * ① 档案记忆（StudentProfile）—— 静态事实：起点、目标、选科、知识点
 * ② 对话记忆（Memory.turns）—— 最近聊过什么，防止重复问同一个问题
 * ③ 事件记忆（Memory.events）—— 做过什么：上课、做卷、复习、提分
 */
const Memory = (() => {

  const TURNS_KEY = 'mem_turns';
  const EVENTS_KEY = 'mem_events';
  const MAX_TURNS = 40;
  const MAX_EVENTS = 60;

  // ══════════════════════════════════════════════════
  //  ② 对话记忆
  // ══════════════════════════════════════════════════

  /** 记一条对话（谁说的、哪个 AI、什么内容） */
  function addTurn(turn) {
    try {
      const turns = getTurns();
      turns.push({
        at: new Date().toISOString(),
        by: turn.by || 'student',      // 'student' | 'ai' | 'system'
        ai: turn.ai || '',             // 'quick' | 'tutor' | 'agent' | 'deep'
        text: String(turn.text || '').slice(0, 500),
        topic: turn.topic || '',
      });
      if (turns.length > MAX_TURNS) turns.splice(0, turns.length - MAX_TURNS);
      Storage.set(TURNS_KEY, turns);
    } catch (e) {}
  }

  function getTurns() {
    try { return Storage.get(TURNS_KEY, []) || []; } catch (e) { return []; }
  }

  /** 最近 N 轮对话，格式化成一句话摘要 */
  function recentSummary(n) {
    const turns = getTurns().slice(-(n || 6));
    if (!turns.length) return '';
    return turns.map(t => {
      const who = t.by === 'student' ? '学生' : '我';
      return who + '：' + t.text.slice(0, 80);
    }).join('\n');
  }

  /** 学生问过哪些主题（防止重复讲） */
  function askedTopics() {
    const set = new Set();
    getTurns().filter(t => t.by === 'student' && t.topic).forEach(t => set.add(t.topic));
    return Array.from(set);
  }

  // ══════════════════════════════════════════════════
  //  ③ 事件记忆
  // ══════════════════════════════════════════════════

  /** 记一个学习事件 */
  function addEvent(type, detail) {
    try {
      const events = getEvents();
      events.push({
        at: new Date().toISOString(),
        type: type,                    // 'paper' | 'lesson' | 'review' | 'quiz' | 'monitor' | 'plan'
        detail: detail || {},
      });
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
      Storage.set(EVENTS_KEY, events);
    } catch (e) {}
  }

  function getEvents() {
    try { return Storage.get(EVENTS_KEY, []) || []; } catch (e) { return []; }
  }

  /** 最近 N 天做过什么（供主动引擎判断"该提醒什么"） */
  function recentEvents(days) {
    const cutoff = Date.now() - (days || 7) * 86400000;
    return getEvents().filter(e => new Date(e.at).getTime() >= cutoff);
  }

  /** 距离上次某类事件过了多久（天） */
  function daysSince(type) {
    const ev = getEvents().filter(e => e.type === type);
    if (!ev.length) return null;
    const last = ev[ev.length - 1];
    return Math.floor((Date.now() - new Date(last.at).getTime()) / 86400000);
  }

  // ══════════════════════════════════════════════════
  //  统一上下文（最关键）
  // ══════════════════════════════════════════════════

  /**
   * 给任何 AI 的完整上下文。
   *
   * 这是**所有 AI 唯一该调的东西**。
   * 返回的对象里 text 字段直接塞进 system prompt。
   *
   * @param {object} opts { forAi: 'quick'|'tutor'|'agent'|'deep', includeTurns: bool }
   * @returns {{text:string, profile:object, know:object, gap:object}}
   */
  function context(opts) {
    const o = opts || {};
    const parts = [];

    // ① 档案
    let profile = null, know = null, gap = null;
    try {
      if (typeof StudentProfile !== 'undefined') {
        profile = StudentProfile.profile();
        know = StudentProfile.knowsStudent();
        gap = StudentProfile.learningGap();
        parts.push(StudentProfile.brief());
      }
    } catch (e) {}

    // ② 我有多了解他（主动 AI 需要知道自己"还不了解"）
    if (know) {
      parts.push('');
      parts.push('【你对他的了解程度】' + know.score + '%' +
        (know.score < 35 ? '（还很浅，别装懂，多问少断言）' :
         know.score < 60 ? '（大致清楚，细节可追问）' :
         '（相当熟悉，可以直接建议）'));
      if (know.missing && know.missing.length) {
        parts.push('【还不知道的】' + know.missing.slice(0, 3).join('；'));
      }
    }

    // ③ 在学什么 / 该学什么
    if (gap && gap.weakPoints && gap.weakPoints.length) {
      parts.push('【他的薄弱点】' + gap.weakPoints.slice(0, 5).join('、'));
    }
    if (gap && gap.nextExam) {
      parts.push('【下次考试】' + gap.nextExam.date + '（' + gap.nextExam.kind +
        '，' + gap.nextExam.daysLeft + ' 天后）');
    }

    // ④ 最近事件（AI 知道学生这两天干了什么）
    const recent = recentEvents(3);
    if (recent.length) {
      const byType = {};
      recent.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });
      const label = { paper: '做卷', lesson: '上课', review: '复习', quiz: '做题', monitor: '监控学习', plan: '排计划' };
      const items = Object.keys(byType).map(k => (label[k] || k) + ' ' + byType[k] + ' 次');
      parts.push('【最近 3 天】' + items.join('、'));
    }

    // ⑤ 对话记忆（防止重复问、重复讲）
    if (o.includeTurns !== false) {
      const turns = getTurns().slice(-4);
      if (turns.length) {
        parts.push('');
        parts.push('【刚才聊过】');
        turns.forEach(t => {
          parts.push((t.by === 'student' ? '学生' : '你') + '：' + t.text.slice(0, 60));
        });
        parts.push('（别重复问已经答过的，接着往下说）');
      }
    }

    return {
      text: parts.join('\n'),
      profile: profile,
      know: know,
      gap: gap,
    };
  }

  // ══════════════════════════════════════════════════
  //  清空（调试用）
  // ══════════════════════════════════════════════════
  function clear() {
    try { Storage.remove(TURNS_KEY); } catch (e) {}
    try { Storage.remove(EVENTS_KEY); } catch (e) {}
  }

  return {
    addTurn, getTurns, recentSummary, askedTopics,
    addEvent, getEvents, recentEvents, daysSince,
    context, clear,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Memory;
