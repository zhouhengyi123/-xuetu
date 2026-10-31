/**
 * 就绪度面板渲染（2026-10-18 新增）
 *
 * 用户明确要求：
 *   "让这个 AI 认为可以开始估计成绩的时候再开始估计成绩，
 *    至少有 60% 以上的把握才再开始估计成绩，
 *    然后而且要做一个什么时候可以开始估计成绩的进度条"
 *
 * 这个文件负责把 evidence-v2 的 readiness 结果画成进度条。
 *
 * 设计要点：
 *   · 每科一行，各自有进度（用户说"每科的成绩估计要单分开来看"）
 *   · 进度条到 100% 才解锁该科的分数
 *   · 没到 100% 时，明确告诉用户"还差什么"（不是干等）
 */
const ReadinessUI = (() => {

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /**
   * 组装 evidence-v2 需要的上下文
   *
   * 数据来源：
   *   papers   ← Storage.getPapers()
   *   lessons  ← Storage.getLessons()（新，上课记录）
   *   quizzes  ← Storage.getQuizStats()（新，练习统计）
   *   aptitude ← Storage.getAptitude()（新，能力测验结果）
   */
  function buildContext() {
    const goal = Storage.getGoal();

    // 上课记录（如果 Storage 有对应方法就用，没有就空数组）
    let lessons = [];
    try {
      lessons = (Storage.getLessons && Storage.getLessons()) || [];
    } catch (e) { lessons = []; }

    // 练习记录：从错题/答题历史里汇总成 {subject, right, total}
    let quizzes = [];
    try {
      if (Storage.getQuizStats) quizzes = Storage.getQuizStats();
    } catch (e) { quizzes = []; }

    // 能力测验
    let aptitude = null;
    try {
      aptitude = (Storage.getAptitude && Storage.getAptitude()) || null;
    } catch (e) { aptitude = null; }

    return {
      goal,
      papers: Storage.getPapers(),
      lessons,
      quizzes,
      aptitude,
    };
  }

  /** 一行的 HTML */
  function rowHTML(sub, r) {
    const pct = Math.round(r.readiness.progress * 100);
    const ready = r.readiness.ready;
    const conf = r.confidence;

    // 进度条颜色
    const barColor = ready
      ? 'linear-gradient(90deg, #22c55e, #16a34a)'
      : pct >= 70
        ? 'linear-gradient(90deg, #4176e6, #5686fe)'
        : pct >= 35
          ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
          : 'linear-gradient(90deg, #9ca3af, #cbd5e1)';

    // 分数区域
    let scoreHTML;
    if (ready && r.score != null) {
      scoreHTML =
        '<div style="display:flex;align-items:baseline;gap:6px">' +
        '<span style="font-size:22px;font-weight:700;color:var(--label-primary);font-variant-numeric:tabular-nums">' +
        r.score.toFixed(1) + '</span>' +
        '<span style="font-size:12px;color:var(--label-tertiary)">/ ' + r.maxScore + '</span>' +
        '</div>' +
        (r.range ? '<div style="font-size:11.5px;color:var(--label-tertiary);margin-top:2px">' +
          '区间 ' + r.range.low.toFixed(0) + ' ~ ' + r.range.high.toFixed(0) + '</div>' : '');
    } else {
      scoreHTML =
        '<div style="font-size:13px;color:var(--label-tertiary);display:flex;align-items:center;gap:5px">' +
        '<span>数据不足</span></div>' +
        '<div style="font-size:11.5px;color:var(--label-tertiary);margin-top:2px">' +
        '就绪 ' + Math.round(r.readiness.progress * 100) + '%</div>';
    }

    // 依据标签
    const basisChips = (r.basis || [])
      .filter(b => b.weight >= 5)
      .map(b => {
        const names = { prior: '你的目标', exam: '卷子', lesson: '上课', quiz: '练习', aptitude: '能力测验' };
        const nm = names[b.source] || b.source;
        const cls = b.source === 'exam' ? 'accent' : '';
        return '<span class="tag ' + cls + '" style="font-size:10.5px;height:19px">' +
          esc(nm) + ' ' + b.weight + '%</span>';
      }).join(' ');

    // 置信度徽标
    const confColor = { high: '#16a34a', mid: '#4176e6', low: '#d97706', none: '#9ca3af' }[conf.level] || '#9ca3af';
    const confBadge = '<span style="font-size:11px;color:' + confColor + ';font-weight:600">' +
      (ready ? '置信 ' + conf.label : '还需数据') + '</span>';

    // 建议
    const adv = (r.readiness.advice || [])[0] || '';

    return '<div class="ready-row" style="padding:13px 0;border-bottom:1px solid var(--border-l1)">' +
      '<div style="display:grid;grid-template-columns:58px 1fr 92px;gap:12px;align-items:center">' +
      // 科目名
      '<div><span class="tag tag-' + esc(sub) + '" style="font-size:12px">' + esc(sub) + '</span></div>' +
      // 进度条
      '<div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">' +
      '<span style="font-size:12px;color:var(--label-secondary);font-weight:500">' + pct + '%</span>' +
      '<span>' + basisChips + ' ' + confBadge + '</span>' +
      '</div>' +
      '<div style="height:7px;background:rgba(15,23,42,.07);border-radius:99px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:99px;' +
      'transition:width .4s cubic-bezier(.4,0,.2,1)"></div>' +
      '</div>' +
      (adv && !ready ? '<div style="font-size:11.5px;color:var(--label-tertiary);margin-top:5px">还差：' + esc(adv) + '</div>' : '') +
      '</div>' +
      // 分数
      '<div style="text-align:right">' + scoreHTML + '</div>' +
      '</div></div>';
  }

  /** 总体进度条 */
  function overallHTML(result) {
    const pct = Math.round((result.overallProgress || 0) * 100);
    const readyN = result.readyCount || 0;
    const totalN = result.subjectCount || 6;
    const allReady = result.allReady;

    const color = allReady
      ? 'linear-gradient(90deg,#22c55e,#16a34a)'
      : pct >= 60
        ? 'linear-gradient(90deg,#4176e6,#5686fe)'
        : 'linear-gradient(90deg,#f59e0b,#fbbf24)';

    return '<div style="background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);' +
      'border-radius:12px;padding:16px 18px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
      '<div>' +
      '<div style="font-size:13.5px;font-weight:600;color:var(--label-primary)">' +
      (allReady ? '✓ 六科数据都够了，可以看分数' : '数据积累中：' + readyN + ' / ' + totalN + ' 科可估分') +
      '</div>' +
      '<div style="font-size:12px;color:var(--label-tertiary);margin-top:3px">' +
      (allReady
        ? '下面的分数是统计推算的，附区间；置信度越高区间越窄'
        : '凑齐六科才能算总分，否则只有分科参考') +
      '</div></div>' +
      '<div style="font-size:26px;font-weight:700;color:' +
      (allReady ? '#16a34a' : 'var(--label-secondary)') + ';font-variant-numeric:tabular-nums">' +
      pct + '%</div>' +
      '</div>' +
      '<div style="height:11px;background:rgba(15,23,42,.08);border-radius:99px;overflow:hidden">' +
      '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:99px;' +
      'transition:width .5s cubic-bezier(.4,0,.2,1)"></div>' +
      '</div>' +
      '</div>';
  }

  /** 主渲染 */
  function render() {
    const card = $('readiness-card');
    if (!card) return null;

    // 引擎必须已加载
    if (typeof EvidenceEngine === 'undefined') {
      card.innerHTML = '<div class="card-header"><h3>还要多少数据才能估分</h3></div>' +
        '<div class="hint">估分引擎未加载（evidence-v2.js 缺失）</div>';
      return null;
    }

    let result;
    try {
      const ctx = buildContext();
      result = EvidenceEngine.estimateAll(ctx);
    } catch (e) {
      card.innerHTML = '<div class="card-header"><h3>还要多少数据才能估分</h3></div>' +
        '<div class="hint" style="color:var(--red)">计算失败：' + esc(e.message) + '</div>';
      return null;
    }

    // 总体
    const overall = $('readiness-overall');
    if (overall) overall.innerHTML = overallHTML(result);

    // 副标题
    const sub = $('ready-sub');
    if (sub) {
      sub.textContent = result.allReady
        ? '全部就绪 · 置信度已达标'
        : '已就绪 ' + result.readyCount + '/' + result.subjectCount + ' 科';
    }

    // 分科行
    const rows = $('readiness-rows');
    if (rows) {
      rows.innerHTML = result.subjects.map(s => rowHTML(s, result.perSubject[s])).join('');
    }

    // 底部建议
    const adv = $('readiness-advice');
    if (adv) {
      if (result.allReady) {
        adv.innerHTML = '<span style="color:var(--green)">✓ 数据齐了。下面是分科明细和预测区间。</span>';
      } else {
        adv.innerHTML = '下一步：<b>' + esc(result.nextAction || '') + '</b>' +
          '<div style="margin-top:4px;color:var(--label-tertiary);font-size:12px">' +
          '提示：一份 25 题的卷子约能到 70% 就绪；两份不同来源的卷子通常就够。</div>';
      }
    }

    // 把结果暂存，供别处复用
    window.__lastReadiness = result;
    return result;
  }

  return { render, buildContext };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReadinessUI;
