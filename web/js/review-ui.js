/**
 * 复习 UI（2026-10-24 新增）
 *
 * 挂在薄弱点页：
 *   #review-card / #review-due-list / #review-stats
 *   #mistake-list（带筛选）
 */
const ReviewUI = (() => {

  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let curIdx = 0;      // 当前复习到第几题
  let curList = [];    // 今日待复习列表
  let revealed = false; // 是否已显示答案解析

  // ══════════════════════════════════════
  //  今日复习卡
  // ══════════════════════════════════════

  function renderDue() {
    const listEl = $('review-due-list');
    const statsEl = $('review-stats');
    if (!listEl) return;

    if (typeof Review === 'undefined') {
      listEl.innerHTML = '<div class="empty">复习模块未加载</div>';
      return;
    }

    const stats = Review.stats();

    if (statsEl) {
      statsEl.textContent =
        '待复习 ' + stats.due + ' · 复习中 ' + stats.learning +
        ' · 已掌握 ' + stats.mastered +
        (stats.needTutoring ? ' · 需补课 ' + stats.needTutoring : '');
    }

    curList = Review.dueToday({ limit: 20 });
    curIdx = 0;
    revealed = false;

    if (!curList.length) {
      listEl.innerHTML =
        '<div style="padding:20px;text-align:center;color:var(--label-secondary);font-size:13px">' +
        (stats.total === 0
          ? '还没有错题。做几道题，错的会自动进来。'
          : '今天的复习都做完了 ✓' + (stats.mastered ? '<br>已掌握 ' + stats.mastered + ' 道' : '')) +
        '</div>';
      return;
    }

    renderCurQuestion();
  }

  function renderCurQuestion() {
    const listEl = $('review-due-list');
    if (!listEl) return;

    if (curIdx >= curList.length) {
      listEl.innerHTML =
        '<div style="padding:24px;text-align:center">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:8px">今天的 ' + curList.length + ' 道复习完了 ✓</div>' +
        '<div style="font-size:13px;color:var(--label-secondary);margin-bottom:14px">' +
        '做对的题会按间隔安排下次复习（1/3/7/16/35 天），连续做对才判定掌握。</div>' +
        '<button class="btn btn-secondary btn-sm" id="btn-review-restart">再复习一轮</button>' +
        '</div>';
      const rb = $('btn-review-restart');
      if (rb) rb.addEventListener('click', () => { curIdx = 0; revealed = false; renderCurQuestion(); });
      return;
    }

    const m = curList[curIdx];
    const rev = m._review || {};
    const mastery = Review.masteryLabel(rev);
    const nextLbl = Review.nextLabel(rev);

    listEl.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:12.5px;color:var(--label-secondary)">' +
      '<span>第 ' + (curIdx + 1) + ' / ' + curList.length + ' 题</span>' +
      '<span class="tag">' + esc(m.subject || '') + '</span>' +
      '<span style="color:' + mastery.color + '">' + esc(mastery.label) + '</span>' +
      '<span style="margin-left:auto">' + esc(rev.why || '') + '</span>' +
      '</div>' +

      '<div style="padding:16px 18px;background:var(--bg-layer-2);border-radius:10px;margin-bottom:14px">' +
      '<div style="font-size:14px;line-height:1.85;white-space:pre-wrap">' + esc(m.question || m.knowledge || '(无题干)') + '</div>' +
      (m.knowledge ? '<div style="margin-top:8px;font-size:12px;color:var(--label-tertiary)">知识点：' + esc(m.knowledge) + '</div>' : '') +
      (m.count > 1 ? '<div style="margin-top:4px;font-size:12px;color:var(--red)">这道题你已经错过 ' + m.count + ' 次</div>' : '') +
      '</div>' +

      // 答案区（默认隐藏）
      '<div id="review-answer" style="display:' + (revealed ? 'block' : 'none') + ';padding:14px 16px;' +
      'background:rgba(34,197,94,.06);border-radius:10px;margin-bottom:14px;font-size:13px;line-height:1.8">' +
      (m.correctAnswer ? '<div><b>正确答案：</b>' + esc(m.correctAnswer) + '</div>' : '') +
      (m.wrongAnswer ? '<div style="color:var(--red);margin-top:6px"><b>你上次答：</b>' + esc(m.wrongAnswer) + '</div>' : '') +
      (m.explanation ? '<div style="margin-top:8px;color:var(--label-secondary)">' + esc(m.explanation) + '</div>' : '') +
      ((m.lostPoints && m.lostPoints.length) ? '<div style="margin-top:8px;color:var(--amber)">上次漏了：' + esc(m.lostPoints.join('、')) + '</div>' : '') +
      '</div>' +

      // 操作按钮
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
      (revealed
        ? '<button class="btn btn-sm btn-primary" id="btn-rv-correct">我自己做对了</button>' +
          '<button class="btn btn-sm btn-secondary" id="btn-rv-wrong">还是不会</button>' +
          '<button class="btn btn-sm btn-ghost" id="btn-rv-next">跳过</button>'
        : '<button class="btn btn-sm btn-primary" id="btn-rv-reveal">先自己想，看答案解析</button>' +
          '<button class="btn btn-sm btn-secondary" id="btn-rv-correct-direct">我已经会了（做对了）</button>' +
          '<button class="btn btn-sm btn-ghost" id="btn-rv-next">跳过</button>') +
      '</div>';

    bindReviewButtons(m);
  }

  function bindReviewButtons(m) {
    // 看解析
    const reveal = $('btn-rv-reveal');
    if (reveal) {
      reveal.addEventListener('click', () => {
        revealed = true;
        renderCurQuestion();
        // ★ 看解析不计入掌握，只记一笔
        try {
          Review.recordAttempt(m, { type: 'read' });
        } catch (e) {}
      });
    }

    // 做对了
    const doCorrect = () => {
      try {
        Review.recordAttempt(m, { type: 'correct' });
        Shell.toast('做对了，已安排下次复习', 'success');
      } catch (e) {}
      curIdx++;
      revealed = false;
      renderCurQuestion();
      renderMistakes();
      updateReviewStats();
    };

    const c1 = $('btn-rv-correct');
    if (c1) c1.addEventListener('click', doCorrect);

    const cDirect = $('btn-rv-correct-direct');
    if (cDirect) cDirect.addEventListener('click', doCorrect);

    // 做错了
    const wrong = $('btn-rv-wrong');
    if (wrong) {
      wrong.addEventListener('click', () => {
        try {
          Review.recordAttempt(m, { type: 'wrong' });
          Shell.toast('又错了，明天再来一次', 'warning');
        } catch (e) {}
        curIdx++;
        revealed = false;
        renderCurQuestion();
        renderMistakes();
        updateReviewStats();
      });
    }

    // 跳过
    const next = $('btn-rv-next');
    if (next) {
      next.addEventListener('click', () => {
        curIdx++;
        revealed = false;
        renderCurQuestion();
      });
    }
  }

  function updateReviewStats() {
    const el = $('review-stats');
    if (!el || typeof Review === 'undefined') return;
    const s = Review.stats();
    el.textContent = '待复习 ' + s.due + ' · 复习中 ' + s.learning +
      ' · 已掌握 ' + s.mastered + (s.needTutoring ? ' · 需补课 ' + s.needTutoring : '');
  }

  // ══════════════════════════════════════
  //  错题本（带筛选 + 掌握状态）
  // ══════════════════════════════════════

  function renderMistakes() {
    const box = $('mistake-list');
    const countEl = $('mistake-count');
    if (!box) return;

    if (typeof Review === 'undefined') {
      box.innerHTML = '<div class="empty">复习模块未加载</div>';
      return;
    }

    // 填充科目下拉
    const subSel = $('mk-filter-subject');
    if (subSel && subSel.options.length <= 1) {
      Review.subjects().forEach(s => {
        const o = document.createElement('option');
        o.value = s.subject;
        o.textContent = s.subject + ' (' + s.count + ')';
        subSel.appendChild(o);
      });
    }

    const f = {
      subject: subSel ? subSel.value : '',
      status: ($('mk-filter-status') || {}).value || '',
      keyword: ($('mk-filter-keyword') || {}).value || '',
    };

    const list = Review.filter(f);

    if (countEl) {
      const s = Review.stats();
      countEl.textContent = '共 ' + s.total + ' 道 · 待复习 ' + s.due + ' · 已掌握 ' + s.mastered;
    }

    if (!list.length) {
      // ★ 空数据时禁用筛选控件（2026-10-31）
      // 旧版让用户点"全部科目"等下拉，但根本没数据可筛，是摆设。
      const filterBar = document.querySelector('#page-weakness select, #page-weakness input#mk-filter-keyword, #page-weakness button#btn-mk-filter');
      const subSel = $('mk-filter-subject');
      const stSel = $('mk-filter-status');
      const kwInp = $('mk-filter-keyword');
      const fBtn = $('btn-mk-filter');
      [subSel, stSel, kwInp, fBtn].forEach(el => { if (el) el.disabled = true; });

      box.innerHTML = '<div class="empty">' +
        (f.subject || f.status || f.keyword ? '没有符合条件的错题' : '还没有错题。做几道题，错的会自动进来。') + '</div>';
      return;
    }

    const subSel2 = $('mk-filter-subject');
    const stSel2 = $('mk-filter-status');
    const kwInp2 = $('mk-filter-keyword');
    const fBtn2 = $('btn-mk-filter');

    // ★ 有数据时恢复筛选控件
    [subSel2, stSel2, kwInp2, fBtn2].forEach(el => { if (el) el.disabled = false; });

    box.innerHTML = list.slice(0, 50).map(m => {
      const rev = m._review || {};
      const mastery = Review.masteryLabel(rev);
      const nextLbl = Review.nextLabel(rev);

      return '<div class="activity" style="align-items:flex-start;padding:12px 0;border-bottom:1px solid var(--border-l1)">' +
        '<div class="act-icon" style="color:' + mastery.color + ';font-size:13px">' +
        (rev.mastered ? '✓' : (rev.level > 0 ? '◐' : '✕')) + '</div>' +
        '<div class="act-info" style="flex:1">' +
        '<div class="act-title" style="font-size:13.5px;line-height:1.7">' + esc(m.question || m.knowledge || '') + '</div>' +
        '<div class="act-time" style="margin-top:5px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<span class="tag">' + esc(m.subject || '') + '</span>' +
        '<span>' + esc(m.knowledge || '未分类') + '</span>' +
        '<span style="color:' + mastery.color + '">' + esc(mastery.label) + '</span>' +
        (rev.mastered ? '' : '<span style="color:var(--label-tertiary)">下次：' + esc(nextLbl) + '</span>') +
        (m.count > 1 ? '<span style="color:var(--red)">错 ' + m.count + ' 次</span>' : '') +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0">' +
        (rev.mastered
          ? '<button class="btn btn-sm btn-ghost js-reset-mastery" data-key="' + esc(m._key) + '">重新练</button>'
          : '<button class="btn btn-sm btn-ghost js-practice" data-key="' + esc(m._key) + '">现在复习</button>') +
        '</div>' +
        '</div>';
    }).join('');

    // 绑定
    box.querySelectorAll('.js-practice').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const idx = curList.findIndex(x => x._key === key);
        if (idx >= 0) {
          curIdx = idx;
          revealed = false;
          renderCurQuestion();
          $('review-card') && $('review-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          // 不在今日列表里 → 手动加进当前列表
          const m = list.find(x => x._key === key);
          if (m) {
            curList.push(m);
            curIdx = curList.length - 1;
            revealed = false;
            renderCurQuestion();
            $('review-card') && $('review-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });

    box.querySelectorAll('.js-reset-mastery').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-key');
        const states = Review.allState();
        if (states[key]) {
          states[key].mastered = false;
          states[key].level = 0;
          states[key].nextAt = null;
          try { Storage.set('review_state', states); } catch (e) {}
          Shell.toast('已重新加入复习', 'success');
          renderDue();
          renderMistakes();
        }
      });
    });
  }

  // ══════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════

  function init() {
    on('btn-mk-filter', 'click', renderMistakes);

    const kw = $('mk-filter-keyword');
    if (kw) {
      kw.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') renderMistakes();
      });
    }

    on('mk-filter-subject', 'change', renderMistakes);
    on('mk-filter-status', 'change', renderMistakes);

    renderDue();
    renderMistakes();
  }

  function refresh() {
    renderDue();
    renderMistakes();
  }

  return { init, refresh, renderDue, renderMistakes };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReviewUI;
