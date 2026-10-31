/**
 * 主动式 AI 引擎（2026-10-31）
 *
 * ══════════════════════════════════════════════════════════════
 * 用户原话
 * ══════════════════════════════════════════════════════════════
 * "真正的老师是主动让学生学习，而不是学生去主动学习。
 *  目前这个软件还是比较被动，AI 教师要主动去熟悉学生、认识学生。"
 *
 * ══════════════════════════════════════════════════════════════
 * 设计原则
 * ══════════════════════════════════════════════════════════════
 * ① **不打扰**：同一类提醒一天最多一次，静默可关
 * ② **有理由**：每条主动消息都必须说"为什么现在说"
 * ③ **可执行**：不是"加油哦"，是"现在做这 3 道题"
 * ④ **老师口吻**：像班主任，不像客服
 *
 * ══════════════════════════════════════════════════════════════
 * 四种主动行为
 * ══════════════════════════════════════════════════════════════
 *   greeting    启动问候（知道你是谁、上次做到哪）
 *   gap         缺口追问（AI 还不了解你 → 主动问）
 *   reminder    学习提醒（该复习了 / 好几天没做卷子）
 *   celebrate   进度庆祝（离目标又近了 / 连续天数）
 */
const ProactiveEngine = (() => {

  const SHOWN_KEY = 'proactive_shown';     // { type: 'YYYY-MM-DD' }
  const MUTED_KEY = 'proactive_muted';     // bool

  // ══════════════════════════════════════════════════
  //  基础
  // ══════════════════════════════════════════════════

  function isMuted() {
    try { return Storage.get(MUTED_KEY, false) === true; } catch (e) { return false; }
  }

  function setMuted(v) {
    try { Storage.set(MUTED_KEY, !!v); } catch (e) {}
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  /** 今天这条类型的提醒显示过没有 */
  function shownToday(type) {
    try {
      const shown = Storage.get(SHOWN_KEY, {}) || {};
      return shown[type] === today();
    } catch (e) { return false; }
  }

  function markShown(type) {
    try {
      const shown = Storage.get(SHOWN_KEY, {}) || {};
      shown[type] = today();
      Storage.set(SHOWN_KEY, shown);
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════
  //  判断该说什么（核心逻辑）
  // ══════════════════════════════════════════════════

  /**
   * 算出现在最该说的一句话。
   *
   * 优先级：
   *   1. 缺口追问（AI 太不了解学生 → 这是最该解决的）
   *   2. 复习提醒（有到期错题却不管）
   *   3. 学习提醒（好几天没动静）
   *   4. 进度庆祝（离目标近了）
   *   5. 启动问候（默认）
   *
   * @returns {null | {type, title, body, action, actionLabel, tone}}
   */
  function nextMessage() {
    if (isMuted()) return null;

    let profile = null, know = null, gap = null;
    try {
      if (typeof StudentProfile !== 'undefined') {
        profile = StudentProfile.profile();
        know = StudentProfile.knowsStudent();
        gap = StudentProfile.learningGap();
      }
    } catch (e) { return null; }

    if (!profile || !know) return null;

    // ── 1. 缺口追问 ──
    if (know.score < 45 && !shownToday('gap')) {
      const missing = (know.missing || [])[0] || '你的学习情况';
      return {
        type: 'gap',
        tone: 'ask',
        title: '我想更了解你',
        body: '现在我对你的了解只有 ' + know.score + '%。缺的是：' + missing +
          ' —— 补齐这个我才能给你真建议，不然只能泛泛而谈。',
        action: 'gap-fill',
        actionLabel: '现在补上',
      };
    }

    // ── 2. 复习提醒 ──
    try {
      if (typeof Review !== 'undefined' && Review.dueToday) {
        const due = Review.dueToday();
        if (due.length >= 3 && !shownToday('reminder-review')) {
          return {
            type: 'reminder-review',
            tone: 'remind',
            title: '有 ' + due.length + ' 道题该复习了',
            body: '按间隔复习的安排，这几道今天不复习就会忘。' +
              '先做题再对答案 —— 只看解析不算会。',
            action: 'goto-weakness',
            actionLabel: '去复习',
          };
        }
      }
    } catch (e) {}

    // ── 3. 学习提醒 ──
    try {
      if (typeof Memory !== 'undefined' && !shownToday('reminder-idle')) {
        const lastPaper = Memory.daysSince('paper');
        const lastLesson = Memory.daysSince('lesson');
        const idle = Math.min(
          lastPaper == null ? 99 : lastPaper,
          lastLesson == null ? 99 : lastLesson
        );
        if (idle >= 4 && idle < 99) {
          return {
            type: 'reminder-idle',
            tone: 'remind',
            title: idle + ' 天没动静了',
            body: '上次做卷或上课是 ' + idle + ' 天前。' +
              '不用等状态好才开始 —— 先做 5 道题，做着做着就进去了。',
            action: 'goto-quiz',
            actionLabel: '做 5 道题',
          };
        }
      }
    } catch (e) {}

    // ── 4. 进度庆祝 ──
    if (!shownToday('celebrate')) {
      try {
        if (profile.papers >= 3 && profile.baseline && profile.target) {
          const ratio = Math.min(1, profile.baseline / profile.target);
          if (ratio >= 0.75) {
            return {
              type: 'celebrate',
              tone: 'good',
              title: '你已经走到 ' + Math.round(ratio * 100) + '% 了',
              body: '从 ' + profile.baseline + ' 到 ' + profile.target +
                ' 这条路，你走了一大半。剩下的 ' + Math.round(profile.target - profile.baseline) +
                ' 分，是每科再提一点点就能拿到的。',
              action: 'goto-progress',
              actionLabel: '看进度条',
            };
          }
        }
      } catch (e) {}
    }

    // ── 5. 启动问候 ──
    if (!shownToday('greeting')) {
      const h = new Date().getHours();
      const when = h < 6 ? '这么早就醒了' : h < 11 ? '早上好' :
        h < 14 ? '中午好' : h < 18 ? '下午好' : h < 23 ? '晚上好' : '还不睡';

      let body = when + '。';
      try {
        if (typeof Memory !== 'undefined') {
          const recent = Memory.recentEvents(1);
          if (recent.length) {
            const n = recent.length;
            body += '昨天到今天你做了 ' + n + ' 件事，' +
              (gap && gap.weakPoints && gap.weakPoints.length
                ? '下一步建议补「' + gap.weakPoints[0] + '」。'
                : '继续保持。');
          } else {
            body += '今天还没开始 —— ' +
              (gap && gap.nextExam
                ? '距' + gap.nextExam.kind + '还有 ' + gap.nextExam.daysLeft + ' 天，现在开始就不算晚。'
                : '先做 5 道题热热身？');
          }
        }
      } catch (e) {}

      return {
        type: 'greeting',
        tone: 'greet',
        title: '我是你的老师',
        body: body,
        action: 'goto-chat',
        actionLabel: '聊聊',
      };
    }

    return null;
  }

  /** 拿到消息后标记已显示（调用方决定什么时候标） */
  function acknowledge(msg) {
    if (!msg || !msg.type) return;
    markShown(msg.type);
    try {
      if (typeof Memory !== 'undefined') {
        Memory.addEvent('proactive', { type: msg.type });
      }
    } catch (e) {}
  }

  return {
    nextMessage, acknowledge, isMuted, setMuted,
    _reset: function () { try { Storage.remove(SHOWN_KEY); } catch (e) {} },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ProactiveEngine;
