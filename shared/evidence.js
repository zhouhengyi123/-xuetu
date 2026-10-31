/**
 * 证据层 v1.0（P1，2026-10-10）
 *
 * 解决的问题：原来的估分是"按满分加权 + 近期 1~2 倍权重"的简单加权平均。
 * 它有两个硬伤：
 *   ① **边界压缩**：得分率是有界的（0~1），多份卷子直接平均会被边界拉向中间；
 *   ② **不听样本量的话**：只做对 3 道题的卷子，和做对 25 道题的卷子话语权一样大。
 *
 * 现在改成三步（每一步都有依据，不是拍脑袋）：
 *   ① **logit 尺度**：把 (0,1) 的得分率映射到 (-∞,+∞)，可加、可做贝叶斯更新；
 *   ② **每卷自带不确定度**：题目少 → σ 大 → 话语权自动变小；
 *   ③ **经验贝叶斯收缩**：证据少时靠近先验，证据多了才让数据说话
 *      θ̂ = w·ȳ + (1-w)·μ_prior，w = τ² / (τ² + SE²)
 *
 * ★ 诚实边界：这里没有任何"实测校准"，全部是**先验 + 证据更新**。
 *   τ²（先验方差）与 μ_prior（学科先验）都是可调参数，不是从数据学到的。
 */
const EvidenceLayer = (() => {

  function round5(x) { return Math.round((Number(x) || 0) * 100000) / 100000; }

  /** 得分率 → logit（夹在 (0,1) 内，避免 ±∞） */
  function toLogit(p) {
    var v = Number(p);
    if (!isFinite(v)) return null;
    v = Math.max(0.001, Math.min(0.999, v));
    return Math.log(v / (1 - v));
  }

  /** logit → 得分率 */
  function fromLogit(t) {
    var v = Number(t);
    if (!isFinite(v)) return null;
    return 1 / (1 + Math.exp(-v));
  }

  /**
   * 单份卷子的观测与不确定度。
   *
   * @param {object} rec { ratio, nq, weight }
   *   ratio  —— 该卷的得分率（已含难度/来源折算）
   *   nq     —— 有效题目数（去重后）
   *   weight —— 满分权重（大题权重大）
   * @returns {{logit:number, var:number, prec:number, ratio:number}}
   *
   * 方差推导：p 的标准误 ≈ sqrt(p(1-p)/n)；
   *   logit 变换的方差 ≈ se_p² / (p(1-p))² = 1/(n·p·(1-p))
   *   这是 delta method 的标准结果。
   */
  function observe(rec) {
    var p = Number(rec && rec.ratio);
    if (!isFinite(p)) return null;

    /**
     * ★ 边界平滑（修正一个真 bug，2026-10-10）
     *
     * delta method 的方差是 1/(n·p·(1-p))，在 p→1 时 (1-p)→0，方差**爆炸**。
     * 实测后果：卷面 100%（10 题）算出的方差极大 → 精确度几乎为 0 →
     * 经验贝叶斯把权重压到 w=0.0015 → **完全忽略这个学生考了满分的事实**，
     * 直接返回先验 55%。这是明显错的。
     *
     * 修法：对 p 做**收缩平滑**，p' = (k·p + 1) / (k + 2)（拉普拉斯/加一平滑的推广）。
     *   · k 取 2n（等效于给 0/1 各加 1 次观测），n 越大平滑越弱
     *   · p=1, n=10 → p' = (2*10*1 + 1)/(2*10+2) = 21/22 ≈ 0.9545（合理：不是无限确定）
     *   · p=0.7, n=10 → p' = (20*0.7+1)/22 = 15/22 ≈ 0.6818（轻微收紧，无害）
     * 这样"考满分"依然是很强的证据，只是不当作**绝对**确定。
     */
    var n = Math.max(1, Number(rec.nq) || 1);
    if (!rec.nq && rec.weight) n = Math.max(1, Math.round(Number(rec.weight) / 10));
    var k = 2 * n;
    var pc = (k * Math.max(0, Math.min(1, p)) + 1) / (k + 2);
    // 平滑后再夹一次，双保险
    pc = Math.max(0.001, Math.min(0.999, pc));

    var vLogit = 1 / (n * pc * (1 - pc));          // delta method（用平滑后的 p，方差不再爆炸）
    // 难度未判 → 观测本身带额外不确定（先验替代测量）
    if (rec.noDifficulty) vLogit *= 1.7;
    return {
      logit: toLogit(pc),
      var: vLogit,
      prec: 1 / vLogit,                            // 精确度 = 1/方差
      ratio: pc,
      rawRatio: p,                                 // 平滑前的原始得分率（给界面显示）
      nq: n,
    };
  }

  /**
   * 时间衰减权重。
   *
   * ★ P1 改进了原来的做法：
   *   旧版是"最早 1 倍 → 最新 2 倍"的**线性排名权重** ——
   *   它只看相对次序，不看**实际间隔**：两份卷子隔 3 天和隔 3 个月，
   *   只要一前一后，权重比就是 1:2，这不合理。
   *
   *   新版按**真实时间差 + 半衰期**：w = 0.5^(Δt / H)
   *   H 默认 120 天（约一个学期的记忆/水平变化尺度）。
   *
   * @param {string|Date} dateStr 卷子日期
   * @param {Date} now 基准时间
   * @param {number} halfLifeDays 半衰期
   */
  function timeWeight(dateStr, now, halfLifeDays) {
    var H = Number(halfLifeDays) || 120;
    if (!dateStr) return 1;
    var t = new Date(dateStr);
    if (isNaN(t.getTime())) return 1;
    var dtDays = Math.abs((now - t) / 86400000);
    // 未来日期（用户误填）按 0 处理，不给超权
    if (dtDays < 0) dtDays = 0;
    return Math.pow(0.5, dtDays / H);
  }

  /**
   * ★ 经验贝叶斯收缩（P1 核心）
   *
   * @param {Array} obs  [{logit, var, prec, w}] —— w 是已乘过时间/满分权重的精确度系数
   * @param {number} priorMean  学科先验（logit 尺度）
   * @param {number} priorVar   τ² —— 学生间真实差异的方差
   * @returns {{logit:number, var:number, se:number, w:number, rawLogit:number, nObs:number}}
   *
   * 公式：
   *   加权均值  ȳ = Σ(prec_i · w_i · θ_i) / Σ(prec_i · w_i)
   *   标准误    SE² = 1 / Σ(prec_i · w_i)
   *   收缩权重  w = τ² / (τ² + SE²)
   *   后验      θ̂ = w·ȳ + (1-w)·μ_prior
   *   后验方差  Var = w · SE²
   *
   * 直觉：
   *   · 只有 1 份 5 题的小卷 → SE² 大 → w 小 → 结果靠近先验（不轻信）
   *   · 有 10 份 25 题的卷子 → SE² 小 → w → 1 → 以数据为准
   */
  function shrink(obs, priorMean, priorVar) {
    /**
     * ★ 先验方差 τ² 的取值（2026-10-10 修正）
     *
     * τ² 表示"学生之间真实水平的差异有多大"（logit 尺度）。
     * 它直接决定收缩强度：τ² 越小 → 越不信数据、越靠近先验。
     *
     * 最初取了 0.36（τ=0.6 logit ≈ ±13% 得分率），实测发现**明显偏小**：
     * 一个学生单卷考满分，会被先验拉到 59%（等于说"你考满分也没用"）——
     * 因为 0.36 暗示"所有学生的真实差异只有 13%"，但这显然不对，
     * 高三学生从 40% 到 95% 都有。
     *
     * 改为 1.6（τ≈1.26 logit ≈ ±28% 得分率），更接近真实的能力分布：
     *   · 1 卷 5 题      → w=0.42（三条题还不太敢信，但不再无视）
     *   · 1 卷 25 题     → w=0.78（一份完整卷子已有相当说服力）
     *   · 5 卷 25 题     → w=0.95（基本以数据为准）
     * 这个梯度符合直觉：数据少时保守，数据多了就听数据的。
     */
    var tau2 = Number(priorVar);
    if (!isFinite(tau2) || tau2 <= 0) tau2 = 1.6;
    var mu = Number(priorMean);
    if (!isFinite(mu)) mu = 0;

    var sw = 0, sv = 0;
    (obs || []).forEach(function(o) {
      if (!o || !isFinite(o.logit) || !isFinite(o.prec)) return;
      var w = o.prec * (isFinite(o.w) ? o.w : 1);
      if (!(w > 0)) return;
      sw += w; sv += o.logit * w;
    });

    if (!(sw > 0)) {
      // 一点证据都没有 → 完全用先验，并把 SE 设为先验 sd
      return { logit: mu, var: tau2, se: Math.sqrt(tau2), w: 0, rawLogit: null, nObs: 0, sw: 0 };
    }

    var rawMean = sv / sw;
    var seVar = 1 / sw;
    var wShrink = tau2 / (tau2 + seVar);
    var post = wShrink * rawMean + (1 - wShrink) * mu;
    var postVar = wShrink * seVar;

    return {
      logit: post,
      var: postVar,
      se: Math.sqrt(postVar),
      w: wShrink,
      rawLogit: rawMean,
      nObs: (obs || []).length,
      sw: sw,
    };
  }

  /**
   * 完整证据融合：把某科的若干卷子合成一个能力估计。
   *
   * @param {Array} papers [{ratio, nq, weight, date, noDifficulty}]
   * @param {object} opts { priorRatio, priorVarLogit, halfLifeDays, now }
   * @returns {{ratio, logit, seLogit, seRatio, weight, nPapers, totalQ, prior}}
   */
  function fuse(papers, opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var H = opts.halfLifeDays || 120;

    // 先验：用"学科基准"当锚（即"高考平均水平的考生"）
    var priorRatio = isFinite(Number(opts.priorRatio)) ? Number(opts.priorRatio) : 0.55;
    var priorMean = toLogit(priorRatio);
    // τ²：学生间真实差异（logit 尺度）。1.6 ≈ ±28% 得分率，符合高三实际分布
    var priorVar = isFinite(Number(opts.priorVarLogit)) ? Number(opts.priorVarLogit) : 1.6;

    var obs = [];
    var totalQ = 0;
    (papers || []).forEach(function(p) {
      var o = observe(p);
      if (!o) return;
      totalQ += o.nq;
      // 时间权重 × 满分权重（大题话语权大），都折算到"精确度系数"上
      var tw = timeWeight(p.date, now, H);
      var fw = p.weight ? Math.max(0.5, Math.min(2, Number(p.weight) / 100)) : 1;
      o.w = tw * fw;
      o.date = p.date;
      obs.push(o);
    });

    var s = shrink(obs, priorMean, priorVar);

    return {
      ratio: fromLogit(s.logit),              // 收缩后的得分率
      rawRatio: s.rawLogit == null ? null : fromLogit(s.rawLogit),
      logit: s.logit,
      seLogit: s.se,
      seRatio: s.se * (1 / (1 + Math.exp(-s.logit))) * (1 - 1 / (1 + Math.exp(-s.logit))),  // 反变换回比例尺度
      weight: s.w,                            // 数据权重（0=全信先验，1=全信数据）
      nPapers: obs.length,
      totalQ: totalQ,
      prior: { ratio: priorRatio, logit: priorMean, var: priorVar },
    };
  }

  /**
   * ★ P2：数据充分度分级（替代旧的"只看题数"的置信度）
   *
   * 三个维度一起看，任何一项差都会降级：
   *   ① 题量       —— 有效题目数
   *   ② 难度覆盖   —— 有多少比例的卷子判过难度
   *   ③ 来源多样   —— 是不是只有一种来源（全是作业 → 外推风险大）
   *   ④ 时间跨度   —— 全挤在一周内 vs 分散一学期
   *
   * @returns {{level:'low'|'mid'|'high', score:0~1, reasons:string[], advice:string}}
   */
  function sufficiency(stats) {
    stats = stats || {};
    var nQ = Number(stats.nQuestions) || 0;
    var nP = Number(stats.nPapers) || 0;
    var diffRatio = Number(stats.diffJudgedRatio);
    if (!isFinite(diffRatio)) diffRatio = 0;
    var nSources = Number(stats.nSources) || 1;
    var spanDays = Number(stats.spanDays) || 0;

    // ① 题量：50 题算充足
    var sQ = Math.min(1, nQ / 50);
    // ② 难度覆盖：判过难度的卷子占比
    var sD = Math.min(1, diffRatio);
    // ③ 来源多样性：≥3 种算充足
    var sS = Math.min(1, (nSources - 1) / 2);
    // ④ 时间跨度：≥90 天算充足
    var sT = Math.min(1, spanDays / 90);

    /**
     * ★ 加权方式（2026-10-10 调整）
     *
     * 最初用"题量 0.45 + 难度 0.30 + 来源 0.15 + 跨度 0.10"的**加权和**，
     * 实测发现一个问题：**同一套题做 50 遍**能拿 0.756 分（判为 high）——
     * 但那是本项目最典型的虚高场景（用户英语/物理/化学就是同一套 5 题做 5 遍）。
     * 加权和的问题是"一项特别强能弥补另一项特别弱"。
     *
     * 改成 **加权和 × 惩罚因子**：
     *   · 来源单一（nSources < 2）→ 乘 0.75（外推风险大）
     *   · 时间集中（spanDays < 14 且卷数 > 1）→ 乘 0.85（看不出稳定性）
     * 这样"同源+集中"会被压到 mid 以下，更符合直觉。
     */
    var raw = sQ * 0.45 + sD * 0.30 + sS * 0.15 + sT * 0.10;

    var penalty = 1;
    if (nSources < 2 && nP > 1) penalty *= 0.75;            // 只有一种来源
    if (spanDays < 14 && nP > 1) penalty *= 0.85;           // 全挤在两周内
    var score = raw * penalty;

    var level = score >= 0.72 ? 'high' : score >= 0.40 ? 'mid' : 'low';
    var reasons = [];
    if (nQ < 15) reasons.push('有效题目只有 ' + nQ + ' 道');
    if (nP < 3) reasons.push('只有 ' + nP + ' 份卷子');
    if (diffRatio < 0.5) reasons.push('判过难度的卷子不到一半');
    if (nSources < 2 && nP > 1) reasons.push('只有一种来源（全是同一类卷子，容易虚高）');
    if (spanDays < 30 && nP > 1) reasons.push('卷子集中在 ' + Math.round(spanDays) + ' 天内');

    var advice = level === 'high' ? '数据比较充分，可以看单点估计'
      : level === 'mid' ? '数据中等，建议以区间为准'
      : '数据偏少，请优先看区间；再上传几份不同来源的卷子会明显改善';

    return { level: level, score: round5(score), reasons: reasons, advice: advice };
  }

  return {
    toLogit: toLogit,
    fromLogit: fromLogit,
    observe: observe,
    timeWeight: timeWeight,
    shrink: shrink,
    fuse: fuse,
    sufficiency: sufficiency,
  };
})();
