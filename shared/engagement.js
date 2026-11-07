/**
 * 学习过程信号（Engagement）2026-11-07
 *
 * ══════════════════════════════════════════════════════════════
 * 定位（非常重要，别用错）
 * ══════════════════════════════════════════════════════════════
 * 审计发现：本应用其实**采集了**学习行为数据 ——
 *   · 摄像头专注度（shared/proctor.js → last_proctor_session.focusRate）
 *   · 学习时长（xt_stats.totalMin / weeklyMin）
 *   · 连续天数（xt_stats.streak）
 *   · 做题次数（xt_stats.monthlyQuiz）
 *   · 活动日志（xt_acts）、事件记忆（mem_events）
 * 但这些数据**完全没有参与任何估分**：EvidenceEngine 和 ProgressEngine
 * 一次都没读过这些 key。而且 Storage.addLesson()/addPractice() 零调用，
 * evidence-v2.js 里预留的「上课/练习」证据在运行时恒为空。
 *
 * 用户提出「接入大数据非特定性相关性信息，提高预测准确度（例如监测学习认真度）」。
 *
 * 但专业判断是：**不能把这些信号当作「能力证据」塞进贝叶斯后验**。
 * 理由：
 *   ① 精度加权融合 (evidence-v2.js fuse) 假设各证据独立，
 *      而「认真学习」同时导致「多学」和「考得好」，是相关而非独立 —— 
 *      硬加一路会虚假收窄预测区间，产出「更自信但更不准」的数字。
 *   ② 现在没有任何 (预测, 真值) 样本可以校准系数（backtest.js 要求 n≥5），
 *      所有权重只能拍脑袋，属于「精致的编造」。
 *   ③ 项目自己引用的 Macnamara 2014 说单纯时长只解释约 1% 的 variance。
 *   ④ webcam 姿态 → 认知投入 → 能力，是两层未验证的推断，噪声大。
 *
 * 所以这个模块只做三件事：
 *   A. 把散落的行为数据**如实聚合**（不加工成「能力分」）
 *   B. 提供给 UI 展示为「间接 / 弱证据」，并明确标注「未校准」
 *   C. 只用于替换 projectSubject 里那个拍脑袋的 efficiency=0.55，
 *      让它影响「未来能提多少」，**不影响「现在水平」**，且放宽区间
 *
 * 明确不做：
 *   · 不把 focusRate 当能力证据 push 进 estimateSubject
 *   · 不做专注度打分/排名/惩罚（避免把学习监控变成监考）
 *   · 不因专注度低而下调「现在分」
 *   · 不上传任何数据（usage-stats.js 的隐私承诺不变）
 */
const Engagement = (() => {

  /** 近 N 天窗口 */
  const WINDOW_DAYS = 28;

  function safeGet(key, d) {
    try { const v = Storage.get(key, d); return v == null ? d : v; } catch (e) { return d; }
  }

  /**
   * 从真实落盘数据聚合过程信号。
   * 所有字段都带 hasData 标记：没有数据就是 null，绝不填充默认值冒充事实。
   */
  function collect() {
    const stats = safeGet('stats', {}) || {};
    const acts = safeGet('acts', []) || [];
    const events = (typeof Memory !== 'undefined' && Memory.getEvents)
      ? (Memory.getEvents() || []) : [];
    const monitor = safeGet('last_proctor_session', null);
    const daily = safeGet('daily', {});

    // ① 摄像头专注度（只取最近一次会话，没有就是 null）
    let focusRate = null;
    if (monitor && isFinite(Number(monitor.focusRate))) {
      const f = Number(monitor.focusRate);
      if (f >= 0 && f <= 1) focusRate = f;
    }

    // ② 累计学习分钟（真实行为产生，非计划时长）
    const totalMin = isFinite(Number(stats.totalMin)) ? Number(stats.totalMin) : null;
    const weeklyMin = isFinite(Number(stats.weeklyMin)) ? Number(stats.weeklyMin) : null;

    // ③ 连续天数 / 本月做题
    const streak = isFinite(Number(stats.streak)) ? Number(stats.streak) : null;
    const monthlyQuiz = isFinite(Number(stats.monthlyQuiz)) ? Number(stats.monthlyQuiz) : null;

    // ④ 近 28 天活动条数（从 xt_acts 与 mem_events 两个源去重按日期数）
    const cutoff = Date.now() - WINDOW_DAYS * 86400000;
    const recentActDays = new Set();
    acts.forEach(a => {
      const t = new Date(a.at || a.time || a.date || 0).getTime();
      if (isFinite(t) && t >= cutoff) recentActDays.add(new Date(t).toDateString());
    });
    events.forEach(e => {
      const t = new Date(e.at || 0).getTime();
      if (isFinite(t) && t >= cutoff) recentActDays.add(new Date(t).toDateString());
    });
    const activeDays = recentActDays.size;

    // ⑤ 今日计划完成度（计划 vs 实际分开，这是真实勾选行为）
    let planDoneRatio = null;
    if (daily && Array.isArray(daily.tasks) && daily.tasks.length) {
      const done = Array.isArray(daily.done) ? daily.done.length : 0;
      planDoneRatio = done / daily.tasks.length;
    }

    // 数据充足度：有多少类信号是真的有值
    const present = [focusRate, totalMin, weeklyMin, streak, monthlyQuiz, planDoneRatio]
      .filter(x => x != null).length;

    return {
      hasAnyData: present > 0,
      signalCount: present,
      focusRate,
      totalMin,
      weeklyMin,
      streak,
      monthlyQuiz,
      activeDays,
      planDoneRatio,
      windowDays: WINDOW_DAYS,
      // 关键：明确告诉调用方这些系数还没校准
      calibrated: false,
      note: '这些是学习过程信号，与成绩相关但不等于能力；未与真值校准，不能当作提分的独立证据。',
    };
  }

  /**
   * 给 projectSubject 用的「有效投入系数」。
   *
   * 原来固定 0.55（拍的）。现在：
   *   · 有真实数据 → 在有界范围内微调，且变化很小（0.45~0.65）
   *   · 没数据 → 返回 null，调用方保留原默认 0.55，不假装有信息
   *
   * 这个系数只影响「未来能提多少」（timeFactor），不影响「现在水平」。
   * 而且调用方必须同步放宽 seFuture —— 见 progress.js 的改动。
   */
  function effectiveFactor() {
    const c = collect();
    if (!c.hasAnyData) return null;

    let f = 0.55;
    // 用「近 28 天活跃天数 / 28」做很弱的调制
    if (c.activeDays > 0) {
      const regularity = Math.min(1, c.activeDays / c.windowDays);
      f += (regularity - 0.5) * 0.10;       // ±0.05
    }
    // 有专注度记录时再微调一点点（±0.03），且必须有足够时长才采信
    if (c.focusRate != null && c.totalMin != null && c.totalMin >= 60) {
      f += (c.focusRate - 0.5) * 0.06;
    }
    // 计划完成度（±0.02）
    if (c.planDoneRatio != null) {
      f += (c.planDoneRatio - 0.5) * 0.04;
    }
    // 硬边界：不让过程数据把预测拉飞
    f = Math.max(0.40, Math.min(0.70, f));
    return Math.round(f * 1000) / 1000;
  }

  /**
   * 给 UI 的诚实说明：一段人能看懂的话，不粉饰。
   */
  function summaryText() {
    const c = collect();
    if (!c.hasAnyData) {
      return '还没有记录到学习过程数据。估分只用卷子和测验，不会拿「看起来很努力」来凑数。';
    }
    const parts = [];
    if (c.totalMin != null) parts.push('累计学习 ' + Math.round(c.totalMin) + ' 分钟');
    if (c.weeklyMin != null) parts.push('本周 ' + Math.round(c.weeklyMin) + ' 分钟');
    if (c.activeDays > 0) parts.push('近 ' + c.windowDays + ' 天有 ' + c.activeDays + ' 天在用');
    if (c.streak != null) parts.push('连续 ' + c.streak + ' 天');
    if (c.focusRate != null) parts.push('最近一次专注率 ' + Math.round(c.focusRate * 100) + '%');
    if (c.planDoneRatio != null) parts.push('今日计划完成 ' + Math.round(c.planDoneRatio * 100) + '%');
    return parts.join(' · ') +
      '。注意：这些只是过程信号，未经与真实成绩校准，只轻微影响「未来能提多少」的估计，' +
      '不改变「现在水平」，也不会因为某天没学就下调分数。';
  }

  /**
   * 注入给 AI 的一段（弱证据，明确标注）。
   * 只让模型知道「学生最近的状态」，不许它据此改分数。
   */
  function promptBlock() {
    const c = collect();
    if (!c.hasAnyData) return '';
    const parts = ['【学习过程（间接信号，仅参考，不要据此改分）】'];
    if (c.activeDays > 0) parts.push('- 近 ' + c.windowDays + ' 天有 ' + c.activeDays + ' 天在使用');
    if (c.weeklyMin != null) parts.push('- 本周记录学习 ' + Math.round(c.weeklyMin) + ' 分钟');
    if (c.planDoneRatio != null) parts.push('- 今日计划完成 ' + Math.round(c.planDoneRatio * 100) + '%');
    if (c.focusRate != null) parts.push('- 最近一次自习专注率约 ' + Math.round(c.focusRate * 100) + '%（摄像头本地统计，噪声较大）');
    parts.push('（这些是过程数据，与成绩相关但不等同能力；未校准，不要写进估分结论，只在给建议时考虑节奏。）');
    return parts.join('\n');
  }

  return { collect, effectiveFactor, summaryText, promptBlock, WINDOW_DAYS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Engagement;
