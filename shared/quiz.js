/**
 * 试卷引擎 v0.4 — AI 驱动出题和批改
 */
const QuizEngine = (() => {
  var quiz = null;
  var timer = null;
  var startTime = 0;

  async function generate({ subject, knowledge, difficulty, type, count, timeLimit, onlyCovered }) {
    var goal = Storage.getGoal();
    var textbook = Storage.getSubjectTextbook(subject);
    var questions;

    try {
      var r = await LLM.generateQuiz({
        subject: subject,
        knowledge: knowledge || '',
        difficulty: difficulty === 'mixed' ? 'normal' : difficulty,
        type: type,
        count: parseInt(count) || 10,
        grade: goal.grade || '高三',
        textbook: textbook,
        onlyCovered: onlyCovered !== false,
      });
      questions = (r.questions || []).map(function(q, i) {
        return Object.assign({}, q, { index: i + 1, subject: subject, studentAnswer: null });
      });
    } catch (e) {
      console.warn('AI出题失败:', e);
      /**
       * ★ 兜底升级（2026-11-01）
       *
       * 原来只走 DB.getFallback，每科只有零星几道题，出 10 道题会明显重复。
       * 现在优先用 Teaching.bankQuestions（内置 135 道高考同型/联考典型题，
       * 按科目 + 知识点 + 难度筛选），题库不够再用 DB.getFallback 补齐。
       */
      var n = parseInt(count) || 10;
      var banked = [];
      try {
        if (typeof Teaching !== 'undefined' && Teaching.bankQuestions) {
          banked = Teaching.bankQuestions({
            subject: subject,
            knowledge: knowledge || '',
            difficulty: difficulty,
            count: n,
          });
          // 置空学生答案字段，保证是全新的卷子
          banked = banked.map(function(q, i) {
            return Object.assign({}, q, { index: i + 1, subject: subject, studentAnswer: null });
          });
        }
      } catch (e2) { console.warn('内置题库读取失败:', e2); }

      if (banked.length >= n) {
        questions = banked.slice(0, n);
      } else {
        // 题库不够：先用题库，再用 DB.getFallback 补齐并去重
        var used = banked.map(function(q) { return q.text; });
        var extra = DB.getFallback(subject, n - banked.length).map(function(q, i) {
          return Object.assign({}, q, { index: 0, subject: subject, studentAnswer: null });
        }).filter(function(q) { return used.indexOf(q.text) < 0; });
        questions = banked.concat(extra).map(function(q, i) {
          return Object.assign({}, q, { index: i + 1 });
        });
      }
      if (!questions.length) {
        questions = DB.getFallback(subject, n).map(function(q, i) {
          return Object.assign({}, q, { index: i + 1, subject: subject, studentAnswer: null });
        });
      }
      console.log('[quiz] 使用内置题库兜底：' + questions.length + ' 题');
    }

    quiz = {
      id: Date.now().toString(36),
      subject: subject,
      questions: questions,
      difficulty: difficulty,
      type: type,
      timeLimit: parseInt(timeLimit) || 0,
      textbook: textbook,   // 记录出题时的教材进度，便于核对是否超纲
      createdAt: new Date().toISOString(),
    };
    startTime = Date.now();
    return quiz;
  }

  function escHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function render(quizData, containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = quizData.questions.map(function(q, i) {
      var dc = q.difficulty === 'easy' ? 'easy' : q.difficulty === 'hard' ? 'hard' : 'normal';
      var dt = q.difficulty === 'easy' ? '基础' : q.difficulty === 'hard' ? '较难' : '中等';
      var input = '';

      if (q.type === 'choice') {
        input = '<div class="q-opts" data-qi="' + i + '">' + (q.options || []).map(function(o, oi) {
          var L = String.fromCharCode(65 + oi);
          return '<div class="q-opt" data-v="' + L + '" onclick="QuizEngine.selOpt(' + i + ',\'' + L + '\')">' +
            '<div class="q-marker">' + L + '</div><span>' + escHtml(String(o == null ? '' : o).replace(/^[A-D]\.?/, '').trim()) + '</span></div>';
        }).join('') + '</div>';
      } else if (q.type === 'fill') {
        input = '<input type="text" class="q-input" data-qi="' + i + '" placeholder="请输入答案" oninput="QuizEngine.saveFill(' + i + ',this.value)">';
      } else {
        input = '<textarea class="q-textarea" data-qi="' + i + '" placeholder="请写出完整的解题过程..." oninput="QuizEngine.saveAns(' + i + ',this.value)"></textarea>';
      }

      return '<div class="q-item" data-qi="' + i + '">' +
        '<div class="q-head"><span class="q-num">第' + (i + 1) + '题</span>' +
        '<span class="q-tag ' + dc + '">' + dt + '</span></div>' +
        '<div class="q-text">' + q.text + '</div>' + input + '</div>';
    }).join('');

    if (quizData.timeLimit > 0) startTimer(quizData.timeLimit);
  }

  function selOpt(qi, v) {
    if (!quiz) return;
    quiz.questions[qi].studentAnswer = v;
    var c = document.querySelector('.q-opts[data-qi="' + qi + '"]');
    if (c) {
      c.querySelectorAll('.q-opt').forEach(function(el) {
        el.classList.toggle('sel', el.dataset.v === v);
      });
    }
  }

  function saveFill(qi, v) { if (quiz) quiz.questions[qi].studentAnswer = v; }
  function saveAns(qi, v) { if (quiz) quiz.questions[qi].studentAnswer = v; }

  function startTimer(min) {
    var el = document.getElementById('quiz-timer');
    if (!el) return;
    var r = min * 60;
    el.textContent = '⏱ ' + fm(r);
    clearInterval(timer);
    timer = setInterval(function() {
      r--;
      el.textContent = '⏱ ' + fm(r);
      if (r <= 60) el.style.color = 'var(--red)';
      if (r <= 0) {
        clearInterval(timer);
        el.textContent = '⏰ 时间到!';
        if (typeof App !== 'undefined') { App.submitQuiz(); }
      }
    }, 1000);
  }

  function stopTimer() { clearInterval(timer); }

  function fm(s) {
    return Math.floor(s / 60).toString().padStart(2, '0') + ':' + (s % 60).toString().padStart(2, '0');
  }

  /**
   * ★ 判分（2026-10-24 重写：改用 Grader 逐题判分）
   *
   * 旧逻辑的严重问题：
   *   · 解答题只要写了内容就给 5 分（半分）—— 完全答对也只有半分
   *   · 随便写一句话也给 5 分
   *   · 填空题用"前缀包含"判断，答案 12 填 1 也算对
   *   · 这些错误直接流进错题本 → 薄弱点 → 估分，污染整条链路
   *
   * 新逻辑：
   *   · 客观题确定性判断（数值等价、多解、单位）
   *   · 主观题按评分点给分，显示"哪步得分、哪步失分"
   *   · 无法确定时标 pending，**不计入总分**，也不进错题本
   */
  async function grade() {
    if (!quiz) return null;
    stopTimer();
    var elapsed = Math.round((Date.now() - startTime) / 1000);
    var answers = [];

    quiz.questions.forEach(function(q, i) {
      answers.push(String(q.studentAnswer == null ? '' : q.studentAnswer).trim());
    });

    // ── 用 Grader 逐题判分 ──
    var result;
    try {
      result = Grader.gradeQuiz(quiz.questions, answers);
    } catch (e) {
      console.error('[quiz] Grader 失败，退回简单判分:', e);
      result = fallbackGrade(quiz.questions, answers);
    }

    var score = result.score;
    var total = result.fullScore;
    var perQuestion = result.perQuestion;

    quiz.score = score;
    quiz.totalScore = total;
    quiz.answers = answers;
    quiz.elapsed = elapsed;
    quiz.perQuestion = perQuestion;
    quiz.pendingCount = result.pendingCount;
    quiz.gradedAt = new Date().toISOString();

    // ── AI 分析（失败不影响判分）──
    var analysis;
    try {
      analysis = await LLM.analyzeQuiz({
        quiz: quiz, answers: answers, perQuestion: perQuestion,
      });
    } catch (e) {
      analysis = localAnalysis(quiz, score, total, answers);
    }

    quiz.analysis = analysis;

    // ── 记录成绩 ──
    /**
     * ★ pending 的处理（2026-10-24）
     *   有未确认的题时不写成绩记录 —— 因为总分不完整，
     *   写进去会让估分算法拿到偏低的分。等用户确认后再写。
     */
    if (result.pendingCount === 0) {
      Storage.addRecord({
        type: 'quiz', source: 'AI出卷', subject: quiz.subject,
        score: score, fullScore: total, quizId: quiz.id, analysis: analysis,
      });
    } else {
      Storage.set('quiz_pending_' + quiz.id, {
        quizId: quiz.id, subject: quiz.subject,
        score: score, fullScore: total,
        pendingCount: result.pendingCount,
        at: new Date().toISOString(),
      });
    }

    // ── 错题本 ──
    /**
     * ★ 只收确定错的题（2026-10-24）
     *   wrong / partial / blank 才进错题本；
     *   pending **不进** —— 因为还不知道对不对，
     *   收进去会污染薄弱点分析。
     */
    perQuestion.forEach(function(p, i) {
      if (p.status === 'wrong' || p.status === 'partial' || p.status === 'blank') {
        Storage.addMistake({
          subject: p.subject || quiz.subject,
          knowledge: p.knowledge || quiz.questions[i].knowledge || '未分类',
          question: p.text,
          correctAnswer: p.correctAnswer,
          wrongAnswer: p.studentAnswer,
          explanation: quiz.questions[i].explanation || '',
          quizId: quiz.id,
          type: p.type,
          // ★ 记录失分详情，方便复习时聚焦
          lostPoints: (p.points || []).filter(function(x) { return !x.ok; }).map(function(x) { return x.text; }),
          gotScore: p.score,
          fullScore: p.fullScore,
        });
      }
    });

    Storage.incQuiz();
    Storage.addMin(Math.round(elapsed / 60));

    var actTitle = '完成' + quiz.subject + '测验: ' + score + '/' + total + '分';
    if (result.pendingCount > 0) {
      actTitle += '（' + result.pendingCount + ' 题待确认）';
    }
    Storage.addAct({ icon: '📝', title: actTitle });

    return {
      score: score,
      total: total,
      analysis: analysis,
      perQuestion: perQuestion,
      pendingCount: result.pendingCount,
    };
  }

  /** Grader 不可用时的兜底（保持旧行为，但至少不误判） */
  function fallbackGrade(questions, answers) {
    var score = 0, fullScore = 0, pendingCount = 0;
    var perQuestion = [];
    questions.forEach(function(q, i) {
      var full = 10;
      var a = answers[i] || '';
      var status, got = 0;
      if (!a) { status = 'blank'; }
      else if (q.type === 'choice') {
        status = (String(a).toUpperCase() === String(q.answer || '').toUpperCase()) ? 'correct' : 'wrong';
        got = status === 'correct' ? full : 0;
      } else if (q.type === 'fill') {
        status = 'pending';  // 没法可靠比较，标待确认
      } else {
        status = 'pending';  // 主观题永远不猜分
      }
      if (status === 'pending') pendingCount++;
      else { score += got; }
      fullScore += full;
      perQuestion.push({ index: i, status: status, score: got, fullScore: full, text: q.text, points: [] });
    });
    return { score: score, fullScore: fullScore, perQuestion: perQuestion, pendingCount: pendingCount };
  }

  function localAnalysis(quiz, score, total, answers) {
    var ratio = score / total;
    var wrong = {};
    quiz.questions.forEach(function(q, i) {
      var sa = answers[i] || '';
      var correct = q.type === 'choice' ? sa === q.answer :
        q.type === 'fill' ? String(q.answer == null ? '' : q.answer).toLowerCase().replace(/\s+/g, '') === String(sa == null ? '' : sa).toLowerCase().replace(/\s+/g, '') : false;
      if (!correct && q.knowledge) wrong[q.knowledge] = (wrong[q.knowledge] || 0) + 1;
    });
    return {
      score: score,
      analysis: ratio >= 0.8 ? '掌握良好！' : ratio >= 0.6 ? '基础尚可，需加强薄弱点' : '需要重点关注',
      strengths: [],
      weaknesses: Object.entries(wrong).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 3).map(function(e) { return e[0]; }),
      suggestions: ['复习错题', '多做同类型练习', '理解解题思路'],
    };
  }

  function renderResult(result, detailId, reviewId) {
    var per = result.perQuestion || [];
    var pending = result.pendingCount || 0;

    // 总分（只说"已确定得分"，pending 的单独说明）
    var ratio = result.total > 0 ? result.score / result.total : 0;
    var color = ratio >= 0.8 ? 'var(--green)' : ratio >= 0.6 ? 'var(--amber)' : 'var(--red)';

    var scoreEl = document.getElementById('result-score');
    if (scoreEl) {
      scoreEl.innerHTML =
        '<span style="color:' + color + '">' + result.score + '</span>' +
        '<span style="font-size:24px;color:#94a3b8">/' + result.total + '</span>' +
        (pending > 0
          ? '<div style="font-size:12px;color:var(--amber);margin-top:4px">' +
            '另有 ' + pending + ' 题待确认，确认后计入总分</div>'
          : '');
    }

    // 概览
    var detailEl = document.getElementById(detailId);
    if (detailEl) {
      /**
       * ★ 不再说"正确率 XX%"
       *   因为 pending 的存在让百分比失准。
       *   改成说清楚：确定对几题、错几题、待确认几题。
       */
      var correctN = per.filter(function(p) { return p.status === 'correct'; }).length;
      var partialN = per.filter(function(p) { return p.status === 'partial'; }).length;
      var wrongN = per.filter(function(p) { return p.status === 'wrong' || p.status === 'blank'; }).length;

      detailEl.innerHTML =
        '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13.5px;margin-bottom:12px">' +
        '<span style="color:var(--green)">✓ 全对 ' + correctN + ' 题</span>' +
        (partialN ? '<span style="color:var(--amber)">◐ 部分对 ' + partialN + ' 题</span>' : '') +
        '<span style="color:var(--red)">✗ 错 ' + wrongN + ' 题</span>' +
        (pending ? '<span style="color:var(--accent)">? 待确认 ' + pending + ' 题</span>' : '') +
        '</div>' +
        '<p style="color:var(--text-sec);margin-bottom:12px;">' + escHtml(result.analysis.analysis || '') + '</p>' +
        (result.analysis.weaknesses && result.analysis.weaknesses.length
          ? '<p style="font-weight:500;margin-bottom:4px;">⚠️ 需加强: ' + result.analysis.weaknesses.map(escHtml).join('、') + '</p>' : '') +
        (result.analysis.suggestions && result.analysis.suggestions.length
          ? '<p style="color:var(--text-sec)">💡 ' + result.analysis.suggestions.map(escHtml).join(' · ') + '</p>' : '');
    }

    // ── 逐题详情 ──
    var reviewEl = document.getElementById(reviewId);
    if (!reviewEl) return;

    var html = '<h4 style="margin:20px 0 12px;font-size:15px;">📋 逐题得分</h4>';

    per.forEach(function(p, i) {
      var q = quiz.questions[i] || {};
      var label = (typeof Grader !== 'undefined') ? Grader.statusLabel(p.status) : p.status;
      var sc = (typeof Grader !== 'undefined') ? Grader.statusColor(p.status) : 'var(--label-secondary)';
      var isPending = p.status === 'pending';
      var isWrong = p.status === 'wrong' || p.status === 'partial' || p.status === 'blank';

      html += '<div class="q-item ' + (isWrong ? 'wrong' : '') + '" data-qidx="' + i + '">' +
        '<div class="q-head">' +
        '<span class="q-num" style="color:' + sc + '">' + label +
        ' <span style="font-size:12px;opacity:.8">' + p.score + '/' + p.fullScore + ' 分</span></span>' +
        '<span class="q-tag ' + (q.difficulty === 'easy' ? 'easy' : q.difficulty === 'hard' ? 'hard' : 'normal') + '">' +
        escHtml(q.knowledge || '') + '</span></div>' +
        '<div class="q-text">' + escHtml(p.text || q.text || '') + '</div>' +
        '<div style="font-size:13px;color:var(--text-sec);margin-top:4px;">你的答案：' +
        '<span style="color:' + sc + '">' + escHtml(p.studentAnswer || '（未作答）') + '</span></div>';

      // 评分点逐条展示（主观题）
      if (p.points && p.points.length) {
        html += '<div style="margin-top:8px;padding:8px 12px;background:rgba(0,0,0,.025);border-radius:7px;font-size:12.5px">' +
          '<div style="font-weight:600;margin-bottom:5px;">评分点</div>' +
          p.points.map(function(pt) {
            return '<div style="color:' + (pt.ok ? 'var(--green)' : 'var(--label-tertiary)') + ';margin:3px 0">' +
              (pt.ok ? '✓' : '○') + ' ' + escHtml(pt.text) +
              ' <span style="opacity:.7">' + pt.got + '/' + pt.max + '</span></div>';
          }).join('') + '</div>';
      }

      // 正确答案（非待确认时显示）
      if (!isPending && p.status !== 'correct' && p.correctAnswer) {
        html += '<div style="font-size:13px;color:var(--green);margin-top:4px;">' +
          '正确答案：' + escHtml(p.correctAnswer) + '</div>';
      }

      // 失分原因
      if (p.reason) {
        html += '<div style="font-size:12px;color:var(--amber);margin-top:4px;">' + escHtml(p.reason) + '</div>';
      }

      // 解析
      if (q.explanation) {
        html += '<div style="font-size:12px;color:var(--text-mute);margin-top:4px;">💡 ' + escHtml(q.explanation) + '</div>';
      }

      // ★ 待确认 → 改判按钮
      if (isPending) {
        html += '<div style="margin-top:10px;padding:10px 12px;background:rgba(65,118,230,.06);' +
          'border-radius:8px;font-size:12.5px">' +
          '<div style="margin-bottom:8px;color:var(--label-secondary)">' +
          '这道题系统没法自动判，你自己确认一下：</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-sm btn-secondary js-mark" data-qidx="' + i + '" data-status="correct">我做对了（' + p.fullScore + ' 分）</button>' +
          '<button class="btn btn-sm btn-secondary js-mark" data-qidx="' + i + '" data-status="partial-half">做对一半（' + Math.round(p.fullScore / 2) + ' 分）</button>' +
          '<button class="btn btn-sm btn-secondary js-mark" data-qidx="' + i + '" data-status="wrong">我做错了（0 分）</button>' +
          '</div></div>';
      }

      html += '</div>';
    });

    // 批量确认
    if (pending > 0) {
      html += '<div style="margin-top:14px;padding:12px;background:rgba(245,158,11,.08);border-radius:9px;font-size:13px">' +
        '<div style="margin-bottom:8px">还有 <b>' + pending + '</b> 题待确认。' +
        '确认完会把成绩计入记录，估分才会用上这次数据。</div>' +
        '<button class="btn btn-sm btn-primary" id="btn-confirm-all-pending">全部按我做对算</button>' +
        '</div>';
    }

    reviewEl.innerHTML = html;

    // ── 绑定改判 ──
    bindMarkButtons(reviewEl, result, detailId, reviewId);
  }

  /** 绑定改判按钮 */
  function bindMarkButtons(reviewEl, result, detailId, reviewId) {
    reviewEl.querySelectorAll('.js-mark').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var qi = parseInt(btn.getAttribute('data-qidx'), 10);
        var st = btn.getAttribute('data-status');
        var p = result.perQuestion[qi];
        if (!p) return;

        var full = p.fullScore;
        if (st === 'correct') { p.status = 'correct'; p.score = full; }
        else if (st === 'partial-half') { p.status = 'partial'; p.score = Math.round(full / 2); }
        else { p.status = 'wrong'; p.score = 0; }

        // 重算总分
        var total = 0, pcount = 0;
        result.perQuestion.forEach(function(x) {
          if (x.status === 'pending') pcount++;
          else total += x.score;
        });
        result.score = total;
        result.pendingCount = pcount;

        // 更新 quiz 对象
        quiz.perQuestion = result.perQuestion;
        quiz.score = result.score;
        quiz.pendingCount = pcount;

        // 重新渲染
        renderResult(result, detailId, reviewId);

        // 全部确认完 → 落库
        if (pcount === 0) saveConfirmedQuiz(result);
      });
    });

    var allBtn = document.getElementById('btn-confirm-all-pending');
    if (allBtn) {
      allBtn.addEventListener('click', function() {
        result.perQuestion.forEach(function(p) {
          if (p.status === 'pending') { p.status = 'correct'; p.score = p.fullScore; }
        });
        var total = 0;
        result.perQuestion.forEach(function(x) { total += x.score; });
        result.score = total;
        result.pendingCount = 0;
        quiz.perQuestion = result.perQuestion;
        quiz.score = result.score;
        quiz.pendingCount = 0;

        renderResult(result, detailId, reviewId);
        saveConfirmedQuiz(result);
      });
    }
  }

  /** 确认完 pending 后落库 */
  function saveConfirmedQuiz(result) {
    try {
      Storage.addRecord({
        type: 'quiz', source: 'AI出卷', subject: quiz.subject,
        score: result.score, fullScore: result.total, quizId: quiz.id,
        analysis: quiz.analysis || {},
        confirmed: true,
      });

      // 清掉暂存标记
      try { Storage.set('quiz_pending_' + quiz.id, null); } catch (e) {}

      // 补收错题（之前 pending 没进的）
      (result.perQuestion || []).forEach(function(p, i) {
        if (p.status === 'wrong' || p.status === 'partial') {
          var q = quiz.questions[i] || {};
          Storage.addMistake({
            subject: q.subject || quiz.subject,
            knowledge: q.knowledge || '未分类',
            question: p.text || q.text,
            correctAnswer: p.correctAnswer || q.answer,
            wrongAnswer: p.studentAnswer,
            explanation: q.explanation || '',
            quizId: quiz.id,
            type: p.type,
            gotScore: p.score,
            fullScore: p.fullScore,
          });
        }
      });

      Storage.addAct({ icon: '✅', title: '确认了' + quiz.subject + '测验的 ' +
        (result.perQuestion || []).length + ' 道题，成绩 ' + result.score + '/' + result.total });

      if (typeof Shell !== 'undefined' && Shell.toast) {
        Shell.toast('成绩已计入记录', 'success');
      }
    } catch (e) {
      console.error('[quiz] 落库失败:', e);
    }
  }

  function getQuiz() { return quiz; }

  return {
    generate: generate,
    render: render,
    grade: grade,
    renderResult: renderResult,
    selOpt: selOpt,
    saveFill: saveFill,
    saveAns: saveAns,
    getQuiz: getQuiz,
    stopTimer: stopTimer,
  };
})();
