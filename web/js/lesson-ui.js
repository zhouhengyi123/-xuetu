/**
 * 一节课 UI（LessonUI）2026-11-07
 *
 * 对齐 docs/真人家教方法论调研.md 的 P0 三项：
 *   ① 分步作答 + 逐步即时反馈（VanLehn 2011 step-based d=0.76）
 *   ② 5~6 级递进提示链，答对即 faded（Belland 2016 g=0.46 / INSPIRE）
 *   ③ 课前诊断 → 出门测（90% 掌握线）→ 一句话复盘（Chi 2001 reflection）
 *
 * 不做：摄像头、专注度打分、「听懂了吗」按钮、表扬文案、排名。
 * 反馈一律「事实 + 定位 + 下一步」，见 shared/tutor-session.js 的文案规范。
 */
const LessonUI = (() => {

  let mounted = false;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** 内置诊断/出门测/分步题的起点（可编辑，不是「官方题库」） */
  const BANK = {
    '数学': {
      diagnose: [
        { q: 'f(x)=x³-3x 的极大值是多少？', answer: '2', knowledge: '导数极值' },
        { q: 'f\'(x)>0 说明函数在区间上是增还是减？', answer: '增', knowledge: '导数符号' },
      ],
      guided: {
        steps: [
          { prompt: '第 1 步：对 f(x)=x³-3ax 求导，写出 f\'(x)', expected: '3x²-3a',
            hints: ['用幂函数求导法则', '常数项 -3ax 的导数是什么？', 'f\'(x)=3x²-3a，再算下一步'] },
          { prompt: '第 2 步：令 f\'(x)≤0 在 (0,1) 恒成立，写出 a 满足的条件', expected: 'a≥1',
            hints: ['3x²-3a≤0 → a≥x²', 'x² 在 (0,1) 上最大趋近多少？', 'a 要不小于 x² 的上确界，即 a≥1'] },
        ],
        knowledge: '导数含参讨论',
      },
      exit: [
        { q: '变式：f(x)=x³-12x 在 x=2 处是极大还是极小？', answer: '极小', knowledge: '导数极值' },
        { q: '变式：若 f(x)=x³-3x 在 (0,1) 递减，a 至少是多少？', answer: '1', knowledge: '导数含参讨论' },
      ],
    },
  };

  function bankFor(subject) {
    return BANK[subject] || {
      diagnose: [
        { q: '用自己的话写出本节最重要的一个概念', answer: '会', knowledge: '概念' },
      ],
      guided: {
        steps: [{ prompt: '写出这个知识点的关键一步', expected: '会', hints: ['先回忆定义', '举一个例子', '把关键词写下来'] }],
        knowledge: '概念',
      },
      exit: [{ q: '换一种说法再写一遍', answer: '会', knowledge: '概念' }],
    };
  }

  function mount() {
    if (mounted) return;
    mounted = true;
    const sel = $('ls-subject');
    if (sel && sel.options.length === 0) {
      // 用当前考试制度的科目（日韩用本地科目名）；中国沿用 data.js
      let subs = ['语文', '数学', '英语', '物理', '化学', '生物'];
      try {
        if (typeof Region !== 'undefined' && Region.current() !== 'cn-gaokao') {
          subs = Region.profile().subjects.slice();
        }
      } catch (e) {}
      subs.forEach(s => {
        const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o);
      });
      const mathIdx = subs.indexOf('数学');
      if (mathIdx >= 0) sel.selectedIndex = mathIdx;
    }
    bind();
    render();
  }

  function bind() {
    const start = $('btn-lesson-start');
    const clear = $('btn-lesson-clear');
    if (start) start.addEventListener('click', onStart);
    if (clear) clear.addEventListener('click', () => {
      if (typeof TutorSession !== 'undefined') TutorSession.clear();
      render();
      if (typeof toast === 'function') toast('已清空，可以重新开始', 'success');
    });
  }

  function onStart() {
    if (typeof TutorSession === 'undefined') return;
    const subject = $('ls-subject').value || '数学';
    const topic = ($('ls-topic').value || '').trim() || '本节内容';
    const bank = bankFor(subject);
    TutorSession.start(subject, topic, bank.diagnose);
    TutorSession.addGuided(bank.guided.steps, bank.guided.knowledge);
    render();
    if (typeof toast === 'function') toast('先从 2 道诊断题开始，定位起点', 'success');
  }

  function render() {
    if (typeof TutorSession === 'undefined') return;
    const s = TutorSession.get();
    const st = TutorSession.status();
    const stageEl = $('lesson-stage');
    const progEl = $('lesson-progress');
    const body = $('lesson-body');
    if (!body) return;

    const stageNames = { diagnose: '课前诊断', guided: '分步例题', exit: '出门测', recap: '一句话复盘', done: '已完成' };
    if (stageEl) stageEl.textContent = s.id ? stageNames[s.stage] || s.stage : '未开始';
    if (progEl) progEl.textContent = s.id
      ? ('诊断 ' + (st.diagnoseRate == null ? '—' : st.diagnoseRate + '%') +
         ' · 例题 ' + st.guidedDone + '/' + st.guidedTotal +
         ' · 出门测 ' + (st.exitRate == null ? '—' : st.exitRate + '%'))
      : '—';

    if (!s.id) {
      body.innerHTML = '<div class="empty" style="padding:20px">点上方「开始一节课」，先把诊断题做出来</div>';
      renderSide(); return;
    }

    let html = '';
    if (s.stage === 'diagnose') html = renderDiagnose(s);
    else if (s.stage === 'guided') html = renderGuided(s);
    else if (s.stage === 'exit') html = renderExit(s);
    else if (s.stage === 'recap') html = renderRecap(s);
    else html = renderDone(s);
    body.innerHTML = html;
    wireInputs(s);
    renderSide();
  }

  function renderDiagnose(s) {
    const pending = s.diagnose.findIndex(q => q.correct == null);
    if (pending < 0) return '<div class="hint">诊断完成，正在进入例题…</div>';
    const q = s.diagnose[pending];
    return '<div class="card" style="margin:0;border-color:var(--ds-500)">' +
      '<div class="card-header"><h3>课前诊断 ' + (pending + 1) + '/' + s.diagnose.length + '</h3>' +
      '<span class="card-sub">定位起点，不是评分</span></div>' +
      '<p style="line-height:1.7">' + esc(q.q) + '</p>' +
      '<div class="form-row"><div class="form-group">' +
      '<label>你的答案</label><input id="ls-ans" placeholder="写出答案" /></div></div>' +
      '<button class="btn btn-primary" id="ls-submit">提交这一步</button>' +
      '<div class="hint" style="margin-top:8px">写错了没关系 —— 这一步只是看从哪里讲起。</div>' +
      '</div>';
  }

  function renderGuided(s) {
    // 找第一道没做完的例题
    const gi = s.guided.findIndex(g => !g.done);
    if (gi < 0) {
      return '<div class="hint">例题都做完了，点下面进入出门测。</div>' +
        '<button class="btn btn-primary" id="ls-to-exit" style="margin-top:10px">进入出门测</button>';
    }
    const g = s.guided[gi];
    const step = g.steps[g.curStep];
    if (!step) return '<div class="hint">例题状态异常，请清空重来。</div>';

    let hintHtml = '';
    if (g.hintLevel > 0) {
      const hs = TutorSession.HINT_STAGES[g.hintLevel - 1];
      const custom = step.hints[g.hintLevel - 1] || '';
      hintHtml = '<div class="ai-box" style="margin-top:10px">' +
        '<b>提示 ' + g.hintLevel + '/' + TutorSession.HINT_STAGES.length + '（' + esc(hs.label) + '）</b><br>' +
        esc(custom || hs.label) +
        (hs.kind === 'bottomOut' ? '<br><span class="hint">看完请自己重做一遍，不要抄。</span>' : '') +
        '</div>';
    }

    return '<div class="card" style="margin:0">' +
      '<div class="card-header"><h3>分步例题 ' + (gi + 1) + '/' + s.guided.length +
      ' · 第 ' + (g.curStep + 1) + '/' + g.steps.length + ' 步</h3>' +
      '<span class="card-sub">每步即时反馈，卡住才给提示</span></div>' +
      '<p style="line-height:1.7">' + esc(step.prompt) + '</p>' +
      '<div class="form-row"><div class="form-group">' +
      '<label>这一步的结果</label><input id="ls-ans" placeholder="写出这一步" /></div></div>' +
      '<button class="btn btn-primary" id="ls-submit">提交这一步</button>' +
      '<button class="btn btn-ghost" id="ls-hint" style="margin-left:8px">要一层提示</button>' +
      hintHtml +
      '<div id="ls-feedback" class="hint" style="margin-top:10px"></div>' +
      '</div>';
  }

  function renderExit(s) {
    // 出门测没题目时，从 bank 取
    if (!s.exit.length) {
      const bank = bankFor(s.subject);
      TutorSession.setExit(bank.exit);
      return '<div class="hint">正在准备出门测…</div>';
    }
    const pending = s.exit.findIndex(q => q.correct == null);
    if (pending < 0) return '<div class="hint">判分中…</div>';
    const q = s.exit[pending];
    return '<div class="card" style="margin:0;border-color:var(--amber)">' +
      '<div class="card-header"><h3>出门测 ' + (pending + 1) + '/' + s.exit.length + '</h3>' +
      '<span class="card-sub">不达标不结课（掌握线 90%）</span></div>' +
      '<p style="line-height:1.7">' + esc(q.q) + '</p>' +
      '<div class="form-row"><div class="form-group">' +
      '<label>独立作答（不看答案）</label><input id="ls-ans" placeholder="写出答案" /></div></div>' +
      '<button class="btn btn-primary" id="ls-submit">提交</button>' +
      '<div id="ls-feedback" class="hint" style="margin-top:10px"></div>' +
      '</div>';
  }

  function renderRecap(s) {
    return '<div class="card" style="margin:0">' +
      '<div class="card-header"><h3>一句话复盘</h3><span class="card-sub">替代「已完成」打勾</span></div>' +
      '<p class="hint">用自己的话写：这节课卡在哪一步、那一步为什么。<br>' +
      '不问「听懂了吗」—— 学得吃力的人最容易说懂了，写出来才算数。</p>' +
      '<div class="form-row"><div class="form-group">' +
      '<label>你的一句话</label><input id="ls-ans" placeholder="例如：含参讨论要先判断根在不在定义域内" /></div></div>' +
      '<button class="btn btn-primary" id="ls-submit">完成这节课</button>' +
      '</div>';
  }

  function renderDone(s) {
    return '<div class="card" style="margin:0">' +
      '<div class="card-header"><h3>本节课完成</h3></div>' +
      '<p>你的复盘：<b>' + esc(s.recap || '（未填写）') + '</b></p>' +
      '<div class="hint">诊断 ' + (TutorSession.status().diagnoseRate ?? '—') + '% · 出门测 ' +
      (TutorSession.status().exitRate ?? '—') + '%。' +
      '没掌握的已进入 overlay，下次复习会优先出现。</div>' +
      '<button class="btn btn-primary" id="btn-lesson-clear" style="margin-top:12px">开始下一节</button>' +
      '</div>';
  }

  function renderSide() {
    const ovEl = $('lesson-overlay');
    const missEl = $('lesson-misses');
    if (typeof TutorSession === 'undefined') return;
    const ov = TutorSession.overlayAll();
    const keys = Object.keys(ov);
    if (ovEl) {
      ovEl.innerHTML = keys.length
        ? keys.map(k => '<div style="padding:4px 0">' +
            (ov[k] === 'ok' ? '✓ ' : '○ ') + esc(k) +
            '<span class="hint" style="float:right">' + (ov[k] === 'ok' ? '已掌握' : '还没稳') + '</span></div>').join('')
        : '<div class="empty" style="padding:12px">还没有记录。做完一节课后这里会显示。</div>';
    }
    const miss = TutorSession.frequentMisses(5);
    if (missEl) {
      missEl.innerHTML = miss.length
        ? miss.map(m => '<div style="padding:4px 0">' + esc(m.knowledge) +
            '<span class="hint" style="float:right">错 ' + m.misses + ' 次</span></div>').join('')
        : '<div class="empty" style="padding:12px">暂无。反复错 2 次以上的知识点会出现在这里。</div>';
    }
  }

  function wireInputs(s) {
    const submit = $('ls-submit');
    const hintBtn = $('ls-hint');
    const toExit = $('ls-to-exit');
    const ans = $('ls-ans');
    const fb = $('ls-feedback');

    if (toExit) toExit.addEventListener('click', () => {
      const bank = bankFor(s.subject);
      TutorSession.setExit(bank.exit);
      render();
    });

    if (hintBtn) hintBtn.addEventListener('click', () => {
      const gi = s.guided.findIndex(g => !g.done);
      if (gi < 0) return;
      const h = TutorSession.requestHint(gi);
      if (h && fb) {
        fb.innerHTML = '<div class="ai-box">提示 ' + h.hintLevel + '：' + esc(h.text) +
          (h.isBottomOut ? '<br>看完自己重做一遍。' : '') + '</div>';
      }
      render();
    });

    if (submit) submit.addEventListener('click', () => {
      const val = ans ? ans.value.trim() : '';
      if (!val) { if (typeof toast === 'function') toast('先写点什么再提交', 'warn'); return; }

      if (s.stage === 'diagnose') {
        const i = s.diagnose.findIndex(q => q.correct == null);
        TutorSession.answerDiagnose(i, val);
        render();
      } else if (s.stage === 'guided') {
        const gi = s.guided.findIndex(g => !g.done);
        const r = TutorSession.answerStep(gi, val);
        if (fb) fb.innerHTML = '<div class="ai-box">' + esc(r.feedback || '') + '</div>';
        if (ans) ans.value = '';
        // 延迟刷新，让学生先看到反馈
        setTimeout(render, r.correct ? 900 : 1200);
      } else if (s.stage === 'exit') {
        const i = s.exit.findIndex(q => q.correct == null);
        const r = TutorSession.answerExit(i, val);
        if (r && !r.passed && r.feedback && fb) {
          fb.innerHTML = '<div class="ai-box">' + esc(r.feedback) + '</div>';
        }
        if (ans) ans.value = '';
        setTimeout(render, (r && !r.passed) ? 1600 : 900);
      } else if (s.stage === 'recap') {
        TutorSession.setRecap(val);
        render();
        if (typeof toast === 'function') toast('这节课记下了，没掌握的会进复习队列', 'success');
      }
    });

    // 回车提交
    if (ans) ans.addEventListener('keydown', e => {
      if (e.key === 'Enter' && submit) { e.preventDefault(); submit.click(); }
    });
  }

  return { mount, render };
})();

if (typeof window !== 'undefined') window.LessonUI = LessonUI;
