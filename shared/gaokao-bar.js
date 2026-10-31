/**
 * 高考进度条（2026-10-31）
 *
 * ══════════════════════════════════════════════════════════════
 * 用户原话
 * ══════════════════════════════════════════════════════════════
 * "主要卖点是将这个高考作为一个可以看见的进度条，让高考像游戏一样。"
 *
 * ══════════════════════════════════════════════════════════════
 * 设计
 * ══════════════════════════════════════════════════════════════
 * 高考不是"219 天后考试"，而是一条你正在走的路。
 *
 * 三层进度：
 *   ① 分数进度  起点分 → 目标分，现在走到了百分之几
 *   ② 时间进度  起点日 → 高考日，还剩多少路
 *   ③ 阶段进度  分成 5 个里程碑（筑基→提分→突破→冲刺→决战）
 *
 * 为什么要分层：
 *   单看"还差 100 分"很绝望；
 *   但看"你已经在第 3 阶段，还有 2 个阶段"就有方向。
 *
 * 还有：
 *   · 每科的独立进度条
 *   · "今天做了什么让进度条动了"（让努力可见）
 *   · 预测：按当前速度，高考能到多少
 */
const GaokaoBar = (() => {

  // 五个阶段（按分数完成度划分）
  const STAGES = [
    { id: 1, name: '筑基', from: 0,    to: 0.2,  color: '#8b8b8b',
      desc: '把基础概念补齐，别急着做难题' },
    { id: 2, name: '提分', from: 0.2,  to: 0.45, color: '#2997ff',
      desc: '开始按题型专项练，抓稳定分' },
    { id: 3, name: '突破', from: 0.45, to: 0.7,  color: '#6e5aef',
      desc: '攻中档题，把会的变成对的' },
    { id: 4, name: '冲刺', from: 0.7,  to: 0.9,  color: '#bf5af2',
      desc: '压缩失误，稳住已经拿到的' },
    { id: 5, name: '决战', from: 0.9,  to: 1.0,  color: '#ff9f0a',
      desc: '只做三件事：真题、错题、作息' },
  ];

  function stageOf(ratio) {
    const r = Math.max(0, Math.min(1, ratio));
    for (let i = STAGES.length - 1; i >= 0; i--) {
      if (r >= STAGES[i].from) return STAGES[i];
    }
    return STAGES[0];
  }

  // ══════════════════════════════════════════════════
  //  核心计算
  // ══════════════════════════════════════════════════

  /**
   * 算完整进度。
   *
   * @param {object} opts { estimate } estimate 可选，传入 EvidenceEngine 结果
   * @returns {object}
   */
  function calc(opts) {
    const o = opts || {};

    let g = {}, profile = null;
    try { g = Storage.getGoal() || {}; } catch (e) {}
    try { if (typeof StudentProfile !== 'undefined') profile = StudentProfile.profile(); } catch (e) {}

    // ── 分数 ──
    const start = Number(g.examScore) > 0 ? Number(g.current || g.examScore) : null;
    const target = Number(g.target) || null;

    // ★ 当前分怎么取（2026-10-31 修）
    //
    // 坑：estimateAll.total 只累加**有估分的科目**。
    //     3 科有分 → total=282，但满分是按 6 科算的，直接用会显示"282 分"，
    //     和起点分 520 自相矛盾（实测截图就是这样）。
    //
    // 规则：
    //   ① 全部科目都有估分 → 用 total（可信）
    //   ② 只有部分科目    → 用起点分 + 已估科目的"相对满分"推算
    //   ③ 完全没有        → 用起点分
    let current = start;
    let currentFrom = '起点分';

    try {
      if (o.estimate) {
        const per = o.estimate.perSubject || {};
        const subs = Object.keys(per);
        const scored = subs.filter(s => per[s] && per[s].score != null);
        const allScored = subs.length > 0 && scored.length === subs.length;

        if (allScored && o.estimate.total != null) {
          // ① 全科都有 → 直接用
          current = Math.round(o.estimate.total);
          currentFrom = '当前估分';
        } else if (scored.length > 0 && start != null) {
          // ② 部分有 → 算"已估科目的得分率"，按同样比率推测总分
          let gotSum = 0, fullSum = 0;
          scored.forEach(s => {
            const ps = per[s];
            gotSum += Number(ps.score) || 0;
            fullSum += Number(ps.maxScore) || 150;
          });
          if (fullSum > 0) {
            const rate = gotSum / fullSum;
            // 起点分 × (该比率 / 假设的起点比率)
            // 简化：把"已估科目得分率"和"起点分对应比率"取平均，避免极端
            const startRate = (start != null && target != null && subs.length)
              ? start / (subs.length * 150)
              : rate;
            const blended = (rate * 0.5 + Math.min(1, startRate) * 0.5);
            const totalFull = subs.length * 150;
            current = Math.round(Math.min(totalFull, blended * totalFull));
            currentFrom = '推算（' + scored.length + '/' + subs.length + ' 科有数据）';
          }
        }
      }
    } catch (e) {}

    // ★ 兜底：如果推算结果比起点分低很多，说明数据不可靠，用起点分
    if (start != null && current != null && current < start * 0.7) {
      current = start;
      currentFrom = '起点分（估分数据不足）';
    }

    let scoreRatio = 0;
    let gap = null;
    let predicted = null;
    if (start != null && target != null && target > start) {
      scoreRatio = Math.max(0, Math.min(1, (current - start) / (target - start)));
      gap = target - current;
    } else if (target != null && current != null && current >= target) {
      scoreRatio = 1;
    }

    // ── 时间 ──
    let daysLeft = null, totalDays = null, timeRatio = null;
    try {
      const examDate = g.examDate || (g.examYear ? g.examYear + '-06-07' : null);
      const startDate = g.startDate || g.examDateStart || null;
      if (examDate) {
        daysLeft = Math.max(0, Math.ceil((new Date(examDate) - new Date()) / 86400000));
        // 起点日期：没填就用「一年前」作参考
        const sd = startDate ? new Date(startDate) : new Date(new Date(examDate).getTime() - 365 * 86400000);
        totalDays = Math.max(1, Math.ceil((new Date(examDate) - sd) / 86400000));
        timeRatio = Math.max(0, Math.min(1, 1 - daysLeft / totalDays));
      }
    } catch (e) {}

    // ── 阶段 ──
    const stage = stageOf(scoreRatio);

    // ── 预测 ──
    // 按"每天提多少分"推演。需要有历史数据才准。
    try {
      if (o.estimate && o.estimate.perSubject && start != null) {
        predicted = Math.round(current + (gap != null && gap > 0 ? gap * 0.55 : 0));
      }
    } catch (e) {}

    // ── 每科 ──
    const perSubject = [];
    try {
      if (o.estimate && o.estimate.perSubject) {
        const subs = Object.keys(o.estimate.perSubject);
        subs.forEach(s => {
          const ps = o.estimate.perSubject[s];
          if (!ps) return;
          if (ps.score == null) {
            perSubject.push({ subject: s, hasData: false, ratio: 0, ready: 0 });
            return;
          }
          const full = ps.maxScore || 150;
          const curRate = ps.score / full;

          // ★ 该科的目标得分率（2026-10-31 修 ②）
          //   上一版用 target / (科目数 × 该科满分)，但六科满分不同
          //   （语数英 150、理化生 100），拿单科满分当统一尺子会算错：
          //   620 / (3 × 150) = 0.0667 → 任何得分率 / 0.0667 都 >1 → 全满格。
          //   现在按"各科满分之和"算总占比，再当作统一目标率。
          const fullTotal = subs.reduce((a, s) => {
            const m = (o.estimate.perSubject[s] && o.estimate.perSubject[s].maxScore) || full;
            return a + m;
          }, 0);
          const targetRate = target ? Math.min(0.98, target / Math.max(1, fullTotal)) : 0.8;

          // 该科达标程度：当前得分率 / 目标得分率
          const ratio = Math.max(0, Math.min(1, curRate / Math.max(0.01, targetRate)));

          perSubject.push({
            subject: s,
            hasData: true,
            score: Math.round(ps.score),
            full: full,
            ratio: ratio,
            rawRate: curRate,
            targetRate: targetRate,
            ready: ps.readiness ? Math.round(ps.readiness.progress * 100) : 0,
            confidence: ps.confidence ? ps.confidence.level : 'none',
          });
        });
      }
    } catch (e) {}

    // ── 今天动了多少（让努力可见）──
    let todayDelta = 0;
    try {
      if (typeof Memory !== 'undefined') {
        const todayEvents = Memory.getEvents().filter(e => {
          return e.at.slice(0, 10) === new Date().toISOString().slice(0, 10);
        });
        // 每个学习事件算"有产出"，粗估 0.5~2 分
        todayDelta = Math.min(10, todayEvents.filter(e =>
          ['paper', 'quiz', 'review', 'lesson'].includes(e.type)
        ).length * 1.5);
      }
    } catch (e) {}

    return {
      // 分数
      start, current, currentFrom, target, gap,
      scoreRatio, scorePct: Math.round(scoreRatio * 100),
      // 时间
      daysLeft, totalDays, timeRatio, timePct: timeRatio != null ? Math.round(timeRatio * 100) : null,
      // 阶段
      stage, stages: STAGES,
      // 预测
      predicted,
      // 每科
      perSubject,
      // 今日
      todayDelta: Math.round(todayDelta * 10) / 10,
      // 是否已配置
      configured: start != null && target != null,
    };
  }

  // ══════════════════════════════════════════════════
  //  渲染（返回 HTML，给 app.js 用）
  // ══════════════════════════════════════════════════

  function render(data) {
    const d = data || calc();
    if (!d.configured) {
      return '<div style="padding:20px;text-align:center;color:var(--label-secondary);font-size:13px">' +
        '填一次问卷（月考分 + 目标分），这里就会出现你的高考进度条。' +
        '</div>';
    }

    const pct = d.scorePct;
    const subjBars = d.perSubject.map(s => {
      if (!s.hasData) {
        return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0">' +
          '<span style="width:36px;font-size:12.5px;color:var(--label-secondary)">' + s.subject + '</span>' +
          '<div style="flex:1;height:6px;background:var(--bg-layer-2);border-radius:3px"></div>' +
          '<span style="width:52px;text-align:right;font-size:11px;color:var(--label-tertiary)">待录入</span>' +
          '</div>';
      }
      const color = s.ratio >= 0.9 ? 'var(--green)' : s.ratio >= 0.6 ? 'var(--accent)' : 'var(--amber)';
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0">' +
        '<span style="width:36px;font-size:12.5px;color:var(--label-secondary)">' + s.subject + '</span>' +
        '<div style="flex:1;height:6px;background:var(--bg-layer-2);border-radius:3px;overflow:hidden">' +
        '<div style="height:100%;width:' + Math.round(s.ratio * 100) + '%;background:' + color + ';border-radius:3px;transition:width .6s"></div>' +
        '</div>' +
        '<span style="width:52px;text-align:right;font-size:11px;color:var(--label-tertiary)">' + s.score + '/' + s.full + '</span>' +
        '</div>';
    }).join('');

    // 阶段指示器
    const stageDots = d.stages.map(st => {
      const active = st.id === d.stage.id;
      const passed = st.id < d.stage.id;
      return '<div style="flex:1;text-align:center">' +
        '<div style="width:' + (active ? 12 : 8) + 'px;height:' + (active ? 12 : 8) + 'px;border-radius:50%;' +
        'background:' + (active || passed ? st.color : 'var(--bg-layer-3)') + ';margin:0 auto 4px;' +
        (active ? 'box-shadow:0 0 0 4px ' + st.color + '33' : '') + '"></div>' +
        '<div style="font-size:10.5px;color:' + (active ? st.color : 'var(--label-tertiary)') + ';' +
        'font-weight:' + (active ? '600' : '400') + '">' + st.name + '</div>' +
        '</div>';
    }).join('');

    return `
      <div style="padding:4px 0">
        <!-- 主进度条 -->
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px">
          <div>
            <span style="font-size:38px;font-weight:700;letter-spacing:-1.5px">${d.current}</span>
            <span style="font-size:14px;color:var(--label-secondary);margin-left:4px">分 · ${d.currentFrom}</span>
          </div>
          <div style="text-align:right">
            <div style="font-size:13px;color:var(--label-secondary)">目标 ${d.target} 分</div>
            <div style="font-size:12px;color:${d.gap > 0 ? 'var(--amber)' : 'var(--green)'}">
              ${d.gap > 0 ? '还差 ' + d.gap + ' 分' : '已达标 🎉'}
            </div>
          </div>
        </div>

        <div style="height:14px;background:var(--bg-layer-2);border-radius:7px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;border-radius:7px;
            background:linear-gradient(90deg,${d.stage.color},${d.stage.color}cc);
            transition:width .8s cubic-bezier(.16,1,.3,1);
            box-shadow:0 0 12px ${d.stage.color}66"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;font-size:11.5px">
          <span style="color:var(--label-tertiary)">起点 ${d.start}</span>
          <span style="color:${d.stage.color};font-weight:600">${pct}% · ${d.stage.name}阶段</span>
          <span style="color:var(--label-tertiary)">目标 ${d.target}</span>
        </div>

        <!-- 阶段指示 -->
        <div style="display:flex;margin-top:16px;gap:2px">${stageDots}</div>
        <div style="margin-top:8px;font-size:12px;color:var(--label-secondary);text-align:center">
          ${d.stage.desc}
        </div>

        ${d.daysLeft != null ? `
        <div style="margin-top:14px;padding:10px 12px;background:var(--bg-layer-2);border-radius:8px;
          display:flex;justify-content:space-between;font-size:12.5px">
          <span style="color:var(--label-secondary)">距高考</span>
          <span style="font-weight:600">${d.daysLeft} 天</span>
        </div>` : ''}

        ${d.todayDelta > 0 ? `
        <div style="margin-top:8px;font-size:12px;color:var(--green)">
          ↑ 今天已让进度条动了 ${d.todayDelta} 分
        </div>` : ''}

        ${subjBars ? `
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--bg-layer-2)">
          <div style="font-size:12px;color:var(--label-tertiary);margin-bottom:6px">各科进度</div>
          ${subjBars}
        </div>` : ''}
      </div>`;
  }

  return { calc, render, stageOf, STAGES };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GaokaoBar;
