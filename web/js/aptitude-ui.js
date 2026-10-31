/**
 * 能力测验界面（2026-10-18）
 *
 * 12 道图形推理，5 分钟。做完后：
 *   · 存进 Storage.setAptitude()
 *   · 估分引擎会自动用它当各科先验
 *
 * 设计上的克制（重要）：
 *   · 结果说"百分位估计"，不说"IQ 130"
 *   · 给区间，不给精确值（12 题的测量误差有 ±12 个百分点）
 *   · 明确告诉用户"这是能力倾向参考，不是判决"
 *     —— 智力测验被误用会伤害学生，这一点必须守住
 */
const AptitudeUI = (() => {

  const $ = (id) => document.getElementById(id);
  /**
   * ★ 自带 on()（2026-10-31 修）
   *
   * 之前的 bug：mount() 里直接调 on('btn-apt-start', ...)，
   * 但 on 只在 app.js 的闭包里定义（const 不挂 window），
   * 且脚本加载顺序上本文件先执行 —— 于是 ReferenceError: on is not defined，
   * 按钮渲染中断，用户"点击开始没反应"（实测控制台报错）。
   */
  const on = (id, ev, fn) => {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
  };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let paper = null;        // 当前试卷
  let answers = {};        // { qid: choiceIndex }
  let startedAt = 0;
  let timerId = null;

  // ── 开始 ──
  function start() {
    /**
     * ★ 修复：推理能力测试点击没反应（2026-10-25）
     *
     * 原因：AptitudeTest 可能未加载（脚本顺序问题），
     * 但只 toast 了错误，用户看不到。
     *
     * 现在：加载失败时给明确提示，并尝试重新加载。
     */
    if (typeof AptitudeTest === 'undefined') {
      console.error('[aptitude] AptitudeTest 未加载');
      toast('测验模块加载失败，请刷新页面重试', 'error');
      // 尝试重新加载
      const script = document.createElement('script');
      script.src = '../shared/aptitude.js?v=' + Date.now();
      script.onload = () => {
        console.log('[aptitude] 重新加载成功');
        toast('测验模块已加载，请再点一次「开始测验」', 'success');
      };
      script.onerror = () => {
        toast('测验模块加载失败，请检查网络或重启应用', 'error');
      };
      document.head.appendChild(script);
      return;
    }
    paper = AptitudeTest.build();
    answers = {};
    startedAt = Date.now();

    renderShell();
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tickTimer, 1000);
  }

  function tickTimer() {
    const el = $('apt-timer');
    if (!el) return;
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    el.textContent = mm + ':' + ss;
  }

  // ── 渲染试卷 ──
  function renderShell() {
    const box = $('aptitude-body');
    if (!box) return;

    const html =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
      '<div>' +
      '<div style="font-size:14px;font-weight:600">图形推理测验</div>' +
      '<div style="font-size:12px;color:var(--label-tertiary);margin-top:2px">' +
      '共 ' + paper.length + ' 题 · 难度递增 · 不限时（建议 5 分钟内）</div>' +
      '</div>' +
      '<div style="text-align:right">' +
      '<div style="font-size:20px;font-weight:700;font-variant-numeric:tabular-nums" id="apt-timer">00:00</div>' +
      '<div style="font-size:11px;color:var(--label-tertiary)">用时</div>' +
      '</div>' +
      '</div>' +

      '<div class="note" style="margin-bottom:16px;font-size:12px">' +
      '这不是考试，也不影响任何记录。它只是帮系统判断你的<b>推理特点</b>，' +
      '从而让估分更贴近你 —— 比如图形推理强的人，数学通常比语文更容易拿高分。' +
      '看不清或不确定可以凭直觉选，选错也不会怎样。' +
      '</div>' +

      '<div id="apt-questions">' +
      paper.map(q => questionHTML(q)).join('') +
      '</div>' +

      '<div style="margin-top:20px;display:flex;gap:10px;align-items:center">' +
      '<button class="btn btn-primary" id="btn-apt-submit">提交并查看结果</button>' +
      '<button class="btn btn-secondary" id="btn-apt-cancel">取消</button>' +
      '<span class="hint" id="apt-progress" style="margin-left:auto"></span>' +
      '</div>';

    box.innerHTML = html;

    // 绑定选择
    box.querySelectorAll('[data-apt-opt]').forEach(el => {
      el.addEventListener('click', () => {
        const qid = Number(el.getAttribute('data-apt-q'));
        const choice = Number(el.getAttribute('data-apt-opt'));
        answers[qid] = choice;

        // 同题的选项去掉选中样式
        box.querySelectorAll('[data-apt-q="' + qid + '"]').forEach(x => {
          x.style.borderColor = 'var(--border-l2)';
          x.style.background = 'rgba(255,255,255,.7)';
        });
        el.style.borderColor = 'var(--accent)';
        el.style.background = 'var(--accent-bg)';

        updateProgress();
      });
    });

    on('btn-apt-submit', 'click', submit);
    on('btn-apt-cancel', 'click', cancel);
    updateProgress();
    tickTimer();
  }

  function questionHTML(q) {
    // 题干图形：横排 / 2×2 / 3×3
    let matrixHTML = '';
    const cellSize = q.layout === 'grid3' ? 68 : q.layout === 'grid2' ? 84 : 76;

    if (q.layout === 'row') {
      matrixHTML = '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
        q.matrix.map(m => '<div style="width:' + cellSize + 'px;height:' + cellSize + 'px;' +
          'border:1px solid var(--border-l1);border-radius:8px;background:#fff;padding:4px">' +
          (m || '') + '</div>').join('') +
        '<div style="font-size:20px;color:var(--label-tertiary);margin:0 4px">→</div>' +
        '<div style="width:' + cellSize + 'px;height:' + cellSize + 'px;border:2px dashed var(--accent);' +
        'border-radius:8px;display:flex;align-items:center;justify-content:center;' +
        'color:var(--accent);font-size:20px;font-weight:600">?</div>' +
        '</div>';
    } else {
      const cols = q.layout === 'grid3' ? 3 : 2;
      matrixHTML = '<div style="display:inline-grid;grid-template-columns:repeat(' + cols + ',' + cellSize + 'px);' +
        'gap:6px">' +
        q.matrix.map(m => {
          if (m === null) {
            return '<div style="width:' + cellSize + 'px;height:' + cellSize + 'px;border:2px dashed var(--accent);' +
              'border-radius:8px;display:flex;align-items:center;justify-content:center;' +
              'color:var(--accent);font-size:20px;font-weight:600">?</div>';
          }
          return '<div style="width:' + cellSize + 'px;height:' + cellSize + 'px;' +
            'border:1px solid var(--border-l1);border-radius:8px;background:#fff;padding:3px">' + m + '</div>';
        }).join('') +
        '</div>';
    }

    const optionsHTML =
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px;max-width:420px">' +
      q.options.map((o, i) =>
        '<div data-apt-q="' + q.id + '" data-apt-opt="' + i + '" ' +
        'style="cursor:pointer;border:2px solid var(--border-l2);border-radius:9px;' +
        'background:rgba(255,255,255,.7);padding:5px;transition:all .15s;position:relative">' +
        o +
        '<span style="position:absolute;top:3px;left:5px;font-size:10.5px;color:var(--label-tertiary);' +
        'font-weight:600">' + 'ABCD'[i] + '</span>' +
        '</div>').join('') +
      '</div>';

    return '<div style="padding:18px 0;border-bottom:1px solid var(--border-l1)" data-apt-qwrap="' + q.id + '">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<span class="tag" style="font-size:11px">第 ' + q.id + ' 题</span>' +
      '<span class="tag" style="font-size:11px;' +
      (q.difficulty >= 4 ? 'background:var(--red-bg);color:var(--red)' :
        q.difficulty >= 3 ? 'background:var(--amber-bg);color:#b45309' : '') + '">' +
      ['', '入门', '简单', '中等', '较难', '困难'][q.difficulty] + '</span>' +
      '<span style="font-size:13px;color:var(--label-secondary)">' + esc(q.prompt) + '</span>' +
      '</div>' +
      matrixHTML +
      optionsHTML +
      '</div>';
  }

  function updateProgress() {
    const el = $('apt-progress');
    if (!el) return;
    const n = Object.keys(answers).length;
    el.textContent = '已答 ' + n + ' / ' + paper.length;
    el.style.color = n === paper.length ? 'var(--green)' : 'var(--label-tertiary)';
  }

  // ── 提交 ──
  function submit() {
    const answered = Object.keys(answers).length;
    if (answered === 0) {
      toast('一道都没答，先选几个吧', 'warning');
      return;
    }
    if (answered < paper.length) {
      const ok = confirm('还有 ' + (paper.length - answered) + ' 题没答，未答的算错。确定提交？');
      if (!ok) return;
    }

    const list = paper.map(q => ({ id: q.id, choice: answers[q.id] != null ? answers[q.id] : -1 }));
    const r = AptitudeTest.check(list);
    const usedSec = Math.floor((Date.now() - startedAt) / 1000);

    renderResult(r, usedSec);
  }

  function renderResult(r, usedSec) {
    const box = $('aptitude-body');
    if (!box) return;
    if (timerId) { clearInterval(timerId); timerId = null; }

    const pct = Math.round(r.score.percentile * 100);
    const lo = Math.round(r.score.range.low * 100);
    const hi = Math.round(r.score.range.high * 100);

    /**
     * ★ 结果怎么解读（措辞很重要）
     *
     * 不说"IQ 是多少"、"你聪明不聪明"。
     * 只说"百分位"、"推理特点"、"对估分的意义"。
     * 因为：12 题测验的误差 ±12 个百分点，把它当判决是害人。
     */
    let band, bandDesc;
    if (pct >= 80) { band = '明显偏强'; bandDesc = '复杂规律抓得快，数理类科目可能更容易上手'; }
    else if (pct >= 60) { band = '中上'; bandDesc = '规律识别稳定，大多数题型都能应付'; }
    else if (pct >= 40) { band = '中等'; bandDesc = '常规难度没问题，遇到多维度叠加的题会慢一些'; }
    else if (pct >= 20) { band = '偏慢'; bandDesc = '简单题稳定，复杂规律需要更多练习和提示'; }
    else { band = '较弱'; bandDesc = '建议从基础题型开始，先练"找一条规律"再练"找两条"'; }

    // 难度分档表现
    const byDiff = {};
    r.results.forEach(x => {
      const q = paper.find(p => p.id === x.id);
      const d = q ? q.difficulty : 3;
      const key = d <= 2 ? '基础题' : d <= 3 ? '中等题' : '难题';
      if (!byDiff[key]) byDiff[key] = { right: 0, total: 0 };
      byDiff[key].total++;
      if (x.correct) byDiff[key].right++;
    });

    box.innerHTML =
      '<div style="text-align:center;padding:10px 0 20px">' +
      '<div style="font-size:13px;color:var(--label-tertiary);margin-bottom:6px">图形推理 · 百分位估计</div>' +
      '<div style="font-size:44px;font-weight:700;letter-spacing:-.03em;color:var(--accent);' +
      'font-variant-numeric:tabular-nums">' + pct + '<span style="font-size:20px">%</span></div>' +
      '<div style="font-size:13px;color:var(--label-secondary);margin-top:4px">' +
      '答对 ' + r.score.correct + '/' + r.score.total + ' 题 · 用时 ' +
      Math.floor(usedSec / 60) + ' 分 ' + (usedSec % 60) + ' 秒</div>' +
      '<div class="hint" style="margin-top:6px">80% 概率落在 ' + lo + '% ~ ' + hi + '% 之间</div>' +
      '</div>' +

      '<div class="note" style="margin-bottom:14px">' +
      '<b>' + band + '</b> —— ' + bandDesc + '。' +
      '<div style="margin-top:6px;font-size:11.5px;opacity:.85">' +
      '这只是<b>能力倾向参考</b>，不是判决。12 道题的测量误差约 ±12 个百分点，' +
      '而且推理能力可以通过训练提升 —— 它影响的是"起点"，不是"终点"。' +
      '</div></div>' +

      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px">' +
      Object.keys(byDiff).map(k => {
        const d = byDiff[k];
        const rate = Math.round(d.right / d.total * 100);
        return '<div style="background:rgba(255,255,255,.6);border:1px solid var(--border-l1);' +
          'border-radius:10px;padding:12px;text-align:center">' +
          '<div style="font-size:11.5px;color:var(--label-tertiary)">' + k + '</div>' +
          '<div style="font-size:19px;font-weight:650;margin-top:3px">' + d.right + '/' + d.total + '</div>' +
          '<div style="font-size:11px;color:var(--label-tertiary);margin-top:2px">' + rate + '%</div>' +
          '</div>';
      }).join('') +
      '</div>' +

      '<div style="font-size:13px;font-weight:600;margin-bottom:8px">逐题回顾</div>' +
      '<div style="max-height:300px;overflow-y:auto">' +
      r.results.map(x => {
        const q = paper.find(p => p.id === x.id);
        return '<div style="padding:9px 0;border-bottom:1px solid var(--border-l1);font-size:12.5px">' +
          '<span class="tag ' + (x.correct ? 'ok' : 'bad') + '" style="font-size:10.5px">' +
          (x.correct ? '✓' : '✗') + '</span> ' +
          '<span style="color:var(--label-secondary)">第 ' + x.id + ' 题</span>' +
          (x.correct ? '' : '<div style="color:var(--label-tertiary);margin-top:3px;font-size:11.5px">' +
            esc(q ? q._explain : '') + '</div>') +
          '</div>';
      }).join('') +
      '</div>' +

      '<div style="margin-top:18px;display:flex;gap:10px">' +
      '<button class="btn btn-primary" id="btn-apt-save">保存结果，用于估分</button>' +
      '<button class="btn btn-secondary" id="btn-apt-retry">重做一次</button>' +
      '</div>';

    on('btn-apt-save', 'click', () => saveResult(r));
    on('btn-apt-retry', 'click', start);
  }

  /** 保存到 Storage，估分引擎会自动读取 */
  function saveResult(r) {
    try {
      /**
       * ★ 只存两个维度（quant / verbal）
       *
       * 为什么不多分几个维度：12 题的数据量撑不起更细的划分，
       * 分多了就是过拟合 —— 看起来精细，实际更不准。
       *
       * 图形推理主要测的是**流体推理（Gf）**，
       * 它对数理类（quant）的预测明显强于语言类（verbal），
       * 所以 quant 直接用测验结果，verbal 做衰减。
       */
      const pct = r.score.percentile;
      Storage.setAptitude({
        quant: {
          score: pct,                    // 0~1
          se: r.score.se,
        },
        verbal: {
          // 图形推理对语言的预测力弱 —— 衰减到中间（0.5）靠拢
          score: 0.5 + (pct - 0.5) * 0.55,
          se: r.score.se * 1.5,          // 不确定性更大
        },
        raw: {
          correct: r.score.correct,
          total: r.score.total,
          percentile: pct,
          range: r.score.range,
          weightedRate: r.score.weightedRate,
        },
      });
      toast('已保存 —— 估分会把这个纳入参考', 'success');

      // 刷新进度页
      if (typeof renderProgress === 'function') {
        try { renderProgress(); } catch (e) {}
      }
      // 收起测验
      const box = $('aptitude-body');
      if (box) {
        box.innerHTML = '<div class="note ok">✓ 结果已保存。去「进度追踪」看看估分有什么变化。</div>' +
          '<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" id="btn-apt-again">再测一次</button></div>';
        on('btn-apt-again', 'click', start);
      }
    } catch (e) {
      toast('保存失败：' + e.message, 'error');
    }
  }

  function cancel() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    const box = $('aptitude-body');
    if (box) box.innerHTML = '';
    answers = {};
    paper = null;
  }

  /** 入口：显示在哪个容器 */
  function mount(containerId) {
    const el = $(containerId || 'aptitude-body');
    if (!el) return;
    el.innerHTML = '<div style="text-align:center;padding:30px 20px">' +
      '<div style="font-size:14px;color:var(--label-secondary);margin-bottom:14px">' +
      '12 道图形推理题，大约 5 分钟</div>' +
      '<button class="btn btn-primary" id="btn-apt-start">开始测验</button>' +
      '</div>';
    on('btn-apt-start', 'click', start);
  }

  return { mount, start, cancel };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AptitudeUI;
