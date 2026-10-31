/**
 * 课程可视化渲染 —— 把 CourseEngine 的页面数据画成"分页讲义"（PPT 式）。
 *
 * 为什么单独一层：版式逻辑（cover/concept/formula/steps/example/compare/chart/tip/summary/quiz）
 * 和信息逻辑（生成、判分、互动）分开，改版式不会碰坏学习流程。
 *
 * 图表用**内联 SVG**手绘（不引外部库）：坐标轴 + 曲线 + 网格，
 * 数学/物理的图像题能直接画出来，这也是"没有视频模型也能可视化"的关键。
 */
const CourseView = (() => {

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /** 行内标记：**粗体** 与 `代码`，先转义再替换，避免XSS */
  function rich(s) {
    let t = esc(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\\n/g, '<br>');
    return t.replace(/\n/g, '<br>');
  }
  const NL = s => String(s == null ? '' : s).split('\n').map(rich).join('<br>');

  // ══════════════════════════════════════════════════════════
  //  SVG 图表：把 chart 数据画成坐标图
  // ══════════════════════════════════════════════════════════
  const CURVE_COLORS = {
    blue: '#0a6cf1', red: '#dc2626', green: '#16a34a',
    amber: '#f59e0b', purple: '#7c3aed', gray: '#6b7280',
  };

  /**
   * 画一张直角坐标图。
   * chart = { type, title, note, curves:[{label,color,points:[[x,y],...]}], xRange, yRange }
   */
  function chartSVG(chart) {
    const W = 640, H = 340, PAD = 44;
    const xr = Array.isArray(chart.xRange) && chart.xRange.length === 2 ? chart.xRange : [-5, 5];
    const yr = Array.isArray(chart.yRange) && chart.yRange.length === 2 ? chart.yRange : [-3, 3];
    const [x0, x1] = [Number(xr[0]) || -5, Number(xr[1]) || 5];
    const [y0, y1] = [Number(yr[0]) || -3, Number(yr[1]) || 3];
    const spanX = (x1 - x0) || 1, spanY = (y1 - y0) || 1;
    const sx = x => PAD + (x - x0) / spanX * (W - PAD * 2);
    const sy = y => H - PAD - (y - y0) / spanY * (H - PAD * 2);

    const parts = [];
    parts.push('<svg class="cv-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(chart.title || '函数图像') + '">');
    parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="12" fill="#fbfdff"/>');

    // 网格
    const gx = niceStep(spanX, 8), gy = niceStep(spanY, 6);
    for (let x = Math.ceil(x0 / gx) * gx; x <= x1 + 1e-9; x += gx) {
      const px = sx(x);
      parts.push('<line x1="' + px.toFixed(1) + '" y1="' + PAD + '" x2="' + px.toFixed(1) + '" y2="' + (H - PAD) + '" stroke="rgba(15,23,42,.07)" stroke-width="1"/>');
    }
    for (let y = Math.ceil(y0 / gy) * gy; y <= y1 + 1e-9; y += gy) {
      const py = sy(y);
      parts.push('<line x1="' + PAD + '" y1="' + py.toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + py.toFixed(1) + '" stroke="rgba(15,23,42,.07)" stroke-width="1"/>');
      if (Math.abs(y) > 1e-9) {
        parts.push('<text x="' + (PAD - 7) + '" y="' + (py + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#8b93a1">' + fmtNum(y) + '</text>');
      }
    }

    // 坐标轴
    const ax = Math.min(Math.max(sx(0), PAD), W - PAD);
    const ay = Math.min(Math.max(sy(0), PAD), H - PAD);
    parts.push('<line x1="' + PAD + '" y1="' + ay.toFixed(1) + '" x2="' + (W - PAD) + '" y2="' + ay.toFixed(1) + '" stroke="#9aa3b2" stroke-width="1.6"/>');
    parts.push('<line x1="' + ax.toFixed(1) + '" y1="' + PAD + '" x2="' + ax.toFixed(1) + '" y2="' + (H - PAD) + '" stroke="#9aa3b2" stroke-width="1.6"/>');
    parts.push('<text x="' + (W - PAD) + '" y="' + (ay - 8).toFixed(1) + '" text-anchor="end" font-size="12" fill="#6b7280">x</text>');
    parts.push('<text x="' + (ax + 8).toFixed(1) + '" y="' + (PAD + 12) + '" font-size="12" fill="#6b7280">y</text>');

    // x 轴刻度
    for (let x = Math.ceil(x0 / gx) * gx; x <= x1 + 1e-9; x += gx) {
      if (Math.abs(x) < 1e-9) continue;
      const px = sx(x);
      if (px < PAD + 6 || px > W - PAD - 6) continue;
      parts.push('<text x="' + px.toFixed(1) + '" y="' + (ay + 15).toFixed(1) + '" text-anchor="middle" font-size="11" fill="#8b93a1">' + fmtNum(x) + '</text>');
    }

    // 曲线
    (chart.curves || []).forEach((c, ci) => {
      const pts = (c.points || []).map(p => Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null)
        .filter(p => p && isFinite(p[0]) && isFinite(p[1]));
      if (pts.length < 2) return;
      const color = CURVE_COLORS[c.color] || CURVE_COLORS.blue;
      const d = pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(' ');
      parts.push('<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"><animate attributeName="stroke-dasharray" from="0 2000" to="2000 0" dur="0.9s" fill="freeze"/></path>');
      // 关键点
      pts.forEach((p, i) => {
        if (pts.length > 24 && i % Math.ceil(pts.length / 12) !== 0) return;
        parts.push('<circle cx="' + sx(p[0]).toFixed(1) + '" cy="' + sy(p[1]).toFixed(1) + '" r="2.6" fill="' + color + '"/>');
      });
      // 图例
      if (c.label) {
        const ly = PAD + 12 + ci * 18;
        parts.push('<rect x="' + (W - PAD - 118) + '" y="' + (ly - 8) + '" width="10" height="10" rx="2" fill="' + color + '"/>');
        parts.push('<text x="' + (W - PAD - 102) + '" y="' + (ly + 1) + '" font-size="12" fill="#4b5563">' + esc(c.label) + '</text>');
      }
    });

    parts.push('</svg>');
    return parts.join('');
  }
  function fmtNum(v) {
    const n = Math.round(v * 100) / 100;
    return String(n).replace(/\.0+$/, '');
  }
  function niceStep(span, target) {
    const raw = span / target;
    const p = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
    const c = [1, 2, 2.5, 5, 10].find(m => p * m >= raw) || 10;
    return p * c;
  }

  // ══════════════════════════════════════════════════════════
  //  各种页面版式
  // ══════════════════════════════════════════════════════════
  function bulletsHTML(list) {
    if (!list || !list.length) return '';
    return '<ul class="cv-bullets">' + list.map(b => '<li>' + rich(b) + '</li>').join('') + '</ul>';
  }
  function stepsHTML(steps) {
    if (!steps || !steps.length) return '';
    return '<ol class="cv-steps">' + steps.map(s => '<li>' + rich(s) + '</li>').join('') + '</ol>';
  }
  function compareHTML(cmp) {
    if (!cmp) return '';
    const rows = cmp.rows || [];
    return '<div class="cv-compare">'
      + '<div class="cv-compare-col"><div class="cv-compare-head">' + esc(cmp.leftTitle || 'A') + '</div>'
      + rows.map(r => '<div class="cv-compare-cell">' + rich((r && r[1]) || '') + '</div>').join('') + '</div>'
      + '<div class="cv-compare-col right"><div class="cv-compare-head">' + esc(cmp.rightTitle || 'B') + '</div>'
      + rows.map(r => '<div class="cv-compare-cell">' + rich((r && r[2]) || '') + '</div>').join('') + '</div>'
      + '</div>'
      + (rows.length ? '<div class="cv-compare-labels">' + rows.map(r => '<span>' + esc((r && r[0]) || '') + '</span>').join('') + '</div>' : '');
  }
  function formulaHTML(p) {
    if (!p.formula) return '';
    return '<div class="cv-formula">' + rich(p.formula) + '</div>'
      + (p.formulaParts && p.formulaParts.length
        ? '<div class="cv-formula-parts">' + p.formulaParts.map(x =>
            '<div class="cv-fpart"><span class="cv-fsym">' + esc(x.sym || '') + '</span><span class="cv-fmean">' + rich(x.mean || '') + '</span></div>').join('') + '</div>'
        : '');
  }

  /**
   * 渲染一页。
   * opts = { quizState, onAsk, onSubmitQuiz, onPractice, onSubmitPractice, asking, grading }
   * 返回 HTML 字符串（事件由 app.js 统一代理，避免内联 onclick 的转义坑）
   */
  function pageHTML(page, opts) {
    opts = opts || {};
    const k = page.kind;
    let inner = '';

    if (k === 'cover') {
      inner = '<div class="cv-cover">'
        + '<div class="cv-cover-badge">本节</div>'
        + '<h2 class="cv-cover-title">' + esc(page.title || '') + '</h2>'
        + (page.body ? '<p class="cv-lead">' + NL(page.body) + '</p>' : '')
        + bulletsHTML(page.bullets)
        + '</div>';
    } else if (k === 'formula') {
      inner = '<h3 class="cv-h">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + formulaHTML(page)
        + bulletsHTML(page.bullets);
    } else if (k === 'steps') {
      inner = '<h3 class="cv-h">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + stepsHTML(page.steps)
        + bulletsHTML(page.bullets);
    } else if (k === 'example') {
      const e = page.example || {};
      inner = '<h3 class="cv-h">' + esc(page.title || '例题') + '</h3>'
        + '<div class="cv-example-q"><span class="cv-tag">题目</span>' + NL(e.question) + '</div>'
        + (e.solution && e.solution.length
          ? '<div class="cv-example-sol"><span class="cv-tag ok">分步演算</span>' + stepsHTML(e.solution) + '</div>' : '')
        + (e.answer ? '<div class="cv-answer">答案：<b>' + rich(e.answer) + '</b></div>' : '')
        + (e.why ? '<div class="cv-why">这题在考：' + rich(e.why) + '</div>' : '');
    } else if (k === 'compare') {
      inner = '<h3 class="cv-h">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + compareHTML(page.compare);
    } else if (k === 'chart') {
      inner = '<h3 class="cv-h">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + (page.chart ? chartSVG(page.chart) : '')
        + (page.chart && page.chart.note ? '<div class="cv-chart-note">' + rich(page.chart.note) + '</div>' : '')
        + bulletsHTML(page.bullets);
    } else if (k === 'tip') {
      inner = '<div class="cv-tip"><div class="cv-tip-head">⚠ 容易错的地方</div>'
        + '<h3 class="cv-h small">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + bulletsHTML(page.bullets) + '</div>';
    } else if (k === 'summary') {
      inner = '<div class="cv-summary"><div class="cv-summary-head">本节小结</div>'
        + '<h3 class="cv-h small">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + bulletsHTML(page.bullets)
        + (page.formula ? '<div class="cv-formula compact">' + rich(page.formula) + '</div>' : '')
        + '</div>';
    } else if (k === 'quiz') {
      inner = quizHTML(page, opts);
    } else {
      // concept 及其它未知类型：按普通讲解排
      inner = '<h3 class="cv-h">' + esc(page.title || '') + '</h3>'
        + (page.body ? '<p class="cv-body">' + NL(page.body) + '</p>' : '')
        + formulaHTML(page)
        + bulletsHTML(page.bullets);
    }

    const kindLabel = {
      cover: '开始', concept: '讲解', formula: '公式', steps: '步骤',
      example: '例题', compare: '对比', chart: '图像', tip: '提醒',
      summary: '小结', quiz: '练习',
    }[k] || '讲解';

    return '<div class="cv-page" data-kind="' + esc(k) + '">'
      + '<span class="cv-page-kind">' + kindLabel + '</span>'
      + inner
      + '</div>';
  }

  /** 练习页：选项 / 填空 + 结果 + 巩固题 */
  function quizHTML(page, opts) {
    const q = page.quiz;
    if (!q) {
      return '<h3 class="cv-h">' + esc(page.title || '随堂练习') + '</h3>'
        + '<div class="cv-empty">' + NL(page.body || '这一页没有练习。') + '</div>'
        + '<div class="btn-group" style="margin-top:12px"><button class="btn btn-secondary btn-sm" data-cv="regen-quiz">重出练习</button></div>';
    }
    const g = q.graded;
    const gv = g && g.correct;
    const pickedOpt = (opts && opts.pickedOption) || null;   // 已选中但还没提交的选项
    let h = '<h3 class="cv-h">' + esc(page.title || '随堂练习') + '</h3>'
      + '<div class="cv-quiz-q">' + NL(q.question) + '</div>';

    if (q.type === 'choice' && q.options.length) {
      h += '<div class="cv-opts">' + q.options.map((o, i) => {
        const L = String.fromCharCode(65 + i);
        let cls = 'cv-opt';
        if (g) {
          // ★ 只有**判分之后**才标出对错颜色。
          //   之前这里在未作答时也会算 correctLetter，加上"点一下即交"的设计，
          //   导致答案一提交就跳出来、且改不了 —— 用户报的两个 BUG 都源于此。
          const picked = q.studentAnswer === L;
          const correctLetter = String(q.answer || '').trim().toUpperCase().slice(0, 1);
          if (L === correctLetter) cls += ' correct';
          else if (picked) cls += ' wrong';
        } else if (pickedOpt === L) {
          cls += ' picked';      // 仅"选中"高亮（蓝色），不泄露对错
        }
        return '<button type="button" class="' + cls + '" data-cv="pick" data-opt="' + L + '"' + (g ? ' disabled' : '') + '>'
          + '<span class="cv-opt-letter">' + L + '</span><span class="cv-opt-text">' + rich(String(o).replace(/^[A-D][.、)]?\s*/, '')) + '</span></button>';
      }).join('') + '</div>';
      // 明确的两步操作：先选，再提交（提交前可以随便改）
      if (!g) {
        h += '<div class="cv-submit-row">'
          + '<button type="button" class="btn btn-primary btn-sm" data-cv="submit-choice"' + (pickedOpt ? '' : ' disabled') + '>'
          + (pickedOpt ? '提交答案（选了 ' + esc(pickedOpt) + '）' : '提交答案') + '</button>'
          + '<span class="cv-submit-hint">先点上面的选项，选错了可以改，确定后再提交</span>'
          + '</div>';
      }
    } else {
      h += '<div class="cv-fill">'
        + '<input type="text" class="cv-fill-input" data-cv="fill-input" placeholder="写出你的答案" '
        + (g ? 'value="' + esc(q.studentAnswer || '') + '" disabled' : '') + '>'
        + (g ? '' : '<button type="button" class="btn btn-primary btn-sm" data-cv="submit-fill">提交</button>')
        + '</div>';
    }

    if (g) {
      h += '<div class="cv-grade ' + (gv ? 'ok' : 'bad') + '">'
        + '<div class="cv-grade-head">' + (gv ? '✓ 答对了' : '✗ 答错了')
        + (g.reason && g.reason !== '无' ? '<span class="cv-grade-reason">' + esc(g.reason) + '</span>' : '') + '</div>'
        + (g.comment ? '<div class="cv-grade-line">' + rich(g.comment) + '</div>' : '')
        + (g.keyStep ? '<div class="cv-grade-line"><b>关键一步：</b>' + rich(g.keyStep) + '</div>' : '')
        + (!gv && q.answer ? '<div class="cv-grade-line"><b>正确答案：</b>' + rich(q.answer) + '</div>' : '')
        + (q.explain ? '<div class="cv-grade-line"><b>解析：</b>' + rich(q.explain) + '</div>' : '')
        + (!gv && q.pitfall ? '<div class="cv-grade-line warn"><b>常见错法：</b>' + rich(q.pitfall) + '</div>' : '')
        + (g.nextTip ? '<div class="cv-grade-line">' + rich(g.nextTip) + '</div>' : '')
        + '</div>';

      h += '<div class="btn-group" style="margin-top:10px">'
        + '<button class="btn btn-secondary btn-sm" data-cv="practice">出同类题练一下</button>'
        + (gv ? '' : '<button class="btn btn-ghost btn-sm" data-cv="reask">换个方式讲这题</button>')
        + '</div>';

      if (q.practice && q.practice.length) {
        h += '<div class="cv-practice"><div class="cv-practice-head">同类巩固题</div>'
          + q.practice.map((it, i) => {
            const r = it.result;
            let body = '<div class="cv-pr-q">' + (i + 1) + '. ' + NL(it.question) + '</div>';
            if (it.type === 'choice' && it.options.length) {
              // 已选中但未提交的那个（存在 opts.pickedOption 里，格式 'pr<idx>:<L>'）
              const prPicked = (() => {
                const raw = (opts && opts.pickedOption) || '';
                const parts = String(raw).split(':');
                return (parts[0] === ('pr' + i)) ? parts[1] : null;
              })();
              body += '<div class="cv-opts small">' + it.options.map((o, oi) => {
                const L = String.fromCharCode(65 + oi);
                let cls = 'cv-opt';
                if (r) {
                  // 同样：只在判分后标对错
                  const picked = it.submitted === L;
                  const cl = String(it.answer || '').trim().toUpperCase().slice(0, 1);
                  if (L === cl) cls += ' correct';
                  else if (picked) cls += ' wrong';
                } else if (prPicked === L) cls += ' picked';
                return '<button type="button" class="' + cls + '" data-cv="pick-pr" data-idx="' + i + '" data-opt="' + L + '"' + (r ? ' disabled' : '') + '>'
                  + '<span class="cv-opt-letter">' + L + '</span><span class="cv-opt-text">' + rich(String(o).replace(/^[A-D][.、)]?\s*/, '')) + '</span></button>';
              }).join('') + '</div>';
              if (!r) {
                body += '<div class="cv-submit-row">'
                  + '<button type="button" class="btn btn-secondary btn-sm" data-cv="submit-pr-choice" data-idx="' + i + '"'
                  + (prPicked ? '' : ' disabled') + '>' + (prPicked ? '提交（选了 ' + esc(prPicked) + '）' : '提交答案') + '</button>'
                  + '</div>';
              }
            } else {
              body += '<div class="cv-fill"><input type="text" class="cv-fill-input" data-cv="fill-pr" data-idx="' + i + '" placeholder="你的答案" '
                + (r ? 'value="' + esc(it.submitted || '') + '" disabled' : '') + '>'
                + (r ? '' : '<button type="button" class="btn btn-secondary btn-sm" data-cv="submit-pr" data-idx="' + i + '">提交</button>') + '</div>';
            }
            if (r) {
              body += '<div class="cv-grade ' + (r.correct ? 'ok' : 'bad') + '">'
                + '<div class="cv-grade-head">' + (r.correct ? '✓ 对了' : '✗ 再看一下') + '</div>'
                + (!r.correct ? '<div class="cv-grade-line"><b>正确答案：</b>' + rich(it.answer) + '</div>' : '')
                + (it.explain ? '<div class="cv-grade-line">' + rich(it.explain) + '</div>' : '')
                + '</div>';
            }
            return '<div class="cv-pr-item">' + body + '</div>';
          }).join('') + '</div>';
      }
    }

    return h;
  }

  // ══════════════════════════════════════════════════════════
  //  外层骨架
  // ══════════════════════════════════════════════════════════

  /** 课程列表（没打开任何课程时） */
  function listHTML(courses) {
    if (!courses.length) {
      return '<div class="cv-empty-state">'
        + '<div class="cv-empty-icon">▤</div>'
        + '<div class="cv-empty-title">还没有课程</div>'
        + '<div class="cv-empty-sub">在上面写下你想学什么，AI 会先给你一份目录</div>'
        + '</div>';
    }
    return '<div class="cv-cards">' + courses.map(c => {
      const pct = c.pct || 0;
      return '<button type="button" class="cv-card" data-cv="open" data-id="' + esc(c.id) + '">'
        + '<div class="cv-card-top"><span class="cv-card-title">' + esc(c.title) + '</span>'
        + '<span class="cv-card-pct">' + pct + '%</span></div>'
        + (c.summary ? '<div class="cv-card-sub">' + esc(c.summary) + '</div>' : '')
        + '<div class="cv-card-bar"><i style="width:' + pct + '%"></i></div>'
        + '<div class="cv-card-meta">' + esc(c.subject || '') + ' · ' + c.done + '/' + c.lessons + ' 节'
        + (c.minutesSpent ? ' · ' + c.minutesSpent + ' 分钟' : '') + '</div>'
        + '</button>';
    }).join('') + '</div>';
  }

  /** 目录（确认/继续学） */
  function outlineHTML(course, progress) {
    return '<div class="cv-outline">'
      + '<div class="cv-outline-head">'
      + '<div><div class="cv-outline-title">' + esc(course.title) + '</div>'
      + (course.summary ? '<div class="cv-outline-sub">' + esc(course.summary) + '</div>' : '')
      + '</div>'
      + '<div class="cv-outline-right">'
      + '<span class="cv-pill">' + progress.done + '/' + progress.lessons + ' 节</span>'
      + (progress.minutes ? '<span class="cv-pill">' + progress.minutes + ' 分钟</span>' : '')
      + '</div></div>'
      + '<div class="cv-outline-bar"><i style="width:' + progress.pct + '%"></i></div>'
      + '<ol class="cv-lessons">'
      + course.outline.map((l, i) => {
        const ready = !!l.pages;
        return '<li class="cv-lesson' + (l.done ? ' done' : '') + '">'
          + '<button type="button" class="cv-lesson-btn" data-cv="lesson" data-idx="' + i + '">'
          + '<span class="cv-lesson-no">' + (l.done ? '✓' : (i + 1)) + '</span>'
          + '<span class="cv-lesson-main">'
          + '<span class="cv-lesson-title">' + esc(l.title) + '</span>'
          + (l.goal ? '<span class="cv-lesson-goal">' + esc(l.goal) + '</span>' : '')
          + '</span>'
          + '<span class="cv-lesson-min">' + (l.minutes || 15) + '′' + (ready && !l.done ? ' · 待学' : '') + '</span>'
          + '</button></li>';
      }).join('')
      + '</ol>'
      + '<div class="btn-group" style="margin-top:14px">'
      + '<button class="btn btn-secondary btn-sm" data-cv="back-list">← 课程列表</button>'
      + '<button class="btn btn-ghost btn-sm" data-cv="delete-course" data-id="' + esc(course.id) + '">删除这门课</button>'
      + '</div></div>';
  }

  /**
   * 朗读栏：朗读/停止 + 音色选择 + 语速 + 自动连读开关 + 服务状态。
   * opts.voices / opts.voice / opts.rate / opts.autoRead / opts.speaking / opts.ttsError 由 app.js 传
   * （渲染层不依赖 Speech 单例，方便单独测试）。
   */
  function speakBarHTML(page, opts) {
    opts = opts || {};
    const vs = opts.voices || [];
    const cur = opts.voice || '';
    const isQuiz = page && page.kind === 'quiz';
    const playing = !!opts.speaking;
    const paused = !!opts.paused;

    /**
     * 服务没起来：明确告诉用户当前状态，而不是给个点了没反应的按钮。
     *
     * ★ 2026-10-17 更新：本地 MOSS 语音服务暂时不做了（模型被清理，用户决定后续接 API），
     *   所以这里不再显示"运行 python tts\tts_server.py"这类**已经不存在的命令**，
     *   否则用户照着做只会看到文件不存在。改为如实说明"暂未启用"。
     *   代码保留，以后接 API 时只要服务能通过 /health 探测，这条分支就不会再走到。
     */
    if (!opts.ttsReady) {
      return '<div class="cv-speak-bar off">'
        + '<span class="cv-speak-off">🔇 朗读功能暂未启用</span>'
        + '<span class="cv-speak-note">本地语音服务还没接上，后续会通过 API 接入。</span>'
        + '<button type="button" class="cv-speak-btn" data-cv="tts-retry">重新检测</button>'
        + '</div>';
    }

    return '<div class="cv-speak-bar">'
      + '<button type="button" class="cv-speak-btn' + (playing ? ' on' : '') + '" data-cv="speak">'
      + (playing ? '⏸ 停止' : (paused ? '▶ 继续' : '🔊 让老师讲这一页')) + '</button>'
      + (vs.length
        ? '<select class="cv-speak-sel" data-cv="voice" title="选老师的声音">'
          + vs.map(v => '<option value="' + esc(v.id || v.name || '') + '"' + ((v.id || v.name) === cur ? ' selected' : '') + '>'
            + esc(v.label || v.id || v.name) + '</option>').join('')
          + '</select>'
        : '')
      + '<span class="cv-speak-rate">语速'
      + '<input type="range" min="0.6" max="1.6" step="0.1" value="' + (opts.rate || 1) + '" data-cv="rate">'
      + '<b>' + Number(opts.rate || 1).toFixed(1) + '×</b></span>'
      + '<label class="cv-speak-rate" style="cursor:pointer" title="打开后翻到下一页会自动接着讲">'
      + '<input type="checkbox" data-cv="auto-read"' + (opts.autoRead ? ' checked' : '') + '> 自动连讲</label>'
      + '<span class="cv-speak-note">'
      + (isQuiz ? '练习页只念题目，不念答案' : 'MOSS-TTS-Nano · 本地合成 · 48kHz')
      + (opts.ttsError ? ' · <b style="color:#b91c1c">' + esc(opts.ttsError) + '</b>' : '')
      + '</span>'
      + '</div>';
  }

  /**
   * 学习界面：顶部进度 + 幻灯片舞台 + 底部翻页 + 互动栏。
   * 注意：这里**不依赖 CourseEngine**（渲染层保持纯粹，只吃数据）——
   * 早期版本写了 `CourseEngine.progress()`，导致单独引用本文件时会 ReferenceError，
   * 也让渲染层和引擎强耦合。现在 progress 由调用方通过 opts.progress 传入。
   */
  function learnHTML(course, lessonIndex, pageIndex, opts) {
    const lesson = course.outline[lessonIndex] || { title: '', pages: [] };
    const pages = lesson.pages || [];
    const page = pages[pageIndex] || {};
    const total = pages.length;

    return '<div class="cv-learn">'
      // 顶部：进度 + 导航
      + '<div class="cv-learn-head">'
      + '<button class="btn btn-ghost btn-sm" data-cv="back-outline">☰ 目录</button>'
      + '<div class="cv-learn-title">' + esc(lesson.title) + '</div>'
      + '<div class="cv-learn-prog"><span>' + (pageIndex + 1) + ' / ' + total + '</span>'
      + '<div class="cv-dots">' + pages.map((p, i) =>
          '<i class="' + (i === pageIndex ? 'on' : (i < pageIndex ? 'past' : '')) + '" data-kind="' + esc(p.kind) + '"></i>').join('')
      + '</div></div>'
      + '</div>'
      // 朗读栏（像老师念给你听；练习页只念题目不念答案）
      + speakBarHTML(page, opts)
      // 幻灯片
      + '<div class="cv-stage" data-page="' + pageIndex + '">'
      + pageHTML(page, opts)
      + '</div>'
      // 底部翻页
      + '<div class="cv-nav">'
      + '<button class="btn btn-secondary btn-sm" data-cv="prev"' + (pageIndex === 0 ? ' disabled' : '') + '>← 上一页</button>'
      + '<button class="btn btn-primary btn-sm" data-cv="next">' + (pageIndex >= total - 1 ? '学完这一节' : '下一页 →') + '</button>'
      + '</div>'
      // 互动栏（边学边问）
      + '<div class="cv-interact">'
      + '<div class="cv-ask-head">没听懂就打断我，我换个方式讲这一步</div>'
      + '<div class="cv-ask-log" data-role="ask-log">'
      + (opts.askLog || []).map(h => '<div class="cv-ask-bubble ' + (h.role === 'user' ? 'me' : 'ai') + '">'
          + (h.role === 'user' ? esc(h.content) : NL(h.content)) + '</div>').join('')
      + '</div>'
      + '<div class="cv-ask-bar">'
      + '<input type="text" class="cv-ask-input" data-cv="ask-input" placeholder="比如：为什么这里要提 2？"'
      + (opts.asking ? ' disabled' : '') + '>'
      + '<button class="btn btn-primary btn-sm" data-cv="ask"' + (opts.asking ? ' disabled' : '') + '>'
      + (opts.asking ? '讲解中…' : '问老师') + '</button>'
      + '</div>'
      + '<div class="cv-quick">'
      + ['这一步没懂', '为什么要这样做', '举个例子', '考试会怎么考'].map(q =>
          '<button type="button" class="cv-quick-btn" data-cv="quick" data-q="' + esc(q) + '">' + esc(q) + '</button>').join('')
      + '</div>'
      + '</div>'
      + '</div>';
  }

  return { esc, rich, NL, chartSVG, pageHTML, listHTML, outlineHTML, learnHTML, speakBarHTML };
})();
