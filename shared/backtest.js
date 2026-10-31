/**
 * 前瞻回溯（P5，2026-10-10）
 *
 * 为什么必须有这个模块：
 *   到目前为止所有"准确率"的说法都站不住 —— 合成数据只能验证代码路径，
 *   不能证明预测准不准（这是 _calib.js 的循环论证）。
 *
 *   **唯一能证明真实精度的路**是：
 *     ① 每次估算时，把"预测了什么"原样存下来（时间、输入摘要、输出、区间）
 *     ② 将来学生真考了，把真实分录入
 *     ③ 比对：误差多大？区间有没有覆盖住？
 *
 * 这个模块只做三件事：**存档 / 录入真值 / 算回溯指标**。不做任何预测。
 */
const Backtest = (() => {
  const KEY = 'forecasts';      // 预测存档
  const KEY_TRUTH = 'truths';   // 真实成绩

  function round5(x) { return Math.round((Number(x) || 0) * 100000) / 100000; }

  // ══════════════════════════════════════════════════════
  //  ① 存档：每次估算都留一份快照
  // ══════════════════════════════════════════════════════
  /**
   * @param {object} est  ProgressEngine 的结果（或 setTotalEstimate 存的那份）
   * @param {object} ctx  上下文 { reason, goal, papersSummary }
   */
  function record(est, ctx) {
    if (!est) return null;
    ctx = ctx || {};
    const list = Storage.get(KEY, []) || [];

    const snap = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      /** 存档时间 —— 这是回溯的基准点，必须准确 */
      at: new Date().toISOString(),
      reason: ctx.reason || '',
      /** 距高考还有多少天（回溯时要知道"当时离考试多远"） */
      daysLeft: est.daysLeft != null ? est.daysLeft : null,

      /**
       * ★ 预测内容：**原样保留**，不重新计算。
       *   重新计算会引入"事后用新算法解释旧预测"的偏差。
       */
      total: est.total == null ? null : round5(est.total),
      projected: est.projected == null ? null : round5(est.projected),
      currentRange: est.currentRange || null,
      totalRange: est.totalRange || null,
      totalRangeMethod: (est.totalRange || {}).breakdown || null,
      subjectScores: est.subjectScores || {},
      subjectProjected: est.subjectProjected || {},
      confidence: est.confidence != null ? est.confidence : null,
      method: est.method || 'local',

      /** 输入摘要（用于事后分析"为什么错"）：只存摘要，不存全量数据 */
      inputs: {
        nPapers: ctx.nPapers || 0,
        nQuestions: ctx.nQuestions || 0,
        evidenceBrief: (est.evidence || []).map(e => ({
          subject: e.subject,
          nPapers: e.nPapers, nQuestions: e.nQuestions,
          ratio: e.ratio, difficultyLevel: e.difficultyLevel,
          coverage: e.coverage, sufficiency: e.sufficiency,
          gradeAssigned: e.gradeAssigned,
        })),
      },
    };

    list.push(snap);
    // 只保留最近 200 条，避免 localStorage 膨胀
    if (list.length > 200) list.splice(0, list.length - 200);
    Storage.set(KEY, list);
    return snap;
  }

  function list() { return Storage.get(KEY, []) || []; }
  function clear() { Storage.set(KEY, []); }

  // ══════════════════════════════════════════════════════
  //  ② 真值：学生真考了多少
  // ══════════════════════════════════════════════════════
  /**
   * 录入真实成绩。
   * @param {object} t { subject?, score, fullScore?, source, date, note? }
   *   subject 为空表示这是总分（用于校验 total/projected）
   */
  function recordTruth(t) {
    if (!t || !isFinite(Number(t.score))) return null;
    const list = Storage.get(KEY_TRUTH, []) || [];
    const row = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      subject: t.subject || null,
      score: round5(Number(t.score)),
      fullScore: isFinite(Number(t.fullScore)) ? Number(t.fullScore) : null,
      source: t.source || 'unknown',
      date: t.date || new Date().toISOString().slice(0, 10),
      note: (t.note || '').toString().slice(0, 200),
      addedAt: new Date().toISOString(),
    };
    list.push(row);
    Storage.set(KEY_TRUTH, list);
    return row;
  }
  function truths() { return Storage.get(KEY_TRUTH, []) || []; }
  function delTruth(id) { Storage.set(KEY_TRUTH, truths().filter(r => r.id !== id)); }

  // ══════════════════════════════════════════════════════
  //  ③ 回溯指标：到底准不准
  // ══════════════════════════════════════════════════════
  /**
   * 计算回溯指标。
   *
   * 配对规则：按**科目 + 时间顺序**把预测和真值配对 ——
   * 取真值日期之前、**最近一次**针对该科目的预测。
   * （不能用"之后"的预测，那是偷看未来。）
   *
   * @returns {object} { pairs, mae, rmse, bias, coverage, bySubject, n }
   *   mae      平均绝对误差
   *   rmse     均方根误差（对大错更敏感）
   *   bias     有符号偏差（正=系统性高估）
   *   coverage 区间覆盖率（PICP）—— **这是"诚实度"的核心指标**
   *            95% 区间应该真的覆盖 ~95% 的真值；远低于 95% 说明区间太窄（吹牛）
   */
  function evaluate() {
    const fs = list();
    const ts = truths();
    const pairs = [];

    ts.forEach(t => {
      const tDate = new Date(t.date).getTime();
      if (isNaN(tDate)) return;

      // 找真值日期之前、最近的一次预测
      let best = null;
      fs.forEach(f => {
        const fDate = new Date(f.at).getTime();
        if (isNaN(fDate) || fDate > tDate) return;   // 只看"过去"的预测
        if (t.subject) {
          // 单科真值 → 必须有该科的预测
          const ps = (f.subjectScores || {})[t.subject];
          if (ps == null) return;
        } else if (f.total == null) return;          // 总分真值 → 必须有总分预测
        if (!best || fDate > new Date(best.at).getTime()) best = f;
      });
      if (!best) return;

      const pred = t.subject ? (best.subjectScores || {})[t.subject] : best.total;
      if (pred == null) return;

      // 区间：单科用 subjectProjectedRange，总分用 totalRange
      let range = null;
      if (t.subject) {
        const pr = (best.subjectProjectedRange || {})[t.subject];
        if (pr) range = { low: pr.low, high: pr.high };
      } else if (best.totalRange) {
        range = { low: best.totalRange.low, high: best.totalRange.high };
      }

      const err = Number(t.score) - Number(pred);
      pairs.push({
        subject: t.subject || '总分',
        truthDate: t.date,
        forecastAt: best.at,
        predicted: round5(pred),
        actual: round5(t.score),
        error: round5(err),
        absError: round5(Math.abs(err)),
        range,
        covered: range ? (t.score >= range.low && t.score <= range.high) : null,
        leadDays: Math.round((tDate - new Date(best.at).getTime()) / 86400000),
        method: best.method,
      });
    });

    if (!pairs.length) {
      return { pairs: [], n: 0, mae: null, rmse: null, bias: null, coverage: null, bySubject: {}, note: '还没有可配对的预测与真值' };
    }

    const n = pairs.length;
    const mae = pairs.reduce((a, p) => a + p.absError, 0) / n;
    const rmse = Math.sqrt(pairs.reduce((a, p) => a + p.error * p.error, 0) / n);
    const bias = pairs.reduce((a, p) => a + p.error, 0) / n;

    const withRange = pairs.filter(p => p.covered != null);
    const coverage = withRange.length
      ? withRange.filter(p => p.covered).length / withRange.length
      : null;

    // 分科指标
    const bySubject = {};
    pairs.forEach(p => {
      if (!bySubject[p.subject]) bySubject[p.subject] = [];
      bySubject[p.subject].push(p);
    });
    Object.keys(bySubject).forEach(k => {
      const arr = bySubject[k];
      bySubject[k] = {
        n: arr.length,
        mae: round5(arr.reduce((a, p) => a + p.absError, 0) / arr.length),
        bias: round5(arr.reduce((a, p) => a + p.error, 0) / arr.length),
      };
    });

    /**
     * 诚实度判断：
     *   区间覆盖率应接近 95%。明显偏低（<70%）说明区间太窄、在吹牛；
     *   明显偏高（>99%）说明区间太宽、没有信息量。
     */
    let honesty = 'unknown';
    if (coverage != null && withRange.length >= 5) {
      honesty = coverage >= 0.85 ? 'good' : coverage >= 0.70 ? 'tight' : 'overconfident';
    }

    return {
      pairs: pairs,
      n: n,
      mae: round5(mae),
      rmse: round5(rmse),
      bias: round5(bias),
      coverage: coverage == null ? null : round5(coverage),
      coverageN: withRange.length,
      honesty: honesty,
      bySubject: bySubject,
      note: n < 5 ? '样本太少（' + n + ' 对），指标仅供参考' : '',
    };
  }

  /** 一句话总结（给界面用） */
  function summary() {
    const e = evaluate();
    if (!e.n) return '还没有真实成绩可以回溯。等你考完把真实分录进来，这里会显示预测到底准不准。';
    let s = '已配对 ' + e.n + ' 次预测与实际成绩：平均绝对误差 ' + fx1(e.mae) + ' 分';
    if (e.bias != null) s += '，偏差 ' + (e.bias >= 0 ? '+' : '') + fx1(e.bias) + '（正=偏乐观）';
    if (e.coverage != null) s += '；95% 区间实际覆盖 ' + Math.round(e.coverage * 100) + '%';
    if (e.note) s += '。' + e.note;
    return s;
  }
  function fx1(x) { return (Math.round(Number(x) * 10) / 10).toString(); }

  return {
    record, list, clear,
    recordTruth, truths, delTruth,
    evaluate, summary,
  };
})();
