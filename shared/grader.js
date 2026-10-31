/**
 * 评分引擎（2026-10-24 新增）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要重写
 * ══════════════════════════════════════════════════════════════
 * 旧逻辑（shared/quiz.js 原来的 grade()）：
 *   选择题：字符串全等 → 10 分
 *   填空题：去空格小写全等 → 10 分
 *   主观题：**只要写了内容就给 5 分**
 *
 * 问题：
 *   · 解答题完全答对，只给 5 分（半分）
 *   · 随便写一句话，也给 5 分
 *   · 这些错误数据会流进错题本 → 薄弱点 → 估分，污染整条链路
 *
 * ══════════════════════════════════════════════════════════════
 * 新设计
 * ══════════════════════════════════════════════════════════════
 * 每题返回一个完整的评分对象：
 *   {
 *     status: 'correct' | 'partial' | 'wrong' | 'blank' | 'pending',
 *     score: 0 ~ fullScore,
 *     fullScore: 本题满分,
 *     points: [{ ok, text, got, max }],   // 评分点逐条
 *     reason: '说明为什么这么判',
 *   }
 *
 * status 含义：
 *   correct  确定答对
 *   partial  部分对（主观题按评分点）
 *   wrong    确定答错
 *   blank    没作答
 *   pending  **无法确定**（模型不确定/表达式无法判定）→ 让学生自己确认
 *
 * 只有 correct 才不进错题本；pending 单独处理，不污染统计。
 */
const Grader = (() => {

  // ══════════════════════════════════════════════════
  //  数字与表达式处理
  // ══════════════════════════════════════════════════

  /** 把各种全角/特殊符号统一成半角 */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\u3000/g, ' ')
      .replace(/[，、]/g, ',')
      .replace(/[（）]/g, m => m === '（' ? '(' : ')')
      .replace(/[－—–]/g, '-')
      .replace(/[×＊]/g, '*')
      .replace(/[÷／]/g, '/')
      .trim();
  }

  /**
   * 解析成数字。
   * 支持：12 / -3.5 / 1/2 / 0.5 / 12.0 / ½ / 百分之50
   * @returns {number|null}
   */
  function toNumber(s) {
    let t = normalize(s);
    if (!t) return null;

    // 去掉常见单位（不影响数值比较）
    t = t.replace(/(cm|mm|m|km|kg|g|mg|s|min|h|L|mL|度|°|元|个|条|人|次|米|厘米|毫米|千克|克|秒|分钟|小时|升|毫升)+\s*$/i, '');

    // 分数 a/b
    const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (frac) {
      const a = parseFloat(frac[1]), b = parseFloat(frac[2]);
      if (b !== 0 && isFinite(a) && isFinite(b)) return a / b;
      return null;
    }

    // 百分数
    const pct = t.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
    if (pct) return parseFloat(pct[1]) / 100;

    // 纯数字（允许千分位逗号）
    const clean = t.replace(/,/g, '');
    if (/^-?\d+(?:\.\d+)?$/.test(clean)) return parseFloat(clean);

    // π 相关：2π / π/2 / π
    if (/^-?\d*(?:\.\d+)?\s*(?:\\?pi|π)$/i.test(clean)) {
      const m = clean.match(/^(-?\d*(?:\.\d+)?)\s*(?:\\?pi|π)$/i);
      const coef = m[1] === '' || m[1] === '-' ? (m[1] === '-' ? -1 : 1) : parseFloat(m[1]);
      return coef * Math.PI;
    }
    const piOver = clean.match(/^(?:\\?pi|π)\s*\/\s*(\d+(?:\.\d+)?)$/i);
    if (piOver) return Math.PI / parseFloat(piOver[1]);

    return null;
  }

  /** 两个字符串是否数学等价 */
  function mathEqual(a, b, tol) {
    const na = toNumber(a), nb = toNumber(b);
    if (na == null || nb == null) return null;   // 无法判定
    const eps = tol != null ? tol : 1e-6;
    return Math.abs(na - nb) < eps;
  }

  /** 规范化文本（用于填空比较） */
  function normText(s) {
    return normalize(s)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[。，、；：""''！？,.;:!?"']/g, '');
  }

  /**
   * 填空答案比较。
   *
   * ★ 修掉旧 bug：原来用"标准答案前缀包含学生答案"判断，
   *   标准答案 12、学生输入 1 也算对。现在必须数值相等。
   *
   * 支持多解：标准答案可以是 "1|2" 或 "1 或 2" 或 "1,2"
   */
  function fillMatch(studentAns, correctAns) {
    const sa = String(studentAns == null ? '' : studentAns).trim();
    if (!sa) return { ok: false, status: 'blank' };

    // 标准答案拆多解
    const candidates = String(correctAns == null ? '' : correctAns)
      .split(/[|｜]|\s+或\s+|;；/)
      .map(x => x.trim())
      .filter(Boolean);

    if (!candidates.length) return { ok: null, status: 'pending', reason: '标准答案缺失' };

    for (const c of candidates) {
      // ① 数值等价
      const numeric = mathEqual(sa, c);
      if (numeric === true) return { ok: true, status: 'correct', matched: c };

      // ② 文本等价（非数值题，如填"细胞膜"）
      if (numeric === null && normText(sa) === normText(c)) {
        return { ok: true, status: 'correct', matched: c };
      }
    }

    // ③ 无法判定数值 → 检查是否至少文本相近
    const allNumeric = candidates.every(c => toNumber(c) != null);
    if (allNumeric && toNumber(sa) == null) {
      // 标准答案是数字，学生答的不是数字 → 可能写了解析式
      return { ok: null, status: 'pending', reason: '标准答案是数值，你的答案不是数字，无法自动判定' };
    }

    return { ok: false, status: 'wrong' };
  }

  // ══════════════════════════════════════════════════
  //  逐题判分
  // ══════════════════════════════════════════════════

  /**
   * 判一道题。
   *
   * @param {object} q  题目 { type, answer, points, fullScore, text }
   * @param {string} studentAnswer
   * @returns {object} 评分对象
   */
  function gradeOne(q, studentAnswer) {
    const type = q.type || 'choice';
    const full = Number(q.fullScore) || (type === 'choice' || type === 'fill' ? 10 : 10);
    const sa = String(studentAnswer == null ? '' : studentAnswer).trim();

    // ── 没作答 ──
    if (!sa) {
      return {
        status: 'blank',
        score: 0,
        fullScore: full,
        points: [],
        reason: '未作答',
      };
    }

    // ── 选择题：标准答案比较（允许 A/a、A.、A、）──
    if (type === 'choice') {
      const cn = normalize(String(q.answer == null ? '' : q.answer))
        .toUpperCase().replace(/[.。、,，\s]/g, '');
      const sn = normalize(sa).toUpperCase().replace(/[.。、,，\s]/g, '');

      if (!cn) {
        return { status: 'pending', score: 0, fullScore: full, points: [], reason: '标准答案缺失' };
      }
      if (sn === cn) {
        return { status: 'correct', score: full, fullScore: full, points: [{ ok: true, text: '选项正确', got: full, max: full }], reason: '' };
      }
      // 学生可能写了选项内容而不是字母
      return { status: 'wrong', score: 0, fullScore: full, points: [{ ok: false, text: '应选 ' + cn, got: 0, max: full }], reason: '' };
    }

    // ── 填空题 ──
    if (type === 'fill') {
      const r = fillMatch(sa, q.answer);
      if (r.status === 'correct') {
        return { status: 'correct', score: full, fullScore: full, points: [{ ok: true, text: '答案正确', got: full, max: full }], reason: '' };
      }
      if (r.status === 'pending') {
        return { status: 'pending', score: 0, fullScore: full, points: [], reason: r.reason || '无法自动判定' };
      }
      return { status: 'wrong', score: 0, fullScore: full, points: [{ ok: false, text: '答案为 ' + String(q.answer || ''), got: 0, max: full }], reason: '' };
    }

    // ── 主观题：按评分点给分 ──
    /**
     * 评分点来源（按优先级）：
     *   ① q.points: [{ text, keywords: [...], score }]  显式评分点
     *   ② q.rubric: "设元1分|联立2分"                    竖线分隔
     *   ③ 没有评分点 → 返回 pending，让学生/模型确认
     *
     * ★ 这里绝不"写了就给半分"。
     *   没有评分标准时，宁可标 pending 让用户确认，也不给假分。
     */
    const rubricPoints = extractRubricPoints(q);
    if (!rubricPoints.length) {
      return {
        status: 'pending',
        score: 0,
        fullScore: full,
        points: [],
        reason: '这道解答题没有评分标准，无法自动判分，请自己确认得分',
      };
    }

    const points = [];
    let got = 0;
    const lower = normText(sa);

    rubricPoints.forEach(p => {
      const kws = p.keywords || [];
      // 有命中任一关键词 → 这点给分
      const hit = kws.length === 0
        ? false
        : kws.some(k => k && lower.indexOf(normText(k)) >= 0);

      if (hit) got += p.score;
      points.push({
        ok: hit,
        text: p.text || (kws.length ? '提到「' + kws[0] + '」' : '评分点'),
        got: hit ? p.score : 0,
        max: p.score,
      });
    });

    got = Math.min(got, full);

    let status;
    if (got >= full) status = 'correct';
    else if (got > 0) status = 'partial';
    else status = 'wrong';

    return {
      status,
      score: got,
      fullScore: full,
      points,
      reason: status === 'partial' ? '部分得分：' + points.filter(p => !p.ok).map(p => '漏了' + p.text).join('、') : '',
    };
  }

  /** 从题目里提取评分点 */
  function extractRubricPoints(q) {
    // ① 数组形式
    if (Array.isArray(q.points) && q.points.length) {
      return q.points.map(p => ({
        text: p.text || '',
        keywords: Array.isArray(p.keywords) ? p.keywords : (p.text ? [p.text] : []),
        score: Number(p.score) || 1,
      }));
    }

    // ② 文本形式 "设元1分|联立2分|求解3分"
    if (typeof q.rubric === 'string' && q.rubric.trim()) {
      const parts = q.rubric.split(/[|｜]/).map(x => x.trim()).filter(Boolean);
      const out = [];
      parts.forEach(part => {
        const m = part.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*分?$/);
        if (m) {
          out.push({ text: m[1].trim(), keywords: [m[1].trim()], score: parseFloat(m[2]) });
        } else {
          out.push({ text: part, keywords: [part], score: 1 });
        }
      });
      return out;
    }

    // ③ 从 answer 里推断（"答案：xxx，步骤：..."）
    if (typeof q.answer === 'string' && q.answer.length > 4) {
      // 有答案但没评分点 → 用答案关键词做单一评分点
      return [{
        text: '与参考答案一致',
        keywords: [q.answer.slice(0, 30)],
        score: Number(q.fullScore) || 10,
      }];
    }

    return [];
  }

  // ══════════════════════════════════════════════════
  //  整卷判分
  // ══════════════════════════════════════════════════

  /**
   * 判一整张卷子。
   *
   * @param {Array} questions 题目数组
   * @param {Array} answers   学生答案数组（同序）
   * @returns {object} { score, fullScore, perQuestion, pendingCount }
   */
  function gradeQuiz(questions, answers) {
    const perQuestion = [];
    let score = 0;
    let fullScore = 0;
    let pendingCount = 0;

    (questions || []).forEach((q, i) => {
      const r = gradeOne(q, answers ? answers[i] : '');
      perQuestion.push(Object.assign({
        index: i,
        text: q.text || '',
        type: q.type || 'choice',
        studentAnswer: answers ? (answers[i] || '') : '',
        correctAnswer: q.answer || '',
      }, r));

      fullScore += r.fullScore;
      // pending 不计入总分（避免用假分污染统计）
      if (r.status === 'pending') {
        pendingCount++;
      } else {
        score += r.score;
      }
    });

    return { score, fullScore, perQuestion, pendingCount };
  }

  // ══════════════════════════════════════════════════
  //  显示辅助
  // ══════════════════════════════════════════════════

  /** 状态标签 */
  function statusLabel(status) {
    return ({
      correct: '✓ 正确',
      partial: '◐ 部分得分',
      wrong: '✗ 错误',
      blank: '— 未作答',
      pending: '? 待确认',
    })[status] || status;
  }

  function statusColor(status) {
    return ({
      correct: 'var(--green)',
      partial: 'var(--amber)',
      wrong: 'var(--red)',
      blank: 'var(--label-tertiary)',
      pending: 'var(--accent)',
    })[status] || 'var(--label-secondary)';
  }

  return {
    // 核心
    gradeOne, gradeQuiz, fillMatch, mathEqual, toNumber, normalize, normText,
    extractRubricPoints,
    // 显示
    statusLabel, statusColor,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Grader;
