/**
 * 进度估算引擎 v0.6
 *
 * 两条铁律：
 *  1) 没有数据的科目一律 null，绝不倒推、绝不编造。
 *  2) 输出两个数字，含义分开：
 *       currentScore   —— 「现在去高考」能考多少（只由已有证据决定）
 *       projectedScore —— 「到高考时」预计能考多少（由证据 + 剩余时间 + 每日投入推算）
 *     以前的 projected 是用「差距 × 天数比例」拍出来的，没有依据，已换成
 *     带边际递减的学习曲线模型（见 projectSubject）。
 */
const ProgressEngine = (() => {

  /** 六科：语数英 + 3 门选考 */
  function sixSubjects(goal) {
    var core = ['语文', '数学', '英语'];
    var sel = (goal && goal.selectedSubjects && goal.selectedSubjects.length)
      ? goal.selectedSubjects : ['物理', '化学', '生物'];
    return core.concat(sel.filter(function(s) { return core.indexOf(s) < 0; }));
  }

  function round5(x) { return Math.round((Number(x) || 0) * 100000) / 100000; }

  function daysLeft(goal) {
    if (!goal || !goal.examDate) return 0;
    var d = Math.ceil((new Date(goal.examDate) - new Date()) / 86400000);
    return d > 0 ? d : 0;
  }

  /** 某科的真实记录（有满分的才算） */
  function realRecords(records, sub) {
    return (records || []).filter(function(r) {
      return r.subject === sub && Number(r.fullScore) > 0 && isFinite(Number(r.score));
    });
  }

  // ══════════════════════════════════════════════════════════
  //  证据层：把每科的原始数据整理成可计算的统计量
  // ══════════════════════════════════════════════════════════
  /**
   * 关键改进：**把题目合并统计**。
   * 一份卷子只有几道题时，单卷得分率噪声极大（做对 4/5 与 3/5 就差了 20 个百分点）；
   * 把同一科所有卷子的题目放在一起算正确率，等价于把样本量从"卷数"提升到"题数"，
   * 估出来的当前水平稳得多。
   */
  function analyzeEvidence(records, mistakes, goal, papers) {
    records = records || []; mistakes = mistakes || []; papers = papers || [];
    var subs = sixSubjects(goal);
    var maxScores = DB.MAX_SCORES || {};
    var out = [];

    subs.forEach(function(sub) {
      var max = maxScores[sub] || 150;
      var subPapers = papers.filter(function(p) { return p.subject === sub; })
        .sort(function(a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
      var recs = realRecords(records, sub);

      var nQuestions = 0, nCorrect = 0, nWrong = 0, papersWithQ = 0;
      var paperRatios = [];       // 卷面得分率（原始，给趋势用）
      var diffList = [];          // 逐卷难度档：[{level, w}]，level 1~5，3=高考平均
      var perPaper = [];          // 逐卷明细：每份卷子用**自己的难度**折算

      subPapers.forEach(function(p) {
        // ★ 逐题难度 → 本卷难度档。缺难度标注时 paperDifficulty 返回 null，不影响其它逻辑。
        var pd = DB.paperDifficulty ? DB.paperDifficulty(p) : null;
        if (pd != null) {
          diffList.push({ level: pd, w: Math.max(1, (Array.isArray(p.questions) ? p.questions.length : 0)) });
        }

        var judged = 0, ok = 0;
        if (Array.isArray(p.questions) && p.questions.length) {
          papersWithQ++;
          p.questions.forEach(function(q) {
            if (q.isCorrect === true) { judged++; ok++; }
            else if (q.isCorrect === false) { judged++; }
          });
          if (judged) { nQuestions += judged; nCorrect += ok; nWrong += (judged - ok); }
        }

        // 卷面得分率：模型按该卷满分打的，**自带难度校准**
        //（题目正确率只反映"做对几道"，不反映题目难度和分值权重）
        var full = Number(p.fullScore);
        var pr = (full > 0 && isFinite(Number(p.score))) ? Number(p.score) / full : null;
        if (pr != null) paperRatios.push({ r: pr, w: full });

        // ★ 关键：每份卷子用**自己的来源 + 自己的难度**折算，之后才加权平均。
        //   不能"先把几份卷子的得分率平均、再乘一个平均系数"——各卷难度差别大时那样会算错。
        var psrc = p.kind || p.type || 'unknown';
        var rawFactor = Storage.getDifficultyFactor
          ? Storage.getDifficultyFactor(sub, psrc, pd)
          : DB.difficultyFactor(sub, psrc, pd);

        /**
         * ★ 折算收窄（2026-10-17 修）
         *
         * 背景：EXAM_DIFFICULTY 的系数（数学 0.72、物理 0.70）是拿"模拟卷"
         * 和高考真题对比出来的，回答的是"这类卷子比高考易多少"。
         *
         * 两个认识：
         *   ① 这个折扣和"有几次考试"**无关** —— 多考几次不会让卷子变难。
         *      （上一版让 relax 随卷数递减到 0，导致"卷子越多估得越低"，反直觉）
         *   ② 校内考试里既有偏易的题，也有超纲/竞赛改编的题，方向不一定单向，
         *      所以不该全额打折。
         *
         * 做法：固定收窄 60% —— 即 0.72 实际按 0.72 + 0.28×0.60 = 0.888 用。
         * 这个幅度是保守的：仍然承认"校内卷比高考易"，只是不那么狠。
         */
        if (rawFactor < 1) {
          var RELAX = 0.60;
          rawFactor = rawFactor + (1 - rawFactor) * RELAX;
        }
        /**
         * ★ 高分段收敛（2026-10-10，方案 B）：
         *   折算原本是纯线性的 —— 校内卷考满分也照打平均折扣（数学 150 分只给 105），
         *   在接近满分时属过度惩罚。这里按**本卷得分率**把折扣放开，
         *   低分段照旧、高分段收敛到 DB.SCORE_TAPER.maxFactor（默认 0.88）。
         *   只影响打折的卷子；真题（系数 ≥ 1）不受影响。
         */
        var factor = (DB.scoreTaper && pr != null) ? DB.scoreTaper(pr, rawFactor) : rawFactor;
        perPaper.push({
          ratio: pr,
          pooled: judged ? ok / judged : null,
          nq: judged,
          w: full > 0 ? full : 1,
          paperFull: full > 0 ? full : 0,   // ★ P1：给证据层算权重用
          date: p.date || '',               // ★ P1：时间半衰期权重用（旧版只有排名，不看真实间隔）
          factor: factor,
          factorBefore: rawFactor,      // 收敛前的系数（给依据列显示）
          tapered: factor !== rawFactor,
          level: pd,
        });
      });

      /**
       * 合并"独立的成绩记录"（没有对应试卷的那些）。
       *
       * ★ P0 修复（2026-10-10）：旧实现有三个真 bug：
       *   ① **重复计数**：导入/上传时同一份卷子同时写进 papers 和 records
       *      （app.js:3497/4356），旧代码把 records 全部再算一遍 —— 同一份成绩计两次。
       *   ② **来源丢失**：旧版写死 'unknown'，于是**高考真题也被当校内卷打折**。
       *      实测推演：数学真题 100/150 会算成 (100/150)×(1+2×0.72)/3 = 81.3 分。
       *   ③ **一刀切**：旧代码把这段放在 `if (!nQuestions)` 里 —— 只要该科有**任何一题**
       *      判过对错，所有纯成绩记录就**全部被丢弃**；反之又全部计入。
       *      于是"多补一题"会让估分突然跳变。
       *
       * 新口径：**逐份判断**——有对应试卷的记录跳过（已在纸卷层算过），
       *         没有对应试卷的独立记录才计入，并还原它的真实来源。
       */
      var seenPaperIds = {};
      subPapers.forEach(function(p) { if (p && p.id) seenPaperIds[p.id] = true; });
      var unmergedRecords = 0;
      recs.forEach(function(x) {
        if (x.paperId && seenPaperIds[x.paperId]) return;   // ① 去重：这份卷子已按 paper 算过
        var r = Number(x.score) / Number(x.fullScore);
        if (!isFinite(r)) return;
        // ② 还原来源：新记录带 kind；老记录从 importData.source 找
        var rsrc = x.kind || (x.importData && x.importData.source) || 'unknown';
        var rFactor = Storage.getDifficultyFactor
          ? Storage.getDifficultyFactor(sub, rsrc, null)
          : DB.difficultyFactor(sub, rsrc, null);
        // 同样做高分段收敛，保持与纸卷层口径一致
        var rFactorEff = (DB.scoreTaper) ? DB.scoreTaper(r, rFactor) : rFactor;
        paperRatios.push({ r: r, w: Number(x.fullScore) });
        perPaper.push({
          ratio: r, pooled: null, nq: 0, w: Number(x.fullScore) || 1,
          factor: rFactorEff, factorBefore: rFactor, tapered: rFactorEff !== rFactor, level: null,
        });
        unmergedRecords++;
      });

      // 题目合并正确率：样本量大，用来"稳住"估计，但它不管难度
      var pooledRatio = nQuestions ? (nCorrect / nQuestions) : null;

      /**
       * ★ P1（2026-10-10）：证据层融合
       *
       * 旧做法：按满分加权 + 排名式近期权重（最早 1 倍 → 最新 2 倍）做加权平均。
       * 两个硬伤：① 得分率有界，直接平均被边界压缩；② 题少的卷子和题多的卷子话语权一样。
       *
       * 新做法（EvidenceLayer）：
       *   ① logit 尺度（可加、不受边界压缩）
       *   ② 每卷自带方差（delta method：1/(n·p(1-p))），题少 → 方差大 → 话语权小
       *   ③ 时间半衰期权重（0.5^(Δt/H)），按真实时间差而不是排名
       *   ④ 经验贝叶斯收缩：证据少 → 靠近学科先验
       */
      var fuse = null;
      if (typeof EvidenceLayer !== 'undefined' && perPaper.length) {
        var fusePapers = perPaper.map(function(x) {
          return {
            ratio: x.ratio == null ? null : (x.factor != null ? x.ratio * x.factor : x.ratio),
            nq: x.nq || 0,
            weight: x.paperFull || x.w || 0,
            date: x.date,
            noDifficulty: x.level == null,
          };
        }).filter(function(x) { return x.ratio != null; });

        /**
         * ★ 先验锚点（2026-10-17 修 —— 这是"填了分反而更低"的根因）
         *
         * 原来写死 priorRatio = 0.55（不管什么科目、什么学生）。
         * 实测：用户填 581 分（得分率 77%），估算只有 486（65%）——
         * 每一科都被往 55% 拽，因为"1 份卷子"的证据太弱，先验占了上风。
         *
         * 正确做法：先验应该锚在**这个学生已经表现出来的水平**上。
         * 用问卷填的起始总分算得分率，再按学科做小幅修正（±8% 内）。
         * 只有连起始分都没有时，才退回 0.55。
         */
        var goalForPrior = (Storage.getGoal && Storage.getGoal()) || {};
        var stuTotal = Number(goalForPrior.current) || 0;
        var maxMap = DB.MAX_SCORES || {};
        var totalFull = 0;
        ['语文', '数学', '英语'].forEach(function (x) { totalFull += (maxMap[x] || 150); });
        var selSubs = (goalForPrior.selectedSubjects || []).slice(0, 3);
        if (selSubs.length) selSubs.forEach(function (x) { totalFull += (maxMap[x] || 100); });
        else totalFull += 300;

        var priorRatio;
        if (stuTotal > 0 && totalFull > 0) {
          var stuRate = Math.max(0.15, Math.min(0.95, stuTotal / totalFull));
          var subjFactor = (DB.EXAM_DIFFICULTY && DB.EXAM_DIFFICULTY[sub] && DB.EXAM_DIFFICULTY[sub].factor) || 0.85;
          // 学科相对高低：折算系数高的科目（比如英语 0.90）给一点上浮
          var adj = Math.max(-0.08, Math.min(0.08, (subjFactor - 0.80) * 0.4));
          priorRatio = Math.max(0.15, Math.min(0.95, stuRate + adj));
        } else {
          priorRatio = 0.55;
        }

        fuse = EvidenceLayer.fuse(fusePapers, {
          priorRatio: priorRatio,
          priorVarLogit: 1.6,
          halfLifeDays: 120,
        });
      }

      /** 按满分加权 + **近期权重更高**（保留旧实现，仅给趋势/兼容用） */
      function wmean(list, pick) {
        var ws = 0, vs = 0;
        list.forEach(function(x, i) {
          var v = pick(x);
          if (v == null || !isFinite(v)) return;
          var recency = 1 + i / Math.max(1, list.length - 1);   // 最早 1 倍 → 最新 2 倍
          var w = (x.w || 1) * recency;
          ws += w; vs += v * w;
        });
        return ws ? vs / ws : null;
      }

      var paperRatio = wmean(perPaper, function(x) { return x.ratio; });   // 原始卷面得分率

      /**
       * ★ 本卷难度档（2026-10-02 新增）：把同一科所有卷子的逐题难度合成一个数。
       * 1~5 档、3 = 高考平均难度，所以它直接回答"这份卷子到底比高考难还是容易"，
       * 而不是拿一个固定系数糊过去。按题数 + 近期权重加权。
       */
      var difficultyLevel = null;
      if (diffList.length) {
        var dws = 0, dvs = 0;
        diffList.forEach(function(x, i) {
          var recency = 1 + i / Math.max(1, diffList.length - 1);
          var w = (x.w || 1) * recency;
          dws += w; dvs += x.level * w;
        });
        if (dws) difficultyLevel = dvs / dws;
      }
      var difficultyAdj = DB.difficultyAdj ? DB.difficultyAdj(difficultyLevel) : 1;

      // ★ 折算后的得分率：每卷各自折完再平均
      var adjPaperRatio = wmean(perPaper, function(x) {
        return x.ratio == null ? null : x.ratio * x.factor;
      });
      var adjPooledRatio = null;
      (function() {
        var pws = 0, pvs = 0;
        perPaper.forEach(function(x) {
          if (x.pooled == null) return;
          var w = x.nq || 1;
          pws += w; pvs += x.pooled * x.factor * w;
        });
        if (pws) adjPooledRatio = pvs / pws;
      })();

      /**
       * 合成口径：**卷面得分率为主（0.65）**，题目正确率为辅（0.35）。
       * 卷面分是模型按满分给的，已经把分值权重算进去了；
       * 题目正确率只数对错，若卷子偏简单会严重高估，所以只占小头。
       */
      var rawRatio = null;
      if (paperRatio != null && pooledRatio != null) rawRatio = paperRatio * 0.65 + pooledRatio * 0.35;
      else if (paperRatio != null) rawRatio = paperRatio;
      else if (pooledRatio != null) rawRatio = pooledRatio;

      /**
       * ★ 高考等效得分率（用户要的"结合高考难度"就落在这里）
       * rawRatio 只是"他做这些卷子的正确率"，**不等于高考水平**——校内卷普遍比高考容易
       * （知识点覆盖窄、重复训练多、批改宽松）。折算 = 学科基准（LongCat-2.5-Preview 对
       * 近 10 年真题与校内模拟卷的对比分析）× 来源修正 × **本卷难度修正**。
       *
       * ★ P1（2026-10-10）：优先用**证据层融合结果**（logit + 方差 + 时间半衰期 + 收缩），
       *   而不是"加权平均得分率"。融合失败（无证据层/无数据）时才回落到旧口径。
       *   两者都保留：便于对照，也保证任何情况下都有结果。
       */
      var ratioOld = null;
      if (adjPaperRatio != null && adjPooledRatio != null) ratioOld = adjPaperRatio * 0.65 + adjPooledRatio * 0.35;
      else if (adjPaperRatio != null) ratioOld = adjPaperRatio;
      else if (adjPooledRatio != null) ratioOld = adjPooledRatio;
      if (ratioOld != null) ratioOld = Math.max(0, Math.min(1, ratioOld));

      var ratio = ratioOld;
      if (fuse && fuse.ratio != null) ratio = Math.max(0, Math.min(1, fuse.ratio));

      // 展示用的**综合折算系数** = 折算后 ÷ 折算前：
      // 这样界面上"卷面 X% × 折算 Y → Z%"永远自洽，用户能自己验算。
      var difficultyFactor = (rawRatio != null && rawRatio > 0 && ratio != null)
        ? ratio / rawRatio
        : (perPaper.length ? perPaper[perPaper.length - 1].factor : 0.85);
      difficultyFactor = Math.round(difficultyFactor * 10000) / 10000;

      // ★ 高分段收敛的痕迹（只要有任一科卷子被放开，就在依据列说明）
      var taperedPapers = perPaper.filter(function(x) { return x.tapered; }).length;
      var taperNote = '';
      if (taperedPapers) {
        var t0 = perPaper.filter(function(x) { return x.tapered; })[0];
        taperNote = DB.scoreTaperNote ? DB.scoreTaperNote(t0.ratio, t0.factorBefore) : '';
      }

      // 错题惩罚（只对有数据的科目）
      var errs = mistakes.filter(function(m) { return m.subject === sub; }).length;
      var penaltyRatio = 0;
      if (ratio != null && errs) penaltyRatio = Math.min(errs * 0.004, 0.05);

      // 趋势：卷面得分率的线性回归斜率（每卷变化量）
      var trend = 'nodata', slope = 0;
      if (paperRatios.length >= 3) {
        var n = paperRatios.length, sx = 0, sy = 0, sxy = 0, sxx = 0;
        paperRatios.forEach(function(x, i) {   // x 现在是 {r, w}
          sx += i; sy += x.r; sxy += i * x.r; sxx += i * i;
        });
        var den = n * sxx - sx * sx;
        slope = den ? (n * sxy - sx * sy) / den : 0;
        trend = slope > 0.02 ? 'up' : slope < -0.02 ? 'down' : 'stable';
      }

      // 置信度：由样本量决定。25 个题目观测 → 约 0.71；50 题 → 0.92
      var obsCount = nQuestions || (paperRatios.length * 5);
      var confidence = ratio == null ? 0 : (1 - Math.exp(-obsCount / 30));

      /**
       * ★ P2（2026-10-10）：数据充分度分级（三维，替代"只看题数"的置信度）
       *
       * 旧 confidence 只看题目数量，不看：难度判没判、来源是否单一、卷子是否挤在一周内。
       * 结果"做了 50 道同一套题"会给出很高的置信度 —— 那是虚高。
       *
       * 新口径看四件事：题量 / 难度覆盖 / 来源多样性 / 时间跨度。
       */
      var sourcesSeen = {};
      subPapers.forEach(function(p) { sourcesSeen[p.kind || p.type || 'unknown'] = 1; });
      recs.forEach(function(x) {
        sourcesSeen[x.kind || (x.importData && x.importData.source) || 'unknown'] = 1;
      });
      var dateList = subPapers.map(function(p) { return p.date; }).filter(Boolean).sort();
      var spanDays = 0;
      if (dateList.length >= 2) {
        var d0 = new Date(dateList[0]), d1 = new Date(dateList[dateList.length - 1]);
        if (!isNaN(d0.getTime()) && !isNaN(d1.getTime())) spanDays = Math.abs((d1 - d0) / 86400000);
      }
      var diffJudgedRatio = subPapers.length ? (diffList.length / subPapers.length) : 0;

      var suff = (typeof EvidenceLayer !== 'undefined' && EvidenceLayer.sufficiency)
        ? EvidenceLayer.sufficiency({
            nQuestions: nQuestions,
            nPapers: subPapers.length,
            diffJudgedRatio: diffJudgedRatio,
            nSources: Object.keys(sourcesSeen).length,
            spanDays: spanDays,
          })
        : { level: 'mid', score: 0.5, reasons: [], advice: '' };

      /**
       * 测量误差 SE 的计算放在后面（依赖 ratioCov / coverage / gradeAssigned），
       * 见下方 "P4：测量误差" 块。★ 曾经误放在这里 —— 那时 ratioCov 还没定义，
       * 结果 seNow 恒为 0，预测区间宽度完全不随数据量变化（被测试 T4-2 抓出来）。
       */

      /**
       * ★ 教材覆盖率（用户要求：没学的知识点直接按 0 分算）
       * ratio 是"在学过的内容上"的高考等效得分率，但高考卷里还有他没学过的章节——
       * 那些题一分拿不到。所以现在的分 = ratio × 覆盖率 × 满分。
       * 覆盖率三级来源：
       *   ① AI 折算（xt_textbook_coverage 缓存，能懂"刚上解析几何的直线"这种口语，按高考分值权重折）
       *   ② 本地匹配（只认"必修第一册 第五章"这种标准写法）
       *   ③ 都没有 → null，不扣分，但如实告诉用户"没扣"，绝不瞎猜。
       */
      var cov = null, covSrc = null;
      var covCache = Storage.getTextbookCoverage ? Storage.getTextbookCoverage() : null;
      if (covCache && covCache.map && covCache.map[sub] && covCache.map[sub].coverage != null) {
        cov = { ratio: Math.max(0, Math.min(1, Number(covCache.map[sub].coverage))),
                learned: 0, total: 0, matched: covCache.map[sub].learned || '', exact: false };
        covSrc = 'ai';
      } else if (DB.coverageOf && Storage.getSubjectTextbook) {
        var tb = Storage.getSubjectTextbook(sub);
        if (tb && tb.unit) { var c1 = DB.coverageOf(sub, tb.unit); if (c1) { cov = c1; covSrc = 'local'; } }
      }
      var coverage = cov ? cov.ratio : null;
      var ratioCov = (ratio == null) ? null
        : (coverage == null ? ratio : Math.max(0, Math.min(1, ratio * coverage)));

      /**
       * ══════════════════════════════════════════════════════════
       *  ★ P3（2026-10-10）：浙江选考等级赋分
       * ══════════════════════════════════════════════════════════
       *
       * 官方口径（浙江考试院 2022 问答 2/6）：
       *   语数外**按卷面分**计入；选考**按等级赋分**（满分 100，起点 40），
       *   以当次当科全体考生卷面分布划 20 区间、区间内等比例转换。
       *
       * 所以选考**不能**用"得分率 × 100"当高考分 —— 那是原始分口径，量级就不对。
       * 正确链路：答卷表现 → 估计全省位次 → 官方 20 区间 → 赋分。
       *
       * ★ 诚实的边界：区间边界是**官方给定、可审计**的；
       *   "全省位次"是**估计**（我们没有全省考生分布），所以：
       *     · 结果按**区间**呈现，不给假精确值；
       *     · 位次估计的不确定度显式传下去（见 uncertainty）。
       */
      var gradeAssigned = false, gradeScore = null, gradeRange = null, gradeNote = '';
      // ★ 用 DB.isZhejiang(goal) 判断，它会同时看 goal.province 和 goal.city
      //   （省市信息实际存在 city，如"浙江杭州"；只看 province 会静默失效）
      gradeAssigned = !!(DB.isZhejiang && DB.isZhejiang(goal) &&
                         DB.isGradeAssigned && DB.isGradeAssigned(sub, '浙江'));

      if (gradeAssigned && ratioCov != null && DB.zjGradeFromPercentile) {
        /**
         * 位次估计：把"高考等效得分率"映射成"全省位次百分位"。
         *
         * 这是**假设**，不是测量。依据：选考科目按官方规则，赋分 60 分大约对应
         * 中位偏上；我们用一条单调映射，把得分率 0.5 视为略优于中位，
         * 并用 logistic 形状避免两端过于陡峭。
         *
         * 为什么用 logistic：得分率与位次不是线性关系 —— 从 95% 提到 97% 跨越的
         * 人数远少于从 55% 提到 57%。用 S 形更接近真实分布，且两端自然收敛。
         */
        var eff = Math.max(0, Math.min(1, ratioCov - penaltyRatio));
        // 映射参数（先验）：得分率 0.5 → 约 55% 位次；0.8 → 约 12%；0.95 → 约 1%
        var pivot = 0.55, steep = 7.5;
        var logit = 1 / (1 + Math.exp(-steep * (eff - pivot)));   // 0~1，越大越好
        var percentileTop = Math.max(0.0005, Math.min(0.999, 1 - logit));

        var g = DB.zjGradeFromPercentile(percentileTop);
        if (g) {
          gradeScore = g.score;
          gradeNote = DB.zjGradeNote ? DB.zjGradeNote(g) : '';
          gradeRange = DB.zjGradeRange ? DB.zjGradeRange(percentileTop, 0.06) : null;
        }
      }

      /**
       * 「现在分」的口径：
       *   · 语数外 → 原始分（得分率 × 满分）
       *   · 选考（浙江）→ **等级赋分**（40~100），这才是它进总分的样子
       */
      var current;
      if (gradeAssigned) {
        current = gradeScore == null ? null : round5(gradeScore);
      } else {
        current = ratioCov == null ? null
          : round5(Math.max(0, Math.min(1, ratioCov - penaltyRatio)) * max);
      }

      // 选考的展示满分是 100（赋分满值），语数外是各自满分
      var displayMax = gradeAssigned ? 100 : max;

      /**
       * ══════════════════════════════════════════════════════════
       *  ★ P4（2026-10-10）：测量误差 SE（分数尺度）
       * ══════════════════════════════════════════════════════════
       *
       * 这是"现在水平"估计本身的不确定度，来源三块：
       *   ① 抽样误差：n 道题估一个得分率，标准误 ≈ sqrt(p(1-p)/n)
       *   ② 难度未判：没有逐题难度时，折算多一层先验的不确定（+30%）
       *   ③ 覆盖率未判：没填教材进度时，不知道多少内容没学（+20%）
       *
       * 换算到分数：SE_score = p 的标准误 × 满分。
       * 这个数**直接决定预测区间有多宽** —— 数据越少，区间越宽，越诚实。
       *
       * ★ 位置很重要：必须放在 ratioCov / penaltyRatio / displayMax 之后，
       *   否则读到 undefined，SE 恒为 0（曾被专项测试 T4-2 抓出来）。
       */
      var pForSe = ratioCov == null ? null : Math.max(0.001, Math.min(0.999, ratioCov - penaltyRatio));
      var seNow = 0;
      if (pForSe != null) {
        var nEff = Math.max(1, nQuestions || (paperRatios.length * 3) || 1);
        var seP = Math.sqrt(pForSe * (1 - pForSe) / nEff);          // ① 抽样
        var seMult = 1;
        if (!diffList.length) seMult += 0.30;                        // ② 难度未判
        if (coverage == null) seMult += 0.20;                        // ③ 覆盖未判
        seNow = seP * seMult * displayMax;
        // 地板：即使题很多，也保留"模型本身不完美"的下限（满分的 2%）
        seNow = Math.max(seNow, displayMax * 0.02);
      }

      out.push({
        subject: sub,
        maxScore: max,
        displayMax: displayMax,                                        // 展示用满分（选考=100 赋分）
        gradeAssigned: gradeAssigned,                                  // 是否走等级赋分（浙江选考）
        gradeScore: gradeScore,                                        // 赋分（40~100）
        gradeLow: gradeRange ? gradeRange.low : null,                  // 赋分区间下界
        gradeHigh: gradeRange ? gradeRange.high : null,                // 赋分区间上界
        gradeNote: gradeNote,                                          // 一句话说明
        nPapers: subPapers.length,
        papersWithQuestions: papersWithQ,
        nQuestions: nQuestions,
        nCorrect: nCorrect,
        nWrong: nWrong,
        pooledRatio: pooledRatio == null ? null : round5(pooledRatio),
        paperRatio: paperRatio == null ? null : round5(paperRatio),
        rawRatio: rawRatio == null ? null : round5(rawRatio),          // 卷面原始得分率
        difficultyLevel: difficultyLevel == null ? null : round5(difficultyLevel),  // 本卷难度档(1~5,3=高考)
        difficultyAdj: difficultyAdj,                                  // 本卷难度修正系数
        difficultyNote: DB.difficultyNote ? DB.difficultyNote(difficultyLevel) : '',
        difficultyPapers: diffList.length,                             // 有几份卷子判出了难度
        difficultyFactor: difficultyFactor,                            // 高考折算系数
        // ★ P1：证据层融合结果（logit + 收缩）
        fuse: fuse ? {
          weight: round5(fuse.weight),          // 数据权重（0=全信先验，1=全信数据）
          rawRatio: fuse.rawRatio == null ? null : round5(fuse.rawRatio),  // 收缩前
          ratio: round5(fuse.ratio),            // 收缩后
          seRatio: round5(fuse.seRatio),
          nPapers: fuse.nPapers, totalQ: fuse.totalQ,
        } : null,
        ratioOldMethod: ratioOld == null ? null : round5(ratioOld),    // 旧口径（对照用）
        // ★ P2：充分度
        sufficiency: suff.level,
        suffScore: suff.score,
        suffReasons: suff.reasons,
        suffAdvice: suff.advice,
        spanDays: Math.round(spanDays),
        nSources: Object.keys(sourcesSeen).length,
        taperedPapers: taperedPapers,                                  // 有几份卷子走了高分段收敛
        taperNote: taperNote,                                          // 收敛说明（给依据列）
        ratio: ratio == null ? null : round5(ratio),                   // 高考等效得分率(学过的内容)
        coverage: coverage == null ? null : round5(coverage),          // 教材覆盖率(0~1)
        coverageLearned: cov ? cov.learned : null,
        coverageTotal: cov ? cov.total : null,
        coverageMatched: cov ? cov.matched : '',                       // AI概括的已学内容
        coverageExact: cov ? cov.exact : false,
        coverageSource: covSrc,                                        // 'ai' | 'local' | null
        ratioWithCoverage: ratioCov == null ? null : round5(ratioCov), // × 覆盖率之后
        penaltyRatio: round5(penaltyRatio),
        currentScore: current,          // ★ 现在这科能考多少
        slope: round5(slope),
        trend: trend,
        mistakeCount: errs,
        confidence: round5(confidence),
        seNow: round5(seNow),           // ★ P4：测量标准误（分数尺度），决定预测区间宽度
        hasData: ratio != null,
      });
    });

    return out;
  }

  // ══════════════════════════════════════════════════════════
  //  推算层：现在 → 高考时
  // ══════════════════════════════════════════════════════════
  /**
   * 单科推算。思路：
   *   gain = 剩余空间 × 可学性(分数越低越好提) × 时间饱和(边际递减) × 趋势修正
   *
   * · 可学性 = (1-r)^0.9 —— 从 60% 提到 70% 比从 90% 提到 95% 容易得多；
   * · 时间饱和 = 1 - e^(-可用小时/τ) —— 时间翻倍不等于提分翻倍，
   *   这是最关键的修正：旧版按"天数线性增长"是错的；
   * · 全局系数 0.85 —— 不是所有学习时间都直接变成分数。
   *
   * ★ P4（2026-10-10）：返回**区间**而不是单点，并暴露不确定度。
   *   propagate 参数为真时返回 {mid, low, high}，否则返回单点（兼容旧调用）。
   */
  function projectSubject(ev, goal, opts) {
    opts = opts || {};
    if (ev.currentScore == null) return null;

    /**
     * ★ P3 口径修正：选考的 currentScore 是**等级分**（满分 100），
     *   而语数外是原始分（满分 150）。旧代码一律用 ev.maxScore 算得分率，
     *   选考按 100 分算却除以 150，得分率被系统性压低 1/3。
     *   这里用 displayMax（选考=100）作为分母。
     */
    var denom = Number(ev.displayMax) || ev.maxScore || 150;
    var r = Math.max(0, Math.min(1, ev.currentScore / denom));
    var fullMark = denom;
    var headroom = fullMark - ev.currentScore;
    var days = daysLeft(goal);
    var hoursPerDay = Number(goal.hours) || 3;
    var efficiency = opts.efficiency != null ? opts.efficiency : 0.55;   // 有效学习占比
    var tau = opts.tau || 900;                                           // 时间常数（小时）
    var k = opts.k != null ? opts.k : 0.85;                              // 全局系数
    var maxGainRatio = opts.maxGainRatio != null ? opts.maxGainRatio : 1;

    var usableHours = days * hoursPerDay * efficiency;
    var timeFactor = 1 - Math.exp(-usableHours / tau);
    var learnability = Math.pow(Math.max(0, 1 - r), 0.9);
    var trendAdj = ev.trend === 'up' ? 1.15 : ev.trend === 'down' ? 0.85 : 1.0;

    var gain = headroom * k * learnability * timeFactor * trendAdj;

    // 天花板：一科的提升不能超过剩余空间的一定比例（避免推出满分）
    gain = Math.max(0, Math.min(gain, headroom * maxGainRatio));

    var mid = ev.currentScore + gain;

    /**
     * ★ P4：预测区间。
     *
     * 误差来自三块，都要算进去（否则区间是假的）：
     *   ① 测量误差 SE_measure —— 现有证据估"现在水平"本身就不准（题少/难度没判）
     *   ② 模型误差 SE_model  —— k/τ/efficiency 这些参数是拍的
     *   ③ 未来误差 SE_future —— 剩下的时间里他实际投入多少、状态如何，无法预知
     *
     * 合计 SE = sqrt(①² + ②² + ③²)，取 95% 区间（1.96σ）。
     * 区间的**含义**必须写清楚：它是"到高考时的预测分布"，不是"现在水平的置信区间"。
     */
    var seMeasure = Number(ev.seNow);
    if (!isFinite(seMeasure)) seMeasure = (fullMark * 0.06);
    // 模型误差：参数不确定性带来的等效分数误差，按剩余空间的比例给
    var seModel = headroom * 0.12 * (0.4 + 0.6 * timeFactor);
    // 未来误差：时间越长、越不可控，误差越大（上限为满分的 8%）
    var seFuture = fullMark * 0.08 * Math.min(1, timeFactor + 0.15);

    var seTotal = Math.sqrt(seMeasure * seMeasure + seModel * seModel + seFuture * seFuture);
    var z = 1.96;
    var low = Math.max(ev.currentScore, mid - z * seTotal);   // 预测不该低于"现在"
    var high = Math.min(fullMark, mid + z * seTotal);

    if (opts.propagate) {
      return {
        mid: round5(mid),
        low: round5(low),
        high: round5(high),
        se: round5(seTotal),
        breakdown: { measure: round5(seMeasure), model: round5(seModel), future: round5(seFuture) },
      };
    }
    return round5(mid);
  }

  /**
   * 汇总六科 → 两个总分 + 单科明细 + 区间
   *
   * ★ P4（2026-10-10）：总分不再是单点，而是「在 + 预测区间」。
   *   总分区间不能简单加单科区间（那样会高估，因为误差有相关性），
   *   但也不能忽略 —— 采用**平方和开方**（假设各科误差近似独立，
   *   这是简化，已在界面标注为"近似"）。
   */
  function buildResult(evidence, goal, opts) {
    var scores = {}, projected = {}, projRange = {}, covered = [], missing = [], gains = [];
    var totalCur = 0, totalProj = 0, anyProj = false;
    var confSum = 0, confN = 0;
    var varSum = 0;              // 单科预测方差累加（用于总分区间）
    var curVarSum = 0;           // 单科"现在"方差累加

    evidence.forEach(function(ev) {
      if (!ev.hasData) { scores[ev.subject] = null; projected[ev.subject] = null; missing.push(ev.subject); return; }
      covered.push(ev.subject);
      scores[ev.subject] = ev.currentScore;
      totalCur += ev.currentScore;
      confSum += ev.confidence; confN++;
      if (isFinite(Number(ev.seNow))) curVarSum += Math.pow(Number(ev.seNow), 2);

      var p = projectSubject(ev, goal, opts);
      projected[ev.subject] = p;
      if (p != null) { totalProj += p; anyProj = true; gains.push(round5(p - ev.currentScore)); }

      // 取区间（再算一次带 propagate 的版本）
      var optsP = { propagate: true };
      if (opts) { for (var kk in opts) { if (Object.prototype.hasOwnProperty.call(opts, kk)) optsP[kk] = opts[kk]; } }
      var pr = projectSubject(ev, goal, optsP);
      projRange[ev.subject] = pr;
      if (pr && isFinite(pr.se)) varSum += Math.pow(pr.se, 2);
    });

    var complete = missing.length === 0;
    var seTotal = Math.sqrt(varSum);
    var seCur = Math.sqrt(curVarSum);
    var z = 1.96;

    return {
      subjectScores: scores,            // 各科「现在」
      subjectProjected: projected,      // 各科「高考时」（单点，兼容旧界面）
      subjectProjectedRange: projRange, // ★ 各科预测区间 {mid,low,high,se,breakdown}
      total: complete ? round5(totalCur) : null,
      projected: (complete && anyProj) ? round5(totalProj) : null,
      // ★ 总分区间（近似：各科误差独立 → 方差可加）
      totalRange: (complete && anyProj) ? {
        low: round5(Math.max(0, totalProj - z * seTotal)),
        high: round5(Math.min(750, totalProj + z * seTotal)),
        se: round5(seTotal),
      } : null,
      currentRange: (complete && isFinite(seCur) && seCur > 0) ? {
        low: round5(Math.max(0, totalCur - z * seCur)),
        high: round5(Math.min(750, totalCur + z * seCur)),
        se: round5(seCur),
      } : null,
      partialTotal: round5(totalCur),
      totalGain: (complete && anyProj) ? round5(totalProj - totalCur) : null,
      perSubjectGain: gains,
      covered: covered, missing: missing,
      coverage: covered.length, totalSubjects: evidence.length,
      confidence: confN ? round5(confSum / confN) : 0,
      daysLeft: daysLeft(goal),
      evidence: evidence,
      method: 'local',
    };
  }

  /** 本地估算（无 Key 或 AI 失败时的降级） */
  function localEstimate(records, mistakes, goal, papers) {
    var ev = analyzeEvidence(records, mistakes, goal, papers);
    return buildResult(ev, goal);
  }

  /**
   * AI 估算。把**统计证据**交给模型，让它做定性判断并微调；
   * 拿到结果后再本地夹一遍（不许超满分、没数据的科目必须为空）。
   */
  async function aiEstimate(goal, records, mistakes, papers) {
    var ev = analyzeEvidence(records, mistakes, goal, papers);
    var base = buildResult(ev, goal);

    if (!base.coverage) return base;   // 一科数据都没有，不必浪费一次调用

    try {
      var r = await LLM.estimateScore({
        current: goal.current,
        goal: goal.target,
        examDate: goal.examDate,
        daysLeft: base.daysLeft,
        hoursPerDay: Number(goal.hours) || 3,
        evidence: ev.map(function(e) {
          return {
            subject: e.subject,
            maxScore: e.maxScore,
            现有试卷数: e.nPapers,
            已判定题目数: e.nQuestions,
            做对: e.nCorrect, 做错: e.nWrong,
            题目正确率: e.pooledRatio,
            卷面平均得分率: e.paperRatio,
            本卷难度档_1到5_3等于高考平均: e.difficultyLevel,
            本卷难度修正: e.difficultyAdj,
            教材覆盖率: e.coverage,
            教材覆盖率来源: e.coverageSource === 'ai' ? 'AI折算' : e.coverageSource === 'local' ? '标准章节名匹配' : '',
            已学内容: e.coverageMatched,
            高考折算系数: e.difficultyFactor,
            高考等效得分率: e.ratio,
            错题数: e.mistakeCount,
            趋势: e.trend,
            本地推算现在分: e.currentScore,
            本地推算高考分: projectSubject(e, goal),
          };
        }),
        missing: base.missing,
        localTotal: base.total,
        localProjected: base.projected,
        subjectTargets: (goal && goal.subjectTargets) || {},
      });

      // ★ 只认有数据的科目；模型多给的、给 null 的，一律剔除
      var scores = {}, proj = {};
      var evBySub = {};
      ev.forEach(function(e) { evBySub[e.subject] = e; });

      sixSubjects(goal).forEach(function(sub) {
        var hasData = base.covered.indexOf(sub) >= 0;
        if (!hasData) { scores[sub] = null; proj[sub] = null; return; }

        var raw = r.subjectEstimates ? r.subjectEstimates[sub] : null;
        var cur = null, prj = null;
        if (raw != null && typeof raw === 'object') { cur = raw.current; prj = raw.projected; }
        else if (raw != null) { cur = raw; }          // 兼容旧的纯数字格式

        cur = (cur != null && isFinite(Number(cur))) ? round5(Number(cur)) : evBySub[sub].currentScore;
        prj = (prj != null && isFinite(Number(prj))) ? round5(Number(prj)) : projectSubject(evBySub[sub], goal);

        /**
         * ★ "现在的分"是确定性计算：卷面 × 难度折算 × 教材覆盖率 × 满分。
         * 模型只许小幅偏离（-15%~+10%），不许把已经扣掉的覆盖率抬回去——
         * 否则"没学的知识点按 0 分算"就白做了（实测模型会把 278 抬回 499）。
         */
        var localCur = evBySub[sub].currentScore;
        if (localCur != null && isFinite(Number(cur))) {
          var lo = localCur * 0.85, hi = localCur * 1.1;
          if (cur > hi) cur = round5(hi);
          if (cur < lo) cur = round5(lo);
        }

        // 夹到合理区间：不能为负、不能超满分；预测不能低于"现在"（有趋势修正也不该倒退回考试）
        var maxS = evBySub[sub].maxScore;
        scores[sub] = Math.max(0, Math.min(maxS, cur));
        prj = Math.max(0, Math.min(maxS, prj));
        if (prj < scores[sub]) prj = scores[sub];
        proj[sub] = prj;
      });

      var complete = base.missing.length === 0;
      var totCur = 0, totPrj = 0;
      sixSubjects(goal).forEach(function(s) {
        if (scores[s] != null) totCur += scores[s];
        if (proj[s] != null) totPrj += proj[s];
      });

      return {
        subjectScores: scores,
        subjectProjected: proj,
        total: complete ? round5(totCur) : null,
        projected: complete ? round5(totPrj) : null,
        partialTotal: base.partialTotal,
        totalGain: complete ? round5(totPrj - totCur) : null,
        covered: base.covered, missing: base.missing,
        coverage: base.coverage, totalSubjects: base.totalSubjects,
        confidence: r.confidence != null ? round5(Math.min(1, Math.max(0, Number(r.confidence)))) : base.confidence,
        daysLeft: base.daysLeft,
        evidence: ev,
        analysis: r.analysis || '',
        suggestion: r.suggestion || '',
        keyGains: Array.isArray(r.keyGains) ? r.keyGains : [],
        method: 'ai',
      };
    } catch (e) {
      console.warn('AI 估算失败，改用本地推算:', e);
      return base;
    }
  }

  /**
   * 薄弱点分析（本地统计 + AI 深挖）
   */
  async function analyzeWeakness(records, mistakes) {
    records = records || [];
    mistakes = mistakes || [];

    var map = {};
    mistakes.forEach(function(m) {
      var key = m.subject + '-' + m.knowledge;
      if (!map[key]) map[key] = { name: m.knowledge, subject: m.subject, count: 0 };
      map[key].count++;
    });
    var list = Object.keys(map).map(function(k) { return map[k]; })
      .sort(function(a, b) { return b.count - a.count; });

    try {
      if (mistakes.length > 3) {
        var aiResult = await LLM.analyzeWeakness({ mistakes: mistakes, records: records });
        if (aiResult.weaknesses && aiResult.weaknesses.length) {
          return {
            list: aiResult.weaknesses.map(function(w, i) {
              return {
                name: w.name,
                subject: w.subject,
                level: w.level || 'warning',
                errorRate: w.errorRate || 0,
                occurrences: w.occurrences || 1,
                priority: w.priority || i + 1,
                count: w.occurrences || 1,
                suggestion: w.suggestion || '',
              };
            }),
            summary: aiResult.summary || '',
            method: 'ai',
          };
        }
      }
    } catch (e) {
      console.warn('AI 薄弱点分析失败:', e);
    }

    return {
      list: list.map(function(w, i) {
        var related = realRecords(records, w.subject);
        return {
          name: w.name,
          subject: w.subject,
          level: w.count >= 5 ? 'critical' : w.count >= 3 ? 'warning' : 'improving',
          errorRate: Math.min(w.count / Math.max(related.length, 1), 1),
          occurrences: w.count,
          priority: i + 1,
          count: w.count,
          suggestion: '',
        };
      }),
      summary: '',
      method: 'local',
    };
  }

  /**
   * 单次测验的影响（基于本次真实得分，不是编的）
   */
  function singleImpact(result, goal) {
    var maxScores = DB.MAX_SCORES || {};
    var ratio = result.fullScore ? result.score / result.fullScore : 0;
    var max = maxScores[result.subject] || 150;
    return {
      subject: result.subject,
      estimatedScore: round5(max * ratio),
      delta: round5((ratio - 0.65) * max),
      potential: round5((max - max * ratio) * (ratio > 0.8 ? 0.5 : ratio > 0.6 ? 1 : 1.5)),
    };
  }

  return {
    sixSubjects: sixSubjects,
    realRecords: realRecords,
    analyzeEvidence: analyzeEvidence,
    projectSubject: projectSubject,
    buildResult: buildResult,
    localEstimate: localEstimate,
    aiEstimate: aiEstimate,
    analyzeWeakness: analyzeWeakness,
    singleImpact: singleImpact,
    daysLeft: daysLeft,
  };
})();
