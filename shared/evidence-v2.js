/**
 * 估分引擎 v2 —— 多源证据融合 + 置信度门控 + 分科能力建模
 *
 * ══════════════════════════════════════════════════════════════════
 * 为什么重写
 * ══════════════════════════════════════════════════════════════════
 * 旧版只看"做题得分率 × 难度折算 × 教材覆盖率"。
 * 用户指出：上课情况、学习时长、认知能力都该纳入，而且每科能力不同。
 *
 * ══════════════════════════════════════════════════════════════════
 * 文献依据（不是拍脑袋）
 * ══════════════════════════════════════════════════════════════════
 * ① 智力 → 学业：r ≈ 0.44（Roth et al. 2015, Intelligence, N=80,145）
 *    但**领域分化明显**：工作记忆对数学 r≈0.40，对阅读 r≈0.25
 *    （Peng et al. 2016 元分析, 110 研究）→ 必须**分科**建能力值
 *
 * ② 先前成绩：r ≈ 0.5~0.6，比智力更强
 *    （因为它已经混入了学习效果）→ 做题数据权重应该最高
 *
 * ③ 学习时长：单独解释力**极低**（大学 GPA 约 1%）
 *    （Macnamara, Hambrick & Oswald 2014）
 *    但**刻意练习**（有反馈/有目标/难度匹配）解释 12%
 *    → 时长必须乘"有效性系数"，不能直算
 *
 * ④ 动机 r=0.27，尽责性 r≈0.19（Poropat 2009）
 *    这些通过"学习行为"间接观测，不单独问
 *
 * ⑤ IRT 层级结构优于深度知识追踪
 *    （Wilson et al. 2016, "Back to the basics: Bayesian extensions of IRT
 *     outperform neural networks for proficiency estimation"）
 *    → 用知识点分组的分层贝叶斯，而不是黑盒
 *
 * ══════════════════════════════════════════════════════════════════
 * 核心模型
 * ══════════════════════════════════════════════════════════════════
 * 每个学生-科目组合，能力 θ 在 logit 尺度上：
 *
 *   θ_posterior = w_exam · θ_exam + w_lesson · θ_lesson
 *               + w_prior · θ_prior + w_apt · θ_aptitude
 *
 *   权重 w 由各证据的**精度（1/方差）**决定，这是贝叶斯的标准做法：
 *   证据越可靠，权重越大。
 *
 * 置信度：用后验标准误 SE(θ)。
 *   SE < 0.35 → 高置信（可发布）
 *   SE < 0.50 → 中置信（可给区间）
 *   SE ≥ 0.50 → 数据不足（不给分数，给"还差什么"）
 *
 *   用户要求的"60% 把握"在这里翻译成：
 *   预测区间覆盖真值的概率 ≥ 60%，即 SE 足够小。
 */
const EvidenceEngine = (() => {

  // ══════════════════════════════════════════════════════
  //  参数（全部有文献或实测依据，不写魔法数）
  // ══════════════════════════════════════════════════════

  /**
   * 各证据源的**方差**（logit 尺度）。
   *
   * ★ 为什么改成动态（2026-10-18）
   *   之前用固定常数（examSingle: 0.12），结果 1 份 25 题的卷子
   *   就判成 SE=0.31、置信"中"，进度条直接 100% —— 太乐观了。
   *
   *   正确答案来自二项分布：SE ≈ sqrt(1 / (n·p·(1-p)))
   *     n=25, p=0.7 → SE ≈ 0.44 (var ≈ 0.19)
   *     n=50, p=0.7 → SE ≈ 0.31 (var ≈ 0.10)
   *   所以方差必须随题量走，而不是固定值。
   *   下面的 floor 是"再多数据也不会更确定"的下限 ——
   *   因为还存在"这份卷子本身能不能代表高考"的系统误差。
   */
  const VAR = {
    examFloor: 0.045,      // 卷子再多也不会比这更确定
    lessonFloor: 0.12,     // 课再多也有噪声
    aptitude: 0.25,        // 能力测验（12 题）
    prior: 1.20,           // 无信息先验
    priorWithTotal: 0.55,  // 用户填了总分 → 有信息先验
  };

  /** 科目 → 能力维度映射（依据：工作记忆/推理的领域分化） */
  const SUBJECT_DOMAIN = {
    '语文': 'verbal',
    '英语': 'verbal',
    '历史': 'verbal',
    '政治': 'verbal',
    '数学': 'quant',
    '物理': 'quant',
    '化学': 'quant',
    '生物': 'quant',     // 生物有大量遗传计算，归 quant
    '地理': 'mixed',     // 自然地理偏 quant，人文地理偏 verbal
    '技术': 'quant',     // 算法/结构分析
  };

  /**
   * 领域能力 → 科目能力的传递系数。
   *
   * 为什么不是 1.0：一个学生"数学推理强"不代表"化学一样强"，
   * 因为化学还有记忆成分。这个系数表示"该科目在多大程度上
   * 被这个领域能力解释"。
   *
   * 若该科有专属测验结果，会覆盖这个先验。
   */
  const DOMAIN_LOADING = {
    quant: { '数学': 0.85, '物理': 0.80, '化学': 0.65, '生物': 0.55, '技术': 0.70, '地理': 0.45 },
    verbal: { '语文': 0.75, '英语': 0.70, '历史': 0.65, '政治': 0.60, '地理': 0.50 },
    mixed: { '地理': 0.60 },
  };

  /**
   * 学习时长的有效性折扣。
   *
   * 关键依据：Macnamara 2014 —— 单纯时长解释力 ~1%，
   * 而"刻意练习"（有反馈、有目标、难度匹配）解释 12%。
   *
   * 所以时长必须乘一个 0~1 的"质量系数"：
   *   心不在焉刷 3 小时 < 专注刷题 1 小时
   */
  function lessonEffectiveness(lesson) {
    if (!lesson) return 0;
    let q = 1.0;

    // ① 专注度（来自学习监控）：低于 50% 大幅打折
    const focus = Number(lesson.focus);
    if (isFinite(focus) && focus >= 0) {
      const f = Math.max(0, Math.min(1, focus / 100));
      // 0.4 + 0.6f：专注 0 → 0.4（还能学一点），专注 100 → 1.0
      q *= (0.40 + 0.60 * f);
    }

    // ② 完成度：半途而废的课，效果打折
    const done = Number(lesson.completion);
    if (isFinite(done) && done >= 0) {
      q *= Math.max(0.3, Math.min(1, done));
    }

    // ③ 主动交互（提问/答题）比被动看视频有效 —— 来自刻意练习理论
    const interactive = Number(lesson.interactions) || 0;
    const minutes = Number(lesson.minutes) || 0;
    if (minutes > 0) {
      // 每 5 分钟至少 1 次交互算"主动"
      const rate = interactive / Math.max(1, minutes / 5);
      q *= Math.min(1.15, 0.85 + 0.15 * rate);   // 最多 1.15（主动学习可以超过标称时长）
    }

    return Math.max(0, Math.min(1.3, q));
  }

  /** 把 0~1 的得分率转成 logit（带平滑，避免 0 和 1 爆炸） */
  function toLogit(p, n) {
    const k = Math.max(1, Number(n) || 30);
    // 拉普拉斯平滑：p' = (k·p + 1) / (k + 2)
    const safe = (k * Math.max(0, Math.min(1, p)) + 1) / (k + 2);
    return Math.log(safe / (1 - safe));
  }

  /** logit → 概率 */
  function fromLogit(x) {
    return 1 / (1 + Math.exp(-x));
  }

  /** 把 logit 转成"该科满分下的分数" */
  function logitToScore(logit, fullScore) {
    return Math.max(0, Math.min(fullScore, fromLogit(logit) * fullScore));
  }

  // ══════════════════════════════════════════════════════
  //  1. 收集证据
  // ══════════════════════════════════════════════════════

  /**
   * 从各种来源收集"某科目"的证据。
   *
   * @returns {Array<{source, logit, variance, weight, detail}>}
   */
  function collectEvidence(subject, ctx) {
    const ev = [];
    const papers = (ctx.papers || []).filter(p => p.subject === subject);
    const lessons = (ctx.lessons || []).filter(l => l.subject === subject);
    const quizResults = (ctx.quizzes || []).filter(q => q.subject === subject);

    // ── ① 考试卷 ──
    // 每份卷子：卷面得分率 → 按难度折算 → logit
    const examPieces = [];
    papers.forEach(p => {
      let ratio = null;
      let n = 0;

      // 有逐题数据：按题算（更准，能用到难度）
      if (Array.isArray(p.questions) && p.questions.length) {
        const judged = p.questions.filter(q => q.isCorrect === true || q.isCorrect === false);
        if (judged.length >= 3) {
          // 难度加权：难题答对含金量更高（IRT 的思路）
          let num = 0, den = 0;
          judged.forEach(q => {
            const diff = Number(q.difficulty);
            const w = (isFinite(diff) && diff >= 1 && diff <= 5) ? (0.6 + 0.2 * diff) : 1;
            const got = q.isCorrect === true ? 1 : 0;
            num += got * w;
            den += w;
          });
          ratio = den > 0 ? num / den : null;
          n = judged.length;
        }
      }

      // 没有逐题：用卷面分
      if (ratio == null) {
        const sc = Number(p.score), full = Number(p.fullScore);
        if (isFinite(sc) && isFinite(full) && full > 0) {
          ratio = Math.max(0, Math.min(1, sc / full));
          n = Number(p.nQuestions) || 30;
        }
      }

      if (ratio == null) return;

      // 难度折算：这份卷子比高考难/易多少
      let factor = 1;
      try {
        if (typeof DB !== 'undefined' && DB.difficultyFactor) {
          const lv = (typeof DB.paperDifficulty === 'function') ? DB.paperDifficulty(p) : null;
          factor = DB.difficultyFactor(subject, p.kind || p.type || 'school', lv);
        }
      } catch (e) {}

      // 折算后仍是"得分率"，再转 logit
      const adjusted = Math.max(0.02, Math.min(0.98, ratio * factor));
      examPieces.push({
        ratio,
        adjusted,
        factor,
        n,
        date: p.date,
        name: p.name || p.title || subject + '卷',
      });
    });

    if (examPieces.length) {
      // 多份卷子：按题量加权平均（题多的更可信）
      let sumW = 0, sumX = 0, totalN = 0;
      examPieces.forEach(pc => {
        const w = Math.max(10, pc.n);
        sumW += w;
        totalN += pc.n;
        sumX += toLogit(pc.adjusted, pc.n) * w;
      });
      const pooledLogit = sumW > 0 ? sumX / sumW : 0;

      /**
       * ★ 方差按题量算（2026-10-18 修）
       *
       * 二项分布的标准误：SE = sqrt(p(1-p) / n)，logit 尺度上约 sqrt(1/(n·p·(1-p)))
       * 取 p≈0.65 的代表值：p(1-p) ≈ 0.2275
       *   n=25  → var ≈ 1/(25×0.2275) ≈ 0.176
       *   n=50  → var ≈ 0.088
       *   n=100 → var ≈ 0.044
       * 再把多份卷子的"份数"算进去：不同卷子能平均掉"卷子偏难/偏易"的系统误差，
       * 所以额外除以份数，但不低于 floor（系统误差不可消除）。
       */
      const pRep = 0.65;
      const infoPerItem = 1 / (pRep * (1 - pRep));      // ≈ 4.4，每题的费舍尔信息量
      const rawVar = infoPerItem / Math.max(10, totalN);
      const varExam = Math.max(VAR.examFloor, rawVar / Math.sqrt(examPieces.length));

      ev.push({
        source: 'exam',
        logit: pooledLogit,
        variance: varExam,
        detail: {
          count: examPieces.length,
          pieces: examPieces,
          avgRatio: examPieces.reduce((a, x) => a + x.ratio, 0) / examPieces.length,
          avgAdjusted: examPieces.reduce((a, x) => a + x.adjusted, 0) / examPieces.length,
        },
      });
    }

    // ── ② 上课 / 学习行为 ──
    // 关键：不是看"上了多久"，而是看"有效学习了多少"
    if (lessons.length) {
      let effectiveMinutes = 0;
      let totalMinutes = 0;
      const lessonDetails = [];

      lessons.forEach(l => {
        const mins = Number(l.minutes) || 0;
        const q = lessonEffectiveness(l);
        totalMinutes += mins;
        effectiveMinutes += mins * q;

        // 对这节课的掌握度评估（如果有）
        const mastery = Number(l.mastery);
        lessonDetails.push({
          minutes: mins,
          effectiveness: q,
          mastery: isFinite(mastery) ? mastery : null,
          date: l.date,
        });
      });

      // 掌握度均值 → logit（若有多节课的掌握度评估）
      const masteries = lessonDetails.map(x => x.mastery).filter(x => x != null);
      let lessonLogit = null;
      let lessonVar = VAR.lessonFloor;

      if (masteries.length) {
        const avg = masteries.reduce((a, x) => a + x, 0) / masteries.length;
        // 掌握度是 0~1（或 0~100），统一到 0~1
        const norm = avg > 1.5 ? avg / 100 : avg;
        lessonLogit = toLogit(norm, 20);
        // 课时越多越可信，但同样有下限（一节课的"掌握"可能只是当时会了）
        lessonVar = Math.max(VAR.lessonFloor, 0.30 / Math.sqrt(masteries.length));
      } else if (effectiveMinutes > 0 && totalMinutes > 0) {
        /**
         * 没有掌握度评估时，用"有效学习量"作弱证据。
         *
         * 注意：这是**很弱**的证据 —— 文献说时长解释力只有 1%。
         * 所以方差给得很大（权重低），而且必须结合该科现状才有意义。
         * 这里只用它做轻微调整，不给独立结论。
         */
        const efficiency = effectiveMinutes / Math.max(1, totalMinutes);  // 0~1.3
        // 以"有效学习 60 分钟"为中性点，多学一点略升、少学略降
        const z = (effectiveMinutes - 60) / 120;   // ±1 对应 ±120 分钟
        lessonLogit = Math.max(-0.35, Math.min(0.35, z * 0.25 * efficiency));
        lessonVar = 0.60;   // 很大的方差 → 权重很小
      }

      if (lessonLogit != null) {
        ev.push({
          source: 'lesson',
          logit: lessonLogit,
          variance: lessonVar,
          detail: {
            count: lessons.length,
            totalMinutes,
            effectiveMinutes: Math.round(effectiveMinutes),
            efficiency: totalMinutes > 0 ? effectiveMinutes / totalMinutes : 0,
            hasMastery: masteries.length > 0,
          },
        });
      }
    }

    // ── ③ 练习 / AI 出题 ──
    /**
     * ★ 必须排除"已经算进卷子里"的练习（2026-10-18 修）
     *
     * 踩过的坑：Storage.getQuizStats() 会从 papers 的逐题数据汇总，
     * 所以同一批题既算进「exam」又算进「quiz」——
     * 等于把一份证据数了两遍，SE 被虚低（1 份卷变成 SE=0.275，
     * 看起来像两份卷那么可信）。
     *
     * 修法：只有**独立来源**的练习才算（有 paperId 指向卷子的都跳过）。
     */
    const examPaperIds = new Set(papers.map(p => p.id).filter(Boolean));
    const independentQuiz = quizResults.filter(q => {
      // 明确指向某份卷子的，已经算过了
      if (q.paperId && examPaperIds.has(q.paperId)) return false;
      // 标记了来自卷子汇总的，也跳过
      if (q.fromPapers === true) return false;
      return true;
    });

    if (independentQuiz.length) {
      let num = 0, den = 0;
      independentQuiz.forEach(q => {
        const total = Number(q.total) || 0;
        const right = Number(q.right) || 0;
        if (total > 0) { num += right; den += total; }
      });
      if (den >= 5) {
        const p = num / den;
        ev.push({
          source: 'quiz',
          logit: toLogit(p, den),
          variance: Math.max(VAR.examFloor, 4.4 / Math.max(20, den)),
          detail: { right: num, total: den, count: independentQuiz.length },
        });
      }
    }

    return ev;
  }

  // ══════════════════════════════════════════════════════
  //  2. 能力测验 → 各科先验
  // ══════════════════════════════════════════════════════

  /**
   * 把能力测验结果分配到各科。
   *
   * 依据：能力有领域分化（quant / verbal），不是单一 g。
   * 一个学生在图形推理上强，对数学的预测力远高于对语文。
   *
   * @param {object} apt - { quant: {score, se}, verbal: {score, se} }
   * @param {string} subject
   * @returns {{logit, variance}|null}
   */
  function aptitudeFor(apt, subject) {
    if (!apt) return null;

    const domain = SUBJECT_DOMAIN[subject] || 'quant';
    const loading = (DOMAIN_LOADING[domain] && DOMAIN_LOADING[domain][subject]);

    // 该科的领域能力
    let src = null;
    if (domain === 'quant') src = apt.quant;
    else if (domain === 'verbal') src = apt.verbal;
    else src = apt.quant || apt.verbal;      // mixed 优先用量化

    if (!src || src.score == null) return null;

    const L = (loading == null) ? 0.5 : loading;
    if (L <= 0) return null;

    // 能力测验是 0~1 的百分位 → 转 logit
    // 但要按 loading 衰减：loading 0.85 → 几乎全信；0.5 → 打半折
    const aptLogit = toLogit(Math.max(0.05, Math.min(0.95, src.score)), 12);
    const shrunk = aptLogit * L;

    // 方差：loading 越低，越不可信
    const baseVar = src.se != null ? Math.max(VAR.aptitude, src.se * src.se) : VAR.aptitude;
    const variance = baseVar / Math.max(0.15, L * L);   // 衰减后方差放大

    return { logit: shrunk, variance };
  }

  // ══════════════════════════════════════════════════════
  //  3. 贝叶斯融合
  // ══════════════════════════════════════════════════════

  /**
   * 把多源证据融合成一个后验。
   *
   * 标准做法：精度加权（precision weighting）
   *   precision_i = 1 / var_i
   *   θ_post = Σ(precision_i · θ_i) / Σ(precision_i)
   *   var_post = 1 / Σ(precision_i)
   *
   * 这比"拍脑袋给权重"更严谨，而且**自动**处理了
   * "证据多 → 置信度高"这件事。
   */
  function fuse(evidenceList, priorLogit, priorVar) {
    let sumP = 0, sumPX = 0;

    // 先验
    const pPrior = 1 / Math.max(0.01, priorVar);
    sumP += pPrior;
    sumPX += pPrior * priorLogit;

    const used = [];
    evidenceList.forEach(e => {
      const p = 1 / Math.max(0.01, e.variance);
      sumP += p;
      sumPX += p * e.logit;
      used.push({
        source: e.source,
        logit: e.logit,
        variance: e.variance,
        weight: p,          // 原始精度
        share: 0,           // 稍后算占比
        detail: e.detail,
      });
    });

    const postLogit = sumP > 0 ? sumPX / sumP : priorLogit;
    const postVar = sumP > 0 ? 1 / sumP : priorVar;
    const postSE = Math.sqrt(postVar);

    // 算各证据的贡献占比（用于界面展示"依据"）
    used.forEach(u => { u.share = sumP > 0 ? u.weight / sumP : 0; });
    const priorShare = sumP > 0 ? pPrior / sumP : 1;

    return {
      logit: postLogit,
      variance: postVar,
      se: postSE,
      evidence: used,
      priorShare,
    };
  }

  // ══════════════════════════════════════════════════════
  //  4. 置信度与"能不能出分"
  // ══════════════════════════════════════════════════════

  /**
   * 置信度分级。
   *
   * 用后验 SE 判断，而不是"发了 5 份卷子"这种拍脑袋阈值。
   *
   * ★ 阈值怎么定的（2026-10-18 校准）
   *   一份 25 题、得分率 65% 的卷子，二项标准误：
   *     SE = sqrt(1/(n·p(1-p))) = sqrt(1/(25×0.2275)) ≈ 0.42
   *   如果"可出分"就定在 0.42，那**一份卷子就够**了 —— 太宽松，
   *   用户会觉得"我才传了一份你就敢给分？"
   *
   *   所以把线画在 0.32：
   *     · 0.32 对应约 40 题以上的证据量（一份 25 题不够，两份够）
   *     · 80% 区间宽约 ±1.28×0.32 ≈ ±0.41 logit
   *       在得分率 0.65 处约合 ±8 分（满分 100）
   *     · 这就是"敢给一个数，但仍然要标区间"的程度
   */
  function confidenceOf(se) {
    if (se <= 0.22) return { level: 'high', label: '高', minProb: 0.85 };
    if (se <= 0.32) return { level: 'mid', label: '中', minProb: 0.65 };
    if (se <= 0.45) return { level: 'low', label: '低', minProb: 0.45 };
    return { level: 'none', label: '不足', minProb: 0 };
  }

  /**
   * 还差什么才能出分？
   *
   * 用户明确要求：要一个"什么时候可以估分"的进度条。
   *
   * ★ 进度怎么算才对（2026-10-18 修）
   *   第一版用 progress = (1/SE) / (1/targetSE)，结果：
   *     · 零数据时先验 SE≈1.1 → progress 也有 57%（太乐观）
   *     · 1 份卷子 SE≈0.31 → 直接 100%
   *   这个映射的毛病是**只看到后的 SE，不区分"这 SE 是数据挣来的还是先验自带的"**。
   *
   *   正确做法：看**信息增益**（precision 的增长）
   *     precision = 1/var
   *     起点 precision₀ = 1/priorVar（只有先验）
   *     目标 precision₁ = 1/targetVar（达到可出分）
   *     progress = (precision_now - precision₀) / (precision₁ - precision₀)
   *
   *   这样零数据时 progress 正好是 0（没有增益），
   *   而且天然体现"数据越准，边际收益越小"。
   */
  function readinessOf(se, evidence, priorVar, targetSE) {
    /**
     * 目标 SE = 0.32，对应"中"置信度（约 65% 把握）。
     *
     * 为什么是 0.32 而不是 0.42：见 confidenceOf 的注释 ——
     * 0.42 时一份 25 题卷就够，太宽松。
     * 0.32 需要约 40 题以上的证据（两份卷 / 一份卷+一组练习）。
     */
    const target = targetSE || 0.32;
    const p0 = 1 / Math.max(0.01, priorVar || VAR.prior);
    const p1 = 1 / Math.max(0.01, target * target);   // 目标精度（用方差尺度）
    const pNow = se > 0 ? 1 / (se * se) : p0;

    let progress;
    if (p1 <= p0) {
      // 先验已经比目标还准（用户填了很具体的成绩）→ 直接算够
      progress = 1;
    } else {
      progress = (pNow - p0) / (p1 - p0);
    }
    progress = Math.max(0, Math.min(1, progress));

    const advice = [];
    if (progress < 1) {
      const hasExam = evidence.some(e => e.source === 'exam');
      const hasQuiz = evidence.some(e => e.source === 'quiz');
      const hasLesson = evidence.some(e => e.source === 'lesson');
      const examCount = (evidence.find(e => e.source === 'exam') || {}).detail;

      if (!hasExam) advice.push('上传至少一份这科的卷子');
      else if (progress < 0.85) advice.push('再传一份不同来源的卷子（月考/联考各一份最有效）');

      if (!hasQuiz && progress < 0.95) advice.push('做一组这科的练习（20 题以上）');
      if (!hasLesson && progress < 0.95) advice.push('学一节这科的课，让系统看到你的掌握度');
      if (progress >= 0.85) advice.push('再做几次练习就能出分了');
    }

    return {
      progress: Math.round(progress * 100) / 100,
      targetSE: target,
      currentSE: Math.round(se * 1000) / 1000,
      ready: se <= target,
      advice: advice.slice(0, 3),
    };
  }

  // ══════════════════════════════════════════════════════
  //  5. 主入口
  // ══════════════════════════════════════════════════════

  /**
   * 估算单个科目。
   *
   * @param {string} subject
   * @param {object} ctx - { papers, lessons, quizzes, aptitude, aim }
   * @returns {object}
   */
  function estimateSubject(subject, ctx) {
    const goal = (ctx.goal || {});
    const maxScore = (typeof DB !== 'undefined' && DB.MAX_SCORES && DB.MAX_SCORES[subject]) ||
      (/语文|数学|英语/.test(subject) ? 150 : 100);

    // ── 先验 ──
    // 用户自己填的起始总分（如果填了）→ 用它当基准
    // 否则用 0.5（完全不确定）
    let priorLogit = 0;
    let priorVar = VAR.prior;

    const stuTotal = Number(goal.current);
    if (isFinite(stuTotal) && stuTotal > 0) {
      // 用户填的是六科总分，按该科占比换算
      const subs = ['语文', '数学', '英语'].concat(goal.selectedSubjects || []);
      let totalFull = 0;
      subs.forEach(s => { totalFull += (DB.MAX_SCORES[s] || 150); });
      if (totalFull > 0) {
        const rate = Math.max(0.15, Math.min(0.92, stuTotal / totalFull));
        priorLogit = toLogit(rate, 50);
        priorVar = 0.55;     // 有总分 → 先验更可信
      }
    }

    // ── 能力测验先验（比总分更细，覆盖在总分之上）──
    const aptEv = aptitudeFor(ctx.aptitude, subject);
    const evidence = collectEvidence(subject, ctx);
    if (aptEv) evidence.push({ source: 'aptitude', logit: aptEv.logit, variance: aptEv.variance, detail: {} });

    // ── 融合 ──
    const post = fuse(evidence, priorLogit, priorVar);

    // ── 输出 ──
    const conf = confidenceOf(post.se);
    const ready = readinessOf(post.se, evidence, priorVar);
    const score = logitToScore(post.logit, maxScore);

    // 预测区间：按 SE 给
    const lo = logitToScore(post.logit - 1.28 * post.se, maxScore);   // 80% 区间
    const hi = logitToScore(post.logit + 1.28 * post.se, maxScore);

    // 各证据的实际贡献（用于界面"依据"）
    const basis = post.evidence.map(e => ({
      source: e.source,
      weight: Math.round(e.share * 100),
      detail: e.detail,
    }));
    const priorBasis = { source: 'prior', weight: Math.round(post.priorShare * 100) };

    return {
      subject,
      maxScore,
      score: conf.level === 'none' ? null : Math.round(score * 10) / 10,
      range: conf.level === 'none' ? null : {
        low: Math.round(lo * 10) / 10,
        high: Math.round(hi * 10) / 10,
      },
      logit: Math.round(post.logit * 1000) / 1000,
      se: Math.round(post.se * 1000) / 1000,
      confidence: conf,
      readiness: ready,
      basis: [priorBasis].concat(basis),
      evidenceCount: evidence.length,
      hasExam: evidence.some(e => e.source === 'exam'),
      hasLesson: evidence.some(e => e.source === 'lesson'),
      hasQuiz: evidence.some(e => e.source === 'quiz'),
      hasAptitude: !!aptEv,
    };
  }

  /**
   * 估算全部科目。
   */
  function estimateAll(ctx) {
    const goal = ctx.goal || {};
    const core = ['语文', '数学', '英语'];
    const sel = (goal.selectedSubjects && goal.selectedSubjects.length)
      ? goal.selectedSubjects.slice(0, 3)
      : ['物理', '化学', '生物'];
    const subjects = core.concat(sel.filter(s => core.indexOf(s) < 0));

    const perSubject = {};
    subjects.forEach(s => { perSubject[s] = estimateSubject(s, ctx); });

    // ── 总分 ──
    // 只有所有科目都达到"可出分"才给总分；否则给"部分"
    const readySubs = subjects.filter(s => perSubject[s].score != null);
    const allReady = readySubs.length === subjects.length;

    let total = null, totalRange = null, totalSE = null;
    if (readySubs.length > 0) {
      total = readySubs.reduce((a, s) => a + perSubject[s].score, 0);
      // 总分方差 = 各科方差之和（独立假设）
      const sumVar = readySubs.reduce((a, s) => a + Math.pow(perSubject[s].se, 2) * Math.pow(perSubject[s].maxScore / 4, 2), 0);
      totalSE = Math.sqrt(sumVar);
      if (readySubs.length === subjects.length) {
        totalRange = {
          low: Math.round((total - 1.28 * totalSE) * 10) / 10,
          high: Math.round((total + 1.28 * totalSE) * 10) / 10,
        };
      }
    }

    // ── 整体就绪度 ──
    const progresses = subjects.map(s => perSubject[s].readiness.progress);
    const overallProgress = progresses.length
      ? Math.round((progresses.reduce((a, x) => a + x, 0) / progresses.length) * 100) / 100
      : 0;

    const readyCount = subjects.filter(s => perSubject[s].readiness.ready).length;

    return {
      subjects,
      perSubject,
      total: total != null ? Math.round(total * 10) / 10 : null,
      totalRange,
      totalSE: totalSE != null ? Math.round(totalSE * 10) / 10 : null,
      allReady,
      readyCount,
      subjectCount: subjects.length,
      overallProgress,
      // 整体建议：先补最缺的那科
      nextAction: (() => {
        const worst = subjects
          .map(s => ({ s, p: perSubject[s].readiness.progress }))
          .sort((a, b) => a.p - b.p)[0];
        if (!worst) return '';
        const r = perSubject[worst.s].readiness;
        if (r.ready) return '数据够了，可以看分科明细';
        return worst.s + '：' + (r.advice[0] || '再多一些数据');
      })(),
    };
  }

  return {
    // 对外
    estimateSubject, estimateAll,
    // 内部（测试用）
    _internal: {
      collectEvidence, aptitudeFor, fuse, confidenceOf, readinessOf,
      lessonEffectiveness, toLogit, fromLogit, logitToScore,
      VAR, SUBJECT_DOMAIN, DOMAIN_LOADING,
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EvidenceEngine;
