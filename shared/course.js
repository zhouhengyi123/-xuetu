/**
 * 课程引擎 v1 —— 把「我想学 XX」变成一门可以一节一节学下去的课。
 *
 * 设计要点（与用户确认过的形态）：
 *   ① 先生成目录，学生确认后再逐节生成内容（快、可控、不会写完不用）
 *   ② 每节是**可视化的分页讲义**（像 PPT 一页页翻），不是一大段文字
 *   ③ 边学边问：任何一页都能打断提问，老师针对这一步重讲（引导式，不直接给答案）
 *   ④ 随堂练习判错 → 错因分类 → 同类巩固题
 *   ⑤ 学完算数：计时长、错题进本、参与高考预估
 *
 * 数据存在 localStorage（Storage.p / xt_courses），与错题本、学习时长打通。
 */
const CourseEngine = (() => {
  const KEY = 'courses';
  const KEY_ACTIVE = 'course_active';

  let cur = null;        // 当前打开的课程对象
  let view = null;       // 当前视图状态 { lessonIndex, pageIndex, mode }
  let listeners = [];    // 状态变化回调（UI 用）

  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
  function on(fn) { listeners.push(fn); }
  function off(fn) { listeners = listeners.filter(f => f !== fn); }

  // ══ 存储 ══
  function all() { return Storage.get(KEY, []) || []; }
  function saveAll(list) { Storage.set(KEY, list); }
  function getActiveId() { return Storage.get(KEY_ACTIVE, null); }
  function setActiveId(id) { Storage.set(KEY_ACTIVE, id); }

  function find(id) { return all().find(c => c.id === id) || null; }

  function upsert(course) {
    const list = all();
    const i = list.findIndex(c => c.id === course.id);
    if (i >= 0) list[i] = course; else list.push(course);
    saveAll(list);
    return course;
  }

  function remove(id) {
    saveAll(all().filter(c => c.id !== id));
    if (getActiveId() === id) setActiveId(null);
    if (cur && cur.id === id) { cur = null; view = null; }
    emit();
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ══ 建课：先生成目录 ══
  /**
   * 建一门课（只到目录）。返回 { id, title, outline:[...] }。
   * 内容按需生成：点开某一节时才调 courseLesson（省 token、也快）。
   */
  async function createCourse({ request, subject, grade, level, textbook, weakPoints }) {
    const r = await LLM.courseOutline({ request, subject, grade, level, textbook, weakPoints });
    const outline = (r.outline || []).map((o, i) => ({
      no: o.no != null ? o.no : i + 1,
      title: o.title || ('第 ' + (i + 1) + ' 节'),
      goal: o.goal || '',
      minutes: Number(o.minutes) || 15,
      points: Array.isArray(o.points) ? o.points : [],
      keyFormula: o.keyFormula || '',
      pages: null,          // 未生成
      done: false,
    }));
    if (!outline.length) throw new Error('没能生成目录，请把要学的内容说得再具体一点');

    const course = {
      id: uid(),
      createdAt: new Date().toISOString(),
      request: request,
      title: r.title || request,
      subject: r.subject || subject || '',
      grade: grade || '',
      summary: r.summary || '',
      outline: outline,
      activeLesson: 0,
      minutesSpent: 0,
      stats: { lessonsDone: 0, quizzes: 0, wrong: 0, asked: 0 },
    };
    upsert(course);
    cur = course; setActiveId(course.id);
    view = { lessonIndex: 0, pageIndex: 0, mode: 'list' };
    emit();

    /**
     * ★ 同步到 DeepTutor（2026-10-24）
     *
     * 异步、不阻塞、失败不影响主流程。
     * 成功的话把 DeepTutor 的 courseId 记下来，
     * 深度辅导那边就能看到同一门课。
     */
    try {
      if (typeof DTSync !== 'undefined' && DTSync.syncCourse) {
        DTSync.syncCourse(course).then(r => {
          if (r && r.courseId) {
            course.dtCourseId = r.courseId;
            upsert(course);
            console.log('[course] 已同步到 DeepTutor: ' + r.courseId);
          }
        }).catch(e => {
          console.log('[course] DeepTutor 同步失败（不影响使用）: ' + e.message);
        });
      }
    } catch (e) {}

    return course;
  }

  /**
   * ★ 把已存在的课程批量推到 DeepTutor（2026-10-24）
   *   用于"补同步"——之前生成的课程还没过去的。
   */
  async function syncAllToDeepTutor() {
    if (typeof DTSync === 'undefined' || !DTSync.syncCourse) {
      return { ok: false, error: 'DTSync 未加载' };
    }
    const list = all();
    let synced = 0, failed = 0;
    for (const c of list) {
      if (c.dtCourseId) continue;   // 已同步过
      try {
        const r = await DTSync.syncCourse(c);
        if (r && r.courseId) {
          c.dtCourseId = r.courseId;
          upsert(c);
          synced++;
        }
      } catch (e) {
        failed++;
      }
    }
    return { ok: true, synced, failed, total: list.length };
  }

  // ══ 载入某一节的页面（第一次访问才生成） ══
  async function loadLesson(lessonIndex, opts) {
    if (!cur) throw new Error('没有打开课程');
    const lesson = cur.outline[lessonIndex];
    if (!lesson) throw new Error('没有这一节');
    if (lesson.pages && !(opts && opts.force)) return lesson.pages;

    const r = await LLM.courseLesson({
      course: cur,
      lesson: lesson,
      studentNote: (opts && opts.studentNote) || '',
    });
    let pages = Array.isArray(r.pages) ? r.pages : [];
    pages = pages.filter(p => p && p.kind).map(p => normalizePage(p));
    if (!pages.length) throw new Error('这一节没生成出内容，重试一次或换个说法');

    // 一节至少要有一道练习；模型偶尔会漏，补一页占位由 UI 提示重生成
    if (!pages.some(p => p.kind === 'quiz')) {
      pages.push({ kind: 'quiz', title: '随堂练习', body: '这一节模型没给出练习，点「重出练习」补一道。', quiz: null, _missing: true });
    }
    lesson.pages = pages;
    upsert(cur);
    emit();
    return pages;
  }

  /** 规整一页：保证 UI 需要的字段都在，避免渲染时到处判空 */
  function normalizePage(p) {
    const q = p.quiz || null;
    return {
      kind: p.kind,
      title: p.title || '',
      body: p.body || '',
      bullets: Array.isArray(p.bullets) ? p.bullets.filter(Boolean) : [],
      formula: p.formula || '',
      formulaParts: Array.isArray(p.formulaParts) ? p.formulaParts.filter(x => x && (x.sym || x.mean)) : [],
      steps: Array.isArray(p.steps) ? p.steps.filter(Boolean) : [],
      compare: (p.compare && Array.isArray(p.compare.rows)) ? p.compare : null,
      chart: (p.chart && p.chart.type && p.chart.type !== 'none' && Array.isArray(p.chart.curves)) ? p.chart : null,
      example: (p.example && p.example.question) ? {
        question: p.example.question,
        solution: Array.isArray(p.example.solution) ? p.example.solution.filter(Boolean) : [],
        answer: p.example.answer || '',
        why: p.example.why || '',
      } : null,
      tip: p.tip || '',
      quiz: q && q.question ? {
        question: q.question,
        type: q.type === 'fill' ? 'fill' : 'choice',
        options: Array.isArray(q.options) ? q.options.filter(Boolean) : [],
        answer: q.answer == null ? '' : String(q.answer),
        explain: q.explain || '',
        pitfall: q.pitfall || '',
        // 运行时字段
        studentAnswer: null, graded: null, practice: null,
      } : null,
      _missing: !!p._missing,
    };
  }

  // ══ 学习进度 ══
  function open(id) {
    const c = find(id);
    if (!c) return null;
    cur = c; setActiveId(id);
    view = { lessonIndex: Math.min(c.activeLesson || 0, c.outline.length - 1), pageIndex: 0, mode: 'list' };
    emit();
    return c;
  }
  function close() { cur = null; view = null; setActiveId(null); emit(); }
  function current() { return cur; }
  function state() { return { course: cur, view: view }; }

  /**
   * 当前正在学的这一节 / 这一页。
   * ⚠️ 所有内部访问都要走这两个函数：课程可能已被 close() 或在别处被删掉，
   * 直接 `cur.outline[...]` 会在那种时刻抛 "Cannot read properties of null"。
   * 外部（app.js）也一样，取到 null 就回列表页。
   */
  function currentLesson() {
    if (!cur || !view) return null;
    return (cur.outline || [])[view.lessonIndex] || null;
  }
  function currentPage() {
    const lesson = currentLesson();
    if (!lesson || !lesson.pages) return null;
    return lesson.pages[view.pageIndex] || null;
  }

  function goto(lessonIndex, pageIndex) {
    if (!cur || !view) return false;
    const total = (cur.outline || []).length;
    if (lessonIndex < 0 || lessonIndex >= total) return false;
    view = { lessonIndex: lessonIndex, pageIndex: pageIndex || 0, mode: 'learn' };
    cur.activeLesson = lessonIndex;
    upsert(cur);
    emit();
    return true;
  }
  function nextPage() {
    if (!cur || !view) return false;
    const lesson = currentLesson();
    if (!lesson) return false;
    const n = (lesson.pages || []).length;
    if (view.pageIndex < n - 1) { view.pageIndex++; emit(); return true; }
    return nextLesson();
  }
  function prevPage() {
    if (!cur || !view) return false;
    if (view.pageIndex > 0) { view.pageIndex--; emit(); return true; }
    return false;
  }
  function nextLesson() {
    if (!cur || !view) return false;
    if (view.lessonIndex < cur.outline.length - 1) {
      view = { lessonIndex: view.lessonIndex + 1, pageIndex: 0, mode: 'learn' };
      cur.activeLesson = view.lessonIndex;
      upsert(cur); emit();
      return true;
    }
    return false;
  }

  // ══ 互动：就当前页提问 ══
  async function ask(question) {
    const lesson = currentLesson();
    if (!lesson) throw new Error('没有打开的课程');
    const page = currentPage() || {};
    const history = (page._askHistory = page._askHistory || []);
    history.push({ role: 'user', content: question });
    const r = await LLM.courseAsk({ course: cur, lesson: lesson, page: page, question: question, history: history });
    history.push({ role: 'ai', content: r.reply });
    if (!lesson.asks) lesson.asks = [];
    lesson.asks.push({ page: view.pageIndex, q: question, a: r.reply, at: Date.now() });
    cur.stats.asked = (cur.stats.asked || 0) + 1;
    upsert(cur);
    emit();
    return r.reply;
  }
  function askHistory() {
    const lesson = currentLesson();
    if (!lesson) return [];
    const page = currentPage() || {};
    return page._askHistory || [];
  }

  // ══ 练习：作答 → 判分 → 出同类题 ══
  async function submitQuiz(answer) {
    const lesson = currentLesson();
    if (!lesson) throw new Error('没有打开的课程');
    const page = currentPage();
    if (!page || !page.quiz) throw new Error('这一页没有练习');
    const quiz = page.quiz;
    quiz.studentAnswer = answer;

    const g = await LLM.courseGrade({ course: cur, lesson: lesson, quiz: quiz, studentAnswer: answer });
    quiz.graded = {
      correct: !!g.correct,
      score: Number(g.score) || (g.correct ? 100 : 0),
      reason: g.reason || '',
      comment: g.comment || '',
      keyStep: g.keyStep || '',
      nextTip: g.nextTip || '',
    };
    cur.stats.quizzes = (cur.stats.quizzes || 0) + 1;
    if (!quiz.graded.correct) {
      cur.stats.wrong = (cur.stats.wrong || 0) + 1;
      // ★ 打通错题本：错题立刻进本（带科目、知识点、错因）
      try {
        Storage.addMistake({
          subject: cur.subject || '综合',
          knowledge: (lesson.points && lesson.points[0]) || lesson.title || '未分类',
          question: quiz.question,
          correctAnswer: quiz.answer,
          wrongAnswer: String(answer == null ? '' : answer),
          explanation: quiz.explain || quiz.graded.comment || '',
          reason: quiz.graded.reason || '',
          type: 'course',
          courseId: cur.id,
          lessonTitle: lesson.title,
        });
      } catch (e) { /* 错题本失败不影响学习 */ }
    }
    upsert(cur);
    emit();
    return quiz.graded;
  }

  /** 出同类巩固题（答错后调用） */
  async function practice(count) {
    const lesson = currentLesson();
    if (!lesson) throw new Error('没有打开的课程');
    const page = currentPage();
    if (!page || !page.quiz) throw new Error('这一页没有练习');
    const quiz = page.quiz;
    const r = await LLM.coursePractice({
      course: cur, lesson: lesson, quiz: quiz,
      reason: (quiz.graded && quiz.graded.reason) || '',
      count: count || 3,
    });
    const items = (r.items || []).filter(x => x && x.question).map(x => ({
      question: x.question,
      type: x.type === 'fill' ? 'fill' : 'choice',
      options: Array.isArray(x.options) ? x.options : [],
      answer: x.answer == null ? '' : String(x.answer),
      explain: x.explain || '',
      focus: x.focus || '',
      submitted: null,
      result: null,
    }));
    quiz.practice = items;
    upsert(cur);
    emit();
    return items;
  }

  /** 判巩固题（本地比对，不额外调模型；无法判定时交给模型） */
  async function submitPractice(index, answer) {
    const lesson = currentLesson();
    if (!lesson) throw new Error('没有打开的课程');
    const page = currentPage();
    const item = page && page.quiz && page.quiz.practice && page.quiz.practice[index];
    if (!item) throw new Error('没有这道巩固题');
    item.submitted = String(answer == null ? '' : answer);

    const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
    const a = norm(item.answer), b = norm(item.submitted);
    let ok = a && (a === b || (a.length === 1 && a === b) || a.startsWith(b) && b.length >= 1);
    // 字母选项：学生可能填"A"而答案是"A.xxx"，做包含判断
    if (!ok && item.options.length && item.answer.length > 1) {
      const letter = b.toUpperCase().slice(0, 1);
      if (letter && /^[A-D]$/.test(letter) && norm(item.answer).startsWith(letter.toLowerCase())) ok = true;
    }
    // 含中文字符串的模糊匹配交给模型判断更稳
    if (!ok && /[\u4e00-\u9fff]/.test(item.answer) && b && a.includes(b)) ok = true;

    item.result = { correct: !!ok, correctAnswer: item.answer };
    if (!ok) {
      cur.stats.wrong = (cur.stats.wrong || 0) + 1;
      try {
        Storage.addMistake({
          subject: cur.subject || '综合',
          knowledge: item.focus || lesson.title || '未分类',
          question: item.question,
          correctAnswer: item.answer,
          wrongAnswer: item.submitted,
          explanation: item.explain || '',
          reason: '同类巩固题答错',
          type: 'course-practice',
          courseId: cur.id,
        });
      } catch (e) {}
    } else {
      cur.stats.quizzes = (cur.stats.quizzes || 0) + 1;
    }
    upsert(cur);
    emit();
    return item.result;
  }

  // ══ 学完一节：小结 + 记录 + 打通学习时长/进度 ══
  async function finishLesson(lessonIndex) {
    // ★ 记入事件流（2026-10-31）
    try {
      if (typeof Memory !== 'undefined') {
        Memory.addEvent('lesson', { courseId: (state.course && state.course.id) || '' });
      }
    } catch (e) {}

    if (!cur) throw new Error('没有打开课程');
    const lesson = cur.outline[lessonIndex];
    if (!lesson) throw new Error('没有这一节');

    // ★ 课程记录一课一记录（2026-10-25）
    // 每次完成一节课，都要记录下来，方便回顾
    const record = {
      courseId: cur.id,
      courseTitle: cur.title,
      subject: cur.subject,
      lessonIndex: lessonIndex,
      lessonTitle: lesson.title,
      goal: lesson.goal,
      minutes: lesson.minutes,
      finishedAt: new Date().toISOString(),
      reviewed: false,  // 是否复习过
    };

    // 存到课程的完成记录
    if (!cur.lessonRecords) cur.lessonRecords = [];
    cur.lessonRecords.push(record);

    // 更新课程状态
    lesson.done = true;
    cur.stats.lessonsDone = (cur.stats.lessonsDone || 0) + 1;
    cur.minutesSpent = (cur.minutesSpent || 0) + (lesson.minutes || 0);

    upsert(cur);
    emit();

    return record;
  }

  // ══ 统计（给 UI 用） ══
  function progress() {
    if (!cur) return { lessons: 0, done: 0, pages: 0, read: 0, pct: 0, minutes: 0, quizzes: 0, wrong: 0, asked: 0 };
    const outline = cur.outline || [];
    const done = outline.filter(l => l.done).length;
    const total = outline.length;
    return {
      lessons: total,
      done: done,
      pct: total ? Math.round(done / total * 100) : 0,
      minutes: cur.minutesSpent || 0,
      quizzes: (cur.stats && cur.stats.quizzes) || 0,
      wrong: (cur.stats && cur.stats.wrong) || 0,
      asked: (cur.stats && cur.stats.asked) || 0,
    };
  }

  function list() {
    return all().map(c => ({
      id: c.id, title: c.title, subject: c.subject, summary: c.summary,
      createdAt: c.createdAt, minutesSpent: c.minutesSpent || 0,
      lessons: c.outline.length,
      done: c.outline.filter(l => l.done).length,
      pct: c.outline.length ? Math.round(c.outline.filter(l => l.done).length / c.outline.length * 100) : 0,
    })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  /** 从拍照读题/上传的题目**直接建课**（豆包爱学那条"拍题 → 讲解"路径） */
  async function createFromProblem({ question, subject, studentAnswer, correctAnswer, knowledge }) {
    const req = '这道题我不会，请围绕它给我讲清楚：\n'
      + question
      + (knowledge ? '\n（涉及知识点：' + knowledge + '）' : '')
      + (studentAnswer ? '\n我当时答的是：' + studentAnswer : '')
      + (correctAnswer ? '\n正确答案是：' + correctAnswer : '');
    return await createCourse({ request: req, subject: subject });
  }

  return {
    on, off, emit,
    // 建课
    createCourse, createFromProblem, loadLesson,
    // ★ DeepTutor 同步（2026-10-24）
    syncAllToDeepTutor,
    // 课程管理
    list, open, close, current, state, remove, find,
    // 学习
    goto, nextPage, prevPage, nextLesson, progress,
    currentLesson, currentPage,
    // 互动
    ask, askHistory, submitQuiz, practice, submitPractice, finishLesson,
    // 给 UI 的纯渲染辅助
    normalizePage,
  };
})();
