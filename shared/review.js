/**
 * 错题复习引擎（2026-10-24 新增）
 *
 * ══════════════════════════════════════════════════════════════
 * 用户痛点（来自产品评估）
 * ══════════════════════════════════════════════════════════════
 * "用户真正需要的不是一直看到错题数量增加，而是知道：
 *   今天该复习哪几道？这道题为什么反复错？我现在到底会不会了？"
 *
 * 现状：错题本只展示最近 20 道，看完就完了。
 *
 * ══════════════════════════════════════════════════════════════
 * 这个文件提供
 * ══════════════════════════════════════════════════════════════
 *   ① 间隔复习排程（今天该复习哪些）
 *   ② 重做记录（看懂了 / 当场做对 / 隔几天仍做对）
 *   ③ 掌握状态判定（不能靠"点一下已掌握"）
 *   ④ 反复错的题标记为"需要补课"
 *
 * ══════════════════════════════════════════════════════════════
 * 复习间隔（简化版 SM-2）
 * ══════════════════════════════════════════════════════════════
 *   第 1 次做对  → 1 天后复习
 *   第 2 次做对  → 3 天后
 *   第 3 次做对  → 7 天后
 *   第 4 次做对  → 16 天后
 *   第 5 次做对  → 35 天后 → 标记"已掌握"
 *   做错         → 重置到第 1 档（1 天后）
 */
const Review = (() => {

  // 复习间隔阶梯（天）
  const INTERVALS = [1, 3, 7, 16, 35];

  // 掌握所需连续正确次数
  const MASTER_LEVEL = 5;

  // ══════════════════════════════════════════════════
  //  复习状态存取
  // ══════════════════════════════════════════════════

  /** 拿到所有复习状态 { mistakeId: {...} } */
  function allState() {
    try { return Storage.get('review_state', {}) || {}; } catch (e) { return {}; }
  }

  function saveState(s) {
    try { Storage.set('review_state', s || {}); } catch (e) {}
  }

  /** 某道错题的复习状态 */
  function stateOf(mistakeId) {
    const s = allState();
    return s[mistakeId] || {
      level: 0,             // 连续做对次数
      attempts: 0,          // 总重做次数
      correct: 0,           // 重做正确次数
      lastAt: null,         // 上次重做时间
      nextAt: null,         // 下次该复习的时间
      mastered: false,      // 是否判定掌握
      // 三种复习方式的记录
      readOnly: 0,          // 只看了解析
      sameDay: 0,           // 当场做对
      laterDays: 0,         // 隔几天仍做对
    };
  }

  function mistakeKey(m) {
    // 优先用 id；没有就用科目+题干哈希
    if (m.id) return String(m.id);
    const t = (m.subject || '') + '|' + (m.question || '').slice(0, 60);
    let h = 0;
    for (let i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
    return 'k' + Math.abs(h).toString(36);
  }

  // ══════════════════════════════════════════════════
  //  排程
  // ══════════════════════════════════════════════════

  /**
   * 今天该复习哪些题。
   *
   * @param {object} opts { limit, subject }
   * @returns {Array} 错题数组（含 _review 字段）
   */
  function dueToday(opts) {
    const o = opts || {};
    const limit = o.limit || 20;
    const mistakes = Storage.getMistakes() || [];
    const states = allState();
    const now = Date.now();

    const due = [];

    mistakes.forEach(m => {
      const key = mistakeKey(m);
      const st = states[key] || { level: 0, attempts: 0, nextAt: null, mastered: false };

      // 已掌握的不再排
      if (st.mastered) return;

      // 按科目过滤
      if (o.subject && m.subject !== o.subject) return;

      // 判断是否到期
      let isDue = false;
      if (!st.nextAt) {
        // 从没复习过 → 立即到期
        isDue = true;
      } else {
        isDue = new Date(st.nextAt).getTime() <= now;
      }

      if (isDue) {
        due.push(Object.assign({}, m, {
          _key: key,
          _review: Object.assign({}, st, {
            // 给 UI 用的提示
            why: st.attempts === 0
              ? '还没复习过'
              : (st.level === 0 ? '上次做错了，重新开始' : '间隔 ' + (INTERVALS[Math.min(st.level, INTERVALS.length - 1)] || 1) + ' 天到了'),
          }),
        }));
      }
    });

    // 排序：反复错的优先 → 没复习过的 → 到期久的
    due.sort((a, b) => {
      const ca = (a.count || 1);
      const cb = (b.count || 1);
      if (cb !== ca) return cb - ca;    // 错得多的先
      const la = a._review.attempts || 0;
      const lb = b._review.attempts || 0;
      return la - lb;                    // 没复习过的先
    });

    return due.slice(0, limit);
  }

  /** 统计：今天待复习几道、已掌握几道、需补课几道 */
  function stats() {
    const mistakes = Storage.getMistakes() || [];
    const states = allState();
    const now = Date.now();

    let due = 0, mastered = 0, needTutoring = 0, learning = 0;

    mistakes.forEach(m => {
      const key = mistakeKey(m);
      const st = states[key] || { level: 0, nextAt: null, mastered: false };

      if (st.mastered) { mastered++; return; }

      // 错 3 次以上且一直没掌握 → 需要补课
      if ((m.count || 1) >= 3 && (st.level || 0) === 0 && (st.attempts || 0) >= 2) {
        needTutoring++;
        return;
      }

      const isDue = !st.nextAt || new Date(st.nextAt).getTime() <= now;
      if (isDue) due++;
      else learning++;
    });

    return {
      total: mistakes.length,
      due,
      mastered,
      needTutoring,
      learning,
    };
  }

  // ══════════════════════════════════════════════════
  //  重做
  // ══════════════════════════════════════════════════

  /**
   * 记录一次重做结果。
   *
   * @param {object} mistake 错题
   * @param {object} result { type: 'read'|'correct'|'wrong', via: 'self'|'ai' }
   *   type:
   *     'read'    只看了解析（不算掌握）
   *     'correct' 自己做对了
   *     'wrong'   又做错了
   * @returns {object} 更新后的状态
   */
  function recordAttempt(mistake, result) {
    const key = mistakeKey(mistake);
    const states = allState();
    const st = Object.assign({
      level: 0, attempts: 0, correct: 0,
      lastAt: null, nextAt: null, mastered: false,
      readOnly: 0, sameDay: 0, laterDays: 0,
    }, states[key] || {});

    const now = Date.now();
    const type = result && result.type ? result.type : 'wrong';

    st.lastAt = new Date(now).toISOString();
    st.attempts = (st.attempts || 0) + 1;

    if (type === 'read') {
      // ★ 只看了解析 → **不推进等级**
      //   这是产品评估明确指出的："避免点一下已掌握就认定掌握"
      st.readOnly = (st.readOnly || 0) + 1;
      // 明天再来
      st.nextAt = new Date(now + 24 * 3600 * 1000).toISOString();

    } else if (type === 'correct') {
      st.correct = (st.correct || 0) + 1;
      st.level = Math.min((st.level || 0) + 1, MASTER_LEVEL);

      // 区分"当场做对"和"隔几天仍做对"
      const daysSinceLast = st.lastAt ? (now - new Date(st.lastAt).getTime()) / 86400000 : 0;
      if (daysSinceLast >= 1) {
        st.laterDays = (st.laterDays || 0) + 1;
      } else {
        st.sameDay = (st.sameDay || 0) + 1;
      }

      // 连续做对到顶 → 判定掌握
      if (st.level >= MASTER_LEVEL && st.laterDays >= 2) {
        st.mastered = true;
        st.nextAt = null;
      } else {
        const days = INTERVALS[Math.min(st.level, INTERVALS.length - 1)] || 1;
        st.nextAt = new Date(now + days * 24 * 3600 * 1000).toISOString();
      }

    } else {
      // 做错 → 等级归零
      st.level = 0;
      st.nextAt = new Date(now + 24 * 3600 * 1000).toISOString();
    }

    states[key] = st;
    saveState(states);

    // 记一笔活动
    try {
      Storage.addAct({
        icon: type === 'correct' ? '✅' : (type === 'wrong' ? '❌' : '📖'),
        title: '复习「' + (mistake.knowledge || mistake.subject || '错题') + '」：' +
          (type === 'correct' ? '做对了（第 ' + st.level + ' 次）'
            : type === 'wrong' ? '又错了，重新开始'
            : '看了解析'),
      });
    } catch (e) {}

    return st;
  }

  /**
   * 掌握状态的人类可读描述。
   * ★ 不用"已掌握/未掌握"二元判断，用五档描述。
   */
  function masteryLabel(st) {
    if (!st) return { label: '未复习', color: 'var(--label-tertiary)' };
    if (st.mastered) return { label: '已掌握', color: 'var(--green)' };

    const lv = st.level || 0;
    if (lv === 0) {
      if ((st.attempts || 0) === 0) return { label: '未复习', color: 'var(--label-tertiary)' };
      return { label: '还没做对', color: 'var(--red)' };
    }
    if (lv === 1) return { label: '刚做对 1 次', color: 'var(--amber)' };
    if (lv === 2) return { label: '做对 2 次', color: 'var(--amber)' };
    if (lv === 3) return { label: '做对 3 次', color: 'var(--accent)' };
    return { label: '做对 ' + lv + ' 次，快掌握了', color: 'var(--accent)' };
  }

  /**
   * 下次复习时间的可读描述。
   */
  function nextLabel(st) {
    if (!st || !st.nextAt) {
      if (st && st.mastered) return '不用再复习';
      return '现在就可以复习';
    }
    const ms = new Date(st.nextAt).getTime() - Date.now();
    if (ms <= 0) return '该复习了';

    const h = Math.floor(ms / 3600000);
    if (h < 24) return h + ' 小时后';
    const d = Math.floor(h / 24);
    return d + ' 天后';
  }

  // ══════════════════════════════════════════════════
  //  按维度筛选（产品评估要求）
  // ══════════════════════════════════════════════════

  /**
   * 筛选错题。
   * @param {object} f { subject, knowledge, status, keyword, days }
   */
  function filter(f) {
    const o = f || {};
    let list = Storage.getMistakes() || [];
    const states = allState();
    const now = Date.now();

    // 附带复习状态
    list = list.map(m => {
      const key = mistakeKey(m);
      return Object.assign({}, m, {
        _key: key,
        _review: states[key] || { level: 0, attempts: 0, mastered: false },
      });
    });

    if (o.subject) list = list.filter(m => m.subject === o.subject);
    if (o.knowledge) list = list.filter(m => (m.knowledge || '').indexOf(o.knowledge) >= 0);

    if (o.status === 'due') {
      list = list.filter(m => !m._review.mastered &&
        (!m._review.nextAt || new Date(m._review.nextAt).getTime() <= now));
    } else if (o.status === 'mastered') {
      list = list.filter(m => m._review.mastered);
    } else if (o.status === 'learning') {
      list = list.filter(m => !m._review.mastered && m._review.level > 0);
    } else if (o.status === 'repeat') {
      // 反复错：错 3 次以上
      list = list.filter(m => (m.count || 1) >= 3);
    }

    if (o.keyword) {
      const k = o.keyword.toLowerCase();
      list = list.filter(m =>
        (m.question || '').toLowerCase().indexOf(k) >= 0 ||
        (m.knowledge || '').toLowerCase().indexOf(k) >= 0);
    }

    if (o.days) {
      const cut = now - o.days * 86400000;
      list = list.filter(m => new Date(m.date || m.at || 0).getTime() >= cut);
    }

    return list;
  }

  /** 可选的科目列表 */
  function subjects() {
    const set = {};
    (Storage.getMistakes() || []).forEach(m => { if (m.subject) set[m.subject] = (set[m.subject] || 0) + 1; });
    return Object.keys(set).map(s => ({ subject: s, count: set[s] })).sort((a, b) => b.count - a.count);
  }

  /** 可选的知识点列表 */
  function knowledgePoints() {
    const set = {};
    (Storage.getMistakes() || []).forEach(m => {
      const k = m.knowledge || '未分类';
      set[k] = (set[k] || 0) + 1;
    });
    return Object.keys(set).map(k => ({ name: k, count: set[k] })).sort((a, b) => b.count - a.count);
  }

  return {
    INTERVALS, MASTER_LEVEL,
    dueToday, stats, recordAttempt,
    masteryLabel, nextLabel,
    filter, subjects, knowledgePoints,
    stateOf, mistakeKey, allState,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Review;
