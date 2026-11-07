/**
 * 学徒 · AI 学习系统 — 应用层 v0.5
 *
 * 设计原则：
 *  1) 所有"分析"都调用大模型（问卷、识别试卷、批改、规划、估算、薄弱点、总分预估）
 *  2) 所有模块共用同一份 AI 记忆（Storage.getMemory），对话里人格始终是一个老师
 *  3) 分数一律保留小数点后五位：Math.round(x*100000)/100000 或 .toFixed(5)
 */
const App = (() => {

  // ════════════════════════════════════════════════════════════
  //  基础工具（★ 2026-10-17 已抽到 js/util-core.js，这里只做别名）
  //
  //  拆分理由：app.js 原来 5300+ 行，工具函数和 11 个页面的渲染混在一起，
  //  改任何一处都要在 5000 行里翻。这些是纯函数，没有内部状态依赖，
  //  是最安全的拆分起点。
  //
  //  ★ 关键：这里用 const 别名保留**原来的函数名**，
  //    所以下面 5000 行里所有 esc()/fmtDate()/compressImage() 调用**一行都不用改**。
  // ════════════════════════════════════════════════════════════
  const {
    round5, fx5, Type,
    esc, $, on,
    fmtDate, fmtAgo, srcLabel,
    prefersStill, countTo,
    parseJSON,
    cleanBox, boxIoU, cleanQuestions, normalizeVision, jsonFailHTML,
    fileToDataURL, compressImage,
  } = U;

  // ════════════════════════════════════════════════════════════
  //  Toast
  // ════════════════════════════════════════════════════════════
  function toast(msg, type) {
    const wrap = $('toast-wrap');
    if (!wrap) { console.log('[toast]', msg); return; }

    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }, type === 'error' ? 5200 : 2600);
  }

  // ★ 暴露 toast / unlockStatus 到全局（2026-10-31 修）
  //   之前 window.unlockStatus 被误插进 toast 函数体内（死代码），
  //   aptitude-ui.js 等模块也依赖 toast —— const/function 不挂 window，
  //   外部脚本拿不到，这里统一挂出来。
  try { window.toast = toast; } catch (e) {}
  try { window.unlockStatus = unlockStatus; } catch (e) {}

  // ════════════════════════════════════════════════════════════
  //  AI 记忆 —— 全局唯一，所有模块共用
  // ════════════════════════════════════════════════════════════
  function remember(role, content, tag) {
    if (!content) return;
    Storage.pushMemory(role, String(content), tag);
    updateMemoryUI();
  }

  /** 六门科目：语数英 + 选考三门 */
  /**
   * WorkBuddy 是否可用作"模型通道"。
   * ★ 这是"没配 API Key 也能用"的唯一判断入口 ——
   *   之前 13 处校验都是硬性要求 cfg.apiKey，导致启用 WorkBuddy 后仍然被拦。
   */
  function wbReady() {
    try {
      return typeof WB !== 'undefined' && WB.available() && WB.isEnabled();
    } catch (e) { return false; }
  }

  function allSixSubjects() {
    /**
     * ★ 去掉语文出卷（2026-10-25）
     *
     * 用户明确要求："去掉语文无意义的出卷，去掉语文这一门科"
     *
     * 语文出卷意义不大：
     *   · 阅读理解、作文没法客观判分
     *   · 基础题（字词、病句）靠积累，刷题效果差
     *   · 高考语文更看重阅读量和写作，不是刷题能提高的
     *
     * 现在只保留数学、英语、选考科目。
     */
    const g = Storage.getGoal();
    return ['数学', '英语'].concat(g.selectedSubjects || []);
  }

  /** 一个"人"的角色设定：把学生的全部已知信息拼成系统提示 */
  function persona() {
    const g = Storage.getGoal();
    const d = Storage.get('setup_data', null) || {};
    const L = [];
    L.push('你是「学徒」，一名从摸底到高考全程跟着这位学生的老师，同时兼班主任。');
    L.push('你在问卷分析、出卷、批改、学习规划、成绩估算、答疑里都是同一个人：');
    L.push('你记得他定过的目标、说过的困难、犯过的错。');
    L.push('风格要求：直接、具体、不安慰式空话；指出问题必须给出下一步可执行的动作。');
    L.push('');
    L.push('【学生档案】');
    L.push('- 地区：' + (d.city || g.city || '未填'));
    L.push('- 年级：' + (d.grade || g.grade || '高中'));
    L.push('- 选科：语文、数学、英语 + ' + allSixSubjects().slice(3).join('、'));
    L.push('- 最近一次月考总分：' + (d.examScore != null && d.examScore !== '' ? d.examScore : '未知'));
    L.push('- 月考时间：' + (d.examDate || '未填'));
    L.push('- 下次月考：' + (d.nextExam || '未填'));
    L.push('- 高考日期：' + (g.examDate || '未填') + '（还剩 ' + daysToExam() + ' 天）');
    L.push('- 每日可用学习时间：' + (d.hours || g.hours || '未知') + ' 小时');
    L.push('- 目标：' + (d.targetSchool || '未定') + ' / ' + (g.target || '--') + ' 分');
    if (d.focuses && d.focuses.length) L.push('- 想提升的方面：' + d.focuses.join('、'));

    /**
     * ★ 2026-11-07：考试制度注入
     *
     * 原来 persona() 写死「高考」「人教版」「赋分」「距高考 N 天」。
     * 日韩用户切换 region 后，所有 AI（问答/出题/规划/估分）必须知道
     * 当前是共通テスト / 수능，不能拿中国高考框架回答。
     * 中国 region 返回空串 → 行为与原来完全一致。
     */
    try {
      if (typeof Region !== 'undefined') {
        const rb = Region.promptBlock();
        if (rb) { L.push(''); L.push(rb); }
      }
    } catch (e) {}

    // 教材进度：让所有模块（答疑/规划/出题/估算）都知道他学到哪儿了
    const tb = Storage.textbookDigest(allSixSubjects());
    if (tb) {
      L.push('');
      L.push('【教材进度（他目前学到哪了）】');
      L.push(tb);
      L.push('涉及具体章节时，只讲这个范围内、或紧接着要学的内容；别拿高三下学期的知识去讲他现在的问题。');
    }
    if (d.report) L.push('- 你上次给他的整体结论（摘要）：' + String(d.report).slice(0, 500));

    const sa = Storage.getSubjectAnalyses();
    const keys = Object.keys(sa);
    if (keys.length) {
      L.push('');
      L.push('【已完成的单科分析】');
      keys.forEach(k => {
        const a = sa[k] || {};
        L.push('- ' + k + '：' + String(a.summary || a.analysis || '').slice(0, 200));
      });
    }
    // ★ 并入共享学生档案（2026-10-31）
    // StudentProfile 是所有 AI 的唯一事实来源：
    // 知识点覆盖、试卷概况、错题复习状态、AI 学到的事实、下次考试推算。
    // 写在这里 → 快速问答/出卷/规划/答疑全都看得到同一份记忆。
    try {
      if (typeof StudentProfile !== 'undefined') {
        L.push('');
        L.push('【共享学生档案（所有 AI 实时同步）】');
        const pf = StudentProfile.profile();
        if (pf.papers > 0) {
          L.push('- 试卷证据：');
          Object.keys(pf.perSubject).forEach(sub => {
            L.push('    · ' + sub + ' ' + pf.perSubject[sub].papers + ' 份，平均得分率 ' + pf.perSubject[sub].avgRate + '%');
          });
        } else {
          L.push('- 试卷证据：还没有（不要假设任何单科水平）');
        }
        const covKeys = Object.keys(pf.knowledgeCovered);
        if (covKeys.length) {
          L.push('- 已学知识点：');
          covKeys.forEach(sub => {
            const ks = pf.knowledgeCovered[sub];
            if (ks && ks.length) L.push('    · ' + sub + '：' + ks.slice(0, 10).join('、'));
          });
        } else {
          L.push('- 已学知识点：未登记（不要假设他学过什么，讲到新知识先问一句）');
        }
        if (pf.mistakes > 0) {
          let st = null;
          try { st = (typeof Review !== 'undefined') ? Review.stats() : null; } catch (e) {}
          L.push('- 错题 ' + pf.mistakes + ' 道' + (st ? '（待复习 ' + st.due + ' · 复习中 ' + st.learning + ' · 已掌握 ' + st.mastered + '）' : ''));
        }
        if (pf.hasAptitude) L.push('- 推理测验百分位约 ' + pf.aptitudePercentile + '%（短测参考）');
        const factKeys = Object.keys(pf.facts || {});
        if (factKeys.length) {
          L.push('- 你记住的关于他的事实：');
          factKeys.slice(0, 10).forEach(k => {
            L.push('    · ' + ((pf.facts[k] || {}).text || k));
          });
        }
        const ne = StudentProfile.nextExamInfo();
        if (ne) L.push('- 下次考试：' + ne.date + '（' + ne.kind + '，约 ' + ne.daysLeft + ' 天后）—— 谈计划时以此为节点');
      }
    } catch (e) { console.warn('[persona] 档案层并人失败:', e); }

    const recent = Storage.getRecords().slice(-8);
    if (recent.length) {
      L.push('');
      L.push('【最近成绩】');
      recent.forEach(r => L.push('- ' + fmtDate(r.date) + ' ' + r.subject + ' ' + r.score + '/' + r.fullScore + '（' + srcLabel(r.source) + '）'));
    }
    
    // ★ 对话记忆（2026-10-31）：让快速问答也知道刚聊过什么
    try {
      if (typeof Memory !== 'undefined') {
        const turns = Memory.getTurns().slice(-4);
        if (turns.length) {
          L.push('');
          L.push('【刚才聊过】');
          turns.forEach(function(t) {
            L.push((t.by === 'student' ? '学生' : '你') + '：' + String(t.text || '').slice(0, 60));
          });
          L.push('（别重复问已经答过的，接着往下说）');
        }
      }
    } catch (e) {}

    /**
     * ★ 教学经验库（2026-11-01）
     *
     * 前面几段都是「这个学生是谁」，这段是「老师自己积累的教学知识」。
     * 用户导入的教学经验 / 知识点 / 易错陷阱 / 解题方法都在这里，
     * 由 Teaching.promptBlock 按科目 + 关键词检索后注入，命中才占 token。
     *
     * 挂在这里而不是每个 AI 里各写一遍：
     * persona() 是 LLM.setPersona 的唯一来源，改一处，
     * 快速问答 / 出卷 / 批改 / 规划 / 估算 / 答疑 全部生效。
     */
    try {
      if (typeof Teaching !== 'undefined') {
        const subjects = allSixSubjects();
        // 没给具体问题（比如出卷、规划），就退化成「各科的高重要度经验」
        const q = String((typeof window !== 'undefined' && window.__teachQuery) || '') || subjects.join(' ') + ' 常见错误 解题方法';
        const sub = (typeof window !== 'undefined' && window.__teachSubject) || '';
        const blk = Teaching.promptBlock(q, { subject: sub });
        if (blk) {
          L.push('');
          L.push(blk);
        }
      }
    } catch (e) { console.warn('[persona] 教学经验库注入失败:', e); }

    return L.join('\n');
  }

  /** 把记忆压成一段摘要，跟着人格一起进 system */
  function memoryDigest(limit, chars) {
    const mem = Storage.getMemory().filter(m => m.role === 'user' || m.role === 'ai').slice(-(limit || 10));
    if (!mem.length) return '';
    return '【你记得的事（按时间顺序，越靠后越新）】\n' + mem.map(m =>
      (m.role === 'ai' ? '你当时说：' : '他当时说：') + String(m.content).slice(0, chars || 300).replace(/\s+/g, ' ')
    ).join('\n');
  }

  /**
   * 统一的模型调用入口。
   * 人格 + 共享记忆由 LLM.setPersona 在 chat() 里统一注入，
   * 所以这里只需要给出本次的输入即可。
   * @param {string|Array} userInput  文本，或 OpenAI 格式的 content 数组（带图片）
   */
  async function ask(userInput, opts) {
    opts = opts || {};
    /**
     * ★ 把「这次要问什么」告诉 persona()，让教学经验库检索得准（2026-11-01）
     *
     * persona() 是全局共享的 system 拼装器，它不知道这次调用的具体问题。
     * 这里先把问题写进窗口变量，LLM.chat 内部取 persona 时就能按关键词检索，
     * 调完立即还原，避免影响别的调用。
     */
    const prevQ = window.__teachQuery;
    const prevS = window.__teachSubject;
    try {
      if (typeof userInput === 'string') window.__teachQuery = userInput.slice(0, 400);
      else if (Array.isArray(userInput)) {
        const t = userInput.filter(p => p && p.type === 'text').map(p => p.text).join(' ');
        if (t) window.__teachQuery = t.slice(0, 400);
      }
      if (opts.subject) window.__teachSubject = opts.subject;
    } catch (e) {}

    try {
      // ★ 2026-11-07：思考强度（设置页可配，默认 standard）
      let effort = opts.reasoningEffort;
      if (!effort) {
        try { effort = Storage.get('reasoning_effort', 'standard'); } catch (e) { effort = 'standard'; }
      }
      return await LLM.chat([{ role: 'user', content: userInput }], {
        maxTokens: opts.maxTokens || 2500,
        temperature: opts.temperature,
        noPersona: opts.noPersona,
        // ★ 模型透传：AI 助教页选了这个模型就用它（undefined = 自动路由）
        model: opts.model || undefined,
        reasoningEffort: effort,
      });
    } finally {
      try {
        window.__teachQuery = prevQ;
        window.__teachSubject = prevS;
      } catch (e) {}
    }
  }

  /** 要 JSON 的调用（自动补提示 + 稳健解析） */
  async function askJSON(prompt, opts) {
    opts = opts || {};
    const text = await ask(prompt + '\n\n只返回一个 JSON 对象，不要 Markdown 代码块，不要额外解释。', opts);
    return parseJSON(text);
  }

  // ════════════════════════════════════════════════════════════
  //  导航
  // ════════════════════════════════════════════════════════════
  const PAGE_META = {
    dashboard: { title: '总览', sub: '今天该做什么，一眼看完' },
    planner: { title: '学习规划', sub: 'AI 按你的薄弱点排每天的任务' },
    quiz: { title: 'AI 出卷', sub: '按需出题、当场批改、估算提分' },
    chat: { title: 'AI 辅导', sub: '同一个老师的连续记忆' },
    photo: { title: '拍照读题', sub: '手机拍照 → 电脑上传 → AI 抄题判错' },
    camera: { title: '学习监控', sub: '本地摄像头判断专注度' },
    progress: { title: '进度追踪', sub: '高考预估与提分曲线' },
    weakness: { title: '薄弱点', sub: 'AI 归纳的易错知识点' },
    import: { title: '导入试卷', sub: '上传试卷，每科满 5 份做独立分析' },
    teach: { title: '教学资料', sub: '导入你自己的经验与知识点，AI 按需检索使用' },
    lesson: { title: '一节课', sub: '诊断 → 分步例题 → 出门测 → 一句话复盘' },
    course: { title: '生成课程', sub: '说想学什么 → 生成课 → 一节一节学，随时可打断提问' },
    settings: { title: '设置', sub: '模型接口、记忆与数据' },
  };

  function setSidebarOpen(open) {
    const sb = $('sidebar'), backdrop = $('sidebar-backdrop'), menu = $('menu-btn');
    if (sb) sb.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('open', open);
    if (menu) menu.setAttribute('aria-expanded', String(open));
  }

  /**
   * 侧栏选中胶囊：用绝对定位的指示条滑到当前项（比瞬间切换自然得多）。
   * 位置用 offsetTop/offsetHeight 算，不依赖 getBoundingClientRect，
   * 这样即便侧栏带 padding / 滚动也准。
   */
  function moveNavIndicator(activeEl) {
    const ind = $('nav-indicator');
    const body = document.querySelector('.sidebar-body');
    if (!ind || !body || !activeEl) return;
    const top = activeEl.offsetTop, h = activeEl.offsetHeight;
    if (!h) { ind.style.opacity = '0'; return; }
    ind.style.height = h + 'px';
    ind.style.transform = 'translateY(' + top + 'px)';
    ind.style.opacity = '1';
  }

  /**
   * 页面入场动效。
   * 为什么不用 CSS class 切换：在同一个任务里 remove + add，浏览器只会看到"最终状态没变"，
   * 于是不重启动画（实测 getAnimations() 为空、两次截图 md5 完全相同 → 动画其实没播）。
   * Web Animations API 每次都真正新建一个动画，所以在列表里必然生效。
   */
  function playEnter(pageId) {
    const content = $('content');
    if (!content) return;
    const page = $('page-' + pageId);
    if (!page) return;
    if (prefersStill()) return;                  // 尊重"减少动态效果"

    // 清掉上一轮的动画，避免快速连点时叠一堆
    if (page._enterAnims) page._enterAnims.forEach(a => { try { a.cancel(); } catch (e) {} });
    const anims = [];

    /*
     * ★ 不要给 .page 本体加 transform 动画！
     *   带 transform / filter / contain 的祖先会成为 position:fixed 的**包含块**，
     *   摄像头页那个"走神警告"是全屏 fixed 遮罩，一旦它的祖先 .page 有 transform，
     *   遮罩就从铺满视口缩成只盖住这一页（实测 1404×857 → 1092×682）。
     *   所以入场动效只做**透明度**（不做位移），位移/缩放全部交给卡片去做 ——
     *   卡片是叶子节点，带 transform 不影响任何后代定位。
     */
    anims.push(page.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 260, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'backwards' }
    ));

    /*
     * ★ 卡片入场：用 translate/scale **属性** 而不是 transform **属性值**。
     *
     * 为什么：transform（含 Web Animations 的 fill:both 残留）会让元素成为
     * position:fixed 的**包含块**。摄像头页的"走神警告"是全屏 fixed 遮罩，
     * 只要它任何一个祖先（卡片 → .page → #content）带着 transform，
     * 遮罩就会被关进那个祖先的盒子里（实测 1404×857 全屏 → 1092×682 只剩卡片）。
     *
     * translate / scale 这两个独立属性**不会**创建包含块，视觉位移效果一样，
     * 但不会破坏后代的 fixed 定位。这是这次能找到的最干净的做法。
     */
    const cards = page.querySelectorAll(':scope > .card, :scope > .grid-2 > .card, :scope > .grid-3 > .card, :scope > .grid-4 > .card');
    cards.forEach((card, i) => {
      anims.push(card.animate(
        [
          { opacity: 0, translate: '0 26px', scale: '.982' },
          { opacity: 1, translate: '0 0', scale: '1' }
        ],
        // fill 只在前向生效（backwards），保证延迟期间卡片是"未入场"的样子；
        // 结束后不保留（不写 forwards），元素自然回到样式表定义的终态，无需 cancel。
        { duration: 520, delay: Math.min(i * 70, 350), easing: 'cubic-bezier(.16,.84,.36,1)', fill: 'backwards' }
      ));
    });

    page._enterAnims = anims;
    // 动画结束后 cancel 掉（fill:both 只是为了让动画期间保持首帧，
    // 结束后必须清干净，免得残留的 opacity/translate 影响后续状态）
    const total = 520 + Math.min(Math.max(cards.length - 1, 0) * 70, 350);
    clearTimeout(page._enterTimer);
    page._enterTimer = setTimeout(() => {
      anims.forEach(a => { try { a.cancel(); } catch (e) {} });
      page._enterAnims = null;
    }, total + 60);
  }

  function navigate(pageId) {
    if (!PAGE_META[pageId] || !$('page-' + pageId)) return;
    let activeEl = null;
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === pageId);
      if (el.dataset.page === pageId) { el.setAttribute('aria-current', 'page'); activeEl = el; }
      else el.removeAttribute('aria-current');
    });
    document.querySelectorAll('.page').forEach(el => {
      el.classList.toggle('active', el.id === 'page-' + pageId);
    });
    const meta = PAGE_META[pageId] || { title: pageId, sub: '' };
    $('page-title').textContent = meta.title;
    $('page-sub').textContent = meta.sub;
    setSidebarOpen(false);
    $('content').scrollTop = 0;
    moveNavIndicator(activeEl);
    render(pageId);
    playEnter(pageId);
  }

  function render(pageId) {
    const fn = {
      dashboard: renderDashboard, planner: renderPlanner, quiz: renderQuiz,
      chat: renderChat, photo: renderPhoto, camera: renderCamera,
      progress: renderProgress, weakness: renderWeakness, import: renderImport,
      settings: renderSettings, course: renderCourse,
      teach: renderTeaching, lesson: renderLesson,
    }[pageId];
    if (fn) { try { fn(); } catch (e) { console.error('render ' + pageId + ' 失败', e); } }
    updateBadges();
  }

  /** 一节课（分步辅导）2026-11-07：逻辑在 web/js/lesson-ui.js */
  function renderLesson() {
    try {
      if (typeof LessonUI !== 'undefined' && LessonUI.mount) LessonUI.mount();
      else if ($('lesson-body')) $('lesson-body').innerHTML = '<div class="empty">分步辅导模块未加载</div>';
    } catch (e) {
      if ($('lesson-body')) $('lesson-body').innerHTML = '<div class="empty">分步辅导加载失败：' + esc(e.message) + '</div>';
    }
  }

  /** 教学资料页（2026-11-01）：逻辑在 web/js/teaching-ui.js */
  function renderTeaching() {
    try {
      if (typeof TeachingUI !== 'undefined' && TeachingUI.mount) TeachingUI.mount();
    } catch (e) { console.warn('[teach] 渲染失败:', e); }
  }

  // ════════════════════════════════════════════════════════════
  //  公共数据
  // ════════════════════════════════════════════════════════════
  function daysToExam() {
    /**
     * ★ 没设高考日期时返回 null（2026-10-31）
     * 旧版默认算成 0 天（"0 天后高考"），误导第一次打开的用户。
     */
    try {
      const g = Storage.getGoal();
      const d = g.examDate || (g.examYear ? g.examYear + '-06-07' : null);
      if (!d) return null;
      const days = Math.ceil((new Date(d) - new Date()) / 86400000);
      return isFinite(days) ? Math.max(0, days) : null;
    } catch (e) { return null; }
  }

  /** 起点分：问卷里填的"最近一次月考总分" */
  function baselineScore() {
    /**
     * ★ 没填过问卷时返回 null（2026-10-31）
     * 旧版直接返回 goal.current（默认 450），用户以为是自己的真实分数。
     */
    const g = Storage.getGoal();
    // examScore 默认是 0，只有真填过问卷才 > 0
    if (!g || Number(g.examScore) <= 0) return null;
    return g.current || g.examScore || null;
  }

  /**
   * ★ 估分门槛改成 AI 判断（2026-10-25）
   *
   * 用户明确要求："让 AI 自己判断是否有能力估算"，而不是固定 5 份。
   *
   * 现在改成动态判断：
   *   · 有 1 份卷子就能估算（给区间）
   *   · 卷子越多，区间越窄
   *   · AI 根据数据质量决定是否给出具体数字
   *
   * 保留 PAPERS_PER_SUBJECT 作为"高置信度"的参考值。
   */
  const PAPERS_PER_SUBJECT = 1;   // 最少 1 份就能估算（AI 判断置信度）

  /**
   * 预测解锁状态：**每科都攒够 5 份试卷**才解锁高考成绩预估。
   * 数据不够时绝不展示预测分数（这是用户明确要求的）。
   */
  function unlockStatus() {
    /**
     * ★ 解锁条件改为 AI 就绪度判断（2026-10-31）
     *
     * 旧版：每科满 PAPERS_PER_SUBJECT 份且全部分析完 → ready
     *       一份联考（题量大、难度准）也算不够，明显不合理。
     *
     * 新版：交给 EvidenceEngine —— 整体就绪度（信息增益）达标即 ready。
     *       一份高质量卷可能就够，五份简单练习也可能不够。
     *       引擎不可用时退回"任一科有卷子"的宽松判定，绝不因引擎
     *       异常把用户锁死在门外（这是之前反复被骂的点）。
     */
    const subs = allSixSubjects();
    const analyses = Storage.getSubjectAnalyses();
    const rows = subs.map(s => {
      const n = Storage.countPapers(s);
      return {
        subject: s,
        count: n,
        need: 1,   // 展示层不再强调"还差几份"，仅作参考
        paperReady: n >= 1,
        analyzed: !!analyses[s],
      };
    });
    const papersDone = rows.filter(r => r.paperReady).length;
    const analyzedDone = rows.filter(r => r.analyzed).length;

    let ready = false;
    let readiness = 0;
    try {
      const r = EvidenceEngine.estimateAll({
        goal: Storage.getGoal(),
        papers: Storage.getPapers(),
        lessons: Storage.getLessons ? Storage.getLessons() : [],
        quizzes: (Storage.getQuizStats && Storage.getQuizStats()) || [],
        aptitude: Storage.getAptitude ? Storage.getAptitude() : null,
      });
      if (r) {
        readiness = r.overallProgress != null ? r.overallProgress : 0;
        ready = r.allReady === true;
      }
    } catch (e) {
      // 引擎挂了：任一科有卷子就放行（宁可给区间，也不锁门）
      ready = papersDone > 0;
    }

    return {
      rows: rows,
      papersDone: papersDone,
      analyzedDone: analyzedDone,
      total: subs.length,
      readiness: readiness,
      ready: ready,
    };
  }

  /** 当前预估（现在 + 高考时两个数字；六科不齐时均为 null） */
  /**
   * 存进估算记录的 evidence 要带上**难度推断**，否则进度页的
   * "卷面 × 难度修正 × 折算 → 高考等效" 永远显示不出来。
   */
  function storeEvidence(ev) {
    return (ev || []).map(e => ({
      subject: e.subject, nPapers: e.nPapers, nQuestions: e.nQuestions,
      nCorrect: e.nCorrect, nWrong: e.nWrong,
      pooledRatio: e.pooledRatio, paperRatio: e.paperRatio,
      rawRatio: e.rawRatio, difficultyFactor: e.difficultyFactor, ratio: e.ratio,
      difficultyLevel: e.difficultyLevel, difficultyAdj: e.difficultyAdj,
      difficultyNote: e.difficultyNote, difficultyPapers: e.difficultyPapers,
      // ★ 高分段收敛的痕迹也要存档，否则刷新后依据列显示不出来（踩过这个坑）
      taperedPapers: e.taperedPapers, taperNote: e.taperNote,
      // ★ P3/P4 字段同样要存档
      displayMax: e.displayMax, gradeAssigned: e.gradeAssigned,
      gradeScore: e.gradeScore, gradeLow: e.gradeLow, gradeHigh: e.gradeHigh,
      gradeNote: e.gradeNote, seNow: e.seNow,
      coverage: e.coverage, coverageLearned: e.coverageLearned, coverageTotal: e.coverageTotal,
      coverageMatched: e.coverageMatched, coverageExact: e.coverageExact, coverageSource: e.coverageSource,
      ratioWithCoverage: e.ratioWithCoverage,
      trend: e.trend, confidence: e.confidence,
    }));
  }

  function currentEstimate() {
    const goal = Storage.getGoal();
    const stored = Storage.getTotalEstimate();
    if (stored && stored.total != null && isFinite(Number(stored.total))) {
      return {
        total: Number(stored.total),
        projected: (stored.projected != null && isFinite(Number(stored.projected))) ? Number(stored.projected) : null,
        subjectScores: stored.subjectScores || {},
        subjectProjected: stored.subjectProjected || {},
        covered: stored.covered || [], missing: stored.missing || [],
        coverage: stored.coverage != null ? stored.coverage : 0,
        totalSubjects: stored.totalSubjects || 6,
        method: stored.method || 'ai',
        confidence: stored.confidence,
        evidence: stored.evidence || [],
        keyGains: stored.keyGains || [],
        daysLeft: stored.daysLeft,
      };
    }
    return ProgressEngine.localEstimate(Storage.getRecords(), Storage.getMistakes(), goal, Storage.getPapers());
  }

  /** 刷新全部顶栏/侧栏上的动态数字 */
  function refreshShell() {
    /**
     * ★ 学习事件自动记录（2026-10-31）
     *
     * 每次刷新壳层时比对数据快照，发现新事件就记进 Memory。
     * 这样不用在每个 addPaper/addMistake 点埋钩子 —— 不容易漏。
     */
    try {
      if (typeof Memory !== 'undefined') {
        const snapKey = '__lastDataSnap';
        const cur = {
          papers: (Storage.getPapers() || []).length,
          mistakes: (Storage.getMistakes() || []).length,
          lessons: (Storage.getLessons ? Storage.getLessons() : []).length,
        };
        const last = window[snapKey];
        if (last) {
          if (cur.papers > last.papers) {
            Memory.addEvent('paper', { count: cur.papers - last.papers });
          }
          if (cur.mistakes > last.mistakes) {
            Memory.addEvent('quiz', { count: cur.mistakes - last.mistakes });
          }
          if (cur.lessons > last.lessons) {
            Memory.addEvent('lesson', { count: cur.lessons - last.lessons });
          }
        }
        window[snapKey] = cur;

        // 复习事件（Review 有记录就算）
        if (typeof Review !== 'undefined' && Review.stats) {
          const st = Review.stats();
          const rKey = '__lastReviewStat';
          const lastR = window[rKey];
          if (lastR != null && (st.learning + st.mastered) > lastR) {
            Memory.addEvent('review', { delta: (st.learning + st.mastered) - lastR });
          }
          window[rKey] = st.learning + st.mastered;
        }
      }
    } catch (e) {}

    // ★ 数据变更后，如果当前在出卷页，重新渲染门禁状态（2026-10-31）
    try {
      const activePage = document.querySelector('.page.active');
      if (activePage && activePage.id === 'page-quiz') {
        renderQuiz();
      }
    } catch (e) {}

    const g = Storage.getGoal();
    const stats = Storage.getStats();

    const st = $('streak');
    if (st) st.textContent = '🔥 ' + (stats.streak || 0) + ' 天';

    const mc = $('model-chip');
    if (mc) {
      const cfg = LLM.getConfig();
      const p = LLM.PROVIDERS[cfg.provider];
      if (wbReady()) {
        const wm = (typeof WB !== 'undefined' && WB.currentModel) ? WB.currentModel() : 'auto';
        mc.textContent = 'WorkBuddy · ' + wm;
        mc.className = 'chip ok';
      } else if (cfg.apiKey) {
        mc.textContent = (p ? p.name : cfg.provider) + ' · 已连接';
        mc.className = 'chip ok';
      } else {
        mc.textContent = '未配置模型';
        mc.className = 'chip warn';
      }
    }

    const sn = $('side-name');
    if (sn) sn.textContent = (g.name || '学生') + ' · ' + (g.grade || '高中');
    const ss = $('side-sub');
    if (ss) ss.textContent = allSixSubjects().slice(3).join('·') + ' · 目标 ' + (g.target || '--') + ' 分';
    const av = $('side-avatar');
    if (av) av.textContent = (g.name || '学').slice(0, 1);

    // 顺带把题数徽标更新掉
    const gq = $('s-quiz');
    if (gq) gq.textContent = stats.monthlyQuiz || 0;
  }

  function updateBadges() {
    const papers = Storage.getPapers();
    const need = allSixSubjects().filter(s => Storage.countPapers(s) >= 5 && !Storage.getSubjectAnalyses()[s]);
    const bi = $('badge-import');
    if (bi) {
      const show = need.length > 0;
      bi.classList.toggle('hidden', !show);
      bi.textContent = need.length;
    }
    const mcount = Storage.getMistakes().length;
    const bw = $('badge-weakness');
    if (bw) {
      bw.classList.toggle('hidden', mcount === 0);
      bw.textContent = mcount > 99 ? '99+' : mcount;
    }
    const bq = $('badge-quiz');
    if (bq) {
      const recs = Storage.getRecords().filter(r => r.type === 'quiz').length;
      bq.classList.toggle('hidden', recs === 0);
      bq.textContent = recs > 99 ? '99+' : recs;
    }
  }

  // ════════════════════════════════════════════════════════════
  //  总览
  // ════════════════════════════════════════════════════════════
  function renderDashboard() {
    // ★ 高考游戏化进度条（2026-10-31）
    renderGaokaoBar();

    // ★ 主动消息（2026-10-31）
    renderProactiveBanner();

    const goal = Storage.getGoal();
    const stats = Storage.getStats();
    const est = currentEstimate();
    const base = baselineScore();
    const target = Number(goal.target) || 600;
    const unlock = unlockStatus();
    const unlocked = unlock.ready && est.total != null;

    countTo($('g-target'), target, { decimals: 0 });

    if (unlocked) {
      const total = round5(est.total);
      countTo($('g-current'), total, { decimals: 5 });
      $('dash-label').textContent = '分 · 当前预估';
      const gap = round5(target - total);
      $('g-gap').textContent = gap > 0 ? '还差 ' + fx5(gap) + ' 分' : '已超过目标 ' + fx5(-gap) + ' 分';
      const pct = target > 0 ? Math.max(0, Math.min(100, (total / target) * 100)) : 0;
      (function(){ var b = $('g-bar'); if (b && b.style) b.style.width = pct + '%'; })();
      ($('g-percent') || {set textContent(v){},set innerHTML(v){}}).textContent = pct.toFixed(2) + '%';
      ($('g-progress-note') || {set textContent(v){},set innerHTML(v){}}).textContent = '起点 ' + base + ' 分 · ' + (est.method === 'ai' ? 'AI 估算' : '本地推算');
      // ★ 展示 1 位小数（2026-10-31 修）
      //   内部计算仍保留 round5 的 5 位精度，但"累计提分"是给人看的数字，
      //   之前 decimals:5 会显示成 +11.54161，像 bug。
      countTo($('s-gain'), total - base, { decimals: 1, prefix: total - base >= 0 ? '+' : '' });
    } else {
      // ★ 数据不够时不编分数：只展示学生真正提供过的那个数字（月考总分）
      countTo($('g-current'), base || NaN, { decimals: 0, fallback: '--' });
      $('dash-label').textContent = '分 · 你的月考起点';
      $('g-gap').textContent = base
        ? ('距目标 ' + fx5(round5(target - base)) + ' 分')
        : '先填一次问卷，告诉我你的起点';
      const pct = (target > 0 && base) ? Math.max(0, Math.min(100, (base / target) * 100)) : 0;
      (function(){ var b = $('g-bar'); if (b && b.style) b.style.width = pct + '%'; })();
      ($('g-percent') || {set textContent(v){},set innerHTML(v){}}).textContent = pct.toFixed(2) + '%';
      /**
       * ★ 估分就绪进度条（2026-10-31 重写）
       *
       * 用户原话："让 AI 自己判断是否有能力估算……进度条也不对"。
       *
       * 旧版：显示"每科满 N 份试卷"——把解锁条件写死成了份数，
       *       和 evidence-v2 的置信度门槛（SE≤0.32）完全脱节。
       *
       * 新版：直接用 EvidenceEngine 的就绪度（信息增益 0~100%）：
       *   · 进度条 = 当前信息量 / 出分线所需信息量
       *   · 文案说明"什么时候能估"和"还差什么"
       *   · 一份卷子也可能达标（联考题量大、难度准），
       *     五份卷子也可能不够（全是简单练习）—— AI 自己判断
       */
      try {
        const r = EvidenceEngine.estimateAll({
          goal: Storage.getGoal(),
          papers: Storage.getPapers(),
          lessons: Storage.getLessons ? Storage.getLessons() : [],
          quizzes: (Storage.getQuizStats && Storage.getQuizStats()) || [],
          aptitude: Storage.getAptitude ? Storage.getAptitude() : null,
        });
        window.__lastReadiness = r;
        // ★ 真实字段：overallProgress（0~1），不是 overall.readiness（实测核实）
        const overallPct = Math.max(0, Math.min(100, Math.round((r.overallProgress || 0) * 100)));
        // 用就绪度替换目标进度条 —— 这里展示"离能估分还差多少"
        (function(){ var b = $('g-bar'); if (b && b.style) b.style.width = overallPct + '%'; })();
        ($('g-percent') || {set textContent(v){},set innerHTML(v){}}).textContent = overallPct + '%';
        const conf = r.nextAction ? '' : '';
        const advice = (typeof r.nextAction === 'string' && r.nextAction) ? r.nextAction : '';
        $('g-progress-note').innerHTML =
          '<b>估分就绪 ' + overallPct + '%</b>' +
          (conf ? '<span style="margin-left:6px">（当前置信：' + esc(conf) + '）</span>' : '') +
          (advice ? '<div style="margin-top:2px;font-size:12px">' + esc(advice) + '</div>' : '');
      } catch (e) {
        // 引擎不可用时退回简单计数，但绝不再说"必须满 N 份"
        ($('g-progress-note') || {set textContent(v){},set innerHTML(v){}}).textContent = unlock.ready
          ? '数据已够，正在生成预估…'
          : '还没录入试卷——上传一份就能开始估（AI 会自己判断够不够）';
      }
      $('s-gain').textContent = '--';
    }

    (function(){
        const _d = daysToExam();
        const _el = $('g-days');
        if (_el) {
          // ★ null 时显示"未设置"，不再显示 0 天（2026-10-31）
          if (_d == null) { _el.textContent = '未设置'; }
          else { countTo(_el, _d, { decimals: 0 }); }
        }
      })();
    countTo($('s-weekly'), (stats.weeklyMin || 0) / 60, { decimals: 1, suffix: 'h' });
    countTo($('s-points'), stats.points || 0, { decimals: 0 });
    $('today-date').textContent = fmtDate(new Date().toISOString());

    // 解锁进度（数据不够时显示在总览上）
    const up = $('dash-unlock');
    if (up) {
      up.innerHTML = unlocked ? '' : unlockCardHTML(unlock, 'dash');
      bindUnlockCard(up);
    }

    // 今日任务
    const plan = Planner.getTodayTasks();
    const tc = $('today-tasks');
    if (!plan || !plan.tasks.length) {
      tc.innerHTML = '<div class="empty">今天还没有计划<br>去「学习规划」让 AI 排一份</div>';
    } else {
      tc.innerHTML = plan.tasks.map(t => {
        const info = t.t || {};
        return '<div class="task">' +
          '<div class="task-check ' + (t.completed ? 'done' : '') + '" data-task="' + esc(t.id) + '">' + (t.completed ? '✓' : '') + '</div>' +
          '<div class="task-info"><div class="task-name ' + (t.completed ? 'done' : '') + '">' + esc(info.task) + '</div>' +
          '<div class="task-meta">' + esc(info.subject || '') + (info.description ? ' · ' + esc(info.description) : '') + '</div></div>' +
          '<div class="task-dur">' + (info.duration || 0) + ' 分钟</div></div>';
      }).join('');
      tc.querySelectorAll('[data-task]').forEach(el => {
        el.addEventListener('click', () => toggleTask(el.dataset.task));
      });
    }

    // 最近活动
    const acts = Storage.getActs();
    $('recent-activity').innerHTML = acts.length
      ? acts.slice(0, 6).map(a =>
          '<div class="activity"><div class="act-icon">' + esc(a.icon || '·') + '</div>' +
          '<div class="act-info"><div class="act-title">' + esc(a.title) + '</div>' +
          '<div class="act-time">' + fmtAgo(a.time) + '</div></div></div>').join('')
      : '<div class="empty">还没有活动记录</div>';

    // 每日简报（保留上次生成的内容）
    const rep = Storage.get('daily_report', null);
    if (rep && rep.date === new Date().toDateString()) {
      $('daily-report').innerHTML = '<div class="ai-box">' + esc(rep.text) + '</div>';
    }
    refreshShell();
  }

  async function generateDailyReport() {
    const btn = $('btn-daily-report');
    btn.disabled = true; btn.textContent = '生成中…';
    $('daily-report').innerHTML = '<div class="thinking"><span class="spinner"></span>AI 正在看你的数据…</div>';
    try {
      const g = Storage.getGoal();
      const recs = Storage.getRecords().slice(-10);
      const plan = Planner.getTodayTasks();
      const todo = plan ? plan.tasks.map(t => (t.completed ? '[已完成] ' : '[未完成] ') + (t.t && t.t.task)).join('\n') : '（今天还没有计划）';
      const text = await ask(
        '请给我一份今天的简报，300 字以内，中文，直接说重点：\n' +
        '1) 我现在的状态（结合最近成绩和错题）\n' +
        '2) 今天最该做的三件事（按优先级）\n' +
        '3) 一句话提醒\n\n' +
        '【我的今日任务】\n' + todo + '\n\n' +
        '【最近成绩】\n' + (recs.map(r => fmtDate(r.date) + ' ' + r.subject + ' ' + r.score + '/' + r.fullScore).join('\n') || '（暂无）') + '\n\n' +
        '【当前预估】' + fx5(currentEstimate().total) + ' 分，目标 ' + g.target + ' 分，距高考 ' + daysToExam() + ' 天',
        { maxTokens: 1200 });
      Storage.set('daily_report', { date: new Date().toDateString(), text: text });
      $('daily-report').innerHTML = '<div class="ai-box">' + esc(text) + '</div>';
      remember('ai', '【每日简报】' + text, 'report');
      toast('简报已生成', 'success');
    } catch (e) {
      $('daily-report').innerHTML = '<div class="empty">生成失败：' + esc(e.message) + '</div>';
      toast('生成失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '生成';
    }
  }

  /**
   * 「还差多少数据」卡片。
   * 数据不够时用它代替预估分数——不展示任何编造的分数。
   */
  function unlockCardHTML(unlock, idPrefix) {
    /**
     * ★ 就绪度卡片（2026-10-31 重写）
     *
     * 旧版按"份数"画 X/5 进度条，并写死"每科必须满 N 份"。
     * 用户明确不要这个：AI 应自己按证据量判断。
     *
     * 新版每科一行 = EvidenceEngine 的就绪度（0~100%），
     * 卡片标题也从"还不能预测"改成"AI 正在积累对你的了解"。
     */
    let perRows = [];
    let overallPct = 0;
    try {
      const r = EvidenceEngine.estimateAll({
        goal: Storage.getGoal(),
        papers: Storage.getPapers(),
        lessons: Storage.getLessons ? Storage.getLessons() : [],
        quizzes: (Storage.getQuizStats && Storage.getQuizStats()) || [],
        aptitude: Storage.getAptitude ? Storage.getAptitude() : null,
      });
      const per = (r && r.perSubject) || {};
      Object.keys(per).forEach(sub => {
        const row = per[sub];
        // ★ 真实结构：row.readiness.progress（0~1）+ row.confidence.level
        const pct = Math.max(0, Math.min(100, Math.round(((row.readiness && row.readiness.progress) || 0) * 100)));
        perRows.push({ subject: sub, pct, confidence: (row.confidence && row.confidence.level) || '' });
      });
      overallPct = Math.max(0, Math.min(100, Math.round((r.overallProgress || 0) * 100)));
    } catch (e) {
      perRows = unlock.rows.map(x => ({ subject: x.subject, pct: x.count > 0 ? 40 : 0, confidence: '' }));
    }

    const confLabel = { high: '高', mid: '中', low: '低', none: '不足' };
    // ★ 全 0% 时不重复显示六行（2026-10-31）
    const allZero = perRows.every(x => x.pct === 0);
    const rowsHtml = allZero
      ? '<div style="padding:16px;text-align:center;color:var(--label-secondary);font-size:13px">' +
        '还没有任何作答证据。上传一份卷子或做一次出卷，AI 就开始了解你。' +
        '</div>'
      : perRows.map(x =>
      '<div class="pp-item">' +
      '<div class="pp-top"><span class="pp-name">' + esc(x.subject) + '</span>' +
      '<span class="pp-count">就绪 ' + x.pct + '%' +
      (x.confidence ? ' · 置信' + (confLabel[x.confidence] || x.confidence) : '') + '</span></div>' +
      '<div class="pp-bar"><div class="pp-fill' + (x.pct >= 100 ? ' full' : '') + '" style="width:' + x.pct + '%"></div></div>' +
      '</div>').join('');

    const readySubjects = perRows.filter(x => x.pct >= 100).length;

    return '<div class="card unlock-card">' +
      '<div class="card-header"><h3>估分就绪度</h3>' +
      '<span class="card-sub">整体就绪 ' + overallPct + '% · ' + readySubjects + ' 科已可单科预估</span></div>' +
      '<p class="card-desc">还没有单科作答证据。每科传 1 份卷子，AI 就开始按证据估分。</p>' +
      '<div class="paper-progress">' + rowsHtml + '</div>' +
      '<div class="btn-group" style="margin-top:14px">' +
      '<button class="btn btn-primary" data-go-import="' + idPrefix + '">去上传作业</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:10px">做一次「推理能力测验」也能提高估分就绪度</div>' +
      '</div>';
  }

  function bindUnlockCard(root) {
    if (!root) return;
    root.querySelectorAll('[data-go-import]').forEach(b =>
      b.addEventListener('click', () => navigate('import')));
    root.querySelectorAll('[data-run-subject]').forEach(b =>
      b.addEventListener('click', () => runSubjectAnalyses()));
  }

  // ════════════════════════════════════════════════════════════
  //  学习规划
  // ════════════════════════════════════════════════════════════
  /**
   * 作息下拉：显示当前配置、切换时应用模板。
   * 模板只是起点，用户可以之后再改；不设就保持「未设置」，不编造。
   */
  function syncRoutineUI() {
    if (typeof Routine === 'undefined') return;
    const sel = $('p-routine');
    const hint = $('p-routine-hint');
    if (!sel) return;
    const ui = Routine.forUI();
    sel.value = ui.preset || '';
    if (hint) {
      if (ui.configured) {
        hint.textContent = ui.presetLabel + ' · ' + ui.hint +
          '（这是模板起点，按你学校的真实作息调整；未调整前别当成系统已经知道你的时间）';
      } else {
        hint.textContent = '没设置作息时按上面「每日学习时间」通用排；住校生建议选一个贴近的模板。';
      }
    }
  }

  function onRoutineChange() {
    if (typeof Routine === 'undefined') return;
    const v = ($('p-routine') || {}).value || '';
    if (v) Routine.applyPreset(v);
    else Routine.clear();
    syncRoutineUI();
    renderPlanner();
    if (typeof toast === 'function') toast(v ? '已应用作息模板，可再按学校实际调整' : '已清除作息设置', 'success');
  }

  function renderPlanner() {
    // 侧重科目下拉
    const sel = $('p-subject');
    if (sel && sel.options.length <= 1) {
      allSixSubjects().forEach(s => {
        const o = document.createElement('option'); o.textContent = s; sel.appendChild(o);
      });
    }
    const g = Storage.getGoal();
    if ($('p-hours') && g.hours) {
      const h = parseInt(g.hours, 10);
      if (h >= 1 && h <= 8) $('p-hours').value = String(h);
    }
    // ★ 2026-11-07：作息下拉（住校 / 走读）
    syncRoutineUI();

    const plan = Planner.getTodayTasks();
    const dc = $('daily-plan');
    if (!plan || !plan.tasks.length) {
      dc.innerHTML = '<div class="empty">点击上方按钮，让 AI 生成今天的计划</div>';
      $('plan-time').textContent = '';
    } else {
      const totalMin = plan.tasks.reduce((s, t) => s + ((t.t && t.t.duration) || 0), 0);
      $('plan-time').textContent = plan.tasks.length + ' 项 · 共 ' + totalMin + ' 分钟';
      dc.innerHTML = plan.tasks.map((t, i) => {
        const info = t.t || {};
        return '<div class="plan-item"><div class="plan-num">' + (i + 1) + '</div>' +
          '<div class="plan-info"><div class="plan-name">' + esc(info.task) + '</div>' +
          '<div class="plan-desc">' + esc(info.subject || '') + (info.description ? ' · ' + esc(info.description) : '') + '</div></div>' +
          '<div class="plan-dur">' + (info.duration || 0) + ' 分钟</div></div>';
      }).join('');
    }

    // 本周节奏
    //
    // ★ 2026-11-07 修：删掉原来的伪数据公式
    //   旧代码在没有 weeklyPlan 时用 `Math.round(120 + (i % 3) * 30)`
    //   凭空造出每天的分钟数画条形图 —— 用户说「缺真实数据」，
    //   这就是最典型的一处：界面在一本正经地显示编出来的数字。
    //
    //   现在优先级：
    //     ① 用户设了作息 → 显示他自己的可用分钟（真实，来自 Routine）
    //     ② AI 生过周计划 → 显示 AI 给的 weeklyPlan（明确标「AI 建议」）
    //     ③ 都没有 → 显示「—」和一句提示，绝不编数字
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const dow = (new Date().getDay() + 6) % 7;
    const last = Storage.get('last_plan', null);
    const weekly = (last && last.t && last.t.weeklyPlan) || [];
    const hasRoutine = (typeof Routine !== 'undefined') && Routine.isConfigured();
    const maxM = 480;
    $('weekly-plan').innerHTML = days.map((d, i) => {
      let mins = null;
      let label = '';
      let source = '';
      if (hasRoutine) {
        mins = Routine.minutesFor(i);
        label = (mins == null) ? '—' : (Math.round(mins / 60 * 10) / 10 + 'h');
        source = '我的作息';
      } else if (weekly[i] && weekly[i].totalMinutes) {
        mins = Number(weekly[i].totalMinutes);
        label = Math.round(mins / 60 * 10) / 10 + 'h';
        source = 'AI 建议';
      } else if (i === dow && plan) {
        // 只有「今天」可以用真实计划时长，其余日子不编
        mins = plan.tasks.reduce((s, t) => s + ((t.t && t.t.duration) || 0), 0);
        label = Math.round(mins / 60 * 10) / 10 + 'h';
        source = '今日计划';
      } else {
        label = '—';
      }
      const pct = (mins != null) ? Math.max(4, Math.min(100, Math.round(mins / maxM * 100))) : 0;
      const fill = mins != null
        ? '<div class="wk-bar-fill" style="width:' + pct + '%"></div>'
        : '<div class="wk-bar-fill" style="width:0;background:transparent"></div>';
      return '<div class="wk-row"><span class="wk-day"' + (i === dow ? ' style="color:var(--ds-500);font-weight:600"' : '') + '>' + d + (i === dow ? ' · 今天' : '') + '</span>' +
        '<div class="wk-bar">' + fill + '</div>' +
        '<span class="wk-info" title="' + esc(source) + '">' + esc(label) + '</span></div>';
    }).join('');
    // 没设作息也不编：给一条明确说明
    if (!hasRoutine && !weekly.length) {
      $('weekly-plan').innerHTML += '<div class="hint" style="margin-top:8px;font-size:11.5px">' +
        '还没设置作息。选一个节奏（或让 AI 生成计划）后，这里才会显示每周安排 —— 没有数据就不编数字。</div>';
    }

    const tips = (last && last.t && last.t.tips) || null;
    const tipEl = $('plan-tips');
    if (tips && tips.length) {
      tipEl.innerHTML = '<div class="ai-box">' + tips.map(t => '· ' + esc(t)).join('\n') + '</div>';
    } else if (last && last.t && last.t.weeklyPlan && !tips) {
      tipEl.innerHTML = '<div class="ai-box">计划已生成。完成后记得回来打勾，AI 会重新估算。</div>';
    }
  }

  async function generatePlan() {
    const btn = $('btn-gen-plan');
    btn.disabled = true; btn.textContent = 'AI 排计划中…';
    try {
      const settings = {
        hours: parseInt($('p-hours').value, 10) || 3,
        subject: $('p-subject').value || 'auto',
        intensity: $('p-intensity').value,
      };
      /**
       * ★ 了解程度门禁（2026-10-31）
       * 不了解弱项就排计划 = 编计划。
       */
      const know2 = (typeof StudentProfile !== 'undefined') ? StudentProfile.knowsStudent() : null;
      if (know2 && !know2.canPlan) {
        showGateCard('plan', know2);
        try { const gb = $('btn-gen-plan'); if (gb) { gb.disabled = false; gb.textContent = 'AI 生成今日计划'; } } catch (e) {}
        return;
      }

      const plan = await Planner.generateDailyPlan(settings);
      Planner.savePlan(plan);
      Storage.set('last_plan', plan);
      Storage.setGoal({ hours: String(settings.hours) });

      const tasks = (plan.t && plan.t.dailyPlan) || [];
      remember('ai', '【今日计划】' + tasks.map(t => (t.t && t.t.task) || '').join('；'), 'plan');
      renderPlanner();
      toast('计划已生成（' + (plan.method === 'ai' ? 'AI' : '本地推算') + '）', 'success');
    } catch (e) {
      toast('生成失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'AI 生成今日计划';
    }
  }

  function toggleTask(id) {
    const wasDone = Storage.getDaily().done.includes(id);
    Planner.completeTask(id);
    const stats = Storage.getStats();
    stats.points = (stats.points || 0) + (wasDone ? -1 : 1);
    Storage.set('stats', stats);
    toast(wasDone ? '已取消（-1 积分）' : '完成一项（+1 积分）', wasDone ? 'warning' : 'success');
    if ($('page-dashboard').classList.contains('active')) renderDashboard();
    else renderPlanner();
  }

  // ════════════════════════════════════════════════════════════
  //  教材进度（每科独立）—— 决定"出题能出到哪儿"
  // ════════════════════════════════════════════════════════════

  /** 一次性把 datalist 注入页面（版本 + 各科章节建议） */
  function ensureTextbookDatalists() {
    if (document.getElementById('tb-datalists')) return;
    const wrap = document.createElement('div');
    wrap.id = 'tb-datalists';
    wrap.style.display = 'none';
    // 九科全都建好，避免选科没保存时拿不到对应科目的建议
    const allNine = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];
    let html = '<datalist id="tb-editions">' +
      (DB.TEXTBOOK_EDITIONS || []).map(e => '<option value="' + esc(e) + '"></option>').join('') +
      '</datalist>';
    allNine.forEach(sub => {
      const hints = (DB.TEXTBOOK_HINTS || {})[sub] || [];
      html += '<datalist id="tb-hints-' + esc(sub) + '">' +
        hints.map(h => '<option value="' + esc(h) + '"></option>').join('') + '</datalist>';
    });
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
  }

  /**
   * 生成"每科教到哪"的编辑行。
   * 注意 1：科目列表必须由调用方传入 —— 问卷里选科还没写进 Storage，
   *         用 allSixSubjects() 会永远显示默认的物化生（这是个真 bug）。
   * 注意 2：改选科会重渲染这个区域，所以先把用户已输入的值收进草稿再画，
   *         否则刚敲的字会没。
   * @param {string} containerId
   * @param {object} opts {subjects, editionMode: 'auto'|'edit', city, compact}
   */
  let tbDraft = {};
  function renderTextbookRows(containerId, opts) {
    const el = $(containerId);
    if (!el) return;
    ensureTextbookDatalists();
    opts = opts || {};

    const subjects = opts.subjects && opts.subjects.length ? opts.subjects : allSixSubjects();
    const editionMode = opts.editionMode || 'edit';
    const city = opts.city !== undefined ? opts.city : (($('q-city') && $('q-city').value) || Storage.getGoal().city || '');

    // 去掉上一次渲染留下的说明行，避免重复
    const oldNote = $(containerId + '-edition-note');
    if (oldNote) oldNote.remove();

    const existing = collectTextbookRows(containerId);
    if (Object.keys(existing).length) tbDraft = Object.assign({}, tbDraft, existing);
    const saved = Object.assign({}, Storage.getTextbook(), tbDraft);

    el.innerHTML = subjects.map(sub => {
      const t = saved[sub] || {};
      const det = DB.detectEdition(city, sub);
      const edValue = t.edition || det.edition;

      let editionCell;
      if (editionMode === 'auto') {
        // 问卷里不问他版本：直接按城市匹配好，标出是推测还是统编，并允许点开改
        editionCell =
          '<span class="tb-edition-chip' + (det.certain ? ' certain' : '') + '" ' +
          'title="' + (det.certain
            ? '教育部统编教材，全国统一'
            : ('按「' + (det.region || '未识别地区') + '」推测，可能不准')) + '">' +
          esc(edValue) + (det.certain ? '' : ' *') + '</span>' +
          '<input type="hidden" class="tb-edition" data-sub="' + esc(sub) + '" data-k="edition" value="' + esc(edValue) + '">';
      } else {
        editionCell =
          '<input class="tb-edition" type="text" list="tb-editions" data-sub="' + esc(sub) + '" data-k="edition" ' +
          'placeholder="版本" value="' + esc(edValue) + '">';
      }

      return '<div class="tb-row">' +
        '<span class="tb-subject">' + esc(sub) + '</span>' +
        editionCell +
        '<input class="tb-unit" type="text" list="tb-hints-' + esc(sub) + '" data-sub="' + esc(sub) + '" data-k="unit" ' +
        'placeholder="上到哪了，如：必修第二册 第六章" value="' + esc(t.unit || '') + '">' +
        '</div>';
    }).join('');

    if (opts.editionMode === 'auto') {
      const r = DB.normalizeRegion(city);
      const note = r
        ? '教材版本已按「' + esc(r) + '」自动匹配；带 * 的是推测（各版本差异主要在章节顺序，不影响出题范围），不对的话可到「AI 出卷」页改'
        : '还没填城市，版本先按人教版给；填了城市会自动匹配';
      el.insertAdjacentHTML('afterend', '<div class="hint" id="' + containerId + '-edition-note">' + note + '</div>');
    }
  }

  /** 从编辑区读回数据 */
  function collectTextbookRows(containerId) {
    const el = $(containerId);
    if (!el) return {};
    const out = {};
    el.querySelectorAll('input[data-sub]').forEach(inp => {
      const sub = inp.dataset.sub;
      if (!out[sub]) out[sub] = {};
      out[sub][inp.dataset.k] = (inp.value || '').trim();
    });
    return out;
  }

  function saveTextbookRows(containerId, quiet) {
    const map = collectTextbookRows(containerId);
    const digest = persistTextbook(map, { subjects: allSixSubjects() });
    renderTextbookSummary();
    if (!quiet) {
      const n = Object.keys(map).filter(s => map[s].unit || map[s].edition).length;
      toast(n ? ('已保存 ' + n + ' 科的教材进度，AI 已记住') : '已清空教材进度', n ? 'success' : 'warning');
    }
    return map;
  }

  function textbookSummaryText() {
    // 用"已保存的科目 + 当前六科"的并集，避免只看当前选科漏掉别的
    const saved = Storage.getTextbook();
    const subs = allSixSubjects().concat(Object.keys(saved))
      .filter((s, i, a) => a.indexOf(s) === i);
    return Storage.textbookDigest(subs) || '';
  }

  function renderTextbookSummary() {
    const s = $('tb-summary');
    if (s) {
      const d = textbookSummaryText();
      const n = d ? d.split('；').length : 0;
      s.textContent = d ? ('已填 ' + n + '/6 科') : '还没填';
      s.style.color = d ? 'var(--green)' : 'var(--amber)';
    }
    // 出卷设置里那行小字：当前科目的进度
    const cur = $('q-textbook-note');
    if (cur) {
      const sub = $('q-subject') ? $('q-subject').value : '';
      const t = Storage.getSubjectTextbook(sub);
      cur.textContent = t
        ? ('本卷范围：' + [t.edition, t.unit].filter(Boolean).join(' '))
        : ('「' + sub + '」还没填教材进度，出题可能超纲 —— 点上方「教材进度」填一下');
      cur.style.color = t ? 'var(--green)' : 'var(--amber)';
    }
  }

  function renderQuizTextbookCard() {
    renderTextbookRows('tb-editor', { subjects: allSixSubjects(), editionMode: 'edit' });
    const open = Storage.get('tb_editor_open', false);
    const ed = $('tb-editor');
    if (ed) ed.classList.toggle('hidden', !open);
    const bar = $('tb-save-bar');
    if (bar) bar.classList.toggle('hidden', !open);
    const btn = $('btn-tb-toggle');
    if (btn) btn.textContent = open ? '收起' : '展开填写';
    renderTextbookSummary();
  }

  /**
   * 把教材进度写进「应用记忆」：
   * ① localStorage xt_textbook_progress（结构化，各模块读）
   * ② AI 共享记忆一条（可在设置页看到，也进模型上下文）
   * ③ setup_data 里留一份快照
   */
  function persistTextbook(map, opts) {
    opts = opts || {};
    const subj = opts.subjects || allSixSubjects();
    Storage.setTextbookBulk(map);

    const digest = Storage.textbookDigest(subj);
    const region = DB.normalizeRegion(opts.city || ($('q-city') && $('q-city').value) || Storage.getGoal().city || '');

    // 只有内容真的变了才写记忆，避免每次保存都刷一条
    const sig = (region || '') + '|' + digest;
    if (digest && sig !== Storage.get('textbook_memory_sig', '')) {
      Storage.set('textbook_memory_sig', sig);
      remember('user', '【教材进度】' + (region ? region + '；' : '') + digest, 'textbook');
      remember('ai', '记住了：他' + (region ? '在' + region + '，' : '') + '各科教材学到——' + digest +
        '。以后出题、讲题、做规划都别超过这个范围。', 'textbook');
    }

    // setup_data 快照
    const sd = Storage.get('setup_data', null);
    if (sd) {
      sd.textbook = Storage.getTextbook();
      sd.editionRegion = region;
      Storage.set('setup_data', sd);
    }
    updateMemoryUI();
    return digest;
  }

  // ════════════════════════════════════════════════════════════
  //  AI 出卷
  // ════════════════════════════════════════════════════════════
  function fillSubjectSelect(id, withAuto) {
    const sel = $(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = (withAuto ? '<option value="">自动判断</option>' : '') +
      allSixSubjects().map(s => '<option value="' + s + '">' + s + '</option>').join('');
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
  }

  /**
   * ★ 功能门禁卡（2026-10-31）
   * AI 还不够了解你时，出卷/规划显示这个而不是硬跑。
   * 告诉用户缺什么、给一键入口 —— 引导而不是拒绝。
   */
  /**
   * ★ 渲染高考进度条（2026-10-31）
   *
   * 用户要的："把高考做成能看见的进度条，像游戏一样。"
   */
  function renderGaokaoBar() {
    const box = $('gaokao-bar-container');
    if (!box) return;
    try {
      if (typeof GaokaoBar === 'undefined') { box.innerHTML = ''; return; }

      // 拿估分数据（有就用，没有就用起点分）
      let est = null;
      try {
        if (typeof EvidenceEngine !== 'undefined') {
          est = EvidenceEngine.estimateAll({
            goal: Storage.getGoal(),
            papers: Storage.getPapers(),
            lessons: (Storage.getLessons ? Storage.getLessons() : []),
            quizzes: [],
            aptitude: (Storage.getAptitude ? Storage.getAptitude() : null),
          });
        }
      } catch (e) {}

      const data = GaokaoBar.calc({ estimate: est });
      box.innerHTML = GaokaoBar.render(data);
    } catch (e) {
      console.warn('[gaokao-bar] 渲染失败:', e);
      box.innerHTML = '';
    }
  }

  /**
   * ★ 渲染主动消息条（2026-10-31）
   *
   * 用户要的："真正的老师主动让学生学习，而非学生主动找老师。"
   */
  function renderProactiveBanner() {
    const box = $('proactive-banner');
    if (!box) return;

    try {
      if (typeof ProactiveEngine === 'undefined') { box.classList.add('hidden'); return; }

      const msg = ProactiveEngine.nextMessage();
      if (!msg) { box.classList.add('hidden'); return; }

      const iconEl = $('pb-icon');
      const titleEl = $('pb-title');
      const bodyEl = $('pb-body');
      const btnEl = $('pb-action');
      const closeEl = $('pb-close');

      const icons = { gap: '🤔', remind: '⏰', greet: '👋', good: '🎉' };
      const tone = msg.type === 'gap' ? 'ask' :
                   msg.type === 'celebrate' ? 'good' :
                   msg.type.startsWith('reminder') ? 'remind' : 'greet';

      if (iconEl) iconEl.textContent = icons[tone] || '👋';
      if (titleEl) titleEl.textContent = msg.title || '';
      if (bodyEl) bodyEl.textContent = msg.body || '';
      if (btnEl) btnEl.textContent = msg.actionLabel || '去看看';

      // 动作
      if (btnEl && !btnEl._bound) {
        btnEl._bound = true;
        btnEl.addEventListener('click', () => {
          const m = window.__lastProactiveMsg;
          if (!m) return;
          ProactiveEngine.acknowledge(m);
          handleProactiveAction(m.action);
        });
      }

      // 关闭
      if (closeEl && !closeEl._bound) {
        closeEl._bound = true;
        closeEl.addEventListener('click', () => {
          const m = window.__lastProactiveMsg;
          if (m) ProactiveEngine.acknowledge(m);
          box.classList.add('hidden');
        });
      }

      window.__lastProactiveMsg = msg;
      box.classList.remove('hidden');
    } catch (e) {
      console.warn('[proactive] 渲染失败:', e);
      box.classList.add('hidden');
    }
  }

  /** 主动消息的动作分发 */
  function handleProactiveAction(action) {
    const box = $('proactive-banner');
    if (box) box.classList.add('hidden');

    const map = {
      'gap-fill': () => { App.navigate('import'); },
      'goto-weakness': () => { App.navigate('weakness'); },
      'goto-quiz': () => { App.navigate('quiz'); },
      'goto-progress': () => { App.navigate('progress'); },
      'goto-chat': () => { App.navigate('chat'); },
      'goto-dashboard': () => { App.navigate('dashboard'); },
    };
    const fn = map[action];
    if (fn) fn();
  }

    function showGateCard(kind, know) {
    const titles = { quiz: '出卷前，我需要更了解你', plan: '排计划前，我需要更了解你' };

    // ★ 渲染到页面最前面（2026-10-31 修）
    //   之前写 #quiz-area，但那是 class="hidden"（出卷后才显示题目的容器），
    //   用户根本看不到门禁卡 —— 实测截图暴露。
    const pageId = kind === 'quiz' ? 'page-quiz' : 'page-planner';
    const page = $(pageId);
    if (!page) { toast('还需要更多数据（了解度 ' + know.score + '%）', 'warning'); return; }

    // 先清掉旧的门禁卡（避免重复插入）
    const old = page.querySelector('[data-gate-card]');
    if (old) old.remove();

    // 插入到页面最前面
    const host = document.createElement('div');
    host.setAttribute('data-gate-card', kind);
    page.insertBefore(host, page.firstChild);
    const box = host;

    // 隐藏原有内容（设置表单 / 计划区），避免用户以为能直接用
    if (kind === 'quiz') {
      const settings = page.querySelector('.card.no-print');
      if (settings) settings.style.display = 'none';
    }

    const items = (know.missing || []).map(m =>
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px">' +
      '<span style="color:var(--amber)">○</span><span>' + esc(m) + '</span></div>').join('');

    const pct = know.score != null ? know.score : 0;
    const need = kind === 'quiz' ? 35 : 45;

    box.innerHTML =
      '<div class="card" style="text-align:left">' +
      '<div class="card-header"><h3>' + (titles[kind] || '我需要更了解你') + '</h3>' +
      '<span class="card-sub">了解度 ' + pct + '% / 需要 ' + need + '%</span></div>' +
      '<div style="padding:8px 0">' +
      '<div style="height:8px;border-radius:4px;background:var(--bg-layer-2);overflow:hidden;margin-bottom:14px">' +
      '<div style="height:100%;width:' + Math.min(100, pct / need * 100) + '%;background:var(--accent);border-radius:4px"></div>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--label-secondary);line-height:1.8;margin-bottom:10px">' +
      '现在出' + (kind === 'quiz' ? '题' : '计划') + '只能靠猜，猜出来的东西浪费你时间。' +
      '补齐下面任何几项，我就能按你的真实水平来：' +
      '</p>' + items +
      '<div class="btn-group" style="margin-top:14px">' +
      '<button class="btn btn-primary btn-sm" onclick="navigate(\'import\')">去上传试卷</button>' +
      '<button class="btn btn-secondary btn-sm" onclick="navigate(\'dashboard\')">去做能力测验</button>' +
      '</div>' +
      '</div></div>';
  }


  // ★ 暴露给全局（2026-10-31）：门禁卡内联 onclick、诊断脚本、TutorHub 都需要
  try {
    window.persona = persona;
    window.generateQuiz = generateQuiz;
    window.generatePlan = (typeof generatePlan !== 'undefined') ? generatePlan : null;
    window.showGateCard = showGateCard;
    window.renderGaokaoBar = renderGaokaoBar;
    window.renderProactiveBanner = renderProactiveBanner;
    window.handleProactiveAction = handleProactiveAction;
  } catch (e) {}

  function renderQuiz() {
    /**
     * ★ 每次渲染都重新判断门禁（2026-10-31 修）
     *
     * 之前的问题：数据补足后（3 科卷子，了解度 47%），
     * 门禁卡还挂在页面上显示"了解度 33%"——因为它只在第一次渲染时判断。
     *
     * 现在：每次 renderQuiz 都重新读 knowsStudent。
     *   数据够 → 清掉门禁卡 + 恢复设置区
     *   数据不够 → 显示门禁卡
     */
    const know = (typeof StudentProfile !== 'undefined') ? StudentProfile.knowsStudent() : null;
    const page = $('page-quiz');

    if (know && !know.canQuiz) {
      showGateCard('quiz', know);
      return;
    }

    // ★ 数据够了：清掉门禁卡 + 恢复设置区显示
    if (page) {
      const oldGate = page.querySelector('[data-gate-card]');
      if (oldGate) oldGate.remove();
      const settings = page.querySelector('.card.no-print');
      if (settings) settings.style.display = '';
    }

    fillSubjectSelect('q-subject');
    fillKnowledgeSelect();
    renderQuizTextbookCard();
    const recs = Storage.getRecords().filter(r => r.type === 'quiz');
    $('quiz-history').innerHTML = recs.length
      ? recs.slice(-10).reverse().map(r =>
          '<div class="activity"><div class="act-icon">✎</div><div class="act-info">' +
          '<div class="act-title">' + esc(r.subject) + ' 测验 — ' + r.score + '/' + r.fullScore + ' 分</div>' +
          '<div class="act-time">' + fmtAgo(r.date) + '</div></div></div>').join('')
      : '<div class="empty">还没有试卷记录</div>';
  }

  function fillKnowledgeSelect() {
    const sub = $('q-subject').value;
    const g = Storage.getGoal();
    const sel = $('q-knowledge');
    let list = [];
    try { list = DB.getKnowledge(g.grade || '高三', sub) || []; } catch (e) { list = []; }
    sel.innerHTML = '<option value="">全部知识点</option>' + list.map(k => '<option value="' + esc(k) + '">' + esc(k) + '</option>').join('');
  }

  async function generateQuiz() {
    /**
     * ★ 了解程度门禁（2026-10-31）
     * AI 不了解学生时出卷 = 乱编（用户原话）。
     * 至少要有：问卷 + 3 科试卷证据（knowsStudent.canQuiz ≥40）。
     */
    const know = (typeof StudentProfile !== 'undefined') ? StudentProfile.knowsStudent() : null;
    if (know && !know.canQuiz) {
      showGateCard('quiz', know);
      return;
    }

    // 门禁通过 → 恢复设置区显示 + 移除门禁卡
    try {
      const qp = $('page-quiz');
      if (qp) {
        const g = qp.querySelector('[data-gate-card]');
        if (g) g.remove();
        const settings = qp.querySelector('.card.no-print');
        if (settings) settings.style.display = '';
      }
    } catch (e) {}

    const btn = $('btn-gen-quiz');
    btn.disabled = true; btn.textContent = 'AI 出题中…';
    try {
      const quiz = await QuizEngine.generate({
        subject: $('q-subject').value,
        knowledge: $('q-knowledge').value,
        difficulty: $('q-difficulty').value,
        type: $('q-type').value,
        count: $('q-count').value,
        timeLimit: $('q-time').value,
        onlyCovered: $('q-only-covered') ? $('q-only-covered').checked : true,
      });
      $('quiz-area').classList.remove('hidden');
      $('quiz-result').classList.add('hidden');
      const tb = Storage.getSubjectTextbook(quiz.subject);
      $('quiz-title').textContent = quiz.subject + ' · ' + quiz.questions.length + ' 题' +
        (quiz.timeLimit > 0 ? ' · 限时 ' + quiz.timeLimit + ' 分钟' : '') +
        (tb ? ' · 范围：' + [tb.edition, tb.unit].filter(Boolean).join(' ') : ' · ⚠ 未设教材进度');
      QuizEngine.render(quiz, 'quiz-questions');
      toast('试卷已生成', 'success');
      $('quiz-area').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast('出题失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '生成试卷并开始';
    }
  }

  async function submitQuiz() {
    const btn = $('btn-submit-quiz');
    btn.disabled = true; btn.textContent = 'AI 批改中…';
    try {
      const result = await QuizEngine.grade();
      if (!result) { toast('没有进行中的试卷', 'warning'); return; }
      const quiz = QuizEngine.getQuiz();

      // 结果容器
      $('quiz-result').classList.remove('hidden');
      $('quiz-result').innerHTML =
        '<div class="card"><div class="card-header"><h3>测验结果</h3>' +
        '<button class="btn btn-sm btn-secondary no-print" onclick="window.print()">打印结果</button></div>' +
        '<div class="result-score" id="result-score"></div>' +
        '<div id="result-detail"></div>' +
        '<div id="result-gain"></div>' +
        '<div id="result-review"></div></div>';
      QuizEngine.renderResult(result, 'result-detail', 'result-review');

      // ★ 每次试卷后估算进步（六科不齐时只更新单科，不编总分）
      $('result-gain').innerHTML = '<div class="thinking"><span class="spinner"></span>正在估算这次测验带来的影响…</div>';
      const after = await estimateProgress(quiz.subject + ' 测验');
      const unlock = unlockStatus();

      if (after.total == null) {
        $('result-gain').innerHTML =
          '<div class="ai-box" style="margin-top:18px">' +
          '这次「' + esc(quiz.subject) + '」的记录已经存下了。\n' +
          '不过现在还不给高考总分预估——你已经攒了 ' + unlock.papersDone + '/' + unlock.total +
          ' 科的试卷（每科需 ' + PAPERS_PER_SUBJECT + ' 份）。\n' +
          '数据不够时我不会用平均分硬凑一个数字给你。\n\n' +
          '还差：' + (after.missing.length ? after.missing.join('、') : '（已齐全，待生成单科分析）') +
          '</div>' +
          '<div class="btn-group" style="margin-top:12px">' +
          '<button class="btn btn-secondary btn-sm" data-goto="import">去上传作业</button>' +
          '<button class="btn btn-secondary btn-sm" data-goto="progress">看进度</button>' +
          '</div>';
      } else {
        const delta = after.delta == null ? 0 : after.delta;
        /**
         * ★ 区分「估计更新」和「学习进步」（2026-10-24 改）
         *
         * 旧版把估分变化直接叫「本次进步」，这是错的：
         *   一次测验后估分上升，可能只是因为系统拿到了新证据、
         *   重新判断了他的水平 —— 不代表他这次"提高了"多少分。
         *
         * 而且旧版用 fx5 显示 5 位小数（如 +3.14159），制造虚假精确感。
         *
         * 新版：
         *   · 主标签叫「估计更新」，说清这是证据变化
         *   · 只显示 1 位小数
         *   · 明确提示"这不等于你的学习进步"
         */
        const dir = delta > 0.05 ? 'up' : (delta < -0.05 ? 'down' : 'flat');
        const dColor = dir === 'up' ? 'var(--green)' : (dir === 'down' ? 'var(--red)' : 'var(--label-tertiary)');
        const dText = dir === 'flat' ? '基本持平' : ((delta > 0 ? '+' : '') + delta.toFixed(1));

        $('result-gain').innerHTML =
          '<div class="estimate-grid" style="margin-top:18px">' +
          '<div class="estimate-item"><div class="estimate-value">' + fx5(after.before != null ? after.before : after.total) + '</div><div class="estimate-label">测验前估计</div></div>' +
          '<div class="estimate-item"><div class="estimate-value" style="color:' + dColor + '">' +
            dText + '</div><div class="estimate-label">估计更新</div></div>' +
          '<div class="estimate-item"><div class="estimate-value">' + fx5(after.total) + '</div><div class="estimate-label">测验后估计</div></div>' +
          '<div class="estimate-item"><div class="estimate-value">' + fx5(round5(Number(Storage.getGoal().target) - after.total)) + '</div><div class="estimate-label">距目标</div></div>' +
          '</div>' +
          '<div class="hint" style="margin-top:10px;font-size:11.5px;line-height:1.7">' +
          '「估计更新」是系统拿到这次成绩后对<b>你当前水平</b>的重新判断，不等于你这次提高了多少分。<br>' +
          '真正的进步看「进度追踪」里多次相同难度的表现。' +
          '</div>';
      }

      remember('ai', '【' + quiz.subject + '测验】得分 ' + result.score + '/' + result.total +
        (after.total != null ? '，本次提分估算 ' + (after.delta >= 0 ? '+' : '') + after.delta : '（数据未齐，暂不出总分）') + '。' +
        ((result.analysis && result.analysis.analysis) || ''), 'quiz');

      const gotoBtns = $('result-gain').querySelectorAll('[data-goto]');
      gotoBtns.forEach(b => b.addEventListener('click', () => navigate(b.dataset.goto)));

      $('quiz-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('批改完成：' + result.score + '/' + result.total, 'success');
      refreshShell();
    } catch (e) {
      toast('批改失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '提交答案';
    }
  }

  /**
   * 重新估算。**只有六科数据齐全时才会产出总分**；
   * 否则只更新单科（有数据的科目），不写总分、不记提分历史。
   */
  async function estimateProgress(reason) {
    const goal = Storage.getGoal();
    const records = Storage.getRecords();
    const mistakes = Storage.getMistakes();
    const papers = Storage.getPapers();
    const before = currentEstimate().total;

    // ★ 估算前先把教材覆盖率折算好（AI 对照高考考点），没学章节按 0 分才有数据
    try { await ensureTextbookCoverage({ silent: true }); } catch (e) { /* 折算失败按无覆盖处理 */ }

    let est;
    try {
      est = await ProgressEngine.aiEstimate(goal, records, mistakes, papers);
    } catch (e) {
      est = ProgressEngine.localEstimate(records, mistakes, goal, papers);
    }

    const subjectScores = {}, subjectProjected = {};
    Object.keys(est.subjectScores || {}).forEach(k => {
      subjectScores[k] = est.subjectScores[k] == null ? null : round5(est.subjectScores[k]);
      subjectProjected[k] = (est.subjectProjected || {})[k] == null ? null : round5(est.subjectProjected[k]);
    });

    // ★ total 为 null 表示"六科不齐，给不出总分" —— 那就不要存、不要显示
    const total = (est.total == null) ? null : round5(Number(est.total));
    const projected = (est.projected == null) ? null : round5(Number(est.projected));

    Storage.setTotalEstimate({
      total: total,
      projected: projected,
      // ★ P4：区间也要存，否则刷新后区间就没了（预测区间是要长期跟踪的）
      currentRange: est.currentRange || null,
      totalRange: est.totalRange || null,
      subjectScores: subjectScores,
      subjectProjected: subjectProjected,
      covered: est.covered || [],
      missing: est.missing || [],
      coverage: est.coverage || 0,
      totalSubjects: est.totalSubjects || 6,
      confidence: est.confidence,
      method: est.method || 'ai',
      analysis: est.analysis || '',
      suggestion: est.suggestion || '',
      keyGains: est.keyGains || [],
      evidence: storeEvidence(est.evidence),
      daysLeft: est.daysLeft,
    });

    // 只有拿到总分才记提分历史，避免历史里混进一堆 null
    if (total != null) {
      Storage.addEst({
        total: total,
        projected: projected,
        delta: (before != null) ? round5(total - before) : 0,
        reason: reason || '',
        method: est.method || 'ai',
      });
    }

    /**
     * ★ P5（2026-10-10）：把这次预测**原样存档**，供将来比对真实成绩。
     *
     * 这是唯一能证明"估分准不准"的路径：
     *   现在存下预测 → 将来录入真考分 → 算 MAE / 偏差 / 区间覆盖率。
     * 在这之前，任何"准确率"的说法都是没有依据的。
     *
     * 注意：只要有任意一科有分就存（不等六科齐全），否则数据攒不起来。
     */
    try {
      if (typeof Backtest !== 'undefined') {
        const nQ = (est.evidence || []).reduce((s, e) => s + (Number(e.nQuestions) || 0), 0);
        Backtest.record({
          daysLeft: est.daysLeft,
          total: total,
          projected: projected,
          currentRange: est.currentRange || null,
          totalRange: est.totalRange || null,
          subjectScores: est.subjectScores || {},
          subjectProjected: est.subjectProjected || {},
          subjectProjectedRange: est.subjectProjectedRange || {},
          confidence: est.confidence,
          method: est.method || 'ai',
          evidence: est.evidence || [],
        }, {
          reason: reason || '',
          nPapers: papers.length,
          nQuestions: nQ,
        });
      }
    } catch (e) { console.warn('预测存档失败（不影响估算）:', e); }

    return {
      total: total,
      projected: projected,
      delta: (total != null && before != null) ? round5(total - before) : null,
      before: before,
      coverage: est.coverage || 0,
      missing: est.missing || [],
    };
  }

  // ════════════════════════════════════════════════════════════
  //  AI 辅导
  // ════════════════════════════════════════════════════════════
  /**
   * AI 助教页的模型选择（2026-10-17）
   *
   * 用户要求："AI 助教那里也要添加模型选择功能，或者自动路由功能"
   *   —— 启用 WorkBuddy 时列出它的模型（带积分倍率），否则只显示"跟随设置"。
   *   选中的只影响辅导对话，不改全局设置。
   */
  async function renderChatModelBar() {
    const sel = $('chat-model');
    if (!sel) return;

    if (!wbReady()) {
      sel.innerHTML = '<option value="">跟随设置（未启用 WorkBuddy）</option>';
      sel.value = '';
      const pool = $('chat-pool');
      if (pool) pool.innerHTML = '';
      return;
    }

    const r = await WB.models();
    const list = (r && r.models) || [];
    const saved = Storage.get('chat_model', '') || '';
    sel.innerHTML = '<option value="">自动路由（推荐）</option>' +
      list.map(m => {
        const price = m.mult == null ? '' : (m.mult === 0 ? ' · 免费' : ' · x' + m.mult);
        return '<option value="' + esc(m.id) + '"' + (m.id === saved ? ' selected' : '') + '>' +
          esc(m.name) + price + '</option>';
      }).join('');
    if (list.some(m => m.id === saved)) sel.value = saved;

    // 池状态
    const pool = $('chat-pool');
    if (pool) {
      const st = await WB.poolStatus();
      if (st && st.ok) {
        const cooling = st.cooling || [];
        pool.innerHTML = '<span class="wb-badge ok">' + st.healthy + '/' + st.total + ' 账号可用</span>' +
          (cooling.length ? cooling.map(c => '<span class="wb-badge cool">' + esc(c.id) +
            ' 冷却 ' + Math.ceil(c.secondsLeft / 60) + ' 分</span>').join('') : '');
      }
    }
  }

  /** 聊天用的模型（空 = 自动路由） */
  function chatModel() {
    try { return Storage.get('chat_model', '') || ''; } catch (e) { return ''; }
  }

  function renderChat() {
    const box = $('chat-messages');
    if (!box) return;
    const chatMsgs = Storage.getMemory().filter(m => m.tag === 'chat');
    box.innerHTML = chatMsgs.length
      ? chatMsgs.map(m => chatBubbleHTML(m.role, m.content)).join('')
      : chatBubbleHTML('ai', '你好，我是你的老师，也是你的班主任。\n\n我已经看过你的问卷和成绩了。有不会的题直接发给我，或者告诉我你今天卡在哪。');
    box.scrollTop = box.scrollHeight;
    const c = $('chat-memory-count');
    if (c) c.textContent = '记忆 ' + Storage.getMemory().length + ' 条';
  }

  function chatBubbleHTML(role, content) {
    const isUser = role === 'user';
    const body = isUser
      ? esc(content).replace(/\n/g, '<br>')
      : esc(content).replace(/^### (.+)$/gm, '<strong>$1</strong>').replace(/^## (.+)$/gm, '<strong>$1</strong>').replace(/\n/g, '<br>');
    return '<div class="chat-msg ' + (isUser ? 'user' : 'ai') + '">' +
      '<div class="chat-avatar">' + (isUser ? '我' : '师') + '</div>' +
      '<div class="chat-bubble">' + body + '</div></div>';
  }

  /** 发送消息。传 prefilled 时用它代替输入框内容（讲题 / 追问会用）。 */
  async function sendChat(prefilled) {
    const input = $('chat-input');
    const text = (prefilled != null ? String(prefilled) : input.value).trim();
    if (!text) return;
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) { toast('请先在「设置」里配置 API Key，或启用 WorkBuddy', 'warning'); return; }

    input.value = '';
    input.style.height = 'auto';
    remember('user', text, 'chat');
    renderChat();
    const box = $('chat-messages');
    box.insertAdjacentHTML('beforeend', '<div class="chat-msg ai" id="chat-pending"><div class="chat-avatar">师</div><div class="chat-bubble"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> 思考中…</div></div>');
    box.scrollTop = box.scrollHeight;

    const btn = $('btn-chat-send');
    btn.disabled = true;
    try {
      const reply = await ask(text, { maxTokens: 2000, temperature: 0.6, model: chatModel() || undefined });
      const p = $('chat-pending'); if (p) p.remove();
      remember('ai', reply, 'chat');
      renderChat();
    } catch (e) {
      const p = $('chat-pending'); if (p) p.remove();
      toast('AI 响应失败：' + e.message, 'error');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  拍照读题（多模态）
  //  流程：手机拍 → 传到电脑 → 拖进/粘贴 → 压缩 → 读图模型识别 → 判错归档
  // ════════════════════════════════════════════════════════════
  const PHOTO_MAX = 6;              // 一次最多几张，多了模型也看不清
  let photoImages = [];             // [{dataUrl,b64,mime,width,height,name,kb}]
  let photoResult = null;           // 最近一次识别结果

  function renderPhoto() {
    fillSubjectSelect('photo-subject', true);
    const vc = LLM.getVisionProvider();
    const chip = $('photo-model-chip');
    if (chip) {
      const ok = !!vc.apiKey && LLM.modelSupportsVision(vc.provider, vc.model);
      chip.textContent = '读图模型：' + (vc.name || vc.provider) + ' / ' + vc.model + (ok ? '' : '（未就绪，去设置）');
      chip.style.color = ok ? 'var(--green)' : 'var(--amber)';
    }
    renderPhotoPreview();
  }

  function renderPhotoPreview() {
    const box = $('photo-preview');
    if (!box) return;
    box.innerHTML = photoImages.map((im, i) =>
      '<div class="photo-thumb"><img src="' + im.dataUrl + '" alt="' + esc(im.name) + '" title="' + im.width + '×' + im.height + ' · ' + im.kb + 'KB">' +
      '<button data-rm="' + i + '" title="移除">✕</button></div>').join('');
    box.querySelectorAll('[data-rm]').forEach(b => {
      b.addEventListener('click', () => {
        photoImages.splice(parseInt(b.dataset.rm, 10), 1);
        renderPhotoPreview();
      });
    });
  }

  async function photoAddFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type && f.type.indexOf('image/') === 0);
    if (!files.length) { toast('请选择图片文件', 'warning'); return; }
    const room = PHOTO_MAX - photoImages.length;
    if (room <= 0) { toast('最多 ' + PHOTO_MAX + ' 张，先移除几张', 'warning'); return; }
    const take = files.slice(0, room);
    if (files.length > room) toast('一次最多 ' + PHOTO_MAX + ' 张，只取了前 ' + room + ' 张', 'warning');

    const status = $('photo-status');
    if (status) status.textContent = '正在压缩 ' + take.length + ' 张图片…';
    // 精度：图少时用更高分辨率（小字更清晰），图多时适度压缩
    const tier = compressTier(photoImages.length + take.length);
    for (const f of take) {
      try {
        photoImages.push(await compressImage(f, tier.maxDim, tier.quality));
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    renderPhotoPreview();
    if (status) {
      const total = photoImages.reduce((s, i) => s + i.kb, 0);
      status.textContent = photoImages.length ? ('共 ' + photoImages.length + ' 张，压缩后 ' + total + ' KB') : '';
    }
  }

  function photoClear() {
    photoImages = [];
    photoResult = null;
    renderPhotoPreview();
    const r = $('photo-result'); if (r) r.innerHTML = '';
    const s = $('photo-status'); if (s) s.textContent = '';
  }

  function photoPrompt(subjectHint, kind, batch) {
    const kindLabel = kind === 'exam' ? '一份考试卷' : kind === 'single' ? '一道我不会的题' : '一份作业／练习';
    const nImg = batch ? batch.nImages : photoImages.length;
    const batchInfo = (batch && batch.batchCount > 1)
      ? '这是**第 ' + batch.batchIndex + '/' + batch.batchCount + ' 批**，对应整卷第 ' +
        batch.pageFrom + '~' + batch.pageTo + ' 张图（共 ' + batch.totalPages + ' 张）。只处理这一批。'
      : '';
    const pageField = (batch && batch.batchCount > 1)
      ? '     "difficulty": 1到5的整数, "reason": "错因，答对则留空", "page": 这道题在**整卷**里的图号（只能是 ' + batch.pageFrom + '~' + batch.pageTo + '）}'
      : '     "difficulty": 1到5的整数, "reason": "错因，答对则留空", "page": 这张题在第几张图}';
    return [
      '下面是我用手机拍的 ' + nImg + ' 张照片，内容是' + kindLabel + '。',
      subjectHint ? '科目是「' + subjectHint + '」。' : '科目请你判断。',
      batchInfo,
      '',
      '请你像阅卷老师一样逐题处理：',
      '1) 把图片里**所有真的有题干的题目**原样抄录出来（数学式子用普通文本写，例如 x^2、√3、1/2、≥）；',
      '   **一题都不许漏**，也不许把多道小题合并成一条，更不许只列错题、跳过做对的题；',
      '   页眉页脚、页码、装订线、空白答题格、插图周围的空白都**不算题目**，不要为它们生成条目；',
      '   **答题说明不算题目**（如"写作词数应为 80 左右""请按如下格式作答""分值说明"）；',
      '   题干抄不出来的条目不要输出；整张是空白页就返回空的 questions；',
      '   **看不清的地方**写"（看不清）"，不确定对错时 isCorrect 填 null —— 宁可说不确定，也不许瞎猜。',
      '2) 识别我的作答；',
      '3) 逐题判断对错；如果图上没有我的作答，correctAnswer 填你认为的正确答案，isCorrect 填 null；',
      '4) 逐题标出难度（1~5 整数，**拿高考真题当尺子**：1送分 2基础 3中等=高考平均 4难题 5压轴，不要一律填 3）；',
      '5) 每题标出考查的知识点；',
      '6) 错题说明错因（具体的，不要写"粗心"这种废话）。',
      '',
      '严格只返回下面这个 JSON，不要 Markdown 代码块，不要任何多余文字：',
      '{',
      '  "subject": "科目",',
      '  "title": "试卷或题目名称",',
      '  "score": 得分数字或null,',
      '  "fullScore": 满分数字或null,',
      '  "questions": [',
      '    {"no": 题目在图上印的题号, "text": "题干", "options": ["A. …", "B. …"], "studentAnswer": "我的作答或null",',
      '     "correctAnswer": "正确答案", "isCorrect": true或false或null, "knowledge": "知识点",',
      pageField,
      '  ],',
      '  "mistakes": [{"knowledge": "知识点", "reason": "为什么会错", "suggestion": "怎么补"}],',
      '  "summary": "整体评价，150 字以内",',
      '  "teacherComment": "一句话点评"',
      '}',
    ].join('\n');
  }

  async function analyzePhoto() {
    if (!photoImages.length) { toast('先拍照或选一张图片', 'warning'); return; }
    const vc = LLM.getVisionProvider();
    if (!vc.apiKey && !wbReady()) {
      toast('读图模型还没配 Key，去「设置 → 读图模型」', 'error');
      navigate('settings');
      return;
    }

    const btn = $('btn-photo-analyze');
    const status = $('photo-status');
    const box = $('photo-result');
    btn.disabled = true;
    btn.textContent = 'AI 读题中…';
    if (status) status.textContent = '正在把 ' + photoImages.length + ' 张图交给 ' + vc.model + '…';
    box.innerHTML = '<div class="card"><div class="thinking"><span class="spinner"></span>AI 正在抄题、判对错、标知识点…（图多或题多时会久一点）</div></div>';

    try {
      const subjectHint = $('photo-subject').value;
      const kind = $('photo-kind').value;
      // 分批识别：图多时一次全发会让模型漏题（和上传试卷同一套逻辑）
      const batches = chunkArray(photoImages, RECOG_BATCH);
      const parts = [];
      for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const pageFrom = bi * RECOG_BATCH + 1;
        const pageTo = pageFrom + batch.length - 1;
        const po = {
          subjectPick: subjectHint, type: kind === 'exam' ? 'exam' : 'homework',
          nImages: batch.length, batchIndex: bi + 1, batchCount: batches.length,
          pageFrom: pageFrom, pageTo: pageTo, totalPages: photoImages.length,
        };
        if (status) status.textContent = batches.length > 1
          ? ('正在识别第 ' + (bi + 1) + '/' + batches.length + ' 批（第 ' + pageFrom + '~' + pageTo + ' 张）…')
          : ('正在把 ' + photoImages.length + ' 张图交给 ' + vc.model + '…');
        if (batches.length > 1) {
          box.innerHTML = '<div class="card"><div class="thinking"><span class="spinner"></span>AI 正在识别第 ' +
            (bi + 1) + '/' + batches.length + ' 批…（分批是为了不漏题）</div></div>';
        }
        const res = await LLM.vision(batch, photoPrompt(subjectHint, kind, po), {
          maxTokens: RECOG_MAX_TOKENS,
          temperature: 0.1,
        });
        let rr;
        try {
          rr = parseJSON(res.text);
        } catch (firstErr) {
          if (res.truncated) {
            box.innerHTML = '<div class="card"><div class="thinking"><span class="spinner"></span>第 ' + (bi + 1) + ' 批输出被字数上限截断了，正在用精简格式重试…</div></div>';
            const slim = await LLM.vision(batch,
              '用最精简的 JSON 复述这批图里的题，不要解释：每道只给 题号/题干(可截断)/我的答案/正确答案/对错/知识点，'
              + '再给一句话总评。只返回：{"subject":"","title":"","score":null,"fullScore":null,'
              + '"questions":[{"no":1,"text":"","studentAnswer":"","correctAnswer":"","isCorrect":null,"knowledge":"","reason":""}],'
              + '"mistakes":[{"knowledge":"","reason":"","suggestion":""}],"summary":""}',
              { maxTokens: 8000, temperature: 0.1 });
            try {
              rr = parseJSON(slim.text);
            } catch (e2) { throw firstErr; }
          } else {
            throw firstErr;
          }
        }
        if (!rr.questions) rr.questions = [];
        parts.push(normalizeVision(rr));
      }
      const r = mergeVisionParts(parts);
      photoResult = r;
      renderPhotoResult(r);
      archivePhotoResult(r, kind === 'exam' ? 'exam' : kind === 'single' ? 'single' : 'homework');
      if (status) status.textContent = '';
      toast('读题完成：识别到 ' + r.questions.length + ' 道题', 'success');
    } catch (e) {
      const hint = e.raw
        ? '点「AI 读题并批改」可以再试一次，或减少图片张数。'
        : '检查一下：①「设置 → 读图模型」是否选了支持图片的模型；②Key 是否有效；③图片是不是太大或太糊。';
      box.innerHTML = '<div class="card">' + jsonFailHTML(e, hint) + '</div>';
      if (status) status.textContent = '';
      toast('读题失败：' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'AI 读题并批改';
    }
  }

  function renderPhotoResult(r) {
    const qs = r.questions || [];
    const wrong = qs.filter(q => q.isCorrect === false);
    const right = qs.filter(q => q.isCorrect === true);

    let html = '<div class="card">';
    html += '<div class="card-header"><h3>' + esc(r.title || '识别结果') + '</h3>' +
      '<span class="card-sub">' + esc(r.subject || '') + ' · 共 ' + qs.length + ' 题' +
      (right.length ? ' · 对 ' + right.length : '') + (wrong.length ? ' · 错 ' + wrong.length : '') + '</span></div>';

    html += '<div class="estimate-grid">' +
      '<div class="estimate-item"><div class="estimate-value">' + qs.length + '</div><div class="estimate-label">识别题目</div></div>' +
      '<div class="estimate-item"><div class="estimate-value" style="color:var(--green)">' + right.length + '</div><div class="estimate-label">做对</div></div>' +
      '<div class="estimate-item"><div class="estimate-value" style="color:var(--red)">' + wrong.length + '</div><div class="estimate-label">做错</div></div>' +
      '<div class="estimate-item"><div class="estimate-value">' +
        (r.score != null && isFinite(Number(r.score)) ? fx5(r.score) : '--') + '</div><div class="estimate-label">估计得分</div></div>' +
      '</div>';

    if (r.summary) html += '<div class="ai-box" style="margin-top:14px">' + esc(r.summary) + '</div>';
    if (r.teacherComment) html += '<div class="ai-box" style="margin-top:10px">' + esc(r.teacherComment) + '</div>';
    html += '</div>';

    // 逐题
    if (qs.length) {
      html += '<div class="card"><div class="card-header"><h3>逐题</h3></div>';
      qs.forEach(q => {
        const v = q.isCorrect === true ? ['ok', '✓ 做对'] : q.isCorrect === false ? ['bad', '✗ 做错'] : ['unknown', '— 未作答'];
        const opts = Array.isArray(q.options) && q.options.length
          ? '<div class="q-options-read">' + q.options.map(o => esc(o)).join('<br>') + '</div>' : '';
        html += '<div class="q-item">' +
          '<div class="q-head"><span class="q-no">第 ' + (q.no || '?') + ' 题</span>' +
          '<span class="q-verdict ' + v[0] + '">' + v[1] + '</span>' +
          (q.knowledge ? '<span class="tag tag-' + esc(r.subject || '') + '">' + esc(q.knowledge) + '</span>' : '') +
          '</div>' +
          '<div class="q-text">' + esc(q.text || '') + '</div>' + opts +
          '<div class="ans-line">' +
            '<span><span class="k">我的作答：</span><span class="' + (q.isCorrect === false ? 'v-bad' : 'v-ok') + '">' + esc(q.studentAnswer || '（没写）') + '</span></span>' +
            (q.isCorrect === false && q.correctAnswer ? '<span><span class="k">正确答案：</span><span class="v-ok">' + esc(q.correctAnswer) + '</span></span>' : '') +
          '</div>' +
          (q.reason ? '<div class="reason-box">错因：' + esc(q.reason) + '</div>' : '') +
          '</div>';
      });
      html += '</div>';
    }

    // 知识点清单
    const kws = [];
    (r.mistakes || []).forEach(m => { if (m.knowledge && kws.indexOf(m.knowledge) < 0) kws.push(m.knowledge); });
    wrong.forEach(q => { if (q.knowledge && kws.indexOf(q.knowledge) < 0) kws.push(q.knowledge); });
    if (r.mistakes && r.mistakes.length) {
      html += '<div class="card"><div class="card-header"><h3>易错点</h3></div>';
      html += r.mistakes.map(m =>
        '<div class="wk-item"><div class="wk-head"><span class="wk-name">' + esc(m.knowledge || '未分类') + '</span></div>' +
        '<div class="wk-stats">' + esc(m.reason || '') + (m.suggestion ? '<br>怎么补：' + esc(m.suggestion) : '') + '</div></div>').join('');
      html += '</div>';
    }

    // 下一步动作
    html += '<div class="card"><div class="solve-actions">' +
      '<button class="btn btn-primary" id="btn-photo-explain">让 AI 讲这几道错题</button>' +
      '<button class="btn btn-accent" id="btn-photo-course">围绕错题生成课程</button>' +
      '<button class="btn btn-secondary" id="btn-photo-mistakes">加入错题本</button>' +
      '<button class="btn btn-secondary" id="btn-photo-practice">出同类题练习</button>' +
      '<button class="btn btn-secondary" id="btn-photo-toimport">记到成绩里</button>' +
      '</div></div>';

    $('photo-result').innerHTML = html;

    on('btn-photo-explain', 'click', photoExplain);
    on('btn-photo-course', 'click', photoToCourse);
    on('btn-photo-mistakes', 'click', () => addPhotoMistakes(true));
    on('btn-photo-practice', 'click', photoPractice);
    on('btn-photo-toimport', 'click', photoToImport);
  }

  /**
   * 把这一次读题的错题**生成成一门课**（不只是讲一遍）。
   * 挑最典型的 1~3 道错题合成一个需求，交给课程引擎。
   */
  async function photoToCourse() {
    if (!photoResult) return;
    const subject = photoResult.subject || ($('photo-subject') && $('photo-subject').value) || '';
    const wrongs = (photoResult.questions || []).filter(q => q.isCorrect === false);
    if (!wrongs.length) { toast('这次没有错题，可以把不会的题单独拍一下', 'warning'); return; }

    const picked = wrongs.slice(0, 3);
    const list = picked.map((q, i) => (i + 1) + ') ' + (q.text || '') +
      (q.knowledge ? '（知识点：' + q.knowledge + '）' : '') +
      (q.studentAnswer ? ' 我答的是：' + q.studentAnswer : '')).join('\n');
    const kws = picked.map(q => q.knowledge).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);

    await courseFromProblem({
      question: '我在这些题上错了，请把它们讲透：\n' + list,
      subject: subject,
      knowledge: kws.join('、'),
      studentAnswer: picked[0].studentAnswer || '',
      correctAnswer: picked[0].correctAnswer || '',
    });
  }

  /** 归档：写试卷、错题、共享记忆，让后面所有模块都知道这次读题 */
  function archivePhotoResult(r, type) {
    const subject = r.subject || $('photo-subject').value || '综合';
    const score = Number(r.score);
    const full = Number(r.fullScore);
    const hasScore = r.score != null && isFinite(score) && isFinite(full) && full > 0;

    const kws = [];
    (r.mistakes || []).forEach(m => { if (m.knowledge && kws.indexOf(m.knowledge) < 0) kws.push(m.knowledge); });
    (r.questions || []).forEach(q => { if (q.isCorrect === false && q.knowledge && kws.indexOf(q.knowledge) < 0) kws.push(q.knowledge); });

    const savedPaper = Storage.addPaper({
      subject: subject, type: 'photo', kind: type,
      score: hasScore ? score : null, fullScore: hasScore ? full : null,
      date: new Date().toISOString().slice(0, 10),
      title: r.title || '', images: photoImages.length,
      knowledge: kws, summary: r.summary || '',
      questionCount: (r.questions || []).length,
      wrongCount: (r.questions || []).filter(q => q.isCorrect === false).length,
      questions: r.questions || [],
    });
    r._paperId = savedPaper.id;

    remember('user',
      '【拍照读题】' + subject + '「' + (r.title || '') + '」识别 ' + (r.questions || []).length + ' 题' +
      (hasScore ? '，估计 ' + score + '/' + full : '') +
      (kws.length ? '，暴露的易错点：' + kws.join('、') : ''), 'photo');

    Storage.addAct({
      icon: '▣',
      title: '读题：' + subject + '「' + (r.title || '') + '」' + (r.questions || []).length + ' 题',
    });
    updateBadges();
  }

  function addPhotoMistakes(showToast) {
    if (!photoResult) return;
    const subject = photoResult.subject || $('photo-subject').value || '综合';
    let n = 0;
    (photoResult.questions || []).forEach(q => {
      if (q.isCorrect !== false) return;
      Storage.addMistake({
        subject: subject,
        knowledge: q.knowledge || '未分类',
        question: q.text || '',
        correctAnswer: q.correctAnswer || '',
        wrongAnswer: q.studentAnswer || '',
        explanation: q.reason || '',
        type: 'photo',
      });
      n++;
    });
    (photoResult.mistakes || []).forEach(m => {
      if (!m.knowledge) return;
      Storage.addMistake({
        subject: subject, knowledge: m.knowledge,
        question: m.reason || m.knowledge, explanation: m.suggestion || '', type: 'photo',
      });
      n++;
    });
    updateBadges();
    if (showToast) toast(n ? ('已加入错题本 ' + n + ' 条') : '没有错题可加', n ? 'success' : 'warning');
    return n;
  }

  function photoExplain() {
    if (!photoResult) return;
    const subject = photoResult.subject || '';
    const wrong = (photoResult.questions || []).filter(q => q.isCorrect === false);
    const list = (wrong.length ? wrong : (photoResult.questions || [])).slice(0, 6);
    if (!list.length) { toast('没有可讲的题目', 'warning'); return; }

    const text = '老师，这是我刚拍给你的' + (subject ? '「' + subject + '」' : '') + '题目，'
      + (wrong.length ? '这几道我做错了，请一道一道讲清楚' : '请帮我讲一下') + '：\n'
      + '（每道题请按这个顺序说：①考的是哪个知识点 ②正确的思路是什么 ③我当时为什么会错 ④给我一句能记住的话）\n\n'
      + list.map((q, i) => (i + 1) + '. ' + (q.text || '')
          + (Array.isArray(q.options) && q.options.length ? '\n   ' + q.options.join('  ') : '')
          + '\n   我的答案：' + (q.studentAnswer || '（没写）')
          + '\n   正确答案：' + (q.correctAnswer || '（未知）')
          + (q.knowledge ? '\n   知识点：' + q.knowledge : '')
          + (q.reason ? '\n   我的错因：' + q.reason : '')).join('\n\n');

    navigate('chat');
    sendChat(text);
  }

  function photoPractice() {
    if (!photoResult) return;
    const kws = [];
    (photoResult.mistakes || []).forEach(m => { if (m.knowledge && kws.indexOf(m.knowledge) < 0) kws.push(m.knowledge); });
    (photoResult.questions || []).forEach(q => {
      if (q.isCorrect === false && q.knowledge && kws.indexOf(q.knowledge) < 0) kws.push(q.knowledge);
    });

    navigate('quiz');
    fillSubjectSelect('q-subject');
    if (photoResult.subject) {
      const ok = $('q-subject').querySelector('option[value="' + photoResult.subject + '"]');
      if (ok) $('q-subject').value = photoResult.subject;
    }
    fillKnowledgeSelect();
    if (kws.length) {
      const sel = $('q-knowledge');
      const v = kws[0];
      let opt = Array.prototype.find.call(sel.options, o => o.value === v);
      if (!opt) {
        opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        sel.appendChild(opt);
      }
      sel.value = v;
    }
    $('q-count').value = '5';
    $('q-difficulty').value = 'normal';
    toast('已按「' + (kws[0] || '综合') + '」出题', 'success');
    generateQuiz();
  }

  /** 把这次读题的成绩记进成绩库（会参与估算和单科分析） */
  function photoToImport() {
    if (!photoResult) return;
    const subject = photoResult.subject || $('photo-subject').value;
    if (!subject) { toast('先确认科目', 'warning'); return; }
    let score = Number(photoResult.score);
    let full = Number(photoResult.fullScore);
    if (!isFinite(score) || !isFinite(full) || full <= 0) {
      const qs = photoResult.questions || [];
      const right = qs.filter(q => q.isCorrect === true).length;
      if (!qs.length) { toast('没有可记的分数', 'warning'); return; }
      full = qs.length * 10;
      score = right * 10;
      toast('图上没写满分，按 ' + full + ' 分制折算', 'warning');
    }
    const data = {
      source: 'photo', name: photoResult.title || (subject + ' 拍照读题'),
      date: new Date().toISOString().slice(0, 10),
      subjects: [{ subject: subject, score: score, fullScore: full }],
    };
    const paper = Storage.addPaper({ subject: subject, type: 'photo', kind: 'photo', score: score, fullScore: full, date: data.date, name: data.name, title: data.name, questions: photoResult.questions || [] });
    Storage.addRecord({
      type: 'import', source: srcLabel('upload'), subject: subject,
      kind: 'photo',   // 拍照读题多为作业/练习册，来源档要如实标成 photo
      score: score, fullScore: full, importData: data, paperId: paper.id,
    });
    renderPhotoResultFlash('已记入成绩：' + subject + ' ' + score + '/' + full);
    toast('已记入成绩', 'success');

    const ready = Storage.countPapers(subject) >= 5 && !Storage.getSubjectAnalyses()[subject];
    if (ready) {
      toast('「' + subject + '」已满 5 份，开始单科分析', 'success');
      runSubjectAnalyses([subject]);
    } else {
      estimateProgress('拍照读题 ' + subject).then(() => refreshShell()).catch(() => {});
    }
    updateBadges();
  }

  function renderPhotoResultFlash(msg) {
    const box = $('photo-result');
    if (!box) return;
    let bar = $('photo-flash');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'photo-flash';
      bar.className = 'hint';
      bar.style.marginBottom = '12px';
      box.insertBefore(bar, box.firstChild);
    }
    bar.textContent = msg;
    bar.style.color = 'var(--green)';
  }

  // ════════════════════════════════════════════════════════════
  //  学习监控
  // ════════════════════════════════════════════════════════════
  const camStats = { focused: 0, distract: 0, attention: 0 };

  // ════════════════════════════════════════════════════════════
  //  可视化课程（生成课程 → 一节一节学 → 边学边问）
  //  引擎在 js/course.js（数据/流程），版式在 js/course-view.js（渲染）
  // ════════════════════════════════════════════════════════════
  const courseUI = {
    busy: false,        // 正在生成/调用模型
    asking: false,      // 正在追问
    grading: false,     // 正在判分
    askLog: [],         // 当前页的问答（内存态，避免每次重渲染都丢）
    pickedOption: null, // 当前练习选中的选项（未提交）
  };

  function renderCourse() {
    const area = $('course-area');
    if (!area) return;
    // 科目下拉
    fillSubjectSelect('course-subject', true);
    const chip = $('course-model-chip');
    if (chip) {
      const cfg = LLM.getConfig();
      const p = LLM.PROVIDERS[cfg.provider];
      chip.textContent = cfg.apiKey
        ? '生成模型：' + (p ? p.name : cfg.provider) + ' / ' + (cfg.model || '')
        : '未配置模型（去设置）';
      chip.style.color = cfg.apiKey ? 'var(--green)' : 'var(--amber)';
    }

    const st = CourseEngine.state();
    if (!st.course) {
      area.innerHTML = CourseView.listHTML(CourseEngine.list());
      return;
    }
    if (st.view && st.view.mode === 'list') {
      area.innerHTML = CourseView.outlineHTML(st.course, CourseEngine.progress());
      return;
    }
    // 学习界面。注意：课程可能在别处被关闭/删除，所以用引擎的安全取法，
    // 取不到就退回列表页（以前直接 st.course.outline[...] 会在那种时刻抛错）
    const lesson = CourseEngine.currentLesson();
    if (!lesson) { area.innerHTML = CourseView.listHTML(CourseEngine.list()); return; }
    if (!lesson.pages) {
      area.innerHTML = courseGeneratingHTML(lesson.title);
      ensureLessonLoaded(st.view.lessonIndex);
      return;
    }
    const opts = {
      askLog: courseUI.askLog,
      asking: courseUI.asking,
      pickedOption: courseUI.pickedOption,
      // 朗读栏所需的数据（渲染层不直接依赖 Speech 单例）
      ttsReady: Speech.serviceOk(),
      ttsError: Speech.errorText(),
      voices: Speech.voices(),
      voice: Speech.voice(),
      rate: Speech.rate(),
      autoRead: Speech.autoRead(),
      speaking: Speech.isPlaying(),
      paused: Speech.isPaused(),
    };
    area.innerHTML = CourseView.learnHTML(st.course, st.view.lessonIndex, st.view.pageIndex, opts);
    // 问答记录滚到底
    const log = area.querySelector('.cv-ask-log');
    if (log) log.scrollTop = log.scrollHeight;
    // ★ 自动连讲：只在开启且服务可用时读；练习页只念题目（Speech 内部已保证不念答案）
    if (courseUI.autoReadPending) {
      courseUI.autoReadPending = false;
      if (Speech.autoRead() && Speech.serviceOk()) speakCurrentPage('auto');
    }
  }

  /** 让老师讲当前这一页 */
  function speakCurrentPage(why) {
    const st = CourseEngine.state();
    const lesson = CourseEngine.currentLesson();
    if (!st.view || !lesson || !lesson.pages) return;
    const pg = lesson.pages[st.view.pageIndex];
    if (!pg) return;
    Speech.speakPage(pg, {
      onError: (m) => toast(m, 'warning'),
      onProgress: () => { /* 需要显示"第几句"时可在这里更新 UI */ },
    }).then(ok => {
      if (ok === false && why !== 'auto') {
        // 服务没起来时给一次明确的探测，避免用户以为是按钮坏了
        Speech.check(true).then(() => renderCourse());
      }
      renderCourse();
    });
  }

  /**
   * 设置页：语音配置区。
   * 服务没起来时也要能填地址（可能是别的机器/端口），所以不隐藏输入框。
   *
   * ★ 健壮性修复（2026-10-17）：speech.js 没加载时这里会抛 ReferenceError，
   *   而它是在 init() 里被调用的 —— 一崩就白屏。现在整体包在 typeof 保护里。
   */
  function renderTtsSettings() {
    if (typeof Speech === 'undefined') {
      const st0 = $('set-tts-state');
      if (st0) { st0.textContent = '未加载'; st0.style.color = 'var(--label-tertiary)'; }
      return;
    }
    const baseEl = $('set-tts-base');
    if (baseEl && !baseEl.value) baseEl.value = Speech.apiBase() || '';
    const rateEl = $('set-tts-rate');
    if (rateEl) rateEl.value = String(Speech.rate());
    const sel = $('set-tts-voice');
    if (sel) {
      const vs = Speech.voices();
      const cur = Speech.voice();
      sel.innerHTML = vs.length
        ? vs.map(v => '<option value="' + esc(v.id) + '"' + (v.id === cur ? ' selected' : '') + '>'
            + esc(v.label || v.id) + '</option>').join('')
        : '<option value="">（服务未启动，先在下面点「检测服务」）</option>';
    }
    const st = $('set-tts-state');
    const h = Speech.serviceOk();
    if (st) {
      st.textContent = Speech.serviceOk() ? '已连接' : '未连接';
      st.style.color = h ? 'var(--green)' : 'var(--amber)';
    }
  }

  /** 设置页：检测语音服务，并把结果写进状态行 */
  async function ttsCheck(explicit) {
    const st = $('set-tts-status');
    if (st) st.textContent = '正在检测 ' + Speech.apiBase() + ' …';
    const h = await Speech.check(true);
    if (h.ok) {
      if (st) {
        st.textContent = '✓ 已连接 · ' + (h.voices || []).length + ' 个音色 · '
          + (h.loaded ? '模型已加载' : '模型将在首次合成时加载（约 10 秒）');
        st.style.color = 'var(--green)';
      }
      if (explicit) toast('语音服务已连接', 'success');
    } else {
      if (st) {
        st.textContent = '✗ 连不上（' + (h.reason || '') + '）· 请在项目目录运行：python tts\\tts_server.py --preload';
        st.style.color = 'var(--red)';
      }
      if (explicit) toast('连不上语音服务', 'error');
    }
    renderTtsSettings();
    return h;
  }

  function courseGeneratingHTML(label) {
    return '<div class="cv-learn"><div class="cv-generating">'
      + '<div class="cv-gen-title">正在生成「' + esc(label || '课程') + '」…</div>'
      + '<div class="cv-gen-sub">按你的需求定制内容，十几秒左右</div>'
      + '<div class="cv-gen-bars">'
      + '<div class="cv-gen-bar skeleton w80"></div>'
      + '<div class="cv-gen-bar skeleton w70"></div>'
      + '<div class="cv-gen-bar skeleton w60"></div>'
      + '</div></div></div>';
  }

  /** 打开某一节时按需生成内容（只生成一次，之后走缓存） */
  async function ensureLessonLoaded(lessonIndex) {
    const st = CourseEngine.state();
    if (!st.course || !st.course.outline[lessonIndex]) return;
    const lesson = st.course.outline[lessonIndex];
    if (lesson.pages) return;
    if (courseUI.busy) return;
    courseUI.busy = true;
    try {
      await CourseEngine.loadLesson(lessonIndex);
      toast('「' + lesson.title + '」已生成', 'success');
    } catch (e) {
      toast('生成失败：' + e.message, 'error');
      const area = $('course-area');
      if (area) {
        area.innerHTML = '<div class="cv-learn"><div class="cv-generating">'
          + '<div class="cv-gen-title">这一节没生成出来</div>'
          + '<div class="cv-gen-sub">' + esc(e.message) + '</div>'
          + '<div class="btn-group" style="justify-content:center"><button class="btn btn-secondary btn-sm" data-cv="back-outline">返回目录</button>'
          + '<button class="btn btn-primary btn-sm" data-cv="lesson" data-idx="' + lessonIndex + '">重试</button></div>'
          + '</div></div>';
      }
    } finally {
      courseUI.busy = false;
    }
  }

  /** 建课（只出目录） */
  async function createCourse() {
    const input = $('course-request');
    const request = (input && input.value || '').trim();
    if (!request) { toast('先说说你想学什么', 'warning'); if (input) input.focus(); return; }
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) { toast('请先在「设置」里配置 API Key，或启用 WorkBuddy', 'warning'); return; }
    if (courseUI.busy) return;

    const btn = $('btn-course-create');
    courseUI.busy = true;
    if (btn) { btn.disabled = true; btn.textContent = '规划中…'; }
    const area = $('course-area');
    if (area) area.innerHTML = courseGeneratingHTML(request);

    try {
      // 参考薄弱点：只在用户勾选时带上
      let weakPoints = [];
      if ($('course-use-weak') && $('course-use-weak').checked) {
        weakPoints = Storage.getMistakes().slice(-30)
          .map(m => m.knowledge).filter(Boolean)
          .filter((v, i, a) => a.indexOf(v) === i).slice(0, 8);
      }
      const tb = Storage.getSubjectTextbook($('course-subject').value || '');
      const course = await CourseEngine.createCourse({
        request: request,
        subject: $('course-subject') ? $('course-subject').value : '',
        grade: Storage.getGoal().grade || '',
        level: $('course-level') ? $('course-level').value : '',
        textbook: tb ? (tb.edition || '') + ' ' + (tb.unit || '') : '',
        weakPoints: weakPoints,
      });
      toast('目录已生成：' + course.outline.length + ' 节，点一节开始学', 'success');
      if (input) input.value = '';
      renderCourse();
    } catch (e) {
      toast('生成课程失败：' + e.message, 'error');
      if (area) area.innerHTML = jsonFailHTML(e, '可以换个说法再试一次。');
    } finally {
      courseUI.busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '生成课程'; }
    }
  }

  /**
   * 从一道具体的题建课（拍照读题 → 「讲这道题」那条路径）。
   * 豆包爱学最核心的用法就是"拍题 → 讲透"，这里把它接进课程体系：
   * 不是给一次性的讲解，而是生成一门围绕这道题的短课（含同类练习）。
   */
  async function courseFromProblem(info) {
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) { toast('请先在「设置」里配置 API Key，或启用 WorkBuddy', 'warning'); return null; }
    navigate('course');
    const area = $('course-area');
    if (area) area.innerHTML = courseGeneratingHTML('这道题');
    try {
      const course = await CourseEngine.createFromProblem({
        question: info.question || '',
        subject: info.subject || '',
        studentAnswer: info.studentAnswer || '',
        correctAnswer: info.correctAnswer || '',
        knowledge: info.knowledge || '',
      });
      toast('已围绕这道题生成 ' + course.outline.length + ' 节短课', 'success');
      renderCourse();
      return course;
    } catch (e) {
      toast('建课失败：' + e.message, 'error');
      if (area) area.innerHTML = jsonFailHTML(e, '可以再试一次。');
      return null;
    }
  }

  /** 课程页的所有点击/输入（事件代理：一次绑定，避免重渲染丢事件） */  function bindCourseEvents() {
    const area = $('course-area');
    if (!area) return;

    area.addEventListener('click', async (e) => {
      const el = e.target.closest ? e.target.closest('[data-cv]') : null;
      if (!el) return;
      const act = el.getAttribute('data-cv');
      const st = CourseEngine.state();

      if (act === 'open') {
        CourseEngine.open(el.getAttribute('data-id'));
        renderCourse();
        return;
      }
      if (act === 'back-list' || act === 'back-outline') {
        if (act === 'back-outline' && st.course) {
          CourseEngine.close();
          CourseEngine.open(st.course.id);
          renderCourse();
        } else {
          CourseEngine.close();
          renderCourse();
        }
        return;
      }
      if (act === 'delete-course') {
        if (!confirm('删除这门课？已经学过的记录会保留在错题本里。')) return;
        CourseEngine.remove(el.getAttribute('data-id'));
        renderCourse();
        toast('已删除', 'success');
        return;
      }
      if (act === 'lesson') {
        const idx = Number(el.getAttribute('data-idx')) || 0;
        courseUI.askLog = [];
        courseUI.pickedOption = null;
        CourseEngine.goto(idx, 0);
        renderCourse();
        ensureLessonLoaded(idx);
        return;
      }
      if (act === 'prev') { courseUI.pickedOption = null; CourseEngine.prevPage(); courseUI.askLog = CourseEngine.askHistory(); renderCourse(); return; }
      if (act === 'next') {
        const lesson = CourseEngine.currentLesson();
        if (!lesson || !st.view) return;
        const last = (lesson.pages || []).length - 1;
        if (st.view.pageIndex >= last) { await finishCurrentLesson(); return; }
        courseUI.pickedOption = null;
        CourseEngine.nextPage();
        courseUI.askLog = CourseEngine.askHistory();
        renderCourse();
        return;
      }
      if (act === 'pick') {
        // ★ 只"选中"，**不立刻提交**。
        //   以前是点一下即交，导致两个严重后果：
        //     ① 判分后正确选项立刻被标绿 —— 答案"自己跳出来"；
        //     ② 判分后所有选项 disabled —— 想改选也点不动了。
        //   现在分两步：点选项=选中（可随时改），点「提交答案」才判分。
        if (courseUI.grading) return;
        const v = el.getAttribute('data-opt');
        courseUI.pickedOption = (courseUI.pickedOption === v) ? null : v;   // 再点一次可取消
        // 只更新选中态，不重渲染（避免把输入框内容/滚动位置弄丢）
        area.querySelectorAll('.cv-opt').forEach(o => {
          o.classList.toggle('picked', o.getAttribute('data-opt') === courseUI.pickedOption);
        });
        const btn = area.querySelector('[data-cv="submit-choice"]');
        if (btn) {
          btn.disabled = !courseUI.pickedOption;
          btn.textContent = courseUI.pickedOption ? ('提交答案（选了 ' + courseUI.pickedOption + '）') : '提交答案';
        }
        return;
      }
      if (act === 'submit-choice') {
        if (courseUI.grading) return;
        if (!courseUI.pickedOption) { toast('先选一个选项', 'warning'); return; }
        await submitCurrentQuiz(courseUI.pickedOption);
        return;
      }
      if (act === 'submit-fill') {
        const box = area.querySelector('[data-cv="fill-input"]');
        const v = box ? box.value.trim() : '';
        if (!v) { toast('先写下你的答案', 'warning'); return; }
        await submitCurrentQuiz(v);
        return;
      }
      // ── 朗读 ──
      if (act === 'speak') {
        if (Speech.isPlaying()) { Speech.stop(); renderCourse(); return; }
        if (Speech.isPaused()) { Speech.resume(); renderCourse(); return; }
        speakCurrentPage('user');
        return;
      }
      if (act === 'tts-retry') {
        toast('正在连接语音服务…');
        await Speech.check(true);
        if (Speech.serviceOk()) toast('连上了，可以点「让老师讲这一页」', 'success');
        else toast('还是连不上：' + (Speech.errorText() || '请确认已运行 tts_server.py'), 'error');
        renderCourse();
        return;
      }
      if (act === 'practice') {
        await doPractice();
        return;
      }
      if (act === 'pick-pr') {
        // 巩固题同样是"先选中再提交"（理由同上面的 pick）
        const idx = Number(el.getAttribute('data-idx'));
        const v = el.getAttribute('data-opt');
        const key = 'pr' + idx;
        courseUI.pickedOption = courseUI.pickedOption === key + ':' + v ? null : key + ':' + v;
        const picked = (courseUI.pickedOption || '').split(':')[1] || null;
        area.querySelectorAll('[data-cv="pick-pr"][data-idx="' + idx + '"]').forEach(o => {
          o.classList.toggle('picked', o.getAttribute('data-opt') === picked);
        });
        const btn = area.querySelector('[data-cv="submit-pr-choice"][data-idx="' + idx + '"]');
        if (btn) {
          btn.disabled = !picked;
          btn.textContent = picked ? ('提交（选了 ' + picked + '）') : '提交答案';
        }
        return;
      }
      if (act === 'submit-pr-choice') {
        const idx = Number(el.getAttribute('data-idx'));
        const picked = (courseUI.pickedOption || '').split(':')[1] || null;
        if (!picked) { toast('先选一个选项', 'warning'); return; }
        await submitPracticeItem(idx, picked);
        return;
      }
      if (act === 'submit-pr') {
        const idx = Number(el.getAttribute('data-idx'));
        const box = area.querySelector('[data-cv="fill-pr"][data-idx="' + idx + '"]');
        const v = box ? box.value.trim() : '';
        if (!v) { toast('先写下你的答案', 'warning'); return; }
        await submitPracticeItem(idx, v);
        return;
      }
      if (act === 'ask') { await doAsk(); return; }
      if (act === 'quick') {
        const box = area.querySelector('[data-cv="ask-input"]');
        if (box) box.value = el.getAttribute('data-q') || '';
        await doAsk();
        return;
      }
      if (act === 'reask') {
        const box = area.querySelector('[data-cv="ask-input"]');
        if (box) box.value = '这道题我还是没懂，换个角度再讲一次';
        await doAsk();
        return;
      }
      if (act === 'regen-quiz') {
        toast('这一节缺少练习，正在重新生成这一节…', 'warning');
        const st2 = CourseEngine.state();
        const l = CourseEngine.currentLesson();
        if (l && st2.view) {
          l.pages = null;
          try { await CourseEngine.loadLesson(st2.view.lessonIndex, { force: true }); } catch (e) { toast('重生成失败：' + e.message, 'error'); }
          renderCourse();
        }
        return;
      }
    });

    // 回车提交追问
    area.addEventListener('keydown', (e) => {
      if (!e.target || !e.target.matches) return;
      if (e.target.matches('[data-cv="ask-input"]') && e.key === 'Enter') {
        e.preventDefault(); doAsk();
      }
      if (e.target.matches('[data-cv="fill-input"]') && e.key === 'Enter') {
        e.preventDefault();
        const v = e.target.value.trim();
        if (v) submitCurrentQuiz(v);
      }
    });

    // 朗读设置：音色 / 语速 / 自动连讲（用 change 事件，不是 click）
    area.addEventListener('change', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('[data-cv="voice"]')) {
        Speech.setVoice(t.value);
        toast('已换成：' + (t.options[t.selectedIndex] || {}).text, 'success');
        // 换音色后如果正在播，重播当前页让它用新声音
        if (Speech.isPlaying() || Speech.isPaused()) { Speech.stop(); speakCurrentPage('user'); }
      } else if (t.matches('[data-cv="auto-read"]')) {
        Speech.setAutoRead(t.checked);
        toast(t.checked ? '翻页会自动接着讲' : '已关闭自动连讲', 'success');
      }
    });
    area.addEventListener('input', (e) => {
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('[data-cv="rate"]')) {
        Speech.setRate(t.value);
        const b = t.parentElement && t.parentElement.querySelector('b');
        if (b) b.textContent = Number(t.value).toFixed(1) + '×';
      }
    });
  }

  async function submitCurrentQuiz(answer) {
    if (courseUI.grading) return;
    courseUI.grading = true;
    try {
      // 直接用返回值（原来从 state() 里再取一次，课程被关闭时会抛 null 错）
      const g = await CourseEngine.submitQuiz(answer);
      if (g && g.correct) toast('答对了', 'success');
      else toast('答错了，看看错在哪（已记进错题本）', 'warning');
    } catch (e) {
      toast('判分失败：' + e.message, 'error');
    } finally {
      courseUI.grading = false;
      renderCourse();
    }
  }

  async function submitPracticeItem(idx, answer) {
    if (courseUI.grading) return;
    courseUI.grading = true;
    try {
      const r = await CourseEngine.submitPractice(idx, answer);
      toast(r.correct ? '对了' : '还是错了，看解析', r.correct ? 'success' : 'warning');
    } catch (e) {
      toast('判分失败：' + e.message, 'error');
    } finally {
      courseUI.grading = false;
      renderCourse();
    }
  }

  async function doPractice() {
    if (courseUI.grading) return;
    courseUI.grading = true;
    toast('正在出同类题…');
    try {
      await CourseEngine.practice(3);
    } catch (e) {
      toast('出题失败：' + e.message, 'error');
    } finally {
      courseUI.grading = false;
      renderCourse();
    }
  }

  async function doAsk() {
    const area = $('course-area');
    if (!area || courseUI.asking) return;
    const box = area.querySelector('[data-cv="ask-input"]');
    const q = box ? box.value.trim() : '';
    if (!q) { toast('想问什么？写一句就行', 'warning'); return; }

    courseUI.asking = true;
    // 先把提问显示出来（不等模型）
    courseUI.askLog = (courseUI.askLog || []).concat([{ role: 'user', content: q }]);
    renderCourse();
    // 显示"讲解中"
    const area2 = $('course-area');
    const log2 = area2 && area2.querySelector('.cv-ask-log');
    if (log2) log2.insertAdjacentHTML('beforeend',
      '<div class="cv-ask-bubble ai" id="cv-ask-pending"><span class="spinner" style="display:inline-block;vertical-align:-2px"></span> 正在按你的问题重讲这一步…</div>');

    try {
      const reply = await CourseEngine.ask(q);
      courseUI.askLog = CourseEngine.askHistory();
      renderCourse();
    } catch (e) {
      const p = $('cv-ask-pending'); if (p) p.remove();
      toast('老师没答上来：' + e.message, 'error');
    } finally {
      courseUI.asking = false;
      renderCourse();
    }
  }

  async function finishCurrentLesson() {
    const st = CourseEngine.state();
    const lesson = CourseEngine.currentLesson();
    if (!lesson || !st.view) return;
    if (courseUI.grading) return;
    courseUI.grading = true;
    toast('正在收尾这一节…');
    try {
      const r = await CourseEngine.finishLesson(lesson.minutes || 15);
      const recap = r.recap || {};
      let html = '<div class="cv-summary"><div class="cv-summary-head">这一节学完了</div>'
        + '<h3 class="cv-h small">' + esc(lesson.title) + '</h3>'
        + '<p class="cv-body">' + CourseView.NL(recap.recap || '继续下一节吧。') + '</p>'
        + (recap.mastered && recap.mastered.length ? '<div class="cv-bullets-wrap"><b>已掌握：</b>' + CourseView.NL(recap.mastered.join('、')) + '</div>' : '')
        + (recap.needWork && recap.needWork.length ? '<div style="margin-top:8px"><b>还需巩固：</b>' + CourseView.NL(recap.needWork.join('、')) + '</div>' : '')
        + '<div class="cv-grade-line" style="margin-top:10px">已记录学习 ' + r.minutes + ' 分钟，错题已进错题本。</div>'
        + '<div class="btn-group" style="margin-top:12px">'
        + '<button class="btn btn-primary btn-sm" data-cv="next-lesson">学下一节 →</button>'
        + '<button class="btn btn-secondary btn-sm" data-cv="back-outline">回到目录</button>'
        + '</div></div>';
      const area = $('course-area');
      if (area) area.innerHTML = '<div class="cv-learn" style="padding:20px">' + html + '</div>';
      // 下一节按钮
      const btn = area && area.querySelector('[data-cv="next-lesson"]');
      if (btn) btn.addEventListener('click', async () => {
        const cid = (st.course && st.course.id) || null;
        const moved = CourseEngine.nextLesson();
        if (!moved) {
          toast('这门课已经学完了 🎉', 'success');
          // 回到目录（用当时的 id；取不到就回列表）
          CourseEngine.close();
          if (cid) { CourseEngine.open(cid); renderCourse(); } else { renderCourse(); }
          return;
        }
        courseUI.askLog = []; courseUI.pickedOption = null;
        renderCourse();
        const s2 = CourseEngine.state();
        if (s2.view) ensureLessonLoaded(s2.view.lessonIndex);
      });
      refreshShell();
      estimateProgress('学完「' + lesson.title + '」').then(() => refreshShell()).catch(() => {});
    } catch (e) {
      toast('收尾失败：' + e.message, 'error');
    } finally {
      courseUI.grading = false;
    }
  }

  function renderCamera() {
    const st = $('cam-status');
    if (st) st.textContent = ProctorEngine.isRunning() ? '监控中' : '未启动';
  }

  function onProctorResult(data) {
    /**
     * ★ 新版监控回调（2026-10-31）
     *
     * 旧版：数帧当秒（时间严重失真）+ 只记分心。
     * 新版：引擎已按真实时间累计，这里只负责显示。
     *   显示 4 项：当前状态、学习时长、专注率、分心次数
     */
    camStats.attention = (data.attention || 0) / 100;
    camStats.last = data;

    const a = $('cam-attention');
    if (a) a.textContent = Math.round((data.attention || 0)) + '%';

    const st = $('cam-state');
    if (st) {
      // 学习状态用绿色，分心用橙色
      const isLearn = data.isLearning;
      st.textContent = (data.label || data.state || '--');
      st.style.color = isLearn ? 'var(--green)' : 'var(--amber)';
    }

    // ★ 真实学习时长（引擎按时间戳算，不是数帧）
    const snap = ProctorEngine.snapshot();
    const t = $('cam-time');
    if (t) {
      const mins = Math.floor(snap.learningMs / 60000);
      const secs = Math.floor((snap.learningMs % 60000) / 1000);
      t.textContent = mins + ' 分 ' + String(secs).padStart(2, '0') + ' 秒';
    }

    // ★ 专注率（学习时间 / 总时间）
    const d = $('cam-distract');
    if (d) d.textContent = snap.focusRate + '%';

    // 更新分心次数（从 keyframes 算）
    const distractCount = (snap.keyframes || []).filter(k => k.to === 'distracted').length;
    const dc = $('cam-distract-count');
    if (dc) dc.textContent = distractCount;
  }

  async function startCamera() {
    const video = $('camera-video');
    try {
      // 优先走 MediaPipe FaceMesh（能算注意力）
      await ProctorEngine.init(video, onProctorResult);
      await ProctorEngine.start();
      $('camera-placeholder').classList.add('hidden');
      $('cam-status').textContent = '监控中';
      addLog('FaceMesh 已就绪，开始分析专注度');
      toast('监控已启动', 'success');
    } catch (e) {
      addLog('FaceMesh 不可用（' + e.message + '），退回到普通摄像头预览');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } });
        video.srcObject = stream;
        await video.play().catch(() => {});
        $('camera-placeholder').classList.add('hidden');
        $('cam-status').textContent = '预览中（无分析）';
        const s = $('cam-state');
        if (s) s.textContent = '未分析';
        toast('摄像头已开启（注意力分析不可用）', 'warning');
      } catch (e2) {
        addLog('摄像头启动失败：' + e2.message);
        toast('启动失败：' + e2.message, 'error');
      }
    }
  }

  function stopCamera() {
    /**
     * ★ 落库真实学习时长（2026-10-31）
     *
     * 旧版：Math.round(camStats.focused / 60) —— focused 是帧数，
     *       除以 60 得到的是"秒"不是分钟，时长严重失真。
     * 新版：引擎按时间戳累计的真实毫秒数。
     */
    const v = $('camera-video');
    let snap = null;
    try { snap = ProctorEngine.snapshot(); } catch (e) {}
    try { ProctorEngine.stop(); } catch (e) {}
    if (v && v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
    const ph = $('camera-placeholder');
    if (ph) ph.classList.remove('hidden');
    const st = $('cam-status');
    if (st) st.textContent = '已停止';

    if (snap && snap.learningMs > 60000) {
      const mins = Math.round(snap.learningMs / 60000);
      Storage.addMin(mins);
      addLog('已记录学习 ' + mins + ' 分钟（专注率 ' + snap.focusRate + '%）');

      // ★ 状态分布入日志，方便回顾
      const dist = snap.perStateMs || {};
      const parts = [];
      const names = { writing: '书写', reading: '阅读', listening: '听讲', thinking: '思考', distracted: '分心' };
      Object.keys(names).forEach(k => {
        const ms = dist[k] || 0;
        if (ms > 5000) parts.push(names[k] + ' ' + Math.round(ms / 60000) + ' 分');
      });
      if (parts.length) addLog('状态分布：' + parts.join(' · '));

      // 落库（学习记录 + 活动日志）
      try {
        Storage.addAct({
          icon: '◉',
          title: '学习监控 ' + mins + ' 分钟（专注率 ' + snap.focusRate + '%）',
        });
        // ★ 记入事件流
      if (typeof Memory !== 'undefined') {
        Memory.addEvent('monitor', { minutes: mins, focusRate: snap.focusRate });
      }
      Storage.set('last_proctor_session', {
          at: new Date().toISOString(),
          learningMs: snap.learningMs,
          distractedMs: snap.distractedMs,
          focusRate: snap.focusRate,
          perStateMs: snap.perStateMs,
          keyframes: snap.keyframes,
        });
      } catch (e) {}
    } else if (snap) {
      addLog('学习时长不足 1 分钟，未计入');
    }
    addLog('监控已停止');
  }

  async function startCalibration() {
    /**
     * ★ 真校准（2026-10-31）
     *
     * 旧版：3 个 setTimeout 打印日志，根本没采数据 —— 用户说"校准太快"。
     * 新版：真采集两段基线（正常坐姿 4 秒 + 书写姿态 4 秒），
     *       记录 pitch/yaw/ear 的均值和范围，供状态识别使用。
     */
    const video = $('camera-video');
    if (!video || !video.srcObject) { toast('请先启动摄像头', 'warning'); return; }
    if (!ProctorEngine.isRunning()) { toast('请先点「启动监控」', 'warning'); return; }

    const btn = $('btn-cam-calibrate');
    if (btn) { btn.disabled = true; btn.textContent = '校准中…'; }

    addLog('校准开始：先保持你平时学习时的坐姿（4 秒）');

    try {
      const r = await ProctorEngine.calibrate((phase, left, hint) => {
        if (left > 0) {
          const label = phase === 'normal' ? '正常坐姿' : '书写姿态';
          addLog('【' + label + '】' + hint + '… 还剩 ' + left + ' 秒');
        } else if (phase === 'normal') {
          addLog('已记录正常坐姿。现在做出你写字时的姿势（4 秒）');
        }
      });

      if (r.ok) {
        addLog('✓ 校准完成：正常坐姿 ' + r.baseline.normal.n + ' 帧，书写姿态 ' + r.baseline.writing.n + ' 帧');
        addLog('  正常：低头 ' + r.baseline.normal.pitch.avg.toFixed(1) + '° · 书写：低头 ' + r.baseline.writing.pitch.avg.toFixed(1) + '°');
        toast('校准完成，现在能区分你写字和分心了', 'success');
        // 存起来，下次不用重校
        try {
          Storage.set('proctor_baseline', r.baseline);
        } catch (e) {}
      } else {
        addLog('校准不完整：' + (r.warning || '请重试'));
        toast(r.warning || '校准不完整，请重试', 'warning');
      }
    } catch (e) {
      addLog('校准失败：' + e.message);
      toast('校准失败：' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '校准我的坐姿'; }
    }
  }

  function addLog(msg) {
    const log = $('camera-log');
    if (!log) return;
    const d = document.createElement('div');
    d.className = 'log-entry';
    d.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '  ' + msg;
    log.insertBefore(d, log.firstChild);
    while (log.children.length > 40) log.removeChild(log.lastChild);
  }

  // ════════════════════════════════════════════════════════════
  //  P5 回溯：录入真实成绩 + 显示预测 vs 实际
  //  —— 这是唯一能证明"估分准不准"的路径
  // ════════════════════════════════════════════════════════════
  function renderBacktest() {
    const box = $('bt-pairs');
    if (!box || typeof Backtest === 'undefined') return;

    // 科目下拉：总分 + 六科
    const sel = $('bt-subject');
    if (sel && !sel.options.length) {
      const subs = allSixSubjects();
      sel.innerHTML = '<option value="">总分（750）</option>' +
        subs.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');
    }
    // 默认日期 = 今天
    const dateEl = $('bt-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

    const summaryEl = $('bt-summary');
    if (summaryEl) summaryEl.textContent = Backtest.summary();

    const ev = Backtest.evaluate();
    const sub = $('bt-sub');
    if (sub) sub.textContent = ev.n ? ('已配对 ' + ev.n + ' 次') : '还没有可配对的数据';

    /**
     * ★ P5 改进（2026-10-17）：把"录入真值"做得好用一点。
     *
     * 原来的问题：
     *   ① 录错了没法删 —— 只能"清空全部"，代价太大
     *   ② 看不到自己录过什么 —— 不知道有没有生效
     *   ③ 不知道某条为什么没配上对
     *
     * 现在：真值列表（可单独删）+ 每条标注配对状态。
     */
    const truths = Backtest.truths().slice().reverse();
    const truthHtml = truths.length
      ? ('<div class="hint" style="margin:12px 0 6px">你录入的真实成绩（' + truths.length + ' 条，最新在上）</div>' +
         '<table class="data-table"><thead><tr><th>考试日期</th><th>科目</th><th>实际得分</th><th>配对状态</th><th></th></tr></thead><tbody>' +
         truths.slice(0, 15).map(t => {
           const paired = ev.pairs.some(p => p.actual === t.score &&
             p.subject === (t.subject || '总分') && p.truthDate === t.date);
           return '<tr>' +
             '<td>' + esc(t.date) + '</td>' +
             '<td><span class="tag">' + esc(t.subject || '总分') + '</span></td>' +
             '<td class="num"><strong>' + fx5(t.score) + '</strong>' +
               (t.fullScore ? '<span style="color:var(--label-tertiary);font-size:12px">/' + t.fullScore + '</span>' : '') + '</td>' +
             '<td>' + (paired
               ? '<span style="color:var(--green)">✓ 已与当时预测配对</span>'
               : '<span style="color:var(--amber)">未配对（那天之前没有该科目的预测存档）</span>') + '</td>' +
             '<td><button class="btn btn-danger btn-sm" data-del-truth="' + esc(t.id) + '">删除</button></td>' +
             '</tr>';
         }).join('') + '</tbody></table>')
      : '';

    let html = '';
    if (!ev.n) {
      html = '<div class="empty">还没有可配对的预测与真值。做法：<br>' +
        '① 先在「高考成绩预估」里点一次估算（系统会自动存档这次的预测）<br>' +
        '② 之后考试出分，把实际分填在上面点「录入真实成绩」<br>' +
        '系统会自动找「那次考试之前最近的一次预测」来比对 —— 只许用之前的预测，不许偷看未来。</div>';
    } else {
      const honestyTxt = {
        good: '覆盖良好（区间没有吹牛）',
        tight: '覆盖偏紧（区间略窄）',
        overconfident: '区间过窄 —— 覆盖率明显低于标称 95%，说明模型过于自信',
        unknown: '样本还不足以下结论（至少 5 对）',
      }[ev.honesty] || '';

      html =
        '<div class="estimate-grid" style="margin-bottom:10px">' +
          '<div class="estimate-item"><div class="estimate-value">' + (ev.mae != null ? fx1(ev.mae) : '—') + '</div><div class="estimate-label">平均绝对误差</div></div>' +
          '<div class="estimate-item"><div class="estimate-value">' + (ev.bias != null ? ((ev.bias >= 0 ? '+' : '') + fx1(ev.bias)) : '—') + '</div><div class="estimate-label">偏差（正=乐观）</div></div>' +
          '<div class="estimate-item"><div class="estimate-value">' + (ev.coverage != null ? Math.round(ev.coverage * 100) + '%' : '—') + '</div><div class="estimate-label">区间覆盖率</div></div>' +
          '<div class="estimate-item"><div class="estimate-value">' + ev.n + '</div><div class="estimate-label">配对次数</div></div>' +
        '</div>' +
        (honestyTxt ? '<div class="hint" style="margin-bottom:8px">' + esc(honestyTxt) + '</div>' : '') +
        '<table class="data-table"><thead><tr><th>考试日期</th><th>科目</th><th>当时预测</th><th>实际</th><th>误差</th><th>区间覆盖</th><th>预测时间</th></tr></thead><tbody>' +
        ev.pairs.slice().reverse().slice(0, 20).map(p =>
          '<tr>' +
          '<td>' + esc(p.truthDate) + '</td>' +
          '<td><span class="tag">' + esc(p.subject) + '</span></td>' +
          '<td class="num">' + fx5(p.predicted) + '</td>' +
          '<td class="num"><strong>' + fx5(p.actual) + '</strong></td>' +
          '<td class="num" style="color:' + (p.error >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
            (p.error >= 0 ? '+' : '') + fx1(p.error) + '</td>' +
          '<td>' + (p.range
            ? (p.covered ? '<span style="color:var(--green)">✓ ' + fx5(p.range.low) + '~' + fx5(p.range.high) + '</span>'
                         : '<span style="color:var(--red)">✗ ' + fx5(p.range.low) + '~' + fx5(p.range.high) + '</span>')
            : '—') + '</td>' +
          '<td style="font-size:12px;color:var(--label-secondary)">' + fmtAgo(p.forecastAt) + '（提前 ' + p.leadDays + ' 天）</td>' +
          '</tr>').join('') +
        '</tbody></table>';
    }

    box.innerHTML = html + truthHtml;

    // 绑定删除按钮
    box.querySelectorAll('[data-del-truth]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-truth');
        if (!confirm('删除这条真实成绩记录？（不影响预测存档）')) return;
        Backtest.delTruth(id);
        renderBacktest();
        toast('已删除', 'success');
      });
    });
  }

  function fx1(x) { return String(Math.round(Number(x) * 10) / 10); }

  async function addBacktestTruth() {
    const scoreEl = $('bt-score');
    const fullEl = $('bt-full');
    const subEl = $('bt-subject');
    const dateEl = $('bt-date');
    const hint = $('bt-hint');
    const score = Number(scoreEl.value);
    if (!isFinite(score) || score < 0) {
      if (hint) hint.textContent = '请先填实际得分';
      return;
    }
    const isTotal = !subEl.value;
    const full = Number(fullEl.value) || (isTotal ? 750 : 100);
    if (score > full) {
      if (hint) hint.textContent = '得分超过满分了，检查一下';
      return;
    }
    try {
      Backtest.recordTruth({
        subject: isTotal ? null : subEl.value,
        score: score,
        fullScore: full,
        source: isTotal ? '真实总分' : '真实单科',
        date: dateEl.value || new Date().toISOString().slice(0, 10),
      });
      scoreEl.value = '';
      if (hint) hint.textContent = '已录入，与当时的预测配对成功 —— 指标已更新';
      renderBacktest();
      toast('真实成绩已录入', 'success');
    } catch (e) {
      if (hint) hint.textContent = '录入失败：' + e.message;
    }
  }

  // ════════════════════════════════════════════════════════════
  //  进度追踪
  // ════════════════════════════════════════════════════════════
  function renderProgress() {
    /**
     * ★ 先画"就绪度面板"（2026-10-18）
     *
     * 用户要求："让 AI 认为可以估分时再估，至少 60% 把握，并且要有进度条"。
     * 这个面板独立于下面的旧估分逻辑，先渲染出来 ——
     * 这样即使旧逻辑判定"未解锁"，用户也能看到自己攒到哪一步、还差什么。
     */
    try {
      if (typeof ReadinessUI !== 'undefined') ReadinessUI.render();
    } catch (e) {
      console.warn('就绪度面板渲染失败:', e);
    }

    /**
     * ★ 挂载能力测验（2026-10-18）
     *   已有结果 → 显示摘要；没有 → 显示"开始测验"。
     *   注意：不要每次 render 都把正在做题的界面刷掉，
     *   所以只在"还没开始做"时初始化（dataset.busy 标记）。
     */
    try {
      const aptBox = $('aptitude-body');
      if (aptBox && aptBox.dataset.busy !== '1') {
        const apt = (Storage.getAptitude && Storage.getAptitude()) || null;
        const sub = $('aptitude-sub');

        if (apt && apt.raw) {
          const pct = Math.round((apt.raw.percentile || 0) * 100);
          const lo = Math.round((apt.raw.range ? apt.raw.range.low : 0) * 100);
          const hi = Math.round((apt.raw.range ? apt.raw.range.high : 0) * 100);
          aptBox.innerHTML =
            '<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">' +
            '<div><div style="font-size:28px;font-weight:700;color:var(--accent);' +
            'font-variant-numeric:tabular-nums">' + pct + '<span style="font-size:15px">%</span></div>' +
            '<div style="font-size:11.5px;color:var(--label-tertiary)">推理能力百分位</div></div>' +
            '<div style="flex:1;min-width:200px">' +
            '<div class="hint">答对 ' + (apt.raw.correct || 0) + ' / ' + (apt.raw.total || 12) +
            ' 题 · 80% 区间 ' + lo + '~' + hi + '%</div>' +
            '<div class="hint" style="margin-top:4px">已纳入估分：数理类科目直接用，语言类做了衰减</div>' +
            '</div>' +
            '<button class="btn btn-secondary btn-sm" id="btn-apt-remount">重测</button>' +
            '</div>';
          if (sub) sub.textContent = '已完成';
          on('btn-apt-remount', 'click', () => {
            if (typeof AptitudeUI !== 'undefined') {
              aptBox.dataset.busy = '1';
              AptitudeUI.mount('aptitude-body');
            }
          });
        } else {
          if (typeof AptitudeUI !== 'undefined') AptitudeUI.mount('aptitude-body');
          if (sub) sub.textContent = '可选 · 5 分钟';
        }
      }
    } catch (e) {
      console.warn('能力测验挂载失败:', e);
    }

    const goal = Storage.getGoal();
    const est = currentEstimate();
    const base = baselineScore();
    const target = Number(goal.target) || 600;
    const unlock = unlockStatus();
    const unlocked = unlock.ready && est.total != null;

    // ★ 教材覆盖率：缓存失效时后台找 AI 折算，折完自动重画（只重算一次，防抖）
    if (Object.keys(Storage.getTextbook()).length) {
      const covSig = textbookCoverageSig();
      const covNow = Storage.getTextbookCoverage();
      if (!covNow || covNow.sig !== covSig) {
        ensureTextbookCoverage().then(() => {
          const pg = $('page-progress');
          if (pg && pg.classList.contains('active')) renderProgress();
        }).catch(() => {});
      }
    }

    /**
     * ── 解锁闸门（2026-10-18 重构）
     *
     * 旧逻辑：每科满 5 份卷子才解锁。
     * 用户明确改变了想法："让 AI 认为可以估分时再估，至少 60% 把握"，
     * 而不是死板的"5 份"。
     *
     * 现在：用就绪度面板的统计置信度判定。
     *   · 新的就绪度面板已经在上方独立显示（每科的进度和能力测验）
     *   · 这里只决定「下面那块旧的分科明细要不要显示」
     *   · 判定标准：至少有一科的置信度达到 mid 及以上
     */
    const gate = $('progress-lock');
    const body = $('progress-body');

    // 用新引擎的结果判断是否有科目可以出分
    let engineReady = false;
    try {
      const rd = window.__lastReadiness;
      if (rd && rd.readyCount > 0) engineReady = true;
    } catch (e) {}

    // 兜底：如果新引擎没跑起来，退回旧的 unlocked 判断
    const canShow = engineReady || unlocked;

    if (!canShow) {
      if (gate) {
        gate.innerHTML =
          '<div class="note" style="padding:14px 16px">' +
          '<div style="font-size:13.5px;font-weight:600;margin-bottom:4px">还没有科目达到可估分的置信度</div>' +
          '<div style="font-size:12.5px;line-height:1.7">' +
          '上面那块「还要多少数据才能估分」会告诉你每科还差什么。' +
          '攒够一科，这里就会显示分科明细。</div>' +
          '</div>';
      }
      if (body) body.classList.add('hidden');
      drawChart(Storage.getRecords());
      refreshShell();
      return;
    }

    if (gate) gate.innerHTML = '';
    if (body) body.classList.remove('hidden');

    const total = round5(est.total);
    const proj = (est.projected != null) ? round5(est.projected) : null;
    const g2 = Storage.getGoal();
    const days = daysToExam();

    // ① 现在  ② 高考时预测  —— 两个数字分开显示，★ 并给出区间（P4）
    const curRange = est.currentRange || null;
    const projRange = est.totalRange || null;
    $('e-total').textContent = fx5(total) + (curRange ? ' ± ' + Math.round(curRange.se) : '');
    $('e-future').textContent = proj != null
      ? (projRange ? (fx5(projRange.low) + ' ~ ' + fx5(projRange.high)) : fx5(proj))
      : '—';
    const totalQ = (est.evidence || []).reduce((s, e) => s + (Number(e.nQuestions) || 0), 0);
    $('e-now-sub').textContent = (totalQ
      ? ('由 ' + totalQ + ' 道已判定题目的真实作答推算')
      : '由各科卷面得分推算') +
      (curRange ? '，95% 区间 ' + fx5(curRange.low) + '~' + fx5(curRange.high) : '');
    $('e-future-sub').textContent = (g2.examDate
      ? ('推算到 ' + g2.examDate + '，还有 ' + days + ' 天')
      : ('还有 ' + days + ' 天')) +
      (projRange ? ' · 95% 预测区间（约 ' + Math.round(projRange.se) + ' 分标准误）' : '');

    $('e-target').textContent = target;
    const gain = (proj != null) ? round5(proj - total) : null;
    const ge = $('e-gain');
    ge.textContent = gain != null ? ('+' + fx5(gain)) : '—';
    ge.style.color = gain != null ? 'var(--green)' : 'var(--label-tertiary)';
    $('e-gap').textContent = fx5(round5(target - (proj != null ? proj : total)));
    // ★ P2：原来这里写 e-conf（数据可信度），已换成 e-suff（数据充分度）——
    //   HTML 里 e-conf 已移除，继续读会得到 null 并抛错。保留 confidence 供别处使用。
    const confEl = $('e-conf');
    if (confEl) confEl.textContent = est.confidence != null ? (Number(est.confidence) * 100).toFixed(1) + '%' : '—';

    /**
     * ★ P2（2026-10-10）：数据充分度。
     * 取代原来只看题数的"数据可信度" —— 那个指标下"同一套题做 50 遍"会显示很高，
     * 是虚高的。现在看：题量 / 难度覆盖 / 来源多样性 / 时间跨度。
     */
    const evAll = est.evidence || [];
    const suffRank = { low: 0, mid: 1, high: 2 };
    let worstSuff = 'high', suffReason = '';
    evAll.forEach(e => {
      if (!e.hasData) return;
      if (suffRank[e.sufficiency] < suffRank[worstSuff]) {
        worstSuff = e.sufficiency || 'mid';
        const r = (e.suffReasons && e.suffReasons.length) ? e.suffReasons[0] : '';
        if (r) suffReason = e.subject + '：' + r;
      }
    });
    const suffEl = $('e-suff');
    if (suffEl) {
      const label = { low: '偏少', mid: '中等', high: '充分' }[worstSuff] || '—';
      const color = worstSuff === 'high' ? 'var(--green)' : worstSuff === 'mid' ? 'var(--amber)' : 'var(--red)';
      suffEl.textContent = label;
      suffEl.style.color = color;
      suffEl.title = suffReason || '';
    }
    const suffHint = $('e-suff-hint');
    if (suffHint) {
      suffHint.textContent = worstSuff === 'high'
        ? '数据比较充分，可以看单点估计'
        : worstSuff === 'mid'
          ? '数据中等，建议以区间为准' + (suffReason ? '（' + suffReason + '）' : '')
          : '数据偏少，请优先看区间' + (suffReason ? '（' + suffReason + '）' : '') + '；再传几份不同来源的卷子会明显改善';
    }

    const stored = Storage.getTotalEstimate();
    const note = $('total-estimate-note');
    if (note) {
      note.textContent = (stored && stored.date ? '上次估算：' + fmtAgo(stored.date) + ' · ' : '') +
        '方式：' + (est.method === 'ai' ? 'AI（已参考本地统计证据）' : '本地推算') +
        ' · 数据来自六科各 ' + PAPERS_PER_SUBJECT + ' 份以上试卷' +
        (stored && stored.analysis ? ' · ' + String(stored.analysis).slice(0, 180) : '');
    }

    // 单科：现在 / 高考时预测 / 预计提升 / 依据
    const maxS = DB.MAX_SCORES || {};
    const subs = allSixSubjects();
    const sa = Storage.getSubjectAnalyses();
    const evBy = {};
    (est.evidence || []).forEach(e => { evBy[e.subject] = e; });
    // ★ P4：把预测区间挂到 evidence 上，依据列才能显示 ±SE
    const prAll = ProgressEngine.buildResult(
      ProgressEngine.analyzeEvidence(Storage.getRecords(), Storage.getMistakes(), goal, Storage.getPapers()),
      goal
    ).subjectProjectedRange || {};
    Object.keys(evBy).forEach(s => {
      if (prAll[s]) evBy[s]._projRange = prAll[s];
    });
    // ★ 存量估算的 evidence 没有难度推断时（老估算），现算一遍，别让"难度修正"空着
    if (DB.paperDifficulty) {
      subs.forEach(s => {
        const e = evBy[s];
        if (!e || e.difficultyLevel != null) return;
        const subPapers = Storage.getPapers().filter(p => p.subject === s);
        if (!subPapers.some(p => DB.paperDifficulty(p) != null)) return;
        const ev1 = ProgressEngine.analyzeEvidence(Storage.getRecords(), Storage.getMistakes(), goal, subPapers);
        const r1 = (ev1 || []).filter(x => x.subject === s)[0];
        if (r1 && r1.difficultyLevel != null) {
          e.difficultyLevel = r1.difficultyLevel;
          e.difficultyAdj = r1.difficultyAdj;
        }
      });
    }

    // ★ 难度推断覆盖情况（放在难度回填之后算，才反映真实状态）
    const assume = $('estimate-assume');
    if (assume) {
      const fdesc = allSixSubjects().map(s => s + ' ' + round5(Storage.getDifficultyFactor(s, 'exam'))).join(' · ');
      const dPapers = allSixSubjects().map(s => evBy[s]).filter(e => e && e.difficultyLevel != null);
      const dJudged = Storage.getPapers().filter(p =>
        (p.questions || []).some(q => DB.questionDifficulty && DB.questionDifficulty(q) != null) || p.difficulty).length;
      const dLine = dPapers.length
        ? '本卷难度已生效 ' + dPapers.length + ' 科：' + dPapers.map(e => e.subject + ' ' + e.difficultyLevel + ' 档(×' + e.difficultyAdj + ')').join(' · ')
        : (dJudged
            ? '已有 ' + dJudged + ' 份试卷判过难度，点右上角「AI 重新估算」就会算进预测。'
            : '还没有试卷判过难度：新上传的卷子会逐题按高考尺度判档；老卷子可点右上角「AI 复核题目难度」。');
      // ★ 教材覆盖：告诉用户"现在分"为什么被压下来
      const covCached = Storage.getTextbookCoverage();
      const covMap = (covCached && covCached.map && Object.keys(covCached.map || {}).length) ? covCached.map : null;
      const covLine = covMap
        ? coverageDigestText() + '。没学的章节在高考里按 0 分算，已从「现在分」里扣掉；「预测分」按剩余时间把没学的学回来。'
        : (Object.keys(Storage.getTextbook()).length
            ? '教材进度已填，AI 正在对照高考考点折算覆盖率……（折算完自动刷新）'
            : '还没有教材覆盖率：去问卷或「AI 出卷」页把各科"教材学到哪"填一下，没学的章节才会按 0 分扣。');
      assume.textContent = '推算假设：距高考 ' + days + ' 天 · 每日有效投入 ' + (Number(g2.hours) || 3) +
        ' 小时 · 约 55% 转化为提分 · 分数越高提得越慢（边际递减）· 趋势向好/转差各加减 15%。\n' +
        '教材覆盖（未学章节按 0 分）：' + covLine + '\n' +
        '难度推断（每道题按高考尺度判 1~5 档，3 档 = 与高考平均相当；偏易再打折、偏难小幅上修）：' + dLine + '\n' +
        '高考难度折算（校内卷普遍比高考容易，已按学科打折，可在「设置」里改）：' + fdesc +
        '　—— 系数由 LongCat-2.5 对近 10 年真题与校内模拟卷得分率的对比分析得出。';
      assume.style.whiteSpace = 'pre-line';
    }

    $('subject-estimates').innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th>科目</th><th>现在</th><th>高考时预测</th><th>预计提升</th><th>目标/差距</th><th>依据</th>' +
      '</tr></thead><tbody>' +
      subs.map(s => {
        const cur = est.subjectScores ? est.subjectScores[s] : null;
        const prj = est.subjectProjected ? est.subjectProjected[s] : null;
        const has = cur != null && isFinite(Number(cur));
        const e = evBy[s];
        const up = (has && prj != null) ? round5(prj - cur) : null;
        const st = (goal.subjectTargets || {})[s];
        const stMax = maxS[s] || 150;
        // 到高考时的预测 vs 这科目标
        let goalCell = '<span style="color:var(--label-tertiary)">未设</span>';
        if (st != null) {
          const gapToGoal = (prj != null) ? round5(Number(st) - Number(prj)) : null;
          const ok = gapToGoal != null && gapToGoal <= 0;
          goalCell = '<b>' + fx5(st) + '</b>/' + stMax +
            (gapToGoal != null
              ? '<span style="font-size:12px;color:' + (ok ? 'var(--green)' : 'var(--red)') + '">'
                + (ok ? ' 能达到' : ' 还差 ' + fx5(-gapToGoal)) + '</span>'
              : '');
        }
        let basis = '';
        if (e) {
          if (e.rawRatio != null) {
            basis += '卷面 ' + (Number(e.rawRatio) * 100).toFixed(0) + '%';
            // ★ 把"这份卷子比高考难还是易"显式写出来，别让折算像个黑盒
            if (e.difficultyLevel != null) {
              basis += ' × 难度修正 ' + e.difficultyAdj + '（本卷 ' + e.difficultyLevel + ' 档 vs 高考 3 档）';
            }
            if (e.difficultyFactor != null) {
              basis += ' × 折算 ' + e.difficultyFactor + ' → ' + (Number(e.ratio) * 100).toFixed(0) + '%';
            }
          } else if (e.difficultyLevel != null) {
            basis += '本卷难度 ' + e.difficultyLevel + ' 档（高考 3 档），卷面分缺失';
          }
          // ★ 教材覆盖率：没学的章节按 0 分算——这是"现在分"被压下来的原因，必须写明
          if (e.coverage != null) {
            // AI 折算的没有"章数"（learned/total 是占位 0），按值判断分支，别显示"0/0 章"
            const aiSrc = e.coverageSource === 'ai' ||
              (Number(e.coverageLearned) === 0 && Number(e.coverageTotal) === 0);
            if (aiSrc) {
              basis += (basis ? ' · ' : '') + '教材覆盖 ' + (Number(e.coverage) * 100).toFixed(0) + '%（AI 折算'
                + (e.coverageMatched ? '：' + e.coverageMatched : '') + '）';
            } else {
              basis += (basis ? ' · ' : '') + '教材覆盖 ' + (Number(e.coverage) * 100).toFixed(0) + '%（'
                + e.coverageLearned + '/' + e.coverageTotal + ' 章' + (e.coverageExact ? '' : '，按册估') + '）';
            }
          } else if (e.nPapers || e.nQuestions) {
            basis += (basis ? ' · ' : '') + '教材进度未折算，未按未学章节扣分';
          }
          if (e.nQuestions) basis += (basis ? ' · ' : '') + e.nQuestions + ' 题答对 ' + e.nCorrect;
          // ★ P3：浙江选考走等级赋分，要说清楚"这个分是怎么来的"，否则用户会以为是卷面分
          if (e.gradeAssigned) {
            basis += (basis ? ' · ' : '') + '等级赋分' +
              (e.gradeLow != null && e.gradeHigh != null ? '（' + e.gradeLow + '~' + e.gradeHigh + ' 分档）' : '') +
              '：按全省位次映射到官方 20 区间（位次为估计值）';
          }
          // ★ 预测区间（P4）：单科也给区间，不只给一个点
          if (e._projRange && isFinite(e._projRange.se)) {
            basis += (basis ? ' · ' : '') + '预测区间 ±' + Math.round(e._projRange.se);
          }
          // ★ 高分段收敛：让用户看到"为什么这次折算比之前松"（否则会觉得分数莫名涨了）
          if (e.taperedPapers) {
            basis += (basis ? ' · ' : '') + '高分段收敛（' + e.taperedPapers + ' 份卷子接近满分，折算已放开至最多 '
              + (DB.SCORE_TAPER ? DB.SCORE_TAPER.maxFactor : 0.88) + '）';
          }
          if (e.trend && e.trend !== 'nodata') {
            basis += (basis ? ' · ' : '') + ({ up: '在进步 ↑', down: '在退步 ↓', stable: '平稳' }[e.trend] || '');
          }
          if (!basis) basis = '按卷面得分推算';
        }
        return '<tr>' +
          '<td><span class="tag tag-' + esc(s) + '">' + esc(s) + '</span></td>' +
          '<td class="num"><strong>' + (has ? fx5(cur) : '无数据') + '</strong>' +
            (has ? '<span style="color:var(--label-tertiary);font-size:12px">/' + (maxS[s] || 150) + '</span>' : '') + '</td>' +
          '<td class="num">' + (prj != null ? fx5(prj) : '—') + '</td>' +
          '<td class="num" style="color:' + ((up != null && up > 0) ? 'var(--green)' : 'var(--label-tertiary)') + '">' +
            ((up != null && up > 0) ? '+' + fx5(up) : (up === 0 ? '0' : '—')) + '</td>' +
          '<td class="num" style="font-size:13px">' + goalCell + '</td>' +
          '<td style="font-size:12px;color:var(--label-secondary)">' + esc(basis) +
            (sa[s] ? ' · 已做单科分析' : '') + '</td>' +
          '</tr>';
      }).join('') +
      '</tbody></table>';

    renderBacktest();

    // 提分记录
    const hist = Storage.getEstHist().slice(-10).reverse()
      .filter(h => h && h.total != null && isFinite(Number(h.total)));
    $('gain-history').innerHTML = hist.length
      ? hist.map(h => {
          const d = Number(h.delta);
          const dd = isFinite(d) ? d : 0;
          return '<div class="activity"><div class="act-icon">' + (dd >= 0 ? '↑' : '↓') + '</div>' +
            '<div class="act-info"><div class="act-title">' + esc(h.reason || '重新估算') + ' — 现在 ' +
            fx5(h.total) + (h.projected != null ? ' / 预测 ' + fx5(h.projected) : '') + '</div>' +
            '<div class="act-time">' + fmtAgo(h.date) + ' · 较上次 ' +
            (dd >= 0 ? '+' : '') + fx5(dd) + ' 分</div></div></div>';
        }).join('')
      : '<div class="empty">还没有提分记录<br>做完一份试卷或导入成绩后会自动生成</div>';

    // 记录表（真实数据）
    const records = Storage.getRecords();
    $('prog-tbody').innerHTML = records.length
      ? records.slice(-25).reverse().map(r => {
          const ratio = r.fullScore ? r.score / r.fullScore : 0;
          const color = ratio >= 0.8 ? 'var(--green)' : ratio >= 0.6 ? 'var(--amber)' : 'var(--red)';
          return '<tr><td>' + fmtDate(r.date) + '</td><td>' + esc(srcLabel(r.source)) + '</td>' +
            '<td><span class="tag tag-' + esc(r.subject) + '">' + esc(r.subject) + '</span></td>' +
            '<td class="num"><strong>' + r.score + '</strong>/' + r.fullScore + '</td>' +
            // ★ 得分率显示取整（2026-10-24）：不再 toFixed(5)
            '<td class="num" style="color:' + color + '">' + Math.round(ratio * 100) + '%</td></tr>';
        }).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--label-tertiary)">暂无记录</td></tr>';

    drawChart(records);
    renderDataQuality();
    refreshShell();
  }

  function drawChart(records) {
    const cv = $('prog-chart');
    if (!cv || !cv.getContext) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);

    const pad = { l: 42, r: 16, t: 16, b: 26 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

    // 网格
    ctx.strokeStyle = 'rgba(0,0,0,.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iw, y); ctx.stroke();
      ctx.fillStyle = '#979da6'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(String(100 - i * 25) + '%', pad.l - 8, y + 4);
    }

    const pts = records.slice(-24).map(r => (r.fullScore ? r.score / r.fullScore : 0));
    if (pts.length < 2) {
      ctx.fillStyle = '#979da6'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('至少需要 2 条记录才能画出趋势', W / 2, H / 2);
      return;
    }

    const xs = (i) => pad.l + iw * (i / (pts.length - 1));
    const ys = (v) => pad.t + ih * (1 - Math.max(0, Math.min(1, v)));

    // 填充
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(86,134,254,.22)');
    grad.addColorStop(1, 'rgba(86,134,254,0)');
    ctx.beginPath();
    ctx.moveTo(xs(0), ys(pts[0]));
    pts.forEach((v, i) => ctx.lineTo(xs(i), ys(v)));
    ctx.lineTo(xs(pts.length - 1), pad.t + ih);
    ctx.lineTo(xs(0), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 折线
    ctx.beginPath();
    ctx.moveTo(xs(0), ys(pts[0]));
    pts.forEach((v, i) => ctx.lineTo(xs(i), ys(v)));
    ctx.strokeStyle = '#4176e6';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 点
    pts.forEach((v, i) => {
      ctx.beginPath();
      ctx.arc(xs(i), ys(v), i === pts.length - 1 ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = '#4176e6'; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  async function aiEstimateNow() {
    const btn = $('btn-ai-estimate');
    btn.disabled = true; btn.textContent = '估算中…';
    try {
      const r = await estimateProgress('AI 重新估算');
      renderProgress();
      toast('预估已更新：' + fx5(r.total) + '（' + (r.delta >= 0 ? '+' : '') + fx5(r.delta) + '）', 'success');
    } catch (e) {
      toast('估算失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'AI 重新估算';
    }
  }

  /**
   * ★ AI 复核题目难度（2026-10-02）
   * 老试卷是这次改动之前上传的，没有逐题 difficulty 字段，估算就只能回落到学科基准系数，
   * "这份卷子比高考难还是易" 就体现不出来。这个按钮把**所有还没判过难度的卷子**交给
   * LongCat 按高考尺度重新判一遍难度档，写回 paper.difficulty。
   *
   * 说明：这批卷子只留了知识点和得分，没留原图和题干，所以这次判档依据是
   * 「知识点 + 卷面得分率 + 总评」，属于**近似推断**；之后新上传的卷子会逐题判档，更准。
   */
  async function judgePaperDifficulties() {
    const btn = $('btn-judge-diff');
    const st = $('judge-diff-status');
    const papers = Storage.getPapers();
    const todo = papers.filter(p => !p.difficulty && !(p.questions || []).some(q => DB.questionDifficulty && DB.questionDifficulty(q) != null));

    if (!todo.length) {
      if (st) st.textContent = '所有试卷都已经判过难度了。新上传的卷子会自动逐题判档。';
      toast('没有需要复核的试卷', 'info');
      return;
    }

    btn.disabled = true; btn.textContent = '判档中…';
    let done = 0;
    try {
      for (const p of todo) {
        const kps = [];
        (p.questions || []).forEach(q => { if (q.knowledge && kps.indexOf(q.knowledge) < 0) kps.push(q.knowledge); });
        (p.mistakes || []).forEach(m => { if (m.knowledge && kps.indexOf(m.knowledge) < 0) kps.push(m.knowledge); });
        if (st) st.textContent = '正在判第 ' + (done + 1) + '/' + todo.length + ' 份：' + (p.subject || '') + ' ' + (p.title || p.name || '') + '…';

        const ratio = Number(p.fullScore) > 0 ? Number(p.score) / Number(p.fullScore) : null;
        try {
          const txt = await LLM.chat([{
            role: 'user',
            content: '这是学生做的一份' + (p.subject || '') + '卷子。\n'
              + '卷面得分：' + (p.score != null ? p.score : '未知') + ' / ' + (p.fullScore != null ? p.fullScore : '未知')
              + (ratio != null ? '（得分率 ' + (ratio * 100).toFixed(1) + '%）' : '') + '\n'
              + '涉及知识点：' + (kps.length ? kps.join('、') : '（未识别）') + '\n'
              + '总评：' + String(p.summary || '（无）').slice(0, 200) + '\n\n'
              + '请只按**高考真题**的尺度判断这份卷子的整体难度，返回一个 1~5 的整数：\n'
              + '1=送分（高考几乎不考） 2=基础（高考简单题） 3=中档（与高考平均相当） 4=难题（高考里的难题） 5=压轴（选拔档）\n'
              + '判断要点：知识点全是基础章节且得分率高 → 偏易；出现导数综合/解析几何/电磁综合/实验探究等压轴考点 → 偏难。\n'
              + '只返回 JSON，不要解释：{"difficulty":1到5的整数,"why":"15字内依据"}',
          }], { maxTokens: 300, temperature: 0.1 });
          const j = parseJSON(txt);
          const lv = DB.normDifficulty(j.difficulty);
          if (lv == null) throw new Error('模型没给出难度值');
          Storage.updatePaper(p.id, { difficulty: lv, difficultyWhy: j.why || '', difficultyJudge: 'ai-review' });
          done++;
        } catch (e) {
          // 单份失败不中断整批
          if (st) st.textContent = '第 ' + (done + 1) + ' 份判档失败（' + e.message + '），继续…';
        }
      }

      if (st) {
        st.textContent = done
          ? '已复核 ' + done + ' 份试卷的难度（依据知识点 + 卷面表现，属近似推断）。点「AI 重新估算」即可把难度算进预测。'
          : '这一批都没判成功，检查一下「设置 → 模型」里的 Key。';
      }
      renderProgress();
      toast(done ? ('已复核 ' + done + ' 份试卷难度') : '判档失败', done ? 'success' : 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'AI 复核题目难度';
    }
  }

  // ════════════════════════════════════════════════════════════
  //  教材覆盖率：AI 把"上到哪了"折成高考考点覆盖比（带签名缓存）
  // ════════════════════════════════════════════════════════════
  let _covInFlight = null;

  /** 缓存签名 = 教材进度文本 + 各科版本。进度没变就不重算。 */
  function textbookCoverageSig() {
    const all = Storage.getTextbook();
    return Object.keys(all).map(s => s + ':' + (all[s].edition || '') + '|' + (all[s].unit || '')).sort().join('§');
  }

  /**
   * 确保 xt_textbook_coverage 是最新的。三个入口都走这里：
   * renderProgress（后台补算）、estimateProgress / analyzeTotal（估算前等待）。
   * 没有教材进度 / 没配 Key / AI 失败 → 保留本地匹配或无覆盖，绝不编造。
   */
  async function ensureTextbookCoverage(opts) {
    opts = opts || {};
    const all = Storage.getTextbook();
    if (!Object.keys(all).length) return null;          // 没填过教材进度，没得折算
    const sig = textbookCoverageSig();
    const cached = Storage.getTextbookCoverage();
    if (cached && cached.sig === sig && cached.map) return cached.map;
    if (_covInFlight) return _covInFlight;

    const digest = Storage.textbookDigest(Object.keys(all));
    _covInFlight = (async () => {
      try {
        const r = await LLM.textbookCoverage({ digest: digest });
        const map = (r && typeof r === 'object' && !Array.isArray(r)) ? r : null;
        if (map && Object.keys(map).length) {
          // 容错：coverage 必须是 0~1 的数，越界/非数丢掉；学不了的科（null）不存
          const clean = {};
          Object.keys(map).forEach(sub => {
            const v = map[sub] && Number(map[sub].coverage);
            if (isFinite(v) && v >= 0 && v <= 1) {
              clean[sub] = { coverage: Math.round(v * 100000) / 100000,
                learned: (map[sub].learned || '').toString().slice(0, 60),
                remaining: (map[sub].remaining || '').toString().slice(0, 60),
                reason: (map[sub].reason || '').toString().slice(0, 120) };
            }
          });
          if (Object.keys(clean).length) Storage.setTextbookCoverage(clean, sig);
        }
      } catch (e) { /* 无 Key / 网络失败：本地匹配兜底或无覆盖 */ }
      finally { _covInFlight = null; }
    })();
    return _covInFlight;
  }

  /** 给界面/AI 用的一行覆盖率摘要 */
  function coverageDigestText() {
    const cached = Storage.getTextbookCoverage();
    const map = (cached && cached.map) || {};
    const lines = allSixSubjects().map(s => {
      const c = map[s];
      if (c && c.coverage != null) {
        return s + '：覆盖 ' + Math.round(c.coverage * 100) + '%（已学：' + (c.learned || '—')
          + '；没学：' + (c.remaining || '—') + '）—— 没学的章节高考里按 0 分算';
      }
      const t = Storage.getSubjectTextbook(s);
      return s + '：教材进度' + (t && t.unit ? '已填但无法折算（' + t.unit + '）' : '未填');
    });
    return lines.join('\n');
  }

  // ════════════════════════════════════════════════════════════
  //  估算依据的数据质量：难度来源 / 样本量 / 重复题
  //  —— 预估准不准，取决于这三件事；摊开给用户看，别让预估像个黑盒
  // ════════════════════════════════════════════════════════════
  function qualityStats(subject) {
    const papers = Storage.getPapers().filter(p => p.subject === subject);
    const qs = [];
    papers.forEach(p => (p.questions || []).forEach(q => qs.push(q)));

    // 难度来源：逐题判档（看过原题）> AI 近似回填（只有知识点+卷面分）> 无
    const perQ = papers.filter(p => (p.questions || []).some(q => DB.questionDifficulty && DB.questionDifficulty(q) != null)).length;
    const aiRev = papers.filter(p => p.difficultyJudge === 'ai-review' &&
      !(p.questions || []).some(q => DB.questionDifficulty && DB.questionDifficulty(q) != null)).length;
    const noDiff = papers.filter(p => !DB.paperDifficulty || DB.paperDifficulty(p) == null).length;

    const judged = qs.filter(q => q.isCorrect === true || q.isCorrect === false).length;

    // 重复题：同一套题做多遍 → 正确率虚高、样本量虚高（用户英语/物理/化学就是同一套 5 题做 5 遍）
    const seen = {};
    let dupQ = 0;
    qs.forEach(q => {
      const key = String(q.text || '').trim().slice(0, 40) || ((q.knowledge || '') + '#' + (q.no || ''));
      if (!key || key === '#') return;
      seen[key] = (seen[key] || 0) + 1;
    });
    Object.keys(seen).forEach(k => { if (seen[k] > 1) dupQ += seen[k] - 1; });
    const uniq = Object.keys(seen).length;

    // 难度来源等级
    let diffLevel = 'none', diffText = '没判过难度（按学科基准折算）', diffColor = 'var(--red)';
    if (perQ) { diffLevel = 'good'; diffText = '逐题判档 ' + perQ + ' 份（看过原题）'; diffColor = 'var(--green)'; }
    else if (aiRev) { diffLevel = 'weak'; diffText = '近似回填 ' + aiRev + ' 份（只看知识点+卷面分，没看原题）'; diffColor = 'var(--amber)'; }

    // 样本量等级
    let smpLevel = 'none', smpText = '没有逐题样本';
    if (judged >= 25) { smpLevel = 'good'; smpText = judged + ' 题（够用）'; }
    else if (judged >= 5) { smpLevel = 'weak'; smpText = judged + ' 题（偏少）'; }
    else if (judged > 0) { smpLevel = 'bad'; smpText = judged + ' 题（太少）'; }

    return { papers: papers.length, perQ, aiRev, noDiff, judged, dupQ, uniq, diffLevel, diffText, diffColor, smpLevel, smpText };
  }

  function renderDataQuality() {
    const body = $('quality-body');
    if (!body) return;
    const subs = allSixSubjects();
    const st = {}, advice = [];

    const rows = subs.map(s => {
      const q = qualityStats(s);
      st[s] = q;
      // 每科一句最该做的事
      let fix = '';
      if (!q.papers) fix = '还没有卷子';
      else if (q.perQ === 0 && q.papers > 0) fix = '带原图重传一份 → 逐题判难度';
      else if (q.judged < 25) fix = '再多传整卷（题目样本 ' + q.judged + '/25）';
      else if (q.dupQ > 0) fix = '换新卷，别重复做同一套';
      else fix = '数据够了';
      return '<tr>' +
        '<td><span class="tag tag-' + esc(s) + '">' + esc(s) + '</span></td>' +
        '<td class="num">' + q.papers + '</td>' +
        '<td style="color:' + q.diffColor + ';font-size:13px">' + esc(q.diffText) + '</td>' +
        '<td class="num" style="font-size:13px">' + esc(q.smpText) + '</td>' +
        '<td class="num" style="font-size:13px">' +
          (q.dupQ ? '<span style="color:var(--amber)">' + q.dupQ + ' 道重复</span>' : (q.uniq ? '无' : '—')) + '</td>' +
        '<td style="font-size:13px;color:var(--label-secondary)">' + esc(fix) + '</td>' +
        '</tr>';
    }).join('');

    body.innerHTML =
      '<table class="data-table"><thead><tr>' +
      '<th>科目</th><th>卷数</th><th>难度来源</th><th>逐题样本</th><th>重复题</th><th>怎么补</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';

    // ── 整体建议（按影响力排序，最多 4 条）──
    const needReal = subs.filter(s => st[s].papers > 0 && st[s].perQ === 0);
    const needMore = subs.filter(s => st[s].papers > 0 && st[s].judged < 25);
    const hasDup = subs.filter(s => st[s].dupQ > 0);
    const noData = subs.filter(s => !st[s].papers);

    if (needReal.length) advice.push('①【最影响准确性】' + needReal.join('、') +
      ' 的卷子难度是"近似回填"的——没看过原题，只按知识点和卷面分猜的。用「导入试卷」把带原图的卷子重新传一次，模型会逐题判难度（1~5 档，3=高考平均），预估会明显更准。');
    if (needMore.length) advice.push('② 逐题样本不足 25 题的：' + needMore.join('、') +
      '。样本少的时候任何模型都只能保守估计，多传整卷比多传单题有用。');
    if (hasDup.length) advice.push('③ ' + hasDup.join('、') +
      ' 存在重复题（同一套题做了多遍）——这会让正确率虚高、看起来比实际强。建议换没做过的新卷。');
    if (noData.length) advice.push('④ ' + noData.join('、') + ' 还没有卷子，这几科不会出现在总分里。');
    if (!advice.length) advice.push('六科的难度都按真题判过、样本也够——这个预估的可信度已经到当前方法的极限了。想更准只能靠更接近高考的卷子（真题卷 > 联考卷 > 校内月考 > 作业）。');

    const qa = $('quality-advice');
    if (qa) { qa.innerHTML = advice.join('<br>'); qa.style.whiteSpace = 'normal'; }

    const qs2 = $('quality-sub');
    if (qs2) {
      const realN = subs.filter(s => st[s].perQ > 0).length;
      const jq = subs.reduce((a, s) => a + st[s].judged, 0);
      qs2.textContent = realN + '/6 科难度看过原题 · 逐题样本共 ' + jq + ' 题';
      qs2.style.color = realN === 0 ? 'var(--amber)' : (realN >= 4 ? 'var(--green)' : 'var(--label-secondary)');
    }
  }

  // ════════════════════════════════════════════════════════════
  //  高考目标：总分 + 每科目标分
  // ════════════════════════════════════════════════════════════
  //  高考目标：总分 + 每科目标分
  // ════════════════════════════════════════════════════════════
  function renderGoalRows() {
    const el = $('set-goal-rows');
    if (!el) return;
    const g = Storage.getGoal();
    const targets = Storage.getSubjectTargets();
    const total = $('set-goal-total');
    if (total && document.activeElement !== total) total.value = (g.target != null ? g.target : '');
    el.innerHTML = allSixSubjects().map(sub => {
      const max = (DB.MAX_SCORES || {})[sub] || 150;
      const cur = targets[sub] != null ? targets[sub] : '';
      return '<div class="tb-row">' +
        '<span class="tb-subject">' + esc(sub) + '</span>' +
        '<input type="number" step="0.5" min="0" max="' + max + '" data-goal="' + esc(sub) + '" ' +
          'placeholder="满分 ' + max + '" value="' + esc(cur) + '" style="flex:0 0 130px;height:32px">' +
        '<span class="hint" style="margin:0;flex:1">满分 ' + max + '</span>' +
        '</div>';
    }).join('');
    updateGoalSum();
  }

  function updateGoalSum() {
    const el = $('set-goal-rows');
    const sum = $('set-goal-sum');
    if (!el || !sum) return;
    let s = 0, n = 0;
    el.querySelectorAll('input[data-goal]').forEach(inp => {
      const v = Number(inp.value);
      if (isFinite(v) && v > 0) { s += v; n++; }
    });
    const totalInp = Number(($('set-goal-total') || {}).value);
    const hasTotal = isFinite(totalInp) && totalInp > 0;
    const s5 = round5(s);
    let txt = n ? (n + ' 科合计 ' + s5 + ' 分') : '还没填单科';
    if (hasTotal) {
      const diff = round5(s5 - totalInp);
      if (n) txt += '，与总分目标 ' + fx5(totalInp) + ' 相差 ' + (diff >= 0 ? '+' : '') + fx5(diff);
      txt += diff === 0 ? '（一致 ✓）' : '';
    }
    sum.textContent = txt;
  }

  function saveGoalRows() {
    const el = $('set-goal-rows');
    const status = $('set-goal-status');
    if (!el) return;
    // 先存总分，再逐科存（setGoal 是整体合并，逐科走 setSubjectTarget 才有校验）
    const totalInp = Number(($('set-goal-total') || {}).value);
    if (isFinite(totalInp) && totalInp > 0) Storage.setTotalTarget(totalInp);
    let n = 0;
    el.querySelectorAll('input[data-goal]').forEach(inp => {
      const sub = inp.dataset.goal;
      const v = (inp.value || '').trim();
      const r = Storage.setSubjectTarget(sub, v === '' ? NaN : v);
      if (r != null) n++;
      if (v !== '' && r == null) {
        const max = (DB.MAX_SCORES || {})[sub] || 150;
        if (status) status.textContent = sub + ' 的目标要在 0~' + max + ' 之间，没保存';
      }
    });
    renderGoalRows();
    const g = Storage.getGoal();
    if (status && n) status.textContent = '已保存：总分目标 ' + fx5(g.target) + ' · ' + n + ' 科单科目标';
    toast(n ? ('已保存目标（总分 ' + fx5(g.target) + '）') : '目标已更新', 'success');
  }

  /** 按总分目标把分数均分到六科（按各科满分占比，语数英 150、选考 100） */
  function spreadGoalEven() {
    const totalInp = Number(($('set-goal-total') || {}).value);
    if (!isFinite(totalInp) || totalInp <= 0) { toast('先填总分目标', 'warning'); return; }
    const subs = allSixSubjects();
    const maxSum = subs.reduce((acc, s) => acc + ((DB.MAX_SCORES || {})[s] || 150), 0);
    subs.forEach(s => {
      const max = (DB.MAX_SCORES || {})[s] || 150;
      const v = Math.round(totalInp * max / maxSum * 100000) / 100000;
      const inp = document.querySelector('input[data-goal="' + s + '"]');
      if (inp) inp.value = v;
    });
    updateGoalSum();
    toast('已按满分占比分到各科，确认后点「保存目标」', 'info');
  }

  // ════════════════════════════════════════════════════════════
  //  薄弱点
  // ════════════════════════════════════════════════════════════
  async function renderWeakness() {
    const records = Storage.getRecords();
    const mistakes = Storage.getMistakes();
    const wl = $('weakness-list');

    /**
     * ★ 错题本改由 ReviewUI 渲染（2026-10-24）
     *
     * 旧版这里把最后 20 条错题平铺出来，只有题目+答案，没有复习状态。
     * 现在 ReviewUI 负责：今日复习卡 + 带筛选/掌握状态的错题列表。
     * 这里只做一处保底（如果 ReviewUI 没加载，仍能显示基本信息）。
     */
    try {
      if (typeof ReviewUI !== 'undefined') {
        ReviewUI.refresh();
      } else {
        const el = $('mistake-list');
        if (el) {
          el.innerHTML = mistakes.length
            ? mistakes.slice(-20).reverse().map(m =>
                '<div class="activity"><div class="act-icon">✕</div><div class="act-info">' +
                '<div class="act-title">' + esc(m.question || m.knowledge) + '</div>' +
                '<div class="act-time"><span class="tag tag-' + esc(m.subject) + '">' + esc(m.subject) + '</span> ' +
                esc(m.knowledge || '') + '</div></div></div>').join('')
            : '<div class="empty">还没有错题</div>';
        }
        const ce = $('mistake-count');
        if (ce) ce.textContent = mistakes.length + ' 道错题';
      }
    } catch (e) {
      console.warn('[weakness] ReviewUI 渲染失败:', e);
    }

    if (!mistakes.length) {
      wl.innerHTML = '<div class="empty">还没有足够数据<br>做几份试卷或上传作业后，AI 会归纳你的薄弱点</div>';
      return;
    }

    /**
     * ★ DeepTutor 错题本状态条（2026-10-24）
     *
     * 错题同时存在于两个地方：
     *   · 学徒 localStorage（本地，快）
     *   · DeepTutor 错题本（能做掌握度分析、分类、检索）
     * 这里显示同步状态，并提供一键同步。
     */
    const dtBar = $('weakness-dt-bar');
    if (dtBar) {
      (async () => {
        try {
          const last = (typeof DTSync !== 'undefined') ? DTSync.lastSync() : null;
          const online = (typeof DTSync !== 'undefined') ? await DTSync.available() : false;

          if (!online) {
            dtBar.innerHTML = '<div class="hint">DeepTutor 未连接（深度辅导服务没开）</div>';
            return;
          }

          dtBar.innerHTML =
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;' +
            'background:rgba(65,118,230,.05);border-radius:9px;font-size:12.5px">' +
            '<span style="color:var(--green)">● DeepTutor 已连接</span>' +
            '<span class="hint">' + (last ? '上次同步 ' + fmtAgo(last.at) : '还没同步过') + '</span>' +
            '<button class="btn btn-sm btn-secondary" id="btn-dt-sync-mistakes" style="margin-left:auto">同步错题到 DeepTutor</button>' +
            '</div>';

          const btn = $('btn-dt-sync-mistakes');
          if (btn) {
            btn.addEventListener('click', async () => {
              btn.disabled = true;
              btn.textContent = '同步中…';
              try {
                const r = await DTSync.syncAll();
                if (r.ok) {
                  btn.textContent = '✓ 已同步';
                  Shell.toast('已同步：' + r.steps.map(x => x.name + ' ' + x.detail).join('，'), 'success');
                } else {
                  btn.textContent = '同步失败';
                  Shell.toast('同步失败：' + (r.errors[0] || ''), 'error');
                }
              } catch (e) {
                btn.textContent = '同步失败';
                Shell.toast('同步失败：' + e.message, 'error');
              }
              btn.disabled = false;
              setTimeout(() => { btn.textContent = '同步错题到 DeepTutor'; }, 2500);
            });
          }
        } catch (e) {
          dtBar.innerHTML = '<div class="hint">DeepTutor 状态未知</div>';
        }
      })();
    }

    wl.innerHTML = '<div class="thinking"><span class="spinner"></span>AI 正在归纳薄弱知识点…</div>';
    try {
      const r = await ProgressEngine.analyzeWeakness(records, mistakes);
      const list = r.list || [];
      if (!list.length) { wl.innerHTML = '<div class="empty">暂时没有明显的薄弱点</div>'; return; }
      const colors = { critical: 'var(--red)', warning: 'var(--amber)', improving: 'var(--green)' };
      const labels = { critical: '严重', warning: '需关注', improving: '提升中' };
      wl.innerHTML = (r.summary ? '<div class="ai-box" style="margin-bottom:14px">' + esc(r.summary) + '</div>' : '') +
        list.map((w, i) => {
          const c = colors[w.level] || colors.warning;
          const rate = Math.max(0, Math.min(1, w.errorRate || 0));
          return '<div class="wk-item"><div class="wk-head">' +
            '<span class="wk-name"><strong>' + (i + 1) + '</strong> ' + esc(w.name) +
            ' <span class="tag tag-' + esc(w.subject) + '">' + esc(w.subject) + '</span></span>' +
            '<span class="wk-level" style="color:' + c + '">' + (labels[w.level] || '需关注') + '</span></div>' +
            '<div class="wk-bar-wrap"><div class="wk-bar-fill" style="width:' + Math.round(rate * 100) + '%;background:' + c + '"></div></div>' +
            /**
             * ★ 不再显示「错误率 100.00000%」（2026-10-24）
             *   用户评估明确指出：五位小数制造虚假精确感，
             *   「最近 6 次作答错了 2 次」比「错误率 33.33333%」有用得多。
             *
             *   改成：错几次 / 共几次 + 取整百分比
             */
            '<div class="wk-stats">' +
            (function() {
              const occ = w.occurrences || w.count || 1;
              const total = w.totalAttempts || w.total || 0;
              if (total > 1) {
                return '最近 ' + total + ' 次里错了 ' + occ + ' 次（' + Math.round(rate * 100) + '%）';
              }
              return '错了 ' + occ + ' 次';
            })() +
            (w.suggestion ? ' · ' + esc(w.suggestion) : '') + '</div></div>';
        }).join('');
      if (r.method === 'ai') remember('ai', '【薄弱点】' + list.slice(0, 5).map(w => w.name).join('、'), 'weakness');
    } catch (e) {
      wl.innerHTML = '<div class="empty">分析失败：' + esc(e.message) + '</div>';
    }
  }

  async function analyzeWeaknessNow() {
    const btn = $('btn-analyze-weakness');
    btn.disabled = true; btn.textContent = '分析中…';
    await renderWeakness();
    btn.disabled = false; btn.textContent = 'AI 重新分析';
  }

  // ════════════════════════════════════════════════════════════
  //  原图标注对错 + 判定校正
  //
  //  模型返回每题的 box（归一化 [x1,y1,x2,y2]）和 page（第几张图），
  //  用百分比绝对定位把 ✓/✗ 盖在原图上，所以图片缩放不用重算坐标。
  //  点标记即可改判 —— 模型看错时用它纠正，保存后错题本与预估一起更新。
  // ════════════════════════════════════════════════════════════

  /** 一次标注会话（页面图片只存内存，不落 localStorage —— base64 太大） */
  let annSession = null;

  function annClass(v) { return v === true ? 'ok' : v === false ? 'bad' : 'unk'; }
  function annSymbol(v) { return v === true ? '✓' : v === false ? '✗' : '?'; }

  function annotatedViewerHTML(pages, questions) {
    if (!pages || !pages.length) return '';
    const items = questions.map((q, i) => ({
      i: i, q: q,
      box: cleanBox(q.box),
      page: Math.max(1, parseInt(q.page, 10) || 1),
    }));

    let html = '<div class="ann-viewer">';
    pages.forEach((pg, pi) => {
      const mine = items.filter(m => m.page === pi + 1);
      html += '<div class="ann-page"><div class="ann-wrap">' +
        '<img src="' + pg.dataUrl + '" alt="第 ' + (pi + 1) + ' 页">';
      mine.forEach(m => {
        if (m.box) {
          const x1 = m.box[0], y1 = m.box[1], x2 = m.box[2], y2 = m.box[3];
          html += '<div class="ann-box ' + annClass(m.q.isCorrect) + '" style="' +
            'left:' + (x1 * 100).toFixed(2) + '%;top:' + (y1 * 100).toFixed(2) + '%;' +
            'width:' + Math.max(1, (x2 - x1) * 100).toFixed(2) + '%;' +
            'height:' + Math.max(1, (y2 - y1) * 100).toFixed(2) + '%"></div>';
        }
        const lt = m.box ? m.box[0] * 100 : 3;
        const tp = m.box ? Math.max(0, m.box[1] * 100 - 1.5) : 3 + (mine.indexOf(m) * 6);
        html += '<button type="button" class="ann-mark ' + annClass(m.q.isCorrect) + '" data-q="' + m.i + '" ' +
          'style="left:' + lt.toFixed(2) + '%;top:' + tp.toFixed(2) + '%" ' +
          'title="第 ' + (m.q.no || m.i + 1) + ' 题 · 点击切换对错">' + annSymbol(m.q.isCorrect) + '</button>';
      });
      html += '</div><div class="ann-caption">第 ' + (pi + 1) + ' 页 · ' + mine.length + ' 题标出位置' +
        (mine.length ? '' : '（这一页没有可定位的题目）') + '</div></div>';
    });
    html += '</div>';
    return html;
  }

  function renderAnnotationPanel(containerId, state) {
    const el = $(containerId);
    if (!el || !state) return;
    const qs = state.questions || [];
    const right = qs.filter(q => q.isCorrect === true).length;
    const wrong = qs.filter(q => q.isCorrect === false).length;
    const un = qs.length - right - wrong;
    // ★ 本卷难度（相对高考）：让用户直接看到"这份卷子比高考难多少"
    const dPaper = DB.paperDifficulty ? DB.paperDifficulty({ questions: qs }) : null;
    const dTags = qs.map(q => DB.questionDifficulty ? DB.questionDifficulty(q) : null).filter(v => v != null);
    const dChip = dPaper == null ? ''
      : '<span class="card-sub" style="margin-left:8px">本卷难度 <b>' + (Math.round(dPaper * 100) / 100) +
        ' 档</b>（高考基准 3 档）'
        + (dTags.length ? ' · 修正 ×' + DB.difficultyAdj(dPaper) : '') + '</span>';

    el.innerHTML =
      '<div class="card">' +
        '<div class="card-header"><h3>原图标注</h3>' +
          '<span class="card-sub">' + right + ' 对 / ' + wrong + ' 错' +
          (un ? ' / ' + un + ' 未判' : '') +
          (state.dirty ? ' · <b style="color:var(--amber)">未保存</b>' : '') + '</span>' + dChip + '</div>' +
        '<p class="card-desc">点图上的 <b>✓ / ✗</b> 就能改判——模型看错时用它纠正。改完点最下方「保存校正」，错题本和成绩预估会一起更新。</p>' +
        annotatedViewerHTML(state.pages, qs) +
      '</div>' +
      '<div class="card">' +
        '<div class="card-header"><h3>逐题校正</h3><span class="card-sub">共 ' + qs.length + ' 题</span></div>' +
        (DB.difficultyNote ? '<p class="card-desc">' + esc(DB.difficultyNote(dPaper)) + '</p>' : '') +
        '<p class="card-desc">点一行改 <b>对/错</b>；点后面的 <b>难度档</b> 改这道题相对高考的难度' +
          '（1 送分 · 2 基础 · <b>3 = 高考平均</b> · 4 难题 · 5 压轴），改完点「保存校正」，预估会跟着重算。</p>' +
        '<div class="corr-list">' +
          qs.map((q, i) => {
            const qd = DB.questionDifficulty ? DB.questionDifficulty(q) : null;
            return '<button type="button" class="corr-item ' + annClass(q.isCorrect) + '" data-q="' + i + '">' +
              '<b>第 ' + esc(q.no || (i + 1)) + ' 题</b>' +
              '<span class="corr-verdict">' + annSymbol(q.isCorrect) + ' ' +
                (q.isCorrect === true ? '对' : q.isCorrect === false ? '错' : '未判') + '</span>' +
              '<span class="corr-verdict" data-diff="' + i + '" title="点一下改难度档（1~5，3=高考平均）"' +
                ' style="cursor:pointer;border-bottom:1px dashed currentColor">' +
                (qd != null ? qd + ' 档' : '难度?') + '</span>' +
              '<span class="corr-text">' + esc(String(q.text || q.knowledge || '').slice(0, 48)) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="btn-group" style="margin-top:14px">' +
          '<button class="btn btn-primary" id="' + containerId + '-save">保存校正</button>' +
          '<button class="btn btn-secondary" id="' + containerId + '-reset">还原</button>' +
        '</div>' +
      '</div>';

    el.querySelectorAll('[data-q]').forEach(b => {
      b.addEventListener('click', () => {
        const i = parseInt(b.dataset.q, 10);
        const q = state.questions[i];
        if (!q) return;
        // 三态循环：对 → 错 → 对（未判也先进"对"）
        q.isCorrect = q.isCorrect === true ? false : true;
        state.dirty = true;
        renderAnnotationPanel(containerId, state);
      });
    });

    // ★ 逐题难度可改：没判过 → 先给 3 档（高考平均，中性），之后 3→4→5→1→2→3 循环
    el.querySelectorAll('[data-diff]').forEach(sp => {
      sp.addEventListener('click', (ev) => {
        ev.stopPropagation();               // 别触发外层的"对/错"切换
        const i = parseInt(sp.dataset.diff, 10);
        const q = state.questions[i];
        if (!q) return;
        const cur = DB.questionDifficulty(q);
        const next = cur == null ? 3 : (cur >= 5 ? 1 : cur + 1);
        q.difficulty = next;                // 统一写 difficulty，读取时兼容 diff/difficultyLevel
        state.dirty = true;
        renderAnnotationPanel(containerId, state);
      });
    });

    const saveBtn = $(containerId + '-save');
    if (saveBtn) saveBtn.addEventListener('click', () => saveAnnotation(containerId, state));

    const rst = $(containerId + '-reset');
    if (rst) rst.addEventListener('click', () => {
      const p = Storage.getPaper(state.paperId);
      if (p && Array.isArray(p.questions)) {
        state.questions = JSON.parse(JSON.stringify(p.questions));
        state.dirty = false;
        renderAnnotationPanel(containerId, state);
        toast('已还原为识别结果', 'success');
      } else {
        toast('没有可还原的已保存判定', 'warning');
      }
    });
  }

  /**
   * 按校正后的逐题判定重算卷面得分。
   *
   * ★ P0 修复（2026-10-10）：旧实现有三个错，属于**数据破坏**：
   *   ① `fullScore × right / qs.length` 忽略每题分值 —— 15 分大题和 3 分小题等权；
   *   ② 未判定的题（isCorrect == null）被当成错 —— 识别不确定就直接扣分；
   *   ③ 结果**回写进原始 record**，原始卷面分从此不可恢复。
   *
   * 新口径：
   *   · 有题分 → 按分值加权（partial credit）
   *   · 没题分 → 按题数平均（退化为旧行为，但不再把 null 当错）
   *   · 只统计**已判定**的题做分母；一个都没判定就返回 null，不动分数
   *   · 不改原始 record，只把"校正后的分"记为单独字段，可回溯
   */
  function recomputeScoreFromQuestions(paper, qs) {
    const full = Number(paper && paper.fullScore);
    if (!(full > 0) || !qs || !qs.length) return null;

    const judged = qs.filter(q => q.isCorrect === true || q.isCorrect === false);
    if (!judged.length) return null;                        // ② 没有判定就不动分

    // 是否有可用题分
    let scoredSum = 0, scoredFull = 0;
    judged.forEach(q => {
      const s = Number(q.score);
      if (isFinite(s) && s >= 0) { scoredFull += s; if (q.isCorrect === true) scoredSum += s; }
    });

    let ratio;
    if (scoredFull > 0 && scoredFull <= full * 1.0001) {
      ratio = scoredSum / scoredFull;                       // ① 按题分加权
    } else {
      const right = judged.filter(q => q.isCorrect === true).length;
      ratio = right / judged.length;                        // 退化为题数比（分母只算已判定）
    }
    return round5(Math.max(0, Math.min(1, ratio)) * full);
  }

  /** 保存校正：更新试卷 + 重建这份卷子的错题 + 重算预估 */
  async function saveAnnotation(containerId, state) {
    const qs = state.questions || [];
    const right = qs.filter(q => q.isCorrect === true).length;
    const wrong = qs.filter(q => q.isCorrect === false).length;
    const unknown = qs.length - right - wrong;
    const paper = Storage.getPaper(state.paperId) || {};
    const subject = paper.subject || '综合';

    const patch = {
      questions: qs, rightCount: right, wrongCount: wrong,
      correctedAt: new Date().toISOString(),
    };

    /**
     * 有满分的卷子：按校正后的判定重算得分。
     * ★ 只写 paper.score（当前生效值），并把**原始分另存**到 paper.scoreOriginal，
     *   这样"这份卷子最初录的多少"永远查得到 —— 旧版直接盖掉 record.score，不可恢复。
     */
    const recomputed = recomputeScoreFromQuestions(paper, qs);
    if (recomputed != null) {
      if (Number(paper.score) > 0 && paper.scoreOriginal == null) {
        patch.scoreOriginal = Number(paper.score);   // 留档：这份卷子最初录的多少
      }
      patch.recomputedScore = recomputed;      // 校正推算值
      patch.score = recomputed;                // 生效值
      patch.scoreBasis = 'recomputed';         // 标注来源，便于审计
      patch.scoreUnknown = unknown;            // 没判定的题数（提醒用户）
    }

    Storage.updatePaper(state.paperId, patch);

    // 错题重建：只清"逐题判定"那批，知识点级错题保留（否则保存校正会凭空少几条）
    Storage.delMistakesByPaper(state.paperId, 'question');
    qs.forEach(q => {
      if (q.isCorrect !== false) return;
      Storage.addMistake({
        subject: subject, paperId: state.paperId, src: 'question',
        knowledge: q.knowledge || '未分类',
        question: q.text || '',
        correctAnswer: q.correctAnswer || '',
        wrongAnswer: q.studentAnswer || '',
        explanation: q.reason || '',
        type: 'photo',
      });
    });

    state.dirty = false;
    renderAnnotationPanel(containerId, state);
    updateBadges();
    toast('校正已保存：' + right + ' 对 / ' + wrong + ' 错' +
      (unknown ? ' / ' + unknown + ' 题未判定（不计分）' : ''), 'success');

    remember('user', '【校正判定】' + subject + '「' + (paper.title || '') + '」' +
      right + ' 对 / ' + wrong + ' 错' + (unknown ? ' / ' + unknown + ' 题未判定' : '') +
      (patch.score != null ? '，按题分重算得分 ' + patch.score + '/' + paper.fullScore : ''), 'correction');

    try {
      await estimateProgress('校正 ' + subject + ' 判定');
      refreshShell();
    } catch (e) { /* 预估失败不影响校正本身 */ }
  }

  function openAnnotation(pages, questions, paperId) {
    annSession = { pages: pages || [], questions: JSON.parse(JSON.stringify(questions || [])), paperId: paperId, dirty: false };
    renderAnnotationPanel('ann-panel', annSession);
    const el = $('ann-panel');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ★ 批量（文件夹）上传时，每份识别完都把图片引用留着，供「查看原图批改」用。
  //   只存 File 引用 + 题目，不存 base64，几乎不占内存；原来批量模式完全不给标注入口，
  //   用户传完一批就看不到批改照片和逐题校正了。
  let annCandidates = [];

  async function openAnnotationFor(idx) {
    const c = annCandidates[idx];
    if (!c) { toast('这份的原图已经不在内存里了，重新传一次即可', 'warning'); return; }
    const panel = $('ann-panel');
    if (panel) panel.innerHTML = '<div class="card"><div class="thinking"><span class="spinner"></span>正在准备「' + esc(c.name) + '」的原图批改…</div></div>';
    try {
      const images = [];
      for (const f of c.files) images.push(await compressImage(f));
      openAnnotation(images, c.questions, c.paperId);
    } catch (e) {
      toast('打不开原图：' + e.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════════
  //  导入试卷 —— 每科满 5 份做独立分析，六科齐了出总分
  // ════════════════════════════════════════════════════════════
  let uploadedFiles = [];

  function renderImport() {
    // 科目默认「自动识别」——不让用户先做选择，模型自己从题目内容判断
    fillSubjectSelect('up-subject', true);
    // 回到本页时把已拖入的图片重新画出来（uploadedFiles 是模块级变量，还在）
    renderUploadPreview();
    const di = $('up-date');
    if (di && !di.value) di.value = new Date().toISOString().slice(0, 10);
    const ii = $('i-date');
    if (ii && !ii.value) ii.value = new Date().toISOString().slice(0, 10);
    if (!document.querySelector('#i-subjects .i-row')) addImportRow();

    // 各科试卷进度
    const subs = allSixSubjects();
    const sa = Storage.getSubjectAnalyses();
    $('paper-progress').innerHTML = subs.map(s => {
      const n = Storage.countPapers(s);
      const pct = Math.min(100, n / 5 * 100);
      const full = n >= 5;
      return '<div class="pp-item"><div class="pp-top"><span class="pp-name">' + esc(s) + '</span>' +
        '<span class="pp-count">' + n + ' / 5 份' + (sa[s] ? ' · 已分析' : '') + '</span></div>' +
        '<div class="pp-bar"><div class="pp-fill' + (full ? ' full' : '') + '" style="width:' + pct + '%"></div></div></div>';
    }).join('');

    // 单科分析
    const keys = Object.keys(sa);
    $('subject-analysis-list').innerHTML = keys.length
      ? keys.map(k => {
          const a = sa[k];
          return '<div class="wk-item"><div class="wk-head"><span class="wk-name">' + esc(k) +
            ' <span class="tag">' + fmtDate(a.date) + '</span></span>' +
            '<span class="wk-level" style="color:var(--ds-500)">' + (a.score != null ? fx5(a.score) : '') + '</span></div>' +
            '<div class="wk-stats" style="white-space:pre-wrap">' + esc(a.summary || a.analysis || '') + '</div>' +
            (a.problems && a.problems.length ? '<div class="wk-stats">问题：' + a.problems.map(esc).join('、') + '</div>' : '') +
            (a.suggestions && a.suggestions.length ? '<div class="wk-stats">建议：' + a.suggestions.map(esc).join('；') + '</div>' : '') +
            '</div>';
        }).join('')
      : '<div class="empty">还没有单科分析<br>每科上传满 5 份试卷后点上方按钮</div>';

    // 总分预估
    const missing = subs.filter(s => !sa[s]);
    const te = Storage.getTotalEstimate();
    if (missing.length) {
      $('total-analysis').innerHTML = '<div class="empty">还差 ' + missing.length + ' 科：' + missing.join('、') + '<br>六科全部分析完才能算总分</div>';
      $('btn-total-analysis').disabled = true;
    } else {
      $('btn-total-analysis').disabled = false;
      $('total-analysis').innerHTML = te && te.analysis
        ? '<div class="ai-box">' + esc(te.analysis) + (te.suggestion ? '\n\n建议：' + esc(te.suggestion) : '') + '</div>'
        : '<div class="empty">六科分析已完成，点下方按钮生成总分预估</div>';
    }

    // 导入历史：手动录入 + 上传试卷都要列出来，否则传错的删不掉
    const recs = Storage.getRecords().filter(r => r.type === 'import' || r.type === 'upload');
    const groups = {};
    recs.forEach(r => {
      const key = r.importData ? (r.importData.name + '|' + r.importData.date) : (r.subject + '|' + fmtDate(r.date));
      if (!groups[key]) groups[key] = { name: (r.importData && r.importData.name) || '未命名', date: (r.importData && r.importData.date) || r.date, source: r.source, subs: 0, total: 0, ids: [] };
      groups[key].subs++;
      groups[key].total = round5(groups[key].total + (Number(r.score) || 0));
      groups[key].ids.push(r.id);
    });
    const gk = Object.keys(groups);
    $('import-tbody').innerHTML = gk.length
      ? gk.reverse().map(k => {
          const g = groups[k];
          return '<tr><td>' + fmtDate(g.date) + '</td><td>' + esc(g.name) + '</td><td>' + esc(srcLabel(g.source)) + '</td>' +
            '<td class="num">' + g.subs + '</td><td class="num"><strong>' + fx5(g.total) + '</strong></td>' +
            '<td><button class="icon-btn" data-del="' + esc(g.ids.join(',')) + '" title="删除">✕</button></td></tr>';
        }).join('')
      : '<tr><td colspan="6" style="text-align:center;color:var(--label-tertiary)">暂无导入记录</td></tr>';
    $('import-tbody').querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => delImport(b.dataset.del));
    });

    updateBadges();
  }

  function addImportRow() {
    const el = $('i-subjects');
    const d = document.createElement('div');
    d.className = 'i-row';
    d.innerHTML = '<select>' + allSixSubjects().map(s => '<option>' + s + '</option>').join('') + '</select>' +
      '<input type="number" placeholder="得分" step="0.01">' +
      '<input type="number" placeholder="满分" value="150" step="0.01">' +
      '<button class="i-del" title="删除">✕</button>';
    d.querySelector('.i-del').addEventListener('click', () => d.remove());
    el.appendChild(d);
  }

  function submitImport() {
    const rows = Array.from(document.querySelectorAll('#i-subjects .i-row'));
    const subs = [];
    let invalid = false;
    rows.forEach(r => {
      const s = r.querySelector('select').value;
      const inputs = r.querySelectorAll('input');
      if (!inputs[0].value.trim()) return;
      const sc = Number(inputs[0].value);
      const full = inputs[1].value.trim() ? Number(inputs[1].value) : (DB.MAX_SCORES[s] || 150);
      if (!Number.isFinite(sc) || !Number.isFinite(full) || full <= 0 || sc < 0 || sc > full || subs.some(x => x.subject === s)) {
        invalid = true; return;
      }
      subs.push({ subject: s, score: sc, fullScore: full });
    });
    if (invalid) { toast('请检查成绩：得分应在 0 到满分之间，满分须大于 0，同一科目只能填写一次', 'warning'); return; }
    if (!subs.length) { toast('请至少填写一科成绩', 'warning'); return; }

    const data = {
      source: $('i-source').value,
      name: $('i-name').value || '未命名考试',
      date: $('i-date').value || new Date().toISOString().slice(0, 10),
      subjects: subs,
    };
    subs.forEach(sub => {
      const paper = Storage.addPaper({ subject: sub.subject, type: 'manual', kind: data.source, score: sub.score, fullScore: sub.fullScore, date: data.date, name: data.name });
      Storage.addRecord({
        type: 'import', source: srcLabel(data.source), subject: sub.subject,
        // ★ kind 必须写进 record：估算层要靠它还原来源档（否则真题会被当校内卷打折）
        kind: data.source,
        score: sub.score, fullScore: sub.fullScore, importData: data, paperId: paper.id,
      });
    });
    const total = round5(subs.reduce((s, x) => s + x.score, 0));
    Storage.addAct({ icon: '↥', title: '导入「' + data.name + '」总分 ' + total + ' 分' });

    $('import-result').innerHTML =
      '<div class="estimate-grid" style="margin-top:16px">' +
      '<div class="estimate-item"><div class="estimate-value">' + fx5(total) + '</div><div class="estimate-label">总分</div></div>' +
      '<div class="estimate-item"><div class="estimate-value">' + fx5(round5(total / subs.reduce((s, x) => s + x.fullScore, 0) * 100)) + '%</div><div class="estimate-label">平均得分率</div></div>' +
      '<div class="estimate-item"><div class="estimate-value">' + subs.length + '</div><div class="estimate-label">科目数</div></div>' +
      '</div>';

    // 满 5 份的科目自动触发单科分析
    const ready = subs.map(s => s.subject).filter(s => Storage.countPapers(s) >= 5 && !Storage.getSubjectAnalyses()[s]);
    renderImport();
    toast('已导入', 'success');
    if (ready.length) runSubjectAnalyses(ready);
    else estimateProgress('导入 ' + data.name).then(() => refreshShell()).catch(() => {});
  }

  function delImport(ids) {
    if (!confirm('确定删除这条导入记录？')) return;
    const selected = new Set(String(ids).split(',').filter(Boolean));
    const records = Storage.getRecords().filter(r => selected.has(r.id));
    let papers = Storage.getPapers();
    const removed = [];
    records.forEach(r => {
      let index = r.paperId ? papers.findIndex(p => p.id === r.paperId) : -1;
      if (index < 0 && r.type === 'import' && r.importData) {
        const d = r.importData;
        index = papers.findIndex(p => p.type === 'manual' && p.subject === r.subject && p.date === d.date && p.name === d.name && Number(p.score) === Number(r.score) && Number(p.fullScore) === Number(r.fullScore));
      }
      if (index >= 0) removed.push(...papers.splice(index, 1));
      Storage.delRecord(r.id);
    });
    Storage.set('papers', papers);
    removed.forEach(p => Storage.delMistakesByPaper(p.id));
    const analyses = Storage.getSubjectAnalyses();
    removed.forEach(p => { delete analyses[p.subject]; });
    Storage.set('subject_analyses', analyses);
    Storage.setTotalEstimate(null);
    renderImport();
    refreshShell();
    estimateProgress('删除导入记录').then(() => refreshShell()).catch(() => {});
    toast('已删除记录及对应试卷，相关分析已更新', 'success');
  }

  // ── 上传图片（拖拽 / 点选 / 粘贴 共用） ──
  const UPLOAD_MAX = 9;

  // ★ 文件夹批量上传：拖入一个文件夹 → 每个子文件夹 = 一份卷子 → 队列逐一识别
  // 队列项：{ name: 卷名(文件夹名), files: [File...] }
  let uploadQueue = [];
  let uploadQueueRunning = false;

  /** 读一个目录的全部直接子项（readEntries 一次最多返回 100 项，要循环读到空） */
  function readAllEntries(dirEntry) {
    return new Promise((resolve, reject) => {
      const reader = dirEntry.createReader();
      const all = [];
      const step = () => reader.readEntries((ents) => {
        if (!ents.length) return resolve(all);
        for (let i = 0; i < ents.length; i++) all.push(ents[i]);
        step();
      }, reject);
      step();
    });
  }

  function entryToFile(entry) {
    return new Promise((resolve) => entry.file((f) => resolve(f), () => resolve(null)));
  }

  const IMG_EXT = /\.(png|jpe?g|webp|heic|heif|gif|bmp|tiff?)$/i;

  /**
   * 收集"卷子"分组（拖拽进来的目录走这里）。
   * 规则：**直接装着图片的目录**才算一份卷子（卷名=目录名）；
   * 目录里只有子目录、没有图片，就继续往下钻。
   * 老版本只看第一层 → 拖入"校准图片"（里面 11 个卷子文件夹）会把 68 张图
   * 当成一份卷子，请求体巨大直接把 fetch 打挂。
   */
  async function collectPaperGroups(dirEntry, out, depth) {
    depth = depth || 0;
    if (depth > 6 || out.length > 200) return;   // 防御：异常目录结构不卡死
    let entries = [];
    try { entries = await readAllEntries(dirEntry); } catch (e) { return; }
    const imgEntries = entries.filter(e => e.isFile && IMG_EXT.test(e.name || ''));
    const subDirs = entries.filter(e => e.isDirectory);
    if (imgEntries.length) {
      const files = [];
      for (const e of imgEntries) { const f = await entryToFile(e); if (f) files.push(f); }
      if (files.length) out.push({ name: dirEntry.name || ('卷子 ' + (out.length + 1)), files: files });
    }
    for (const d of subDirs) await collectPaperGroups(d, out, depth + 1);
  }

  /**
   * 把拖入的内容按"卷子"分组。
   * 拖入文件夹 → 每个"直接装图片的目录"= 一份卷子；
   * 拖入的散图 → 一份"未分组"卷子。
   * 返回 [{ name, files }]（只保留图片）；纯图片返回 null，交给原来的单张上传逻辑。
   */
  async function groupDroppedItems(dt) {
    const items = dt && dt.items ? Array.from(dt.items) : [];
    const entries = items.filter(i => i.webkitGetAsEntry).map(i => i.webkitGetAsEntry());
    const anyDir = entries.some(e => e && e.isDirectory);
    if (!anyDir) return null;   // 纯图片 → 走原来的单张上传逻辑

    const groups = [];
    const rootImgs = [];
    for (const e of entries) {
      if (!e) continue;
      if (e.isDirectory) {
        await collectPaperGroups(e, groups, 0);
      } else if (e.isFile && IMG_EXT.test(e.name || '')) {
        const f = await entryToFile(e);
        if (f) rootImgs.push(f);
      }
    }
    if (rootImgs.length) groups.push({ name: '未分组图片', files: rootImgs });
    return groups;
  }

  /** 队列总进度（用于 toast 和状态显示） */
  function queueSummary() {
    return uploadQueue.length
      ? (uploadQueueRunning
        ? '正在识别第 1/' + uploadQueue.length + ' 份…'
        : '共发现 ' + uploadQueue.length + ' 份卷子')
      : '';
  }

  function fmtSize(b) {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  /**
   * 加入待识别图片。
   * 注意：这里是**追加**不是替换 —— 分几次拖进来不会把之前的挤掉
   *（老版本直接 uploadedFiles = [...] ，拖第二张时第一张就没了）。
   */
  function handleFileUpload(files, opts) {
    opts = opts || {};
    const all = Array.from(files || []);
    if (!all.length) return;

    const imgs = all.filter(f => f.type && f.type.indexOf('image/') === 0);
    const skipped = all.filter(f => !(f.type && f.type.indexOf('image/') === 0));

    if (opts.replace) uploadedFiles = [];

    if (!imgs.length) {
      toast(skipped.length
        ? ('这些不是图片，没法识别：' + skipped.slice(0, 3).map(f => f.name || '未命名').join('、'))
        : '没有可用的图片', 'warning');
      renderUploadPreview();
      return;
    }

    const room = UPLOAD_MAX - uploadedFiles.length;
    if (room <= 0) { toast('最多 ' + UPLOAD_MAX + ' 张，先移除几张再拖', 'warning'); return; }

    // 同一个文件重复拖入不重复加
    let added = 0;
    for (const f of imgs) {
      if (added >= room) break;
      const dup = uploadedFiles.some(x => x.name === f.name && x.size === f.size);
      if (dup) continue;
      uploadedFiles.push(f);
      added++;
    }

    renderUploadPreview();

    if (!added) { toast('这些图片已经在列表里了', 'warning'); return; }
    const parts = ['已加入 ' + added + ' 张'];
    if (imgs.length > room) parts.push('超出上限，只收了 ' + room + ' 张');
    if (skipped.length) parts.push('跳过 ' + skipped.length + ' 个非图片文件');
    toast(parts.join('，'), (imgs.length > room || skipped.length) ? 'warning' : 'success');
  }

  function renderUploadPreview() {
    const box = $('up-preview');
    if (!box) return;
    box.innerHTML = '';
    uploadedFiles.forEach((file, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'photo-thumb';
      const img = document.createElement('img');
      img.alt = file.name || '';
      img.title = (file.name || '') + ' · ' + fmtSize(file.size);
      fileToDataURL(file).then(url => { img.src = url; }).catch(() => {});
      const del = document.createElement('button');
      del.type = 'button';
      del.title = '移除这张';
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadedFiles.splice(i, 1);
        renderUploadPreview();
      });
      wrap.appendChild(img);
      wrap.appendChild(del);
      box.appendChild(wrap);
    });

    const sum = $('up-file-summary');
    if (sum) {
      sum.textContent = uploadedFiles.length
        ? ('已选 ' + uploadedFiles.length + ' / ' + UPLOAD_MAX + ' 张 · 共 ' +
           fmtSize(uploadedFiles.reduce((s, f) => s + (f.size || 0), 0)))
        : '还没选图片';
      sum.style.color = uploadedFiles.length ? 'var(--green)' : 'var(--label-tertiary)';
    }
  }

  /** 九科全名单，用于校验模型识别的科目 */
  const ALL_NINE = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];

  /**
   * 决定这份卷子归档到哪个科目。
   * 用户手动指定优先；没指定就用模型识别的（并做模糊校验）。
   * 这个函数的存在是因为老版本直接用下拉框的值 —— 下拉默认"语文"，
   * 结果一道三角函数的数学卷被记进了语文名下。
   */
  function resolveSubject(modelSaid, userPicked) {
    if (userPicked && ALL_NINE.indexOf(userPicked) >= 0) return userPicked;
    let s = String(modelSaid == null ? '' : modelSaid).trim();
    if (ALL_NINE.indexOf(s) >= 0) return s;
    // 模型可能返回 "高中数学" / "数学（人教版）" 这种
    const hit = ALL_NINE.find(x => s.indexOf(x) >= 0);
    if (hit) return hit;
    return '综合';
  }

  /**
   * 识别并归档**一份**卷子（图片组）。
   * 返回 { subject, savedPaper, r }，供队列汇总。
   */
  // ════════════════════════════════════════════════════════════
  //  识别精度：分批 + 压缩档 + 提示词 + 结果合并
  //
  //  三个精度瓶颈（2026-10-02 改）：
  //  ① 一次把十几张图全发过去 → 模型注意力分散，后面的图漏题；
  //  ② max_tokens 8000 + "最多列 15 条" → 题多的卷子（英语 67 题）大量丢题；
  //  ③ 压缩到 1600px/0.86 → 小字（化学方程式、数学下标）糊掉。
  //  对策：每批最多 4 张、逐批识别再合并；输出上限 16000；图少时用更高分辨率；
  //       并要求"逐题列全、不许漏题、看不清标 ?"。
  // ════════════════════════════════════════════════════════════
  const RECOG_BATCH = 4;            // 每批最多几张图
  const RECOG_MAX_TOKENS = 16000;   // 单批输出上限（原 8000，题多会被截断丢题）

  function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  /** 按图片张数选压缩档：图少 → 更清晰（精度优先）；图多 → 适度压缩（防请求体过大把 fetch 打挂） */
  function compressTier(n) {
    if (n <= 2) return { maxDim: 2200, quality: 0.92 };
    if (n <= 4) return { maxDim: 1800, quality: 0.88 };
    return { maxDim: 1700, quality: 0.86 };
  }

  /**
   * 识别提示词。分批时说明"这是第 i/k 批、对应整卷第 A~B 页"，
   * 并要求 page 写**整卷页号**、no 写**图上印的题号**，这样合并时不用猜。
   */
  function buildPaperPrompt(o) {
    const batchInfo = o.batchCount > 1
      ? '这是这份卷子的**第 ' + o.batchIndex + '/' + o.batchCount + ' 批**，对应整卷的第 ' +
        o.pageFrom + '~' + o.pageTo + ' 页（共 ' + o.totalPages + ' 页）。只处理这一批图片。\n'
      : '';
    const pageRule = o.batchCount > 1
      ? '    "page": 这道题在**整卷**里的页号（本批图片对应第 ' + o.pageFrom + '~' + o.pageTo + ' 页，所以这个字段只能是这个范围）, "box": [x1,y1,x2,y2]}\n'
      : '    "page": 这张题在第几张图（从 1 开始）, "box": [x1,y1,x2,y2]}\n';
    // ★ 用户已经人工确认过题目位置：把这些框作为"必答清单"写进提示词，每框必出一条
    const boxHint = (o.boxes && o.boxes.length)
      ? '**用户已经人工确认了本批的题目位置**（下面每行：页号 题号 [左,上,右,下]）：\n' +
        o.boxes.map(function(b) {
          return '  第 ' + b.page + ' 页 第 ' + b.no + ' 题 [' +
            (b.box || []).map(function(v) { return Number(v).toFixed(2); }).join(',') + ']\n';
        }).join('') +
        '· **上面列出的每一道题都必须出现在 questions 里，一个都不许少**（这是用户核对过的清单）；\n' +
        '· 每条的 box 直接回填对应坐标、page 用对应页号、no 用上面的题号；\n' +
        '· 如果某个框里确实没有题目内容，才可省略该条，并在 summary 里说明。\n\n'
      : '';

    return (
      '这是我上传的' + (o.subjectPick ? '「' + o.subjectPick + '」' : '') +
      (o.type === 'exam' ? '考试试卷' : '日常作业') +
      '（本批 ' + o.nImages + ' 张图）。\n' +
      batchInfo +
      boxHint +
      '请你扮演阅卷老师：\n' +
      '1) 识别出里面**所有**的题目和学生作答；\n' +
      '2) 判断每道题对错；\n' +
      '3) **逐题判断难度**（下面有专门说明，这一步决不能用"中等"糊过去）；\n' +
      '4) 归纳出学生在这份卷子上暴露的易错知识点；\n' +
      '5) 给出这一批的得分估计。\n' +
      (o.subjectPick ? '' :
        '6) **先判断这是哪个科目**，并写进 subject 字段。\n' +
        '   只能是这九个之一：语文、数学、英语、物理、化学、生物、政治、历史、地理。\n' +
        '   依据题目内容判断，不要凭卷子抬头猜。\n') +
      '\n严格返回下面的 JSON 结构（不要 Markdown 代码块，不要任何解释文字）：\n' +
      '{\n' +
      '  "title": "试卷名称",\n' +
      '  "subject": "科目",\n' +
      '  "score": 本批这些题的得分数字,\n' +
      '  "fullScore": **整卷满分**（这份卷子的总分，不是本批的）,\n' +
      '  "totalQuestions": 本批识别到的题目总数,\n' +
      '  "pageCheck": [{"page": 1, "nos": [1,2,3,4,5]}],\n' +
      '  "questions": [\n' +
      '    {"no": 题目在图上印的题号（不是你自己连续编号）, "text": "题干要点（40字内，便于日后复习）",\n' +
      '     "studentAnswer": "我的作答或null", "correctAnswer": "正确答案",\n' +
      '     "isCorrect": true或false或null, "knowledge": "知识点", "reason": "错因",\n' +
      '     "score": 本题分值数字,\n' +
      '     "difficulty": 1到5的整数, "difficultyWhy": "为什么这么判（10字内）",\n' +
      pageRule +
      '  ],\n' +
      '  "mistakes": [{"knowledge": "易错知识点", "reason": "为什么会错"}],\n' +
      '  "summary": "这一批的整体评价，100字以内"\n' +
      '}\n\n' +
      '关于**完整性**（最关键，漏题会让后面的分析全错）：\n' +
      '· **先清点、再作答**：先看每一页有几道题、题号分别是什么，把它们写进 pageCheck；\n' +
      '· 然后按题号逐题写进 questions —— **pageCheck 里列出的题号必须全部出现在 questions 里**；\n' +
      '· 图上有几道题就列几道，**一题都不许漏**；题目多也要全列出来；\n' +
      '· 大题下的 (1)(2)(3) 小问算**同一道题**（写一条，题干里带上小问），不要漏掉小问内容；\n' +
      '· 不许把多道题合并成一条，也不许只列错题、跳过做对的题；\n' +
      '· 一题跨两页时按它主要所在的那一页记；\n' +
      '· **看不清的地方**（模糊、遮挡、公式糊掉）在对应字段写"（看不清）"，\n' +
      '  不确定对错时 isCorrect 填 null —— 宁可说不确定，也不许瞎猜。\n\n' +
      '关于 difficulty（很重要，我要拿它把这份卷子跟高考比难度）：\n' +
      '· 难度是**拿高考真题当尺子**判的，不是拿"这次考试班级平均分"判的；\n' +
      '· 1 = 送分题（高考几乎不考这种，看一眼就会）；\n' +
      '· 2 = 基础题（高考里的简单题，套路固定）；\n' +
      '· 3 = 中档题（**与高考平均难度相当**，这是基准档）；\n' +
      '· 4 = 难题（高考里的难题，需要两步以上转化）；\n' +
      '· 5 = 压轴题（高考压轴/选拔档，多数学生做不完）；\n' +
      '· **必须真的分出档次**：一份卷子不可能全是 3；\n' +
      '· 判档依据写进 difficultyWhy，例如"套公式即可"→2、"需构造辅助线"→4。\n\n' +
      '关于 box（很重要，我要拿它在原图上打勾打叉）：\n' +
      '· box 是这道题在图片里的矩形范围，用**归一化坐标**表示：左上角 (0,0)、右下角 (1,1)；\n' +
      '· 四个数依次是 [左, 上, 右, 下]，例如题目在图的上半部分靠中间，就是 [0.15,0.05,0.85,0.2]；\n' +
      '· **框要紧贴这一题**：上边界贴着题干第一行上方，下边界贴着作答结束处；\n' +
      '  宽度一般占页面的 60%~95%（一行字高度约 3%），别把整页或半页一股脑框进去，也别只框一个小点；\n' +
      '· 一页有多道题时，每个 box 要分开、不要互相重叠；实在定位不了就给 null。\n\n' +
      '关于「哪些才算题目」（很关键，别把空白处也列成题）：\n' +
      '· 只列**真的有题干文字**的题目；页眉页脚、页码、装订线、空白答题格、\n' +
      '  插图周围的空白区域，都不算题目，不要为它们生成条目；\n' +
      '· **答题说明不算题目**：像"写作词数应为 80 左右""请按如下格式在答题纸相应位置作答"\n' +
      '  "阅读下列材料，回答问题"这类作答要求、格式说明、分值说明，都**不要**当成题目；\n' +
      '· 空白页或没有题目的图，就不要输出题目；\n' +
      '· text 必须写出这题的题干要点，**不许留空**；写不出题干的条目不要输出。\n\n' +
      'JSON 必须完整闭合，不要写到一半停住。'
    );
  }

  /** 截断后的精简重试提示词（分批后每批题目不多，一般用不到） */
  function buildSlimPrompt(o) {
    return '只做四件事，用最精简的 JSON 回答，不要解释：\n'
      + '1) ' + (o.subjectPick ? '估计这批「' + o.subjectPick + '」题' : '判断科目，并估计这批题') + '的得分与整卷满分；\n'
      + '2) 列出**全部**错题（每题：题干要点、知识点、错因）；\n'
      + '3) 每题给 difficulty（1~5 整数，拿高考真题当尺子：1送分 2基础 3中等=高考平均 4难题 5压轴）；\n'
      + '4) 一句话总评。\n'
      + '只返回：{"title":"","subject":"","score":0,"fullScore":0,"totalQuestions":0,'
      + '"questions":[{"no":1,"text":"","isCorrect":null,"knowledge":"","reason":"","difficulty":3,"page":' + (o.pageFrom || 1) + ',"box":[0,0,1,1]}],'
      + '"mistakes":[{"knowledge":"","reason":""}],"summary":""}';
  }

  /** 合并分批识别结果：分数累加、满分取最大、题目按页排序、错题去重、题号冲突则重排 */
  function mergeVisionParts(parts) {
    const valid = (parts || []).filter(Boolean);
    if (!valid.length) return { questions: [], mistakes: [], summary: '' };
    if (valid.length === 1) return valid[0];

    const out = {
      title: '', subject: '', score: null, fullScore: null, totalQuestions: 0,
      questions: [], mistakes: [], summary: '', teacherComment: '', _batches: valid.length,
    };
    const sums = [], seenMistake = {};
    valid.forEach(p => {
      if (Number.isFinite(Number(p.score))) out.score = (out.score == null ? 0 : out.score) + Number(p.score);
      if (Number.isFinite(Number(p.fullScore)) && Number(p.fullScore) > 0) out.fullScore = Math.max(out.fullScore || 0, Number(p.fullScore));
      out.totalQuestions += Number(p.totalQuestions) || (p.questions || []).length;
      if (!out.title && p.title) out.title = p.title;
      if (!out.subject && p.subject) out.subject = p.subject;
      if (!out.teacherComment && p.teacherComment) out.teacherComment = p.teacherComment;
      if (p._filtered) out._filtered = (out._filtered || 0) + p._filtered;
      (p.questions || []).forEach(q => out.questions.push(q));
      (p.mistakes || []).forEach(m => {
        const k = String(m.knowledge || '') + '|' + String(m.reason || '');
        if (!seenMistake[k]) { seenMistake[k] = 1; out.mistakes.push(m); }
      });
      if (p.summary) sums.push(p.summary);
    });
    out.mistakes = out.mistakes.slice(0, 8);
    out.summary = sums.join(' ');

    // 按整卷页号排序（分批时提示词要求 page 用整卷页号）
    out.questions.sort((a, b) => (Number(a.page) || 1) - (Number(b.page) || 1));
    // 题号重复（每批都从 1 编）→ 按顺序重排，保证错题本里题号唯一
    const seenNo = {};
    let dup = false;
    out.questions.forEach(q => {
      if (q.no == null || seenNo[String(q.no)]) dup = true;
      seenNo[String(q.no)] = 1;
    });
    // 仅当模型在分批结果里重复使用了同一组题号时重排；正常印刷题号保持不变。
    if (dup) out.questions.forEach((q, i) => { q.no = i + 1; });
    return out;
  }

  /** 找出「pageCheck 清单里有、questions 里却没作答」的题号 —— 这些就是模型漏掉的题 */
  function findMissingQuestions(r, confirmedBoxes) {
    if (confirmedBoxes) {
      return confirmedBoxes.filter(b => !(r.questions || []).some(q =>
        Number(q.page) === Number(b.page) && String(q.no) === String(b.no)
      )).map(b => ({ page: b.page, no: b.no, box: b.box }));
    }
    const got = {};
    const gotNo = {};
    const nos = [];
    (r.questions || []).forEach(q => {
      if (!q || q.no == null) return;
      const hasPage = q.page != null && q.page !== '';
      const key = (Number(q.page) || 1) + '#' + String(q.no);
      got[key] = 1; gotNo[String(q.no)] = 1;
      const n = Number(q.no);
      if (isFinite(n)) nos.push(n);
    });
    const out = [];
    (r.pageCheck || []).forEach(pc => {
      const page = Number(pc && pc.page) || 1;
      ((pc && pc.nos) || []).forEach(no => {
        const k = page + '#' + String(no);
        if (!got[k] && !gotNo[String(no)]) { got[k] = 1; gotNo[String(no)] = 1; out.push({ page: page, no: no }); }
      });
    });
    // 兜底：模型没给清单时，用题号连续性找断档（如 1,2,4,5 缺 3）。
    // 只认少量断档（≤3），因为卷子本身跳号也会造成断档；
    // 补漏调用里明确写了"图上找不到就不要编造"，所以误报不会产生假题。
    if (!out.length && !(r.pageCheck || []).length && nos.length >= 4) {
      const min = Math.min.apply(null, nos), max = Math.max.apply(null, nos);
      const gaps = [];
      for (let n = min; n <= max; n++) if (!gotNo[String(n)]) gaps.push(n);
      if (gaps.length && gaps.length <= 3) {
        const pg = Number((r.questions[0] || {}).page) || 1;
        gaps.forEach(n => out.push({ page: pg, no: n }));
      }
    }
    return out;
  }

  /** 补漏提示词：只补漏掉的那几道题 */
  function buildPatchPrompt(missing) {
    const list = missing.map(m => '第 ' + m.page + ' 页的第 ' + m.no + ' 题' + (m.box ? '（确认范围：[' + m.box.join(',') + ']）' : '')).join('、');
    return '你刚才识别这批图片时，下面这些题**没有出现在结果里**（漏了）：' + list + '。\n' +
      '请只补这几道题，**不要重复**已经识别过的题。严格返回（不要代码块）：\n' +
      '{"questions":[{"no":题号,"text":"题干要点","studentAnswer":"我的作答或null",' +
      '"correctAnswer":"正确答案","isCorrect":true或false或null,"knowledge":"知识点","reason":"错因",' +
      '"score":本题分值,"difficulty":1到5的整数,"difficultyWhy":"判档依据","page":页号,"box":[x1,y1,x2,y2]}]}\n' +
      '如果某道题在图上确实找不到，就不要为它编造内容。JSON 必须完整闭合。';
  }

  // ════════════════════════════════════════════════════════════
  //  题目定位：先框题 → 用户拖动校准 → 再识别
  //
  //  为什么加这一步（用户反馈"有漏题、框也不准"）：
  //   ① 定位段只找"题在哪"（轻量快），把框画给用户看；
  //   ② 用户拖框修正、删误框、给漏掉的题补框；
  //   ③ 识别段带着"用户确认过的框清单"去识别，**每框必出一条**，漏不掉。
  // ════════════════════════════════════════════════════════════
  let boxSession = null;
  // { files, images:[{dataUrl}], boxes:[{id,page,no,box}], subjectPick, type, seq, locating }

  function buildLocatePrompt(o) {
    return '这是一份试卷/作业的图片（第 ' + o.pageFrom + '~' + o.pageTo + ' 页，共 ' + o.totalPages + ' 页）。\n' +
      '**只找题目位置**：不要抄题干、不要判对错、不要判难度。\n' +
      '逐页列出每道题：题号 + 它在图上的矩形范围。page 必须使用整卷页号（' + o.pageFrom + '~' + o.pageTo + '），不要每批从 1 重新编号。\n\n' +
      '严格返回 JSON（不要代码块、不要解释）：\n' +
      '{"pages":[{"page":1,"boxes":[{"no":1,"box":[左,上,右,下]}]}]}\n\n' +
      '规则：\n' +
      '· box 用**归一化坐标**：左上角 (0,0)、右下角 (1,1)，格式 [左,上,右,下]；\n' +
      '· 框要紧贴这一题（题干 + 作答区），宽度一般占页面 60%~95%，一行字高度约 3%；\n' +
      '· no 用图上印的题号；一题一个框，**不许漏题、不许把多题合并成一个框**；\n' +
      '· 页眉页脚、页码、装订线、空白答题格、插图周围空白**不要框**；\n' +
      '· 定位不了的题也要给个大致位置，**不要省略**；\n' +
      '· 大题下的 (1)(2)(3) 小问算同一道题，框住整道大题。\n' +
      'JSON 必须完整闭合。';
  }

  function applyBoxStyle(el, box) {
    el.style.left = (box[0] * 100).toFixed(2) + '%';
    el.style.top = (box[1] * 100).toFixed(2) + '%';
    el.style.width = ((box[2] - box[0]) * 100).toFixed(2) + '%';
    el.style.height = ((box[3] - box[1]) * 100).toFixed(2) + '%';
  }

  function updateBoxCount() {
    const c = $('bx-count');
    if (c && boxSession) c.textContent = boxSession.boxes.length;
  }

  /** 阶段①：只定位（找框），不做识别 */
  async function startBoxLocate(files, opts) {
    opts = opts || {};
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) { toast('请先在「设置」里配置 API Key，或启用 WorkBuddy', 'warning'); return; }

    const panel = $('box-panel');
    const tier = compressTier(files.length);
    const images = [];
    for (const f of files) images.push(await compressImage(f, tier.maxDim, tier.quality));

    boxSession = {
      files: files, images: images, boxes: [], seq: 0, locating: true,
      subjectPick: opts.subjectPick || '', type: opts.type || 'homework',
    };
    if (panel) panel.innerHTML = '<div class="card"><div class="thinking"><span class="spinner"></span>正在定位题目位置（' + images.length + ' 页）…</div></div>';

    const batches = chunkArray(images, RECOG_BATCH);
    let pageCursor = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const pageFrom = pageCursor + 1, pageTo = pageCursor + batch.length;
      if (panel) panel.innerHTML = '<div class="card"><div class="thinking"><span class="spinner"></span>正在定位题目位置：第 ' +
        (bi + 1) + '/' + batches.length + ' 批（第 ' + pageFrom + '~' + pageTo + ' 页）…</div></div>';
      try {
        const res = await LLM.vision(batch, buildLocatePrompt({ pageFrom: pageFrom, pageTo: pageTo, totalPages: images.length }),
          { maxTokens: 8000, temperature: 0.1 });
        const r = parseJSON(res.text);
        const locatedPages = r.pages || [];
        const usesLocalPages = pageFrom > 1 && locatedPages.some(pg => Number(pg.page) < pageFrom);
        locatedPages.forEach(pg => {
          const reported = Number(pg.page) || (usesLocalPages ? 1 : pageFrom);
          const page = Math.min(pageTo, Math.max(pageFrom, usesLocalPages ? pageFrom + reported - 1 : reported));
          (pg.boxes || []).forEach(b => {
            const bx = cleanBox(b && b.box);
            if (!bx) return;
            boxSession.boxes.push({ id: ++boxSession.seq, page: page, no: (b && b.no != null) ? b.no : '', box: bx });
          });
        });
      } catch (e) {
        toast('第 ' + (bi + 1) + ' 批定位失败：' + e.message, 'error');
      }
      pageCursor += batch.length;
    }
    boxSession.locating = false;
    renderBoxEditor();
    const n = boxSession.boxes.length;
    toast(n ? ('定位到 ' + n + ' 个题目框，拖动校准后点「确认并开始识别」') : '没自动定位到题目框，请在图上拖出题目范围',
      n ? 'success' : 'warning');
  }

  /** 渲染可拖动的框编辑器 */
  function renderBoxEditor() {
    const panel = $('box-panel');
    if (!panel || !boxSession) return;
    const s = boxSession;
    let html = '<div class="card">' +
      '<div class="card-header"><h3>题目定位（可拖动校准）</h3>' +
        '<span class="card-sub">共 <b id="bx-count">' + s.boxes.length + '</b> 个框</span></div>' +
      '<p class="card-desc">先核对每道题的位置：<b>拖框</b>移动 · <b>拖右下角</b>改大小 · 点 <b>✕</b> 删掉误框 · ' +
      '漏掉的题在图上<b>按住空白处拖出矩形</b>补框。框准了再点「确认并开始识别」——识别会按这些框逐题来，不容易漏。</p>' +
      '<div class="box-toolbar">' +
        '<button type="button" class="btn btn-primary btn-sm" id="bx-go">确认并开始识别</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="bx-skip">跳过定位，直接识别</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="bx-cancel">取消</button>' +
        '<span class="hint">框数：<b id="bx-count2">' + s.boxes.length + '</b></span>' +
      '</div>';
    s.images.forEach((img, pi) => {
      const page = pi + 1;
      const mine = s.boxes.filter(b => b.page === page);
      html += '<div class="box-page"><div class="box-wrap" data-page="' + page + '">' +
        '<img src="' + img.dataUrl + '" alt="第 ' + page + ' 页">';
      mine.forEach(b => {
        html += '<div class="bx" data-id="' + b.id + '" style="' +
          'left:' + (b.box[0] * 100).toFixed(2) + '%;top:' + (b.box[1] * 100).toFixed(2) + '%;' +
          'width:' + ((b.box[2] - b.box[0]) * 100).toFixed(2) + '%;height:' + ((b.box[3] - b.box[1]) * 100).toFixed(2) + '%">' +
          '<span class="bx-label">第' + esc(String(b.no === '' || b.no == null ? '?' : b.no)) + '题</span>' +
          '<button type="button" class="bx-del" title="删掉这个框">✕</button>' +
          '<span class="bx-resize" title="拖动改大小"></span>' +
        '</div>';
      });
      html += '</div><div class="ann-caption">第 ' + page + ' 页 · ' + mine.length + ' 个框</div></div>';
    });
    html += '</div>';
    panel.innerHTML = html;
    bindBoxEditor();
  }

  /** 框编辑器的拖拽交互（pointer 事件，鼠标/触摸通用） */
  function bindBoxEditor() {
    const panel = $('box-panel');
    if (!panel || !boxSession) return;
    const s = boxSession;

    const go = $('bx-go'); if (go) go.addEventListener('click', confirmBoxes);
    const skip = $('bx-skip');
    if (skip) skip.addEventListener('click', () => { boxSession = null; panel.innerHTML = ''; analyzeUpload({ skipLocate: true }); });
    const cancel = $('bx-cancel');
    if (cancel) cancel.addEventListener('click', () => { boxSession = null; panel.innerHTML = ''; });

    // 已有框：拖动移动 / 右下角缩放 / 删除
    panel.querySelectorAll('.bx').forEach(el => {
      const id = Number(el.getAttribute('data-id'));
      const rec = s.boxes.find(b => b.id === id);
      const wrap = el.closest('.box-wrap');
      if (!rec || !wrap) return;

      el.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('bx-del')) return;
        e.preventDefault(); e.stopPropagation();
        const resizing = e.target.classList.contains('bx-resize');
        const rect = wrap.getBoundingClientRect();
        const sx = e.clientX, sy = e.clientY;
        const b0 = rec.box.slice();
        el.classList.add('selected');
        const move = (ev) => {
          const dx = (ev.clientX - sx) / rect.width;
          const dy = (ev.clientY - sy) / rect.height;
          if (resizing) {
            rec.box[2] = Math.max(b0[0] + 0.03, Math.min(1, b0[2] + dx));
            rec.box[3] = Math.max(b0[1] + 0.02, Math.min(1, b0[3] + dy));
          } else {
            const w = b0[2] - b0[0], h = b0[3] - b0[1];
            const x1 = Math.max(0, Math.min(1 - w, b0[0] + dx));
            const y1 = Math.max(0, Math.min(1 - h, b0[1] + dy));
            rec.box = [x1, y1, x1 + w, y1 + h];
          }
          applyBoxStyle(el, rec.box);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });

      const del = el.querySelector('.bx-del');
      if (del) del.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        s.boxes = s.boxes.filter(b => b.id !== id);
        el.remove();
        updateBoxCount();
        const c2 = $('bx-count2'); if (c2) c2.textContent = s.boxes.length;
      });
    });

    // 空白处拖出新框（给漏掉的题补框）
    panel.querySelectorAll('.box-wrap').forEach(wrap => {
      wrap.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.bx')) return;
        e.preventDefault();
        const page = Number(wrap.getAttribute('data-page'));
        const rect = wrap.getBoundingClientRect();
        const x0 = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y0 = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        const el = document.createElement('div');
        el.className = 'bx new selected';
        el.innerHTML = '<span class="bx-label">新框</span>';
        wrap.appendChild(el);
        let box = [x0, y0, x0 + 0.02, y0 + 0.02];
        applyBoxStyle(el, box);
        const move = (ev) => {
          const x1 = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
          const y1 = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
          box = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
          applyBoxStyle(el, box);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (box[2] - box[0] < 0.03 || box[3] - box[1] < 0.02) { el.remove(); return; }
          s.boxes.push({ id: ++s.seq, page: page, no: '', box: box });
          renderBoxEditor();   // 重渲染以绑定交互（简单可靠）
          toast('已补一个框；题号会在识别时按位置自动编', 'success');
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
  }

  /** 阶段②：用用户确认的框去识别（每框必出一条） */
  async function confirmBoxes() {
    if (!boxSession) return;
    const s = boxSession;
    if (!s.boxes.length) { toast('一个框都没有——请在图上拖出题目范围', 'warning'); return; }

    // 按页、按纵坐标排序；新框没题号的按顺序补上
    const byPage = {};
    s.boxes.slice().sort((a, b) => a.page - b.page || a.box[1] - b.box[1]).forEach(b => {
      (byPage[b.page] = byPage[b.page] || []).push(b);
    });
    Object.keys(byPage).forEach(pg => {
      byPage[pg].forEach((b, i) => { if (b.no === '' || b.no == null) b.no = i + 1; });
    });
    const boxes = s.boxes.map(b => ({ page: b.page, no: b.no, box: b.box.slice() }));
    const files = s.files, sp = s.subjectPick, ty = s.type;
    boxSession = null;
    const panel = $('box-panel'); if (panel) panel.innerHTML = '';
    await runRecognizeWithBoxes(files, boxes, sp, ty);
  }

  /** 带着"确认过的框"跑识别并归档 */
  async function runRecognizeWithBoxes(files, boxes, subjectPick, type) {
    const box = $('up-analysis');
    const btn = $('btn-up-analyze');
    if (btn) { btn.disabled = true; btn.textContent = '识别中…'; }
    const nPages = files.length;
    try {
      const o = await recognizeOnePaper({ files: files, name: '上传试卷' }, {
        box: box, subjectPick: subjectPick, type: type, boxes: boxes,
        onProgress: function(pr) {
          if (box) box.innerHTML = '<div class="thinking"><span class="spinner"></span>正在识别第 ' + pr.index + '/' + pr.count +
            ' 批（第 ' + pr.pageFrom + '~' + pr.pageTo + ' 页，共 ' + nPages + ' 页）' +
            (pr.patching ? '，正在补识别漏掉的 ' + pr.patching + ' 题…' : '…') + '</div>';
        },
      });
      const subject = o.subject;
      if (box) box.innerHTML = recogCardHTML(o);
      const images = [];
      for (const f of files) images.push(await compressImage(f));
      openAnnotation(images, o.r.questions || [], o.savedPaper.id);
      const n = Storage.countPapers(subject);
      toast('识别完成，' + subject + ' 已累计 ' + n + ' 份', 'success');
      uploadedFiles = [];
      renderUploadPreview();
      renderImport();
      if (n >= 5 && !Storage.getSubjectAnalyses()[subject]) await runSubjectAnalyses([subject]);
      else await estimateProgress('上传 ' + subject + ' 试卷');
      refreshShell();
    } catch (e) {
      if (box) box.innerHTML = jsonFailHTML(e, '可以再试一次。');
      toast('分析失败：' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'AI 识别并分析'; }
    }
  }

  async function recognizeOnePaper(paper, opts) {
    opts = opts || {};
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) throw new Error('请先在「设置」里配置 API Key，或启用 WorkBuddy');

    const subjectPick = opts.subjectPick || $('up-subject').value || '';
    const type = opts.type || $('up-type').value;
    const box = opts.box || $('up-analysis');

    // 压缩（按张数选档）后**分批**识别：一次发太多图模型会漏题
    const tier = compressTier(paper.files.length);
    const images = [];
    for (const f of paper.files) images.push(await compressImage(f, tier.maxDim, tier.quality));
    const batches = chunkArray(images, RECOG_BATCH);
    const onProgress = opts.onProgress || function() {};

    const allBoxes = opts.boxes || null;
    const parts = [];
    let pageCursor = 0;
    let patchedTotal = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const pageFrom = pageCursor + 1;
      const pageTo = pageCursor + batch.length;
      const batchBoxes = allBoxes
        ? allBoxes.filter(function(b) { return b.page >= pageFrom && b.page <= pageTo; })
        : null;
      const po = {
        subjectPick: subjectPick, type: type, nImages: batch.length,
        batchIndex: bi + 1, batchCount: batches.length,
        pageFrom: pageFrom, pageTo: pageTo, totalPages: images.length,
        boxes: batchBoxes,
      };
      onProgress({ index: bi + 1, count: batches.length, pageFrom: pageFrom, pageTo: pageTo });

      const res = await LLM.vision(batch, buildPaperPrompt(po), { maxTokens: RECOG_MAX_TOKENS, temperature: 0.1 });
      let r;
      try {
        r = parseJSON(res.text);
      } catch (firstErr) {
        // 截断是最常见的失败原因：再要一次，且明确要求精简
        if (res.truncated) {
          if (box) box.innerHTML = '<div class="thinking"><span class="spinner"></span>第 ' + (bi + 1) + '/' + batches.length + ' 批输出被字数上限截断了，正在用精简格式重试…</div>';
          const slim = await LLM.vision(batch, buildSlimPrompt(po), { maxTokens: 8000, temperature: 0.1 });
          try {
            r = parseJSON(slim.text);
          } catch (e2) {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      // 模型可能仍按本批从 1 开始写 page；本地强制归一到整卷页号，避免标注跨批错位。
      r.questions = (r.questions || []).map(function(q) {
        const local = Number(q.page) || 1;
        const page = (local >= pageFrom && local <= pageTo) ? local : Math.min(pageTo, Math.max(pageFrom, pageFrom + local - 1));
        q.page = page;
        return q;
      });
      // ★ 补漏：模型自己列的题号清单里有、却没作答的，再要一次
      //   （只补差集，不重复已识别的题；失败不影响主流程）
      try {
        r = normalizeVision(r);
        const missing = findMissingQuestions(r, batchBoxes);
        if (missing.length && missing.length <= 40) {
          onProgress({ index: bi + 1, count: batches.length, pageFrom: pageFrom, pageTo: pageTo, patching: missing.length });
          const pres = await LLM.vision(batch, buildPatchPrompt(missing), { maxTokens: 8000, temperature: 0.1 });
          const pr = parseJSON(pres.text);
          const have = {};
          (r.questions || []).forEach(q => { if (q && q.no != null) have[String(q.no)] = 1; });
          (pr.questions || []).forEach(q => {
            if (!q || q.no == null || have[String(q.no)]) return;
            have[String(q.no)] = 1;
            const target = missing.find(m => String(m.no) === String(q.no));
            q.page = target ? target.page : (Number(q.page) >= pageFrom && Number(q.page) <= pageTo ? Number(q.page) : pageFrom);
            if (target && target.box && !q.box) q.box = target.box;
            r.questions.push(q);
            patchedTotal++;
          });
          r.totalQuestions = (r.questions || []).length;
        }
      } catch (e) { /* 补漏失败不影响主流程 */ }

      parts.push(normalizeVision(r));
      pageCursor += batch.length;
    }

    const r = mergeVisionParts(parts);
    if (patchedTotal) r._patched = patchedTotal;

    // ★ 科目以模型识别为准（用户没手动指定时），不再用下拉框的默认值
    const subject = resolveSubject(r.subject, subjectPick);
    const autoPicked = !subjectPick;
    const wrongCount = (r.questions || []).length
      ? (r.questions || []).filter(q => q.isCorrect === false).length
      : (r.wrongQuestions || []).length;

    const scoreValue = Number(r.score);
    const fullValue = Number(r.fullScore);
    const score = Number.isFinite(scoreValue) && scoreValue >= 0 ? scoreValue : null;
    const fullScore = Number.isFinite(fullValue) && fullValue > 0 ? fullValue : null;
    const dateStr = (opts.date || $('up-date') || {}).value || new Date().toISOString().slice(0, 10);
    if (score != null && fullScore != null && score > fullScore) throw new Error('识别出的得分超过满分，请在原图批改中校正');

    // 存档
    const savedPaper = Storage.addPaper({
      // ★ 类型要落到卷子上：估算按 kind/type 取来源档（真题不折算、作业再打折）。
      subject: subject, type: type || 'upload', score: score, fullScore: fullScore,
      date: dateStr, title: r.title || (paper.name || subject + ' 上传试卷'),
      images: images.length,
      questions: r.questions || [], mistakes: r.mistakes || [], summary: r.summary || '',
      rightCount: (r.questions || []).filter(q => q.isCorrect === true).length,
      wrongCount: wrongCount,
    });
    Storage.addRecord({
      type: type || 'upload', source: srcLabel(type || 'upload'), subject: subject,
      // ★ kind 带上真实来源（真题/模拟/作业），估算层才不会再按"未标注"打折
      kind: type || 'upload',
      score: score, fullScore: fullScore, paperId: savedPaper.id,
      importData: { name: r.title || (paper.name || subject + ' 上传试卷'), date: dateStr, source: type || 'upload', subjects: [{ subject, score, fullScore }] },
    });
    (r.mistakes || []).forEach(m => {
      Storage.addMistake({ subject: subject, paperId: savedPaper.id, src: 'knowledge', knowledge: m.knowledge || '未分类', question: m.reason || m.knowledge || '', explanation: m.reason || '' });
    });
    (r.questions || []).forEach(q => {
      if (q.isCorrect !== false) return;
      Storage.addMistake({
        subject: subject, paperId: savedPaper.id, src: 'question',
        knowledge: q.knowledge || '未分类', question: q.text || '',
        correctAnswer: q.correctAnswer || '', wrongAnswer: q.studentAnswer || '',
        explanation: q.reason || '',
      });
    });
    Storage.addAct({ icon: '↥', title: '上传「' + (r.title || subject) + '」 ' + score + '/' + fullScore });

    const learned = (r.mistakes || []).map(m => m.knowledge).filter(Boolean);
    remember('user', '【上传试卷】' + subject + '「' + (r.title || '') + '」得分 ' + score + '/' + fullScore +
      (learned.length ? '，暴露的易错点：' + learned.join('、') : ''), 'paper');

    return { r, subject, autoPicked, score, fullScore, wrongCount, savedPaper, name: paper.name };
  }

  /** 识别结果卡片 HTML（单份卷子） */
  function recogCardHTML(o, summaryExtra, annIndex) {
    const subject = o.subject;
    const autoPicked = o.autoPicked;
    const score = o.score, fullScore = o.fullScore, wrongCount = o.wrongCount, r = o.r;
    return (
      '<div class="recog-subject">' +
        '<span class="tag tag-' + esc(subject) + '" style="font-size:13px;padding:3px 12px">' + esc(subject) + '</span>' +
        '<span class="hint" style="margin:0">' +
          (autoPicked
            ? 'AI 从题目内容判断的科目 · 如果不对，在上方「科目」里选对再点一次'
            : '你指定了科目「' + esc(subject) + '」') +
        '</span>' +
      '</div>' +
      '<div class="estimate-grid" style="margin-top:14px">' +
      '<div class="estimate-item"><div class="estimate-value">' + fx5(score) + '</div><div class="estimate-label">估计得分</div></div>' +
      '<div class="estimate-item"><div class="estimate-value">' + fx5(round5(fullScore)) + '</div><div class="estimate-label">满分</div></div>' +
      '<div class="estimate-item"><div class="estimate-value">' + fx5(round5(fullScore ? score / fullScore * 100 : 0)) + '%</div><div class="estimate-label">得分率</div></div>' +
      '<div class="estimate-item"><div class="estimate-value">' + wrongCount + '</div><div class="estimate-label">错题数</div></div>' +
      '</div>' +
      (summaryExtra ? '<div class="hint" style="margin-top:8px">' + esc(summaryExtra) + '</div>' : '') +
      (r._patched ? '<div class="hint" style="margin-top:6px">识别时漏了 ' + r._patched + ' 题，已自动补识别回来 ✓</div>' : '') +
      (r._filtered ? '<div class="hint" style="margin-top:6px">本地过滤掉 ' + r._filtered + ' 条空白/重复条目（模型把空白处当题了）</div>' : '') +
      '<div class="hint" style="margin-top:6px">识别到 ' + ((r.questions || []).length) + ' 题；如果比卷面少，' +
      '把缺的题号发我，我按那条路径查</div>' +
      (r.summary ? '<div class="ai-box" style="margin-top:14px">' + esc(r.summary) + '</div>' : '') +
      (r.mistakes && r.mistakes.length
        ? '<div class="ai-box" style="margin-top:10px">易错点：\n' + r.mistakes.map(m => '· ' + esc(m.knowledge) + (m.reason ? ' — ' + esc(m.reason) : '')).join('\n') + '</div>'
        : '') +
      (annIndex != null
        ? '<div class="btn-group" style="margin-top:12px">' +
          '<button type="button" class="btn btn-sm btn-secondary" data-ann="' + annIndex + '">查看原图批改与校准</button>' +
          '</div>'
        : '')
    );
  }

  /** 上传页主入口：单份走 uploadedFiles，多份走 uploadQueue，逐一识别 */
  async function analyzeUpload(opts) {
    opts = opts || {};
    // 队列模式：优先消费队列（文件夹拖入生成的）
    if (uploadQueue.length) {
      if (uploadQueueRunning) { toast('上一批还在识别中，稍等', 'warning'); return; }
      uploadQueueRunning = true;
      const cfg = LLM.getConfig();
      if (!cfg.apiKey && !wbReady()) { toast('请先在「设置」里配置 API Key，或启用 WorkBuddy', 'warning'); uploadQueueRunning = false; return; }
      const box = $('up-analysis');
      const btn = $('btn-up-analyze');
      btn.disabled = true;
      const total = uploadQueue.length;
      const results = [];
      try {
        while (uploadQueue.length) {
          const paper = uploadQueue.shift();
          const seq = total - uploadQueue.length;
          btn.textContent = '识别中 ' + seq + '/' + total + '…';
          const progress = function(pr) {
            box.innerHTML = '<div class="thinking"><span class="spinner"></span>正在识别「' + esc(paper.name) +
              '」（第 ' + seq + '/' + total + ' 份）第 ' + pr.index + '/' + pr.count +
              ' 批（第 ' + pr.pageFrom + '~' + pr.pageTo + ' 页）' +
              (pr.patching ? '，正在补识别漏掉的 ' + pr.patching + ' 题…' : '…') + '</div>';
          };
          progress({ index: 1, count: 1, pageFrom: 1, pageTo: paper.files.length });
          try {
            const o = await recognizeOnePaper(paper, { box: box, onProgress: progress });
            results.push(o);
            // ★ 保留这份的图片引用，供「查看原图批改与校准」用
            const annIdx = annCandidates.length;
            annCandidates.push({ name: paper.name, files: paper.files, questions: o.r.questions || [], paperId: o.savedPaper.id });
            if (annCandidates.length > 20) annCandidates.shift();   // 只留最近 20 份，别攒内存
            box.innerHTML += recogCardHTML(o, '「' + esc(paper.name) + '」识别完成 ✓', annIdx);
          } catch (perErr) {
            results.push({ err: perErr.message, name: paper.name });
            box.innerHTML += '<div class="ai-box" style="margin-top:10px;border-color:var(--red)">「' + esc(paper.name) + '」识别失败：' + esc(perErr.message) + '</div>';
          }
          await new Promise(s => setTimeout(s, 400));   // 呼吸间隔
        }
      } finally {
        uploadQueueRunning = false;
        btn.disabled = false;
        btn.textContent = 'AI 识别并分析';
      }
      // 汇总
      const okN = results.filter(x => !x.err).length;
      const failN = results.length - okN;
      box.innerHTML += '<div class="ai-box" style="margin-top:16px"><b>批量上传完成：' + okN + ' 份成功' +
        (failN ? '，' + failN + ' 份失败' : '') + '</b></div>';
      toast('批量上传完成：' + okN + ' 份成功' + (failN ? '，' + failN + ' 份失败' : ''), failN ? 'warning' : 'success');

      // ★ 自动打开最后一份的原图批改（原来批量模式完全没有标注入口，
      //   用户传完一批看不到批改照片和逐题校正）
      if (annCandidates.length) {
        box.innerHTML += '<div class="hint" style="margin-top:8px">下面自动打开最后一份的原图批改；每份结果里也有「查看原图批改与校准」按钮，可以逐份查看。</div>';
        try { await openAnnotationFor(annCandidates.length - 1); } catch (e) { /* 打不开不影响归档 */ }
      }

      // 统一触发估算：满 5 份的科目做独立分析，其余重新估算
      uploadedFiles = [];
      renderUploadPreview();
      try {
        const subjects = results.filter(x => !x.err).map(x => x.subject);
        const fresh = subjects.filter(s => Storage.countPapers(s) >= 5 && !Storage.getSubjectAnalyses()[s]);
        if (fresh.length) await runSubjectAnalyses(fresh);
        else await estimateProgress('批量上传试卷');
      } catch (e) { /* 估算失败不阻断 */ }
      refreshShell();
      return;
    }

    // 单份模式
    if (!uploadedFiles.length) { toast('请先选择试卷图片', 'warning'); return; }
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) { toast('请先在「设置」里配置 API Key，或启用 WorkBuddy', 'warning'); return; }

    const subjectPick = $('up-subject').value;   // '' = 自动识别（默认）
    const type = $('up-type').value;

    // ★ 默认先「定位题目」→ 用户拖动校准框 → 再识别
    //   用户反馈整页识别会漏题、框也不准；先定位既能让人兜底，
    //   也让识别段拿到一份"用户核对过的必答清单"。
    if (!opts.skipLocate) {
      await startBoxLocate(uploadedFiles.slice(), { subjectPick: subjectPick, type: type });
      return;
    }
    const box = $('up-analysis');
    const btn = $('btn-up-analyze');
    btn.disabled = true; btn.textContent = '识别中…';
    box.innerHTML = '<div class="thinking"><span class="spinner"></span>正在压缩并识别 ' + uploadedFiles.length + ' 张图片…</div>';

    const nPages = uploadedFiles.length;
    try {
      const o = await recognizeOnePaper({ files: uploadedFiles, name: '上传试卷' }, {
        box: box,
        onProgress: function(pr) {
          box.innerHTML = '<div class="thinking"><span class="spinner"></span>正在识别第 ' + pr.index + '/' + pr.count +
            ' 批（第 ' + pr.pageFrom + '~' + pr.pageTo + ' 页，共 ' + nPages + ' 页）' +
            (pr.patching ? '，正在补识别漏掉的 ' + pr.patching + ' 题…' : '…') + '</div>';
        },
      });
      const subject = o.subject;
      box.innerHTML = recogCardHTML(o);

      // ★ 原图标注 + 校正（图片只放内存，不落盘）
      const images = [];
      for (const f of uploadedFiles) images.push(await compressImage(f));
      openAnnotation(images, o.r.questions || [], o.savedPaper.id);

      const n = Storage.countPapers(subject);
      toast('识别完成，' + subject + ' 已累计 ' + n + ' 份', 'success');

      // 识别完就清空待上传列表，避免再点一次重复归档
      uploadedFiles = [];
      renderUploadPreview();

      renderImport();
      // 满 5 份 → 立刻做该科独立分析
      if (n >= 5 && !Storage.getSubjectAnalyses()[subject]) {
        await runSubjectAnalyses([subject]);
      } else {
        await estimateProgress('上传 ' + subject + ' 试卷');
      }
      refreshShell();
    } catch (e) {
      box.innerHTML = jsonFailHTML(e, '点「AI 识别并分析」可以再试一次。');
      toast('分析失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'AI 识别并分析';
    }
  }

  /** 对指定科目做独立分析（每科 5 份试卷后触发） */
  async function runSubjectAnalyses(subjects) {
    const list = subjects || allSixSubjects().filter(s => Storage.countPapers(s) >= 5 && !Storage.getSubjectAnalyses()[s]);
    if (!list.length) { toast('还没有哪一科满 5 份，或者都已经分析过了', 'warning'); return; }
    for (const sub of list) {
      await analyzeSubject(sub);
    }
    renderImport();
    updateBadges();
  }

  async function analyzeSubject(subject) {
    const papers = Storage.getPapers().filter(p => p.subject === subject);
    const records = Storage.getRecords().filter(r => r.subject === subject);
    const mistakes = Storage.getMistakes().filter(m => m.subject === subject);

    const prompt =
      '现在只分析「' + subject + '」这一科，不要谈其他科目。\n' +
      '下面这名学生在本学科已经有 ' + papers.length + ' 份试卷/作业记录。\n\n' +
      '【试卷记录】\n' + JSON.stringify(papers.slice(-10), null, 1) + '\n\n' +
      '【成绩记录】\n' + JSON.stringify(records.slice(-10).map(r => ({ score: r.score, full: r.fullScore, date: r.date, source: r.source })), null, 1) + '\n\n' +
      '【错题】\n' + JSON.stringify(mistakes.slice(-20).map(m => ({ knowledge: m.knowledge, question: m.question })), null, 1) + '\n\n' +
      '请给出这一科的独立诊断，返回 JSON：\n' +
      '{\n' +
      '  "level": "该科当前水平定位（如：中游偏上 / 基础不牢）",\n' +
      '  "estimatedScore": 该科高考预估分（数字，满分按本省该科满分）,\n' +
      '  "trend": "up | stable | down",\n' +
      '  "problems": ["最关键的2-4个问题"],\n' +
      '  "suggestions": ["针对性的2-4条做法"],\n' +
      '  "summary": "100-200字的单科总结"\n' +
      '}';

    try {
      toast('正在进行「' + subject + '」单科分析…', 'success');
      const r = await askJSON(prompt, { maxTokens: 2500, temperature: 0.4 });
      Storage.setSubjectAnalysis(subject, {
        level: r.level || '', score: round5(r.estimatedScore), trend: r.trend || 'stable',
        problems: r.problems || [], suggestions: r.suggestions || [], summary: r.summary || '',
      });
      remember('ai', '【' + subject + '单科分析】' + (r.summary || ''), 'subject');
      toast(subject + ' 单科分析完成', 'success');
    } catch (e) {
      toast(subject + ' 单科分析失败：' + e.message, 'error');
    }
  }

  /** 六科全部分析完后，生成总分预估 */
  async function analyzeTotal() {
    const subs = allSixSubjects();
    const sa = Storage.getSubjectAnalyses();
    const missing = subs.filter(s => !sa[s]);
    if (missing.length) {
      toast('还有 ' + missing.length + ' 科没做完单科分析：' + missing.join('、'), 'warning');
      return;
    }
    const btn = $('btn-total-analysis');
    btn.disabled = true; btn.textContent = '生成中…';
    $('total-analysis').innerHTML = '<div class="thinking"><span class="spinner"></span>AI 正在汇总六科…</div>';
    try {
      const g = Storage.getGoal();
      // ★ 汇总前先折算教材覆盖率，分析里才带"没学的章节按 0 分"
      try { await ensureTextbookCoverage({ silent: true }); } catch (e) { /* 无覆盖时照常分析 */ }
      const prompt =
        '六科的单科分析已经全部完成，请你汇总成一份高考总分预估。\n\n' +
        '【教材覆盖率（AI 已把"没学章节按0分"折进各科，汇总时别再抬高）】\n' +
        coverageDigestText() + '\n\n' +
        '【六科分析】\n' + JSON.stringify(sa, null, 1) + '\n\n' +
        '【目标】' + (g.target || '--') + ' 分，距高考 ' + daysToExam() + ' 天。\n\n' +
        '返回 JSON：\n' +
        '{\n' +
        '  "subjectScores": {"语文": 数字, "数学": 数字, "英语": 数字, "' + subs[3] + '": 数字, "' + subs[4] + '": 数字, "' + subs[5] + '": 数字},\n' +
        '  "total": 六科加总（数字，保留五位小数）,\n' +
        '  "confidence": 0到1之间,\n' +
        '  "analysis": "整体分析，200字以内：当前处在什么位置、最大短板是哪个科、分差主要在哪里",\n' +
        '  "suggestion": "接下来 30 天最该做的一件事"\n' +
        '}';

      const r = await askJSON(prompt, { maxTokens: 2500, temperature: 0.3 });

      /**
       * ★ P0 修复（2026-10-10）：这里原来完全绕过本地约束，有三个问题：
       *   ① 模型给的分**没有夹到 [0, 满分]**；
       *   ② 直接采信 `r.total`，可以跟六科之和对不上（模型加法错了就跟着错）；
       *   ③ 强制 `missing: []` 把结果标成"六科齐全"，即使模型漏科 —— 覆盖率约束等于失效。
       *
       * 新口径：**以本地 evidence 为基准**，AI 只在允许范围内微调（与 progress.js 的
       * aiEstimate 保持一致：current ∈ [local×0.85, local×1.10]）；缺数据的科目保持 null；
       * 总分永远由六科分**加总得出**，不采信模型自报的 total。
       */
      const evLocal = ProgressEngine.analyzeEvidence(Storage.getRecords(), Storage.getMistakes(), g, Storage.getPapers());
      const evSub = {};
      evLocal.forEach(e => { evSub[e.subject] = e; });

      const scores = {};
      const missingSubs = [];
      allSixSubjects().forEach(sub => {
        const local = evSub[sub];
        const localCur = (local && local.currentScore != null) ? Number(local.currentScore) : null;

        // 本地都说没数据 → 不给分（不信模型凭空补）
        if (localCur == null) { scores[sub] = null; missingSubs.push(sub); return; }

        const v = (r.subjectScores || {})[sub];
        let cur = (v != null && isFinite(Number(v))) ? Number(v) : localCur;

        // 夹到 [local×0.85, local×1.10]，再夹到 [0, 满分]（顺序不能反）
        const lo = localCur * 0.85, hi = localCur * 1.10;
        if (cur > hi) cur = hi;
        if (cur < lo) cur = lo;
        const maxS = (DB.MAX_SCORES && DB.MAX_SCORES[sub]) || 150;
        scores[sub] = round5(Math.max(0, Math.min(maxS, cur)));
      });

      // 总分 = 六科加总（只在该科有分时累加），绝不采信 r.total
      let sum = 0;
      allSixSubjects().forEach(sub => { if (scores[sub] != null) sum += scores[sub]; });
      const sum5 = round5(sum);
      const complete = missingSubs.length === 0;
      const total = complete ? sum5 : null;

      // 「高考时预测」用本地学习曲线模型算（AI 那条只给"现在"）
      // evNow 就是上面的 evLocal，不重复算一遍（旧代码这里算了两遍）
      const evNow = evLocal;
      const localRes = ProgressEngine.buildResult(evNow, g);
      const subjProjected = localRes.subjectProjected || {};
      let projSum = 0;
      let projAll = true;
      allSixSubjects().forEach(sub => {
        const pv = subjProjected[sub];
        if (pv != null && isFinite(Number(pv))) projSum += Number(pv);
        else if (scores[sub] != null) projSum += scores[sub];
        else projAll = false;
      });
      const projected = (complete && projAll) ? round5(projSum) : null;

      const before = currentEstimate().total;
      Storage.setTotalEstimate({
        total: total, projected: projected,
        subjectScores: scores, subjectProjected: subjProjected,
        confidence: r.confidence, keyGains: r.keyGains || [],
        evidence: storeEvidence(evNow),
        // ★ 如实记录：缺哪科就是缺哪科，不再无条件写成"六科齐全"
        covered: allSixSubjects().filter(s => scores[s] != null),
        missing: missingSubs,
        coverage: allSixSubjects().filter(s => scores[s] != null).length,
        totalSubjects: 6,
        method: 'ai', analysis: r.analysis || '', suggestion: r.suggestion || '',
        daysLeft: localRes.daysLeft,
      });
      if (total != null) {
        Storage.addEst({
          total: total, projected: projected,
          delta: (before != null) ? round5(total - before) : 0,
          reason: '六科总分预估', method: 'ai',
        });
      }
      remember('ai', '【六科总分预估】现在 ' + (total != null ? fx5(total) : '数据不全') +
        (projected != null ? ' 分，高考时预计 ' + fx5(projected) + ' 分。' : ' 分（还缺 ' + missingSubs.join('、') + '）。') +
        (r.analysis || ''), 'total');

      // ★ total 为 null = 数据不全：如实显示"还缺哪科"，不给假数字
      const hasTotal = total != null;
      const gapTxt = hasTotal ? fx5(round5(Number(g.target) - total)) : '—';
      const gainTxt = (hasTotal && projected != null) ? fx5(round5(projected - total)) : '—';
      const baseDeltaTxt = hasTotal ? fx5(round5(total - baselineScore())) : '—';
      const missingTip = hasTotal ? '' :
        '<div class="empty" style="margin-top:12px">数据还不齐，暂时给不出总分 —— 还缺：' +
        esc(missingSubs.join('、')) + '。上传这几科的试卷后重新生成即可。</div>';

      $('total-analysis').innerHTML =
        '<div class="two-big" style="margin-top:4px">' +
          '<div class="big-stat now"><div class="big-label">① 现在的高考分数</div><div class="big-value">' + (hasTotal ? fx5(total) : '—') + '</div>' +
            '<div class="big-sub">' + (hasTotal ? '由六科真实作答推算' : '还缺 ' + missingSubs.length + ' 科数据') + '</div></div>' +
          '<div class="big-stat future"><div class="big-label">② 预测高考分数</div><div class="big-value">' + (projected != null ? fx5(projected) : '—') + '</div>' +
            '<div class="big-sub">还有 ' + localRes.daysLeft + ' 天</div></div>' +
        '</div>' +
        missingTip +
        '<div class="estimate-grid" style="margin-top:14px">' +
        '<div class="estimate-item"><div class="estimate-value">' + gapTxt + '</div><div class="estimate-label">距离目标</div></div>' +
        '<div class="estimate-item"><div class="estimate-value">' + gainTxt + '</div><div class="estimate-label">预计还能提</div></div>' +
        '<div class="estimate-item"><div class="estimate-value">' + (r.confidence != null ? (Number(r.confidence) * 100).toFixed(2) + '%' : '--') + '</div><div class="estimate-label">置信度</div></div>' +
        '<div class="estimate-item"><div class="estimate-value">' + baseDeltaTxt + '</div><div class="estimate-label">较起点</div></div></div>' +
        '<div class="ai-box" style="margin-top:14px">' + esc(r.analysis || '') + '\n\n建议：' + esc(r.suggestion || '') + '</div>';
      toast(hasTotal ? ('总分预估已生成：' + fx5(total)) : ('数据不全，还缺 ' + missingSubs.join('、')), hasTotal ? 'success' : 'warning');
      refreshShell();
    } catch (e) {
      $('total-analysis').innerHTML = '<div class="empty">生成失败：' + esc(e.message) + '</div>';
      toast('生成失败：' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = '生成总分预估';
    }
  }

  // ════════════════════════════════════════════════════════════
  //  读图模型（与主模型解耦）
  // ════════════════════════════════════════════════════════════
  function initVisionSelect() {
    const prov = $('set-vision-provider');
    const model = $('set-vision-model');
    if (!prov || !model) return;

    const all = LLM.listVisionModels();
    const pids = [];
    all.forEach(x => { if (pids.indexOf(x.provider) < 0) pids.push(x.provider); });
    if (pids.indexOf('custom') < 0) pids.push('custom');   // 允许自填

    if (!prov.options.length) {
      prov.innerHTML = pids.map(pid =>
        '<option value="' + pid + '">' + esc((LLM.PROVIDERS[pid] || {}).name || pid) + '</option>').join('');
    }

    const c = LLM.getVisionConfig();
    if (c.provider) prov.value = c.provider;

    const sync = () => {
      const pid = prov.value;
      const isCustom = pid === 'custom';
      $('set-vision-model-custom-group').classList.toggle('hidden', !isCustom);
      $('set-vision-baseurl-group').classList.toggle('hidden', !isCustom);

      if (isCustom) {
        model.innerHTML = '<option value="">（用下方输入框填写）</option>';
        if (c.provider === 'custom') {
          $('set-vision-model-custom').value = c.model || '';
          $('set-vision-baseurl').value = c.baseUrl || '';
        }
      } else {
        model.innerHTML = all.filter(x => x.provider === pid)
          .map(x => '<option value="' + esc(x.model) + '">' + esc(x.name) + '</option>').join('');
        const want = (c.provider === pid && c.model)
          ? c.model
          : (LLM.DEFAULT_VISION.provider === pid ? LLM.DEFAULT_VISION.model : '');
        if (want) model.value = want;
      }
      // Key：优先读图配置里存的，其次复用同供应商主配置的 Key
      $('set-vision-key').value = c.apiKey || Storage.getProviderKey(pid) || '';

      const info = $('set-vision-info');
      if (info) {
        const vc = LLM.getVisionProvider();
        info.textContent = LLM.modelSupportsVision(vc.provider, vc.model) && vc.apiKey ? '已就绪' : '待配置';
      }
    };

    if (!prov._vbound) { prov.addEventListener('change', sync); prov._vbound = true; }
    sync();
  }

  function readVisionConfig() {
    const pid = $('set-vision-provider').value;
    const isCustom = pid === 'custom';
    return {
      provider: pid,
      model: isCustom ? ($('set-vision-model-custom').value || '').trim() : $('set-vision-model').value,
      baseUrl: isCustom ? ($('set-vision-baseurl').value || '').trim() : '',
      apiKey: $('set-vision-key').value.trim(),
    };
  }

  function saveVisionConfigUI() {
    const cfg = readVisionConfig();
    const status = $('set-vision-status');
    if (!cfg.model) { status.textContent = '请选择或填写读图模型'; return false; }
    if (!LLM.modelSupportsVision(cfg.provider, cfg.model)) {
      status.textContent = '「' + cfg.model + '」不在已知支持图片的模型列表里；自填模型请将供应商选为「自定义」';
      return false;
    }
    if (cfg.provider === 'custom' && !cfg.baseUrl) { status.textContent = '自定义供应商需要填写 API 地址'; return false; }
    if (cfg.apiKey) Storage.setProviderKey(cfg.provider, cfg.apiKey);
    LLM.saveVisionConfig(cfg);
    const eff = LLM.getVisionProvider();
    status.textContent = '已保存：' + (eff.name || eff.provider) + ' / ' + eff.model +
      (eff.apiKey ? '' : '（还没 Key，去上面主模型里填同供应商的 Key 也行）');
    return true;
  }

  async function testVisionUI() {
    const status = $('set-vision-status');
    const btn = $('btn-set-vision-test');
    const cfg = readVisionConfig();
    if (!cfg.model) { status.textContent = '请先选择读图模型'; return; }
    status.textContent = '正在发一张测试图…';
    btn.disabled = true;
    try {
      const r = await LLM.testVision(cfg);
      status.textContent = '读图成功 · ' + r.model + ' 回复：' + r.reply;
    } catch (e) {
      status.textContent = '读图失败：' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ════════════════════════════════════════════════════════════
  //  高考难度折算系数（可编辑）
  // ════════════════════════════════════════════════════════════
  function renderDifficultyRows() {
    const el = $('set-diff-rows');
    if (!el) return;
    const custom = Storage.getDifficultyFactors();
    el.innerHTML = allSixSubjects().map(sub => {
      const base = DB.difficultyFactor(sub, 'exam');
      const cur = custom[sub] != null ? custom[sub] : '';
      const d = DB.EXAM_DIFFICULTY[sub] || {};
      return '<div class="tb-row">' +
        '<span class="tb-subject">' + esc(sub) + '</span>' +
        '<input type="number" step="0.01" min="0.3" max="1.2" data-diff="' + esc(sub) + '" ' +
          'placeholder="默认 ' + base + '" value="' + esc(cur) + '" style="flex:0 0 130px;height:32px">' +
        '<span class="hint" style="margin:0;flex:1">' +
          (d.level != null ? '高考难度系数 ' + d.level + ' · ' : '') +
          (d.avgRate ? '全省平均得分率 ' + Math.round(d.avgRate[0] * 100) + '-' + Math.round(d.avgRate[1] * 100) + '%' : '') +
          (d.loss ? ' · 主要失分：' + esc(d.loss) : '') +
        '</span>' +
        '</div>';
    }).join('');
    const sum = $('set-diff-summary');
    if (sum) {
      const n = Object.keys(custom).length;
      sum.textContent = n ? ('已自定义 ' + n + ' 科') : '使用默认值';
      sum.style.color = n ? 'var(--amber)' : 'var(--label-tertiary)';
    }
  }

  function saveDifficultyRows() {
    const el = $('set-diff-rows');
    const status = $('set-diff-status');
    if (!el) return;
    let n = 0;
    el.querySelectorAll('input[data-diff]').forEach(inp => {
      const sub = inp.dataset.diff;
      const v = (inp.value || '').trim();
      Storage.setDifficultyFactor(sub, v === '' ? NaN : v);
      if (v !== '') n++;
    });
    renderDifficultyRows();
    if (status) status.textContent = n ? ('已保存 ' + n + ' 科自定义系数，下次估算生效') : '已全部恢复默认';
    toast(n ? ('已保存 ' + n + ' 科折算系数') : '已恢复默认系数', 'success');
  }

  function resetDifficultyRows() {
    Storage.resetDifficultyFactors();
    renderDifficultyRows();
    const status = $('set-diff-status');
    if (status) status.textContent = '已恢复为 LongCat-2.5 分析的默认系数';
    toast('已恢复默认系数', 'success');
  }

  // ════════════════════════════════════════════════════════════
  //  设置
  // ════════════════════════════════════════════════════════════
  /**
   * 考试制度 / 界面语言设置（2026-11-07）
   * 切换 region 会让所有 AI 换一套制度框架，并停用中国高考专用模块。
   */
  function syncRegionUI() {
    if (typeof Region === 'undefined') return;
    const sel = $('set-region');
    const langSel = $('set-lang');
    const notice = $('region-notice');
    const state = $('region-state');
    const meta = Region.meta();

    if (sel && sel.options.length === 0) {
      meta.all.forEach(x => {
        const o = document.createElement('option'); o.value = x.id; o.textContent = x.label;
        sel.appendChild(o);
      });
    }
    if (sel) sel.value = meta.id;
    if (langSel && typeof I18n !== 'undefined') {
      if (langSel.options.length === 0) {
        I18n.LANGS.forEach(l => {
          const o = document.createElement('option');
          o.value = l; o.textContent = { 'zh-CN': '简体中文', 'ja-JP': '日本語', 'ko-KR': '한국어' }[l] || l;
          langSel.appendChild(o);
        });
      }
      langSel.value = I18n.current();
    }
    if (state) state.textContent = meta.label;

    // 适用学年度（仅韩国等有 curriculumVariants 的 region 显示）
    const curSel = $('set-curriculum');
    if (curSel && typeof Region !== 'undefined') {
      const vm = Region.variantMeta();
      const p = Region.profile();
      const variants = p.curriculumVariants
        ? Object.keys(p.curriculumVariants).map(k => ({ id: k, label: p.curriculumVariants[k].label }))
        : [];
      curSel.innerHTML = '';
      if (!variants.length) {
        const o = document.createElement('option'); o.value = ''; o.textContent = '不适用';
        curSel.appendChild(o); curSel.disabled = true;
      } else {
        curSel.disabled = false;
        variants.forEach(v => {
          const o = document.createElement('option'); o.value = v.id; o.textContent = v.label;
          curSel.appendChild(o);
        });
        curSel.value = Region.curriculum();
      }
    }
    // 思考强度
    const rSel = $('set-reasoning');
    if (rSel) {
      try { rSel.value = Storage.get('reasoning_effort', 'standard'); } catch (e) { rSel.value = 'standard'; }
    }

    if (notice && typeof I18n !== 'undefined') {
      const p = Region.profile();
      const lines = [I18n.scopeNotice()];
      if (p.notes) lines.push(p.notes);
      if (I18n.partialNotice()) lines.push(I18n.partialNotice());
      if (p.disabledModules && p.disabledModules.length) {
        lines.push('本制度下停用：' + p.disabledModules.join('、') + '。');
      }
      notice.innerHTML = lines.filter(Boolean).map(x => '<div>· ' + esc(x) + '</div>').join('');
    }
  }

  function onRegionChange() {
    if (typeof Region === 'undefined') return;
    const v = ($('set-region') || {}).value || 'cn-gaokao';
    Region.set(v);
    // 同步界面语言到该制度的默认语言（用户仍可单独改）
    if (typeof I18n !== 'undefined' && v !== 'cn-gaokao') {
      I18n.set(Region.profile().lang);
    }
    syncRegionUI();
    if (typeof toast === 'function') toast('已切换考试制度，AI 会按新制度回答', 'success');
  }

  function onLangChange() {
    if (typeof I18n === 'undefined') return;
    const v = ($('set-lang') || {}).value || 'zh-CN';
    I18n.set(v);
    syncRegionUI();
    I18n.applyDOM();
    if (typeof toast === 'function') toast('界面语言已切换（部分界面仍为中文）', 'success');
  }

  function onCurriculumChange() {
    if (typeof Region === 'undefined') return;
    const v = ($('set-curriculum') || {}).value || '';
    if (v && Region.setCurriculum(v)) {
      // 换교육과정 → 缓存必须失效，否则拿旧学年度的知识点当新制度用
      try { if (typeof ModelCache !== 'undefined') ModelCache.invalidate(); } catch (e) {}
      syncRegionUI();
      if (typeof toast === 'function') toast('已切换适用学年度', 'success');
    }
  }

  function onReasoningChange() {
    const v = ($('set-reasoning') || {}).value || 'standard';
    try { Storage.set('reasoning_effort', v); } catch (e) {}
    if (typeof toast === 'function') {
      toast(v === 'high' ? '已开启深度思考（复杂题更稳，但会慢一些）' : '思考强度已更新', 'success');
    }
  }

  function renderSettings() {
    initProviderSelect('set-provider', 'set-model', 'set-model-custom-group', 'set-model-custom', 'set-baseurl-group', 'set-baseurl', 'set-key');
    initVisionSelect();
    syncRegionUI();   // ★ 2026-11-07 考试制度/语言卡片
    renderDifficultyRows();
    renderGoalRows();
    renderTtsSettings();
    const cfg = LLM.getConfig();
    const info = $('set-model-info');
    if (info) info.textContent = cfg.apiKey ? '已配置' : '未配置';
    renderMemoryList();
    // ★ 匿名使用统计卡片（2026-10-31 修）
    //   之前 index.html 有完整卡片，但**一个 JS 绑定都没有** ——
    //   按钮点了没反应、状态永远停在「默认关闭」、地址框永远空白。
    renderUsageStats();
    // 进设置页时后台探一次语音服务（不阻塞渲染）
    Speech.check(false).then(() => renderTtsSettings()).catch(() => {});
  }

  // ════════════════════════════════════════════════════════════
  //  匿名使用统计卡片（2026-10-31）
  //  数据层在 shared/usage-stats.js（UsageStats），这里只管 UI。
  //  隐私：默认关闭、只发匿名计数、随时可关。
  // ════════════════════════════════════════════════════════════
  function renderUsageStats() {
    if (typeof UsageStats === 'undefined') return;
    const st = $('usage-status');
    const ep = $('usage-endpoint');
    const metaEl = $('usage-meta');

    let s = null;
    try { s = UsageStats.status(); } catch (e) { return; }

    // 地址框：只在为空时回填，避免覆盖用户正在输入的内容
    if (ep && !ep.value) ep.value = s.endpoint || UsageStats.DEFAULT_ENDPOINT;

    if (st) {
      st.textContent = s.enabled ? '已开启（匿名）' : '默认关闭';
      st.style.color = s.enabled ? 'var(--ok, #22c55e)' : '';
    }

    if (metaEl) {
      if (!s.launches) {
        metaEl.textContent = '';
      } else {
        const last = s.lastPush ? fmtAgo(new Date(s.lastPush).toISOString()) : '从未';
        metaEl.textContent = '本机匿名 ID：' + String(s.anonId || '').slice(0, 18) +
          ' · 累计启动 ' + s.launches + ' 次 · 最近上报：' + last;
      }
    }
  }

  /** 绑定统计卡片三个按钮（只在设置页首次进入后绑一次） */
  let usageStatsBound = false;
  function bindUsageStats() {
    if (usageStatsBound) return;
    if (typeof UsageStats === 'undefined') return;
    usageStatsBound = true;

    on('btn-usage-enable', 'click', async () => {
      const ep = $('usage-endpoint');
      const url = (ep && ep.value.trim()) || UsageStats.DEFAULT_ENDPOINT;
      // ★ 先切状态再上报：enable() 内部会 await push()（最长 8s），
      //   直接 await 会让界面停在旧状态好几秒，用户以为没点上。
      UsageStats.setCfg({ enabled: true, endpoint: url });
      renderUsageStats();
      const r = await UsageStats.push({});
      renderUsageStats();
      if (r && r.ok) toast('已开启匿名统计，谢谢支持', 'success');
      else toast('已开启，但上报失败：' + ((r && r.reason) || '网络不通'), 'error');
    });

    on('btn-usage-disable', 'click', () => {
      UsageStats.disable();
      renderUsageStats();
      toast('已关闭匿名统计，不再发送任何数据', 'success');
    });

    on('btn-usage-preview', 'click', () => {
      const box = $('usage-preview');
      if (!box) return;
      let p = {};
      try { p = UsageStats.payload(); } catch (e) { p = { error: String(e) }; }
      box.innerHTML = '<div class="hint" style="font-size:11.5px">' +
        '开启后每次启动会 POST 下面这些字段（就这些，没有别的）：</div>' +
        '<pre style="white-space:pre-wrap;font-size:11.5px;margin-top:6px;padding:8px;' +
        'background:rgba(127,127,127,.12);border-radius:6px">' +
        esc(JSON.stringify(p, null, 2)) + '</pre>';
    });
  }

  function renderMemoryList() {
    const el = $('memory-list');
    if (!el) return;
    const mem = Storage.getMemory();
    if (!mem.length) {
      el.innerHTML = '<div class="empty" style="padding:16px">还没有记忆。做完问卷后，AI 会开始记东西。</div>';
      return;
    }
    el.innerHTML = mem.slice(-30).reverse().map(m =>
      '<div class="memory-item"><span class="memory-role ' + (m.role === 'ai' ? 'ai' : 'user') + '">' +
      (m.role === 'ai' ? 'AI' : '我') + '</span>' +
      '<span class="memory-text">' + esc(String(m.content).slice(0, 200)) + '</span></div>').join('');
  }

  function updateMemoryUI() {
    const c = $('chat-memory-count');
    if (c) c.textContent = '记忆 ' + Storage.getMemory().length + ' 条';
  }

  function exportData() {
    const d = Storage.exportAll();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '学徒备份_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('已导出备份', 'success');
    // ★ 导出同时也写一份到磁盘（双保险：文件和快照各一份）
    try { if (typeof BackupGuard !== 'undefined') BackupGuard.backupNow(); } catch (e) {}
  }

  function clearLearningData() {
    if (!confirm('清除学习记录、错题、计划和估算？（积分保留）')) return;
    Storage.set('records', []);
    Storage.set('mistakes', []);
    Storage.set('papers', []);
    Storage.set('daily', { date: '', tasks: [], done: [] });
    Storage.set('acts', []);
    Storage.set('estHist', []);
    Storage.set('subject_analyses', {});
    Storage.set('total_estimate', null);
    Storage.set('last_plan', null);
    const points = Storage.getStats().points || 0;
    Storage.set('stats', { points: points, weeklyMin: 0, weeklyReset: null, monthlyQuiz: 0, monthlyReset: null, streak: 0, lastDate: null, totalMin: 0 });
    renderSettings();
    toast('学习数据已清除（积分保留）', 'success');
  }

  function resetSetup() {
    if (!confirm('重做问卷？AI 记忆会清空，成绩记录保留。')) return;
    Storage.set('setup_completed', false);
    Storage.set('setup_data', null);
    Storage.clearMemory();
    showWizard(1);
    toast('请重新填写问卷', 'success');
  }

  // ════════════════════════════════════════════════════════════
  //  供应商 / 模型选择（问卷与设置页共用）
  // ════════════════════════════════════════════════════════════
  function initProviderSelect(provId, modelId, customGroupId, customInputId, baseGroupId, baseInputId, keyId) {
    const prov = $(provId), model = $(modelId);
    if (!prov || !model) return;

    if (!prov.options.length) {
      Object.keys(LLM.PROVIDERS).forEach(id => {
        const o = document.createElement('option');
        o.value = id; o.textContent = LLM.PROVIDERS[id].name;
        prov.appendChild(o);
      });
    }
    const cfg = LLM.getConfig();
    if (cfg.provider) prov.value = cfg.provider;

    const sync = () => {
      const pid = prov.value;
      const p = LLM.PROVIDERS[pid];
      const isCustom = pid === 'custom';

      $(customGroupId).classList.toggle('hidden', !isCustom);
      $(baseGroupId).classList.toggle('hidden', !isCustom);

      if (isCustom) {
        model.innerHTML = '<option value="">（用右侧输入框填写）</option>';
        if (cfg.provider === 'custom') {
          if ($(customInputId)) $(customInputId).value = cfg.model || '';
          if ($(baseInputId)) $(baseInputId).value = cfg.baseUrl || '';
        }
      } else {
        // ★ 末尾加「＋ 自定义模型」（2026-10-31）
        model.innerHTML = (p.models || []).map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join('')
          + '<option value="__CUSTOM_MODEL__">＋ 自定义模型…</option>';

        // 回填：如果保存的模型不在列表里，自动切到自定义并填进输入框
        if (cfg.provider === pid && cfg.model) {
          const inList = (p.models || []).some(m => m.id === cfg.model);
          if (inList) {
            model.value = cfg.model;
          } else {
            model.value = '__CUSTOM_MODEL__';
            if ($(customInputId)) $(customInputId).value = cfg.model;
          }
        }
        if (!model.value && p.models && p.models.length) model.value = p.models[0].id;

        // 选「自定义」时把输入框露出来
        if (!model._customBound) {
          model._customBound = true;
          model.addEventListener('change', function () {
            const isCus = model.value === '__CUSTOM_MODEL__';
            const inp = $(customInputId);
            if (inp) {
              const grp = inp.closest('.form-group') || inp.parentElement;
              if (grp) grp.classList.toggle('hidden', !isCus);
              if (isCus && !inp.value) inp.focus();
            }
          });
        }
        // 初始时如果当前就是自定义，露出输入框
        (function () {
          const isCus = model.value === '__CUSTOM_MODEL__';
          const inp = $(customInputId);
          if (inp) {
            const grp = inp.closest('.form-group') || inp.parentElement;
            if (grp) grp.classList.toggle('hidden', !isCus);
          }
        })();
        if ($(baseInputId)) $(baseInputId).value = p.baseUrl || '';
      }
      // 回填该供应商单独保存的 Key
      if (keyId && $(keyId)) $(keyId).value = Storage.getProviderKey(pid) || (cfg.provider === pid ? (cfg.apiKey || '') : '');
    };

    prov.onchange = null;
    if (!prov._bound) { prov.addEventListener('change', sync); prov._bound = true; }
    sync();
  }

  function readProviderConfig(provId, modelId, customInputId, baseInputId, keyId) {
    const pid = $(provId).value;
    const isCustom = pid === 'custom';
    // ★ 支持"自定义模型"（2026-10-31）
    let model;
    if (isCustom) {
      model = ($(customInputId).value || '').trim();
    } else {
      model = $(modelId).value;
      if (model === '__CUSTOM_MODEL__') {
        model = ($(customInputId).value || '').trim();
      }
    }
    const baseUrl = isCustom ? ($(baseInputId).value || '').trim() : (LLM.PROVIDERS[pid] || {}).baseUrl;
    const apiKey = $(keyId).value.trim();
    return { provider: pid, model: model, baseUrl: baseUrl, apiKey: apiKey };
  }

  function saveProviderConfig(cfg, statusEl, quiet) {
    if (!cfg.apiKey) { if (!quiet) toast('请填写 API Key', 'warning'); return false; }
    if (!cfg.model) { if (!quiet) toast('请选择或填写模型名称', 'warning'); return false; }
    if (cfg.provider === 'custom' && !cfg.baseUrl) { if (!quiet) toast('自定义供应商需要填写 API 地址', 'warning'); return false; }
    Storage.setProviderKey(cfg.provider, cfg.apiKey);
    LLM.saveConfig({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model });
    if (statusEl) statusEl.textContent = '已保存 · ' + (LLM.PROVIDERS[cfg.provider] || {}).name + ' / ' + cfg.model;
    refreshShell();
    return true;
  }

  async function testProviderConfig(cfg, statusEl, btn) {
    if (!cfg.apiKey) { statusEl.textContent = '请先填写 API Key'; return false; }
    statusEl.textContent = '测试中…';
    if (btn) btn.disabled = true;
    try {
      const r = await LLM.testConnection(cfg);
      statusEl.textContent = '连接成功 · ' + r.model;
      return true;
    } catch (e) {
      /**
       * ★ 错误显示改成多行（2026-10-18）
       *   原来把所有信息塞一行，用户只会看到一坨 HTML。
       *   现在换成 <pre>，保留换行和缩进，能看清"打到哪个地址、该怎么改"。
       */
      statusEl.innerHTML = '';
      const bad = document.createElement('div');
      bad.style.cssText = 'color:#dc2626;font-size:12.5px;line-height:1.75;white-space:pre-wrap;word-break:break-word';
      bad.textContent = e.message;
      statusEl.appendChild(bad);
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ════════════════════════════════════════════════════════════
  //  引导流程
  // ════════════════════════════════════════════════════════════
  let selectedSubjects = [];

  function showWizard(step) {
    const wiz = $('setup-wizard');
    wiz.classList.remove('hidden');
    wiz.style.display = 'flex';
    $('app').classList.add('hidden');
    for (let i = 1; i <= 3; i++) {
      const s = $('setup-step-' + i);
      s.classList.toggle('active', i === step);
      const d = $('wiz-dot-' + i);
      d.classList.toggle('active', i === step);
      d.classList.toggle('done', i < step);
    }
  }

  function hideWizard() {
    const wiz = $('setup-wizard');
    wiz.classList.add('hidden');
    wiz.style.display = 'none';
    $('app').classList.remove('hidden');
  }

  function initSubjectSelector() {
    const box = $('q-subjects');
    if (!box) return;
    box.innerHTML = '';
    const g = Storage.getGoal();
    const preset = (g.selectedSubjects && g.selectedSubjects.length === 3) ? g.selectedSubjects : [];
    selectedSubjects = preset.slice();

    /**
     * ★ 按省份取可选科目：浙江是 7 选 3（多一门「技术」），其余 3+3 省份 6 选 3。
     *   省份来自问卷的「省份/城市」输入框（还没写进 Storage 时也要能即时响应）。
     */
    const cityNow = (($('q-city') && $('q-city').value) || g.city || '');
    const list = (DB.selectableFor && DB.selectableFor({ city: cityNow })) ||
                 ['物理', '化学', '生物', '政治', '历史', '地理'];

    list.forEach(sub => {
      const label = document.createElement('label');
      label.innerHTML = '<input type="checkbox" value="' + sub + '"> ' + sub;
      const cb = label.querySelector('input');
      cb.checked = selectedSubjects.indexOf(sub) >= 0;
      label.classList.toggle('checked', cb.checked);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          if (selectedSubjects.length >= 3) {
            cb.checked = false;
            toast('3+3 模式只能选 3 门（浙江 7 选 3）', 'warning');
            return;
          }
          selectedSubjects.push(sub);
        } else {
          selectedSubjects = selectedSubjects.filter(s => s !== sub);
        }
        label.classList.toggle('checked', cb.checked);
        updateSubjectHint();
      });
      box.appendChild(label);
    });
    updateSubjectHint();
  }

  /** 问卷进行中的六科：语数英 + 当前勾选的选考科目（还没写进 Storage） */
  function wizardSixSubjects() {
    const core = ['语文', '数学', '英语'];
    return core.concat(selectedSubjects.filter(s => core.indexOf(s) < 0));
  }

  function updateSubjectHint() {
    const left = 3 - selectedSubjects.length;
    const h = $('subject-hint');
    if (h) {
      h.textContent = left > 0
        ? '已选 ' + selectedSubjects.join('、') + '，还有 ' + left + ' 门待选'
        : '已选：语文、数学、英语 + ' + selectedSubjects.join('、') + '（共 6 科）';
      h.style.color = left > 0 ? 'var(--label-tertiary)' : 'var(--green)';
    }
    // ★ 教材进度要跟着当前选科走。这里必须传 wizardSixSubjects()，
    //   不能让它自己去读 Storage —— 那读到的是旧选科（老 bug：选物化地却显示物化生）
    const note = $('q-textbook-edition-note');
    if (note) note.remove();
    renderTextbookRows('q-textbook', {
      subjects: wizardSixSubjects(),
      editionMode: 'auto',
    });
  }

  function collectQuestionnaire() {
    /**
     * ★ 问卷更新（2026-10-25）
     *
     * 用户要求：
     *   1. 不问"学到哪里"，问"学了哪些知识点"（因为有些书会跳着上）
     *   2. AI 自动提问（而不是让用户自己填）
     *   3. 按本地历年考试情况推出下次考试时间
     *
     * 现在改成：
     *   · 学生选科目
     *   · AI 根据科目自动问知识点
     *   · 学生勾选已学的知识点
     *   · 系统自动推算考试时间
     */
    const d = {
      city: $('q-city') ? $('q-city').value : '',
      grade: $('q-grade') ? $('q-grade').value : '高三',
      enrollYear: $('q-enroll-year') ? $('q-enroll-year').value : '',
      selectedSubjects: [],
      examScore: $('q-exam-score') ? parseInt($('q-exam-score').value) || 0 : 0,
      examDate: $('q-exam-date') ? $('q-exam-date').value : '',
      nextExam: $('q-next-exam') ? $('q-next-exam').value : '',
      hours: $('q-hours') ? $('q-hours').value : '2-3小时',
      targetSchool: $('q-target-school') ? $('q-target-school').value : '',
      targetScore: $('q-target-score') ? parseInt($('q-target-score').value) || 0 : 0,
      focuses: [],
      examYear: $('q-exam-year') ? parseInt($('q-exam-year').value) || (new Date().getFullYear() + 1) : new Date().getFullYear() + 1,
      // ★ 新增：知识点覆盖
      knowledgePoints: {},
    };

    // 选考科目
    document.querySelectorAll('#q-subjects input[type=checkbox]').forEach(cb => {
      if (cb.checked) d.selectedSubjects.push(cb.value);
    });

    // 关注点
    document.querySelectorAll('#q-focuses input[type=checkbox]').forEach(cb => {
      if (cb.checked) d.focuses.push(cb.value);
    });

    /**
     * ★ 知识点收集（2026-10-25）
     *
     * 原来问"学到哪里"（比如"函数与导数"），
     * 现在改成问"学了哪些知识点"，更精确。
     *
     * 每个科目下面列出该科的知识点，让学生勾选已学的。
     */
    const allSubs = ['数学', '英语'].concat(d.selectedSubjects);
    allSubs.forEach(sub => {
      const container = $('q-knowledge-' + sub);
      if (container) {
        const checked = [];
        container.querySelectorAll('input[type=checkbox]').forEach(cb => {
          if (cb.checked) checked.push(cb.value);
        });
        d.knowledgePoints[sub] = checked;
      }
    });

    /**
     * ★ 考试时间推算（2026-10-25）
     *
     * 根据浙江高中常见考试安排：
     *   · 月考：每月一次，通常在月底
     *   · 期中考：4月、11月
     *   · 期末考：1月、6月
     *
     * 用当前日期推算下次考试时间。
     */
    if (!d.nextExam) {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      // 简单推算：找下一个考试节点
      let nextExamDate = '';
      if (month >= 9 && month <= 10) {
        nextExamDate = year + '-11-15';  // 期中考
      } else if (month >= 11) {
        nextExamDate = (year + 1) + '-01-15';  // 期末考
      } else if (month >= 3 && month <= 4) {
        nextExamDate = year + '-04-15';  // 期中考
      } else if (month >= 5) {
        nextExamDate = year + '-06-15';  // 期末考（高考前最后一次）
      } else {
        // 默认下次月考：月底
        const lastDay = new Date(year, month, 0).getDate();
        nextExamDate = year + '-' + String(month).padStart(2, '0') + '-' + lastDay;
      }
      d.nextExam = nextExamDate;
    }

    return d;
  }

  async function runFullAnalysis() {
    const status = $('quiz-status');
    const btn = $('btn-analyze');
    const cfg = LLM.getConfig();
    if (!cfg.apiKey && !wbReady()) {
      status.textContent = '请先回到第 1 步配置大模型接口，或启用 WorkBuddy';
      status.style.color = 'var(--red)';
      toast('还没配置 API Key（也没启用 WorkBuddy）', 'warning');
      return;
    }

    const d = collectQuestionnaire();
    if (d.selectedSubjects.length !== 3) {
      status.textContent = '请选择 3 门选考科目（3+3 模式）';
      status.style.color = 'var(--red)';
      return;
    }
    if (!d.examScore) {
      status.textContent = '请填写「最近一次月考总分」——AI 需要这个起点';
      status.style.color = 'var(--red)';
      return;
    }

    btn.disabled = true; btn.textContent = '分析中…';
    status.textContent = '正在保存你的问卷…';
    status.style.color = 'var(--label-tertiary)';

    /**
     * ══════════════════════════════════════════════════════════
     * ★ 关键重构（2026-10-24）：把「存数据」和「AI 分析」彻底拆开
     * ══════════════════════════════════════════════════════════
     *
     * 用户的报错：所有 WorkBuddy 账号登录都过期 → AI 调用失败
     * → 旧代码在 catch 里只报了个错，**数据没存、问卷没完成**
     * → 用户永远卡在第 2 步，进不去软件。
     *
     * 这是设计错误：AI 是**锦上添花**，不是进门的前提。
     * 正确的顺序是：
     *   ① 先保存问卷（不依赖任何网络，一定成功）
     *   ② 立刻标记 setup_completed，保证能进主界面
     *   ③ 再尝试 AI 分析，成功就展示，失败就显示一段本地兜底
     *
     * 另：用户明确说「只要有一个账号就可以了，不用弄多个」——
     * 所以 AI 失败不该是"致命错误"，而应该是"暂时没报告看"。
     */
    let savedOk = false;
    let savedData = null;

    // ── 第 ① 步：保存（绝不允许失败到影响流程）──
    try {
      const goal = {
        grade: d.grade, city: d.city, selectedSubjects: d.selectedSubjects,
        current: d.examScore, examScore: d.examScore,
        target: d.targetScore || Math.round(d.examScore * 1.25),
        targetSchool: d.targetSchool,
        hours: d.hours, focuses: d.focuses,
        examDate: d.examYear + '-06-07',
        examYear: d.examYear,
      };
      Storage.setGoal(goal);
      Storage.set('setup_data', Object.assign({}, d, { report: '' }));

      // 教材进度
      persistTextbook(collectTextbookRows('q-textbook'), {
        subjects: allSixSubjects(),
        city: d.city,
      });
      tbDraft = {};

      // ★ 标记完成 —— 这一行保证用户一定能进主界面
      Storage.set('setup_completed', true);
      savedOk = true;
      savedData = d;

      remember('user', '【学习问卷】' + JSON.stringify(d), 'survey');

      // 问卷阶段没有单科数据，不生成成绩预估
      Storage.setTotalEstimate(null);
      Storage.set('estHist', []);

      console.log('[学徒] 问卷已保存，可以进入主界面');
    } catch (e) {
      // 连本地存储都失败，这才是真要报错的
      status.textContent = '保存失败：' + e.message;
      status.style.color = 'var(--red)';
      toast('保存失败：' + e.message, 'error');
      btn.disabled = false; btn.textContent = 'AI 分析我的学习情况';
      return;
    }

    // ── 第 ② 步：尝试 AI 分析（失败也能继续）──
    status.textContent = '正在让 AI 通读你的情况…（最多 60 秒）';
    let report = '';

    try {
      const all = ['语文', '数学', '英语'].concat(savedData.selectedSubjects);
      const prompt =
        '这是一名高中生的完整问卷。请你以班主任兼任课老师的身份，做一次严肃的学情分析。\n\n' +
        '【问卷】\n' +
        '- 地区：' + (savedData.city || '未填') + '\n' +
        '- 年级：' + savedData.grade + '（入学 ' + (savedData.enrollYear || '未填') + '）\n' +
        '- 选科：语文、数学、英语 + ' + savedData.selectedSubjects.join('、') + '（共 6 科）\n' +
        '- 最近一次月考总分：' + savedData.examScore + ' 分\n' +
        '- 月考时间：' + (savedData.examDate || '未填') + '\n' +
        '- 下次月考：' + (savedData.nextExam || '未填') + '\n' +
        '- 每日可用学习时间：' + savedData.hours + ' 小时\n' +
        '- 目标：' + (savedData.targetSchool || '未定') + ' / ' + (savedData.targetScore || '未定') + ' 分\n' +
        '- 想提升：' + (savedData.focuses.join('、') || '综合提升') + '\n' +
        '- 高考：' + savedData.examYear + ' 年 6 月（约 ' + Math.ceil((new Date(savedData.examYear + '-06-07') - new Date()) / 86400000) + ' 天）\n\n' +
        '重要：' + savedData.examScore + ' 分是「月考」成绩，是本学期的起点参考，不要把它当成高考水平。\n' +
        '更重要：**学生只提供了月考总分，没有提供任何单科成绩。**\n' +
        '所以你不知道他现在语数英理化生各考多少分 —— 不要假装知道。(语数英满分150，选考满分100)\n\n' +
        '请输出一篇结构清晰的中文报告，用下面的小标题：\n' +
        '## 一、现在处在什么位置\n' +
        '（结合月考总分和常见分数线，给一个诚实定位，不要盲目鼓励）\n' +
        '## 二、总分缺口怎么拆\n' +
        '（注意：这里给的是【建议目标分】，不是学生的现状。）\n' +
        '## 三、六科怎么学\n' +
        '（每科一小段，写这一科在高考里最容易失分的地方、以及第一步该做什么。）\n' +
        '## 四、未来 30 天的打法\n' +
        '（每天 ' + savedData.hours + ' 小时具体怎么分配，给出可执行的节奏）\n' +
        '## 五、最容易踩的坑\n' +
        '（2-3 条，直接说）';

      report = await ask(prompt, { maxTokens: 4000, temperature: 0.5 });
      remember('ai', report, 'report');
    } catch (e) {
      /**
       * AI 失败 → 用本地兜底报告。
       *
       * 为什么要有兜底而不是只报错：
       *   用户此刻已经填完了问卷，如果只看到"分析失败"，
       *   会以为自己白填了。给一段基于本地规则的建议，
       *   至少能让他知道下一步该做什么。
       */
      const gap = (savedData.targetScore || Math.round(savedData.examScore * 1.25)) - savedData.examScore;
      report =
        '## ⚠️ AI 分析暂时不可用\n\n' +
        '（' + String(e.message).split('\n')[0] + '）\n\n' +
        '**你的问卷已经保存好了，可以直接开始使用。**' +
        'AI 分析只是附加服务，不影响任何功能。\n\n' +
        '## 一、现在的位置\n' +
        '你填的最近月考总分是 **' + savedData.examScore + ' 分**，' +
        '目标 ' + (savedData.targetScore || '未填') + ' 分，' +
        (gap > 0 ? '中间还有约 **' + gap + ' 分** 要补。' : '目标已经接近，接下来是稳住。') + '\n\n' +
        '## 二、接下来做什么\n' +
        '1. **上传几份真实卷子**：每科传 2 份（一份月考 + 一份联考最好），系统就能算出分科成绩和区间。\n' +
        '2. **做一次推理能力测验**：「进度追踪」页里有 12 道图形题，5 分钟，做完估分会更贴近你。\n' +
        '3. **正常上课/提问**：这些会自动积累成证据。\n\n' +
        '## 三、关于 AI 服务\n' +
        '如果你用的是 WorkBuddy 免费额度，登录过期时会这样。' +
        '去 WorkBuddy 桌面 App 重新登录一次即可；' +
        '或者在「设置」里填自己的 API Key（DeepSeek 官网注册即可）。';

      console.log('[学徒] AI 分析失败，已用本地兜底报告：' + e.message);
    }

    // ── 第 ③ 步：展示报告并放行 ──
    try {
      Storage.set('setup_data', Object.assign({}, savedData, { report: report }));

      const html = esc(report)
        .replace(/^## (.+)$/gm, '<h4>$1</h4>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      const box = $('analysis-result');
      if (box) box.innerHTML = '<div class="ai-box report">' + html + '</div>';

      status.textContent = '';
      showWizard(3);
      refreshShell();
      toast('问卷已保存', 'success');
    } catch (e) {
      console.error('[学徒] 展示报告失败:', e);
      // 展示失败也不能卡住 —— 直接进第 3 步
      try { showWizard(3); } catch (e2) {}
    }

    btn.disabled = false; btn.textContent = 'AI 分析我的学习情况';
  }

  function finishSetup() {
    hideWizard();
    navigate('dashboard');
    toast('开始学习吧', 'success');
  }

  // ════════════════════════════════════════════════════════════
  //  初始化
  // ════════════════════════════════════════════════════════════
  function init() {
    /**
     * ★ 关键健壮性修复（2026-10-17）：**先把界面显示出来，再做其它初始化。**
     *
     * ★ 2026-10-25：初始化 AptitudeUI.mount()
     *   原来没有调用，导致推理能力测试按钮不显示。
     *
     * 原来是：init() 一路往下跑，最后才 hideWizard()/显示 #app。
     * 中间任何一行抛错（实测就是 CourseEngine / Speech 未定义），
     * 结果 #app 和 #setup-wizard 两边都是 hidden —— **整页白屏**，用户完全打不开。
     *
     * 现在：
     *   ① 一进 init 就先确定"该显示哪个界面"并显示出来，
     *      保证**后面无论多少模块失败，至少界面是可见的**；
     *   ② 各模块的初始化失败只影响自己那一块，不再拖垮整个应用。
     *
     * ★ 2026-10-24 加强：引导只走一次
     *   用户明确要求"这次填完问卷后，下次就不要填问卷了"。
     *   判断条件从单一 setup_completed 扩展为三选一：
     *     · setup_completed 为 true
     *     · 之前点过"跳过"
     *     · 已经配好了 API Key（说明走完了第 1 步）
     *   任一条成立 → 直接进主界面，绝不再问一遍。
     */
    function shouldSkipWizard() {
      try {
        // ★ 恢复：只有完整走完问卷才能跳过引导（2026-10-31）
        if (Storage.get('setup_completed', false) === true) return true;
        // 有目标分且有卷子 = 明显已经在用了
        const g = Storage.getGoal();
        const papers = Storage.getPapers();
        if (papers && papers.length > 0 && g && g.target) return true;
      } catch (e) {}
      return false;
    }

    try {
      const done = shouldSkipWizard();
      const wiz = $('setup-wizard');
      const appEl = $('app');
      if (done) {
        if (wiz) { wiz.classList.add('hidden'); wiz.style.display = 'none'; }
        if (appEl) appEl.classList.remove('hidden');
      } else {
        // 没完成引导：让 showWizard 决定（它自己会隐藏 #app）
        if (appEl) appEl.classList.add('hidden');
        try { showWizard(1); } catch (e) {
          console.warn('[学徒] 引导界面渲染失败，直接进主界面:', e);
          if (wiz) { wiz.classList.add('hidden'); wiz.style.display = 'none'; }
          if (appEl) appEl.classList.remove('hidden');
        }
      }
    } catch (e) {
      // 连判断都失败 → 无论如何先让主界面可见，绝不白屏
      console.error('[学徒] 初始化界面判断失败，强制显示主界面:', e);
      const wiz = $('setup-wizard');
      const appEl = $('app');
      if (wiz) { wiz.classList.add('hidden'); wiz.style.display = 'none'; }
      if (appEl) appEl.classList.remove('hidden');
    }

    // ★ 关键：把"一个老师 + 一份记忆"注册给 LLM 层。
    //   之后无论从哪个模块发起调用（出卷、批改、规划、估算、识别试卷、答疑），
    //   模型拿到的 system 都是同一个人的同一份记忆。
    LLM.setPersona(() => {
      const parts = [persona()];
      const digest = memoryDigest(10, 300);
      if (digest) parts.push(digest);
      // ★ 2026-11-07：静默备课包（提前算好，学生卡住时才逐层给）
      try {
        if (typeof ModelCache !== 'undefined') {
          const pb = ModelCache.promptBlock();
          if (pb) parts.push(pb);
        }
      } catch (e) {}
      // ★ 过程信号：只作弱证据提示，不改分数
      try {
        if (typeof Engagement !== 'undefined') {
          const eb = Engagement.promptBlock();
          if (eb) parts.push(eb);
        }
      } catch (e) {}
      return parts.join('\n\n');
    });

    /**
     * ★ 2026-11-07：启动时静默预计算（提前建模）
     *
     * 只做免费的本地计算，不发 LLM 请求（开源版默认没配 Key，
     * 用户没点按钮却在烧额度是越界）。带指纹失效、24h 过期、
     * 单例并发锁；失败静默吞掉，绝不阻塞启动。
     */
    try {
      if (typeof ModelCache !== 'undefined') {
        ModelCache.precompute({ silent: true }).catch(() => {});
      }
    } catch (e) {}

    // 导航
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.page));
    });
    document.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.goto));
    });
    const uc = document.querySelector('.user-chip');
    if (uc) uc.addEventListener('click', () => navigate(uc.dataset.page || 'settings'));
    on('btn-new-session', 'click', () => { navigate('chat'); setTimeout(() => $('chat-input').focus(), 120); });
    on('menu-btn', 'click', () => setSidebarOpen(!$('sidebar').classList.contains('open')));
    on('sidebar-backdrop', 'click', () => setSidebarOpen(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') setSidebarOpen(false);
    });
    window.matchMedia('(max-width: 860px)').addEventListener('change', () => setSidebarOpen(false));
    document.querySelectorAll('.nav-item, .user-chip').forEach(el => {
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
      });
    });

    // 总览
    on('btn-daily-report', 'click', generateDailyReport);

    // 生成课程
    on('btn-course-create', 'click', createCourse);
    on('course-request', 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createCourse(); } });
    bindCourseEvents();
    /**
     * ★ 健壮性修复（2026-10-17）：
     *   原来是直接 `CourseEngine.on(...)`。如果 course.js 因为任何原因没加载成功，
     *   这一行会抛 ReferenceError，**整个 init() 中断** —— 后面的 hideWizard() 永远不执行，
     *   结果 #app 和 #setup-wizard 两边都 hidden，**页面全白**（用户截图就是这个）。
     *
     *   教训：init 里任何一个可选模块的失败，都不能拖垮主界面。
     *   所以这里以及下面所有可选模块的调用都加 typeof 保护。
     */
    if (typeof CourseEngine !== 'undefined' && CourseEngine.on) {
      CourseEngine.on(() => {
        const page = $('page-course');
        if (page && page.classList.contains('active')) renderCourse();
      });
    } else {
      console.warn('[学徒] CourseEngine 未加载，课程功能不可用（不影响其它页面）');
    }

    // 规划
    on('btn-gen-plan', 'click', generatePlan);
    on('p-routine', 'change', onRoutineChange);   // ★ 2026-11-07 作息

    // 出卷
    on('btn-gen-quiz', 'click', generateQuiz);
    on('q-subject', 'change', () => { fillKnowledgeSelect(); renderTextbookSummary(); });
    on('btn-tb-toggle', 'click', () => {
      const open = !Storage.get('tb_editor_open', false);
      Storage.set('tb_editor_open', open);
      const ed = $('tb-editor');
      if (ed) ed.classList.toggle('hidden', !open);
      const bar = $('tb-save-bar');
      if (bar) bar.classList.toggle('hidden', !open);
      $('btn-tb-toggle').textContent = open ? '收起' : '展开填写';
      if (open) renderTextbookRows('tb-editor', { compact: true });
    });
    on('btn-tb-save', 'click', () => {
      saveTextbookRows('tb-editor');
      renderTextbookRows('tb-editor', { compact: true });
      renderTextbookSummary();
    });
    on('q-subject', 'change', fillKnowledgeSelect);
    on('btn-submit-quiz', 'click', submitQuiz);
    on('btn-quit-quiz', 'click', () => {
      if (!confirm('放弃这份试卷？')) return;
      QuizEngine.stopTimer();
      $('quiz-area').classList.add('hidden');
    });
    on('btn-print-quiz', 'click', () => window.print());

    // 辅导
    // 注意：sendChat 的第一个参数是"预填文本"，绝不能把 click 事件对象直接传进去，
    // 否则 String(MouseEvent) === "[object PointerEvent]" 会被当成消息发出去。
    on('btn-chat-send', 'click', () => sendChat());
    const ci = $('chat-input');
    if (ci) {
      ci.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); sendChat(); }
      });
      ci.addEventListener('input', () => {
        ci.style.height = 'auto';
        ci.style.height = Math.min(140, ci.scrollHeight) + 'px';
      });
    }
    on('btn-chat-clear', 'click', () => {
      if (!confirm('清空全部 AI 记忆？（问卷结论、试卷分析、对话都会没）')) return;
      Storage.clearMemory();
      renderChat();
      toast('记忆已清空', 'success');
    });

    // 监控
    on('btn-cam-start', 'click', startCamera);
    on('btn-cam-stop', 'click', stopCamera);
    on('btn-cam-calibrate', 'click', startCalibration);

    // 进度
    on('btn-ai-estimate', 'click', aiEstimateNow);
    on('btn-judge-diff', 'click', judgePaperDifficulties);

    // 薄弱点
    on('btn-analyze-weakness', 'click', analyzeWeaknessNow);

    // 导入
    // 导入试卷：拖拽 / 点选 / 粘贴 三种都能进
    const upDrop = $('up-drop');
    if (upDrop) {
      upDrop.addEventListener('click', (e) => {
        // 点 label（文件选择）或缩略图的删除按钮时不要重复触发
        if (e.target.closest('label') || e.target.closest('button')) return;
        const fi = $('up-files');
        if (fi) fi.click();
      });
      ['dragenter', 'dragover'].forEach(ev => upDrop.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        upDrop.classList.add('over');
      }));
      ['dragleave', 'drop'].forEach(ev => upDrop.addEventListener(ev, (e) => {
        e.preventDefault(); e.stopPropagation();
        upDrop.classList.remove('over');
      }));
      upDrop.addEventListener('drop', async (e) => {
        const dt = e.dataTransfer;
        if (!dt) return;
        // ★ 优先判断拖入的是不是文件夹：是 → 每个子文件夹 = 一份卷子，入队逐一识别
        const groups = await groupDroppedItems(dt);
        if (groups && groups.length) {
          if (uploadQueueRunning) { toast('上一批还在识别中，先把这批等完', 'warning'); return; }
          uploadQueue = uploadQueue.concat(groups);
          uploadedFiles = [];
          renderUploadPreview();
          const names = groups.map(g => g.name);
          toast('发现 ' + groups.length + ' 份卷子：' + names.slice(0, 5).join('、') +
            (names.length > 5 ? ' 等' : '') + '。点「AI 识别并分析」逐一识别', 'success');
          $('up-file-summary').textContent = '已分组 ' + groups.length + ' 份卷子 · 待逐一识别';
          $('up-file-summary').style.color = 'var(--green)';
          // 自动开跑，不用再点按钮
          analyzeUpload();
          return;
        }
        if (groups && !groups.length) {
          toast('这个文件夹里没有图片', 'warning');
          return;
        }
        if (dt.files && dt.files.length) handleFileUpload(dt.files);
      });
      // 拖到页面别处也别让浏览器直接打开图片；在导入页时照样收下
      window.addEventListener('dragover', (e) => { e.preventDefault(); });
      window.addEventListener('drop', async (e) => {
        if (!$('page-import') || !$('page-import').classList.contains('active')) return;
        if (upDrop.contains(e.target)) return;   // 上面已处理
        e.preventDefault();
        const dt = e.dataTransfer;
        if (!dt) return;
        const groups = await groupDroppedItems(dt);
        if (groups && groups.length) {
          if (uploadQueueRunning) { toast('上一批还在识别中，先把这批等完', 'warning'); return; }
          uploadQueue = uploadQueue.concat(groups);
          uploadedFiles = [];
          renderUploadPreview();
          toast('发现 ' + groups.length + ' 份卷子，开始逐一识别', 'success');
          analyzeUpload();
          return;
        }
        if (groups && !groups.length) { toast('这个文件夹里没有图片', 'warning'); return; }
        if (dt.files && dt.files.length) handleFileUpload(dt.files);
      });
    }
    on('up-files', 'change', (e) => { handleFileUpload(e.target.files); e.target.value = ''; });
    // ★ 点选文件夹批量上传：webkitdirectory 会递归给出全部文件，
    //   用**图片所在目录名**（路径倒数第二段）分组：
    //   选"校准图片"→ "校准图片/数学2026_xx/page_01.png" → 组名"数学2026_xx"（正确）
    //   老版本取第一段，会得到"校准图片"，把所有卷子的图挤成一份。
    on('up-folder', 'change', (e) => {
      const input = e.target;
      const files = Array.from(input.files || []);
      input.value = '';
      if (!files.length) return;
      const groupByRelPath = {};
      const REL = (f) => {
        const parts = String(f.webkitRelativePath || '').split('/');
        // 形如 [根目录, 卷子目录, 图片] 或 [卷子目录, 图片]；图片直接放根下时无父目录名
        return parts.length >= 2 ? parts[parts.length - 2] : '';
      };
      for (const f of files) {
        if (!(f.type && f.type.indexOf('image/') === 0) && !IMG_EXT.test(f.name || '')) continue;
        const g = REL(f);
        (groupByRelPath[g] = groupByRelPath[g] || []).push(f);
      }
      const groups = Object.keys(groupByRelPath).map(name => ({ name: name || '未分组图片', files: groupByRelPath[name] }));
      if (uploadQueueRunning) { toast('上一批还在识别中，先把这批等完', 'warning'); return; }
      if (!groups.length) { toast('这个文件夹里没有图片', 'warning'); return; }
      // 安全阀：某组超过 20 张，多半是层级选错了（把所有卷子放进了一组）
      const tooBig = groups.filter(g => g.files.length > 20);
      if (tooBig.length && groups.length === 1) {
        toast('检测到 ' + tooBig[0].files.length + ' 张图在同一层，请选到「卷子文件夹」这一层再试', 'warning');
        return;
      }
      uploadQueue = uploadQueue.concat(groups);
      uploadedFiles = [];
      renderUploadPreview();
      toast('从文件夹发现 ' + groups.length + ' 份卷子，开始逐一识别', 'success');
      $('up-file-summary').textContent = '已分组 ' + groups.length + ' 份卷子 · 待逐一识别';
      $('up-file-summary').style.color = 'var(--green)';
      analyzeUpload();
    });
    on('btn-up-analyze', 'click', analyzeUpload);
    // 批量结果里的「查看原图批改与校准」按钮（innerHTML 会重建，所以用委托）
    document.addEventListener('click', (e) => {
      const t = e.target;
      const btn = t && t.closest ? t.closest('[data-ann]') : null;
      if (!btn) return;
      e.preventDefault();
      openAnnotationFor(Number(btn.getAttribute('data-ann')));
    });
    on('btn-run-subject-analysis', 'click', () => runSubjectAnalyses());
    on('btn-total-analysis', 'click', analyzeTotal);
    on('btn-add-subject', 'click', addImportRow);
    on('btn-submit-import', 'click', submitImport);

    // 拍照读题
    const drop = $('photo-drop');
    if (drop) {
      drop.addEventListener('click', (e) => {
        if (e.target.closest('label')) return;   // 让 label 自己触发 file input
        const fi = $('photo-files'); if (fi) fi.click();
      });
      ['dragenter', 'dragover'].forEach(ev =>
        drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev =>
        drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) photoAddFiles(e.dataTransfer.files);
      });
    }
    on('photo-files', 'change', (e) => { photoAddFiles(e.target.files); e.target.value = ''; });
    on('btn-photo-analyze', 'click', analyzePhoto);
    on('btn-photo-clear', 'click', photoClear);
    // 截图后 Ctrl+V 直接贴进来（两个上传页共用）。
    // 关键：在输入框里粘贴文字时不能抢 —— 否则填"名称"都填不了。
    document.addEventListener('paste', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const page = $('page-photo') && $('page-photo').classList.contains('active') ? 'photo'
                 : ($('page-import') && $('page-import').classList.contains('active') ? 'import' : '');
      if (!page) return;
      const items = (e.clipboardData && e.clipboardData.items) || [];
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
          const f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (!files.length) return;
      e.preventDefault();
      if (page === 'photo') { photoAddFiles(files); toast('已粘贴 ' + files.length + ' 张图', 'success'); }
      else handleFileUpload(files);
    });

    // 读图模型
    on('btn-set-vision-save', 'click', () => { if (saveVisionConfigUI()) toast('读图模型已保存', 'success'); });
    on('btn-set-vision-test', 'click', testVisionUI);

    // 难度折算系数
    on('btn-diff-save', 'click', saveDifficultyRows);
    on('btn-diff-reset', 'click', resetDifficultyRows);
    on('btn-goal-save', 'click', saveGoalRows);
    on('btn-goal-even', 'click', spreadGoalEven);
    on('set-goal-total', 'input', updateGoalSum);
    on('set-goal-rows', 'input', updateGoalSum);

    // 设置
    // ★ 匿名使用统计（2026-10-31 补：之前 HTML 有卡片但无任何绑定）
    bindUsageStats();
    on('set-region', 'change', onRegionChange);
    on('set-lang', 'change', onLangChange);
    on('set-curriculum', 'change', onCurriculumChange);
    on('set-reasoning', 'change', onReasoningChange);
    on('btn-set-test', 'click', async () => {
      const cfg = readProviderConfig('set-provider', 'set-model', 'set-model-custom', 'set-baseurl', 'set-key');
      await testProviderConfig(cfg, $('set-status'), $('btn-set-test'));
    });
    on('btn-set-save', 'click', () => {
      const cfg = readProviderConfig('set-provider', 'set-model', 'set-model-custom', 'set-baseurl', 'set-key');
      if (saveProviderConfig(cfg, $('set-status'))) toast('已保存', 'success');
    });
    on('btn-export', 'click', exportData);    on('btn-reset-setup', 'click', resetSetup);
    on('btn-clear-data', 'click', clearLearningData);
    on('btn-memory-refresh', 'click', renderMemoryList);
    on('btn-clear-memory', 'click', () => {
      if (!confirm('清空 AI 记忆？')) return;
      Storage.clearMemory();
      renderMemoryList();
      updateMemoryUI();
      toast('记忆已清空', 'success');
    });

    // 语音（老师的声音）
    renderTtsSettings();
    on('btn-tts-check', 'click', async () => { await ttsCheck(true); });
    on('btn-tts-save', 'click', () => {
      const base = ($('set-tts-base') || {}).value || '';
      const v = ($('set-tts-voice') || {}).value || '';
      const r = ($('set-tts-rate') || {}).value || '1';
      Speech.setBase(base);
      if (v) Speech.setVoice(v);
      Speech.setRate(r);
      toast('语音设置已保存', 'success');
      ttsCheck(true);
    });
    on('set-tts-voice', 'change', () => {
      Speech.setVoice($('set-tts-voice').value);
    });
    on('set-tts-rate', 'input', () => {
      Speech.setRate($('set-tts-rate').value);
      const h = $('set-tts-status');
      if (h) h.textContent = '语速 ' + Number($('set-tts-rate').value).toFixed(1) + '×';
    });
    on('btn-tts-test', 'click', async () => {
      const st = $('set-tts-status');
      const h = await Speech.check(true);
      if (!h.ok) { if (st) st.textContent = '服务没启动：' + (h.reason || ''); toast('语音服务没启动', 'error'); return; }
      if (st) st.textContent = '正在合成试听…';
      const ok = await Speech.speakList(['这一节我们讲三角函数的图像变换。'], {
        onError: (m) => { if (st) st.textContent = m; },
        onDone: () => { if (st) st.textContent = '试听结束。声音还满意吗？不喜欢可以在上面换一个。'; },
      });
      if (ok) { if (st) st.textContent = '正在播放…（听到声音说明配置好了）'; }
    });

    // 问卷 / 引导
    initProviderSelect('api-provider', 'api-model', 'api-model-custom-group', 'api-model-custom', 'api-baseurl-group', 'api-baseurl', 'api-key');

    // ══════════════════════════════════════════════════════
    //  向导第一步：WorkBuddy 免费通道
    //  —— 用户最先看到的就是这个界面，所以卡片放这里，不用先填 Key
    // ══════════════════════════════════════════════════════
    (function initWizardWorkBuddy() {
      if (typeof WB === 'undefined') return;
      const card = $('wiz-wb-card');
      if (!card) return;
      if (!WB.available()) { card.classList.add('hidden'); return; }
      card.classList.remove('hidden');

      const stateEl = $('wiz-wb-state');
      const hintEl = $('wiz-wb-hint');
      const modelSel = $('wiz-wb-model');
      const poolEl = $('wiz-wb-pool');

      function paintState() {
        const on = WB.isEnabled();
        if (stateEl) {
          stateEl.textContent = on ? '✓ 已启用（可跳过填 Key）' : '未启用';
          stateEl.style.color = on ? 'var(--green)' : 'var(--label-tertiary)';
        }
      }

      // ── 模型下拉 ──
      async function loadModels() {
        if (!modelSel) return;
        const r = await WB.models();
        const list = (r && r.models) || [];
        if (!list.length) {
          modelSel.innerHTML = '<option value="auto">Auto（默认）</option>';
          return;
        }
        const cur = (r && r.current) || WB.currentModel() || 'auto';
        modelSel.innerHTML = list.map(m => {
          const price = m.mult == null ? '' : (m.mult === 0 ? ' · 免费' : ' · x' + m.mult);
          return '<option value="' + esc(m.id) + '"' + (m.id === cur ? ' selected' : '') + '>' +
            esc(m.name) + price + '</option>';
        }).join('');
      }

      if (modelSel) {
        modelSel.addEventListener('change', async () => {
          const id = modelSel.value;
          try {
            Storage.set('workbuddy_model', id);
            await WB.setModel(id);
            if (hintEl) hintEl.textContent = '已切到 ' + id;
            refreshPool();
          } catch (e) {
            if (hintEl) hintEl.textContent = '切换失败：' + e.message;
          }
        });
      }

      // ── 池状态 ──
      async function refreshPool() {
        if (!poolEl) return;
        const st = await WB.poolStatus();
        if (!st || !st.ok) {
          poolEl.innerHTML = '<span class="wb-badge">池状态读不到</span>';
          return;
        }
        const cooling = st.cooling || [];
        let html = '<span class="wb-badge ok">健康 ' + st.healthy + '/' + st.total + ' 个账号</span>';
        if (cooling.length) {
          html += cooling.map(c =>
            '<span class="wb-badge cool">' + esc(c.id) + ' 冷却 ' +
            Math.ceil(c.secondsLeft / 60) + ' 分</span>').join('');
        }
        html += '<span class="wb-badge">模型 ' + esc(st.model || 'auto') + '</span>';
        poolEl.innerHTML = html;
      }

      async function probe(show) {
        const r = await WB.probe();
        if (!show) return r;
        if (r.ok) {
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--green)">✓ 发现 ' + r.count +
            ' 个账号：' + r.accounts.map(a => '<code>' + esc(a.id) + '</code>').join(' ') + '</span>';
          refreshPool();
        } else {
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--red)">✗ ' + esc(r.reason || '不可用') + '</span>' +
            '<div class="hint">需要本机安装并登录 WorkBuddy 桌面 App。</div>';
        }
        return r;
      }

      on('btn-wiz-wb-enable', 'click', async (e) => {
        const btn = e.currentTarget;
        const old = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = '正在连接 WorkBuddy…'; }
        if (hintEl) hintEl.textContent = '正在检测 WorkBuddy 账号…（首次要启动 App 取密钥，约 5~10 秒）';

        const r = await probe(false);
        if (btn) { btn.disabled = false; btn.textContent = old; }

        if (!r.ok) {
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--red)">✗ ' + esc(r.reason || '不可用') + '</span>';
          toast('WorkBuddy 不可用：' + (r.reason || ''), 'error');
          return;
        }

        WB.setEnabled(true);
        paintState();

        /**
         * ★ 用户要求（2026-10-17）：点「用 WorkBuddy」之后**直接进下一步**，
         *   不要再让用户点一次「下一步」。
         *
         * 但有个前提要保证：第 2 步（学习问卷）能正常渲染。问卷里要用到
         * 教材版本/选科等初始化，所以这里先把第 2 步需要的渲染补上，
         * 再做跳转 —— 否则会跳进一个空白问卷。
         */
        try {
          if (typeof renderTextbookRows === 'function') {
            const g0 = Storage.getGoal();
            const subs = ['语文', '数学', '英语'].concat(Array.isArray(selectedSubjects) ? selectedSubjects : []);
            renderTextbookRows('q-textbook', { subjects: subs, editionMode: 'auto' });
          }
        } catch (err) { console.warn('[学徒] 问卷预渲染失败（不影响跳转）:', err); }

        toast('已启用 WorkBuddy（' + r.count + ' 个账号），进入学习问卷', 'success');
        if (hintEl) hintEl.innerHTML = '<span style="color:var(--green)">✓ 已连接 ' + r.count + ' 个账号，正在进入下一步…</span>';

        // 稍等一下让用户看到"已连接"，然后自动跳转
        setTimeout(() => {
          try { showWizard(2); } catch (err) { console.error('跳转失败:', err); }
        }, 700);
      });

      on('btn-wiz-wb-test', 'click', async () => {
        if (!WB.isEnabled()) { toast('先点「用 WorkBuddy」启用', 'warning'); return; }
        if (hintEl) hintEl.textContent = '测试中（会消耗一点点积分）…';
        try {
          const r = await WB.chat([{ role: 'user', content: '只回复两个字：收到' }]);
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--green)">✓ 通了！模型 ' +
            esc(r.model) + ' 回复「' + esc((r.text || '').slice(0, 30)) + '」，账号 ' + esc(r.account) + '</span>';
          refreshPool();
        } catch (e) {
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--red)">✗ 失败：' + esc(e.message) + '</span>';
          refreshPool();
        }
      });

      on('btn-wiz-wb-reset', 'click', async () => {
        await WB.clearCooldown();
        if (hintEl) hintEl.textContent = '已清除所有冷却，账号恢复可用';
        refreshPool();
        toast('已清冷却', 'success');
      });

      on('btn-wiz-wb-off', 'click', () => {
        WB.setEnabled(false);
        paintState();
        if (hintEl) hintEl.textContent = '已关闭，请在下面填自己的 API Key。';
        toast('已关闭 WorkBuddy', 'success');
      });

      paintState();
      loadModels().catch(() => {});
      renderChatModelBar().catch(() => {});
      probe(false).catch(() => {});
      refreshPool().catch(() => {});
      // 每 20 秒刷新一次池状态（冷却倒计时会变）
      setInterval(() => { if (WB.isEnabled()) refreshPool().catch(() => {}); }, 20000);
    })();

    initSubjectSelector();

    // ★ P5 回溯：录入真实成绩 / 清空
    on('btn-bt-add', 'click', () => { addBacktestTruth(); });
    // ★ 批量录六科：一次考试填六科，不用点六次（2026-10-17）
    on('btn-bt-batch', 'click', () => {
      const box = $('bt-batch-rows');
      if (!box) return;
      const subs = allSixSubjects();
      const dateEl = $('bt-batch-date');
      if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

      box.innerHTML = '<div class="form-row" style="align-items:flex-end;gap:8px;flex-wrap:wrap">' +
        subs.map(function (sub) {
          const full = (DB.MAX_SCORES && DB.MAX_SCORES[sub]) || 100;
          return '<div class="form-group" style="margin:0;flex:0 0 128px">' +
            '<label>' + esc(sub) + '（' + full + '）</label>' +
            '<input type="number" class="bt-batch-in" data-sub="' + esc(sub) + '" data-full="' + full +
            '" placeholder="留空跳过" style="width:118px">' +
            '</div>';
        }).join('') +
        '</div>' +
        '<div class="btn-group" style="margin-top:10px">' +
        '<button class="btn btn-primary btn-sm" id="btn-bt-batch-save">保存这几科</button></div>';

      const saveBtn = $('btn-bt-batch-save');
      if (!saveBtn) return;
      saveBtn.addEventListener('click', () => {
        const dEl = $('bt-batch-date');
        const dateVal = (dEl && dEl.value) || new Date().toISOString().slice(0, 10);
        let n = 0, bad = 0;
        box.querySelectorAll('.bt-batch-in').forEach(function (inp) {
          const raw = String(inp.value || '').trim();
          if (raw === '') return;                        // 留空跳过
          const sc = Number(raw);
          if (!isFinite(sc)) { bad++; return; }
          const full = Number(inp.getAttribute('data-full')) || 100;
          if (sc < 0 || sc > full) { bad++; return; }
          Backtest.recordTruth({
            subject: inp.getAttribute('data-sub'),
            score: sc,
            fullScore: full,
            source: '真实单科',
            date: dateVal,
          });
          n++;
        });
        renderBacktest();
        if (n) toast('已录入 ' + n + ' 科' + (bad ? ('（' + bad + ' 项无效已跳过）') : ''), 'success');
        else toast(bad ? '分数超出满分范围，请检查' : '没有填任何分数', 'warning');
      });
    });

    on('btn-bt-clear', 'click', () => {
      if (!confirm('确定清空所有回溯数据（预测存档 + 真实成绩）？这不可恢复。')) return;
      Backtest.clear();
      // 真值也要清
      Storage.set('truths', []);
      renderBacktest();
      toast('回溯数据已清空', 'success');
    });

    // ══════════════════════════════════════════════════
    //  数据备份与恢复
    // ══════════════════════════════════════════════════
    on('btn-backup-now', 'click', async (e) => {
      const btn = e.currentTarget;
      const hint = $('backup-hint');
      btn.disabled = true; const old = btn.textContent; btn.textContent = '备份中…';
      try {
        const r = await BackupGuard.backupNow();
        if (r.ok) {
          if (hint) hint.textContent = '✓ 已写入磁盘：' + r.file + '（' + Math.round((r.size || 0) / 1024) + ' KB）';
          toast('备份成功：' + r.file, 'success');
        } else if (r.fellBackToLocal) {
          if (hint) hint.textContent = '⚠️ ' + r.error + ' —— 已在浏览器内留了快照，但这不是长久之计，建议开着 server.py。';
          toast('只在浏览器内备份了', 'warning');
        } else {
          if (hint) hint.textContent = '✗ 备份失败：' + r.error;
          toast('备份失败：' + r.error, 'error');
        }
        BackupGuard.updateBadge(r);
      } catch (err) {
        if (hint) hint.textContent = '✗ 备份出错：' + err.message;
      } finally { btn.disabled = false; btn.textContent = old; }
    });

    on('btn-backup-list', 'click', async () => {
      const box = $('backup-list');
      if (!box) return;
      box.innerHTML = '<div class="hint">读取中…</div>';
      const items = await BackupGuard.listDiskBackups();
      const local = BackupGuard.localSnapshots();
      let html = '';
      if (items.length) {
        html += '<div class="hint" style="margin-bottom:6px">磁盘快照（backups/ 目录，共 ' + items.length + ' 份）</div>';
        html += '<table class="data-table"><thead><tr><th>时间</th><th>大小</th><th>操作</th></tr></thead><tbody>' +
          items.slice(0, 20).map(it =>
            '<tr><td>' + esc(it.time) + '</td><td class="num">' + Math.round(it.size / 1024) + ' KB</td>' +
            '<td><button class="btn btn-secondary btn-sm" data-restore="' + esc(it.name) + '">恢复这一份</button></td></tr>'
          ).join('') + '</tbody></table>';
      } else {
        html += '<div class="hint">磁盘上还没有快照（server.py 没开，或还没备份过）。</div>';
      }
      if (local.length) {
        html += '<div class="hint" style="margin:10px 0 6px">浏览器内兜底快照（' + local.length + ' 份）</div>' +
          '<table class="data-table"><thead><tr><th>时间</th><th>操作</th></tr></thead><tbody>' +
          local.map((it, i) =>
            '<tr><td>' + esc(fmtDate(it.at)) + '</td>' +
            '<td><button class="btn btn-secondary btn-sm" data-restore-local="' + i + '">恢复这一份</button></td></tr>'
          ).join('') + '</tbody></table>';
      }
      box.innerHTML = html;

      box.querySelectorAll('[data-restore]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('恢复会用这份备份覆盖当前数据（恢复前会自动先备份当前状态）。继续？')) return;
          try {
            await BackupGuard.restoreFromDisk(btn.getAttribute('data-restore'));
            toast('已恢复，页面即将刷新', 'success');
            setTimeout(() => location.reload(), 800);
          } catch (err) { toast('恢复失败：' + err.message, 'error'); }
        });
      });
      box.querySelectorAll('[data-restore-local]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!confirm('用浏览器内的这份快照覆盖当前数据？')) return;
          try {
            BackupGuard.restoreFromLocal(Number(btn.getAttribute('data-restore-local')));
            toast('已恢复，页面即将刷新', 'success');
            setTimeout(() => location.reload(), 800);
          } catch (err) { toast('恢复失败：' + err.message, 'error'); }
        });
      });
    });

    on('btn-export2', 'click', () => { exportData(); });

    // AI 助教页：模型选择
    on('chat-model', 'change', (e) => {
      const v = e.target.value || '';
      Storage.set('chat_model', v);
      toast(v ? ('辅导用 ' + v) : '辅导用自动路由', 'success');
    });

    // ══════════════════════════════════════════════════════
    //  WorkBuddy 免费 Token（自用测试）
    // ══════════════════════════════════════════════════════
    (function initWorkBuddyUI() {
      if (typeof WB === 'undefined') return;
      const card = $('wb-card');
      if (!card) return;

      // 浏览器里没有桥 → 不显示这个卡片（避免误导）
      if (!WB.available()) { card.classList.add('hidden'); return; }
      card.classList.remove('hidden');

      const stateEl = $('wb-state');
      const hintEl = $('wb-hint');
      const acctEl = $('wb-accounts');

      function paint() {
        const on = WB.isEnabled();
        if (stateEl) {
          stateEl.textContent = on ? '已启用' : '未启用';
          stateEl.style.color = on ? 'var(--green)' : 'var(--label-tertiary)';
        }
      }

      async function doProbe(silent) {
        /**
         * ★ 两步检测（2026-10-18 修）
         *
         * 第一步 probe：读本地凭据文件 → 知道有几个账号
         * 第二步 verify：真发一次请求 → 知道 token 还能不能用
         *
         * 为什么必须两步：实际发生过「显示健康 5/5，点分析却报 401 openresty」——
         * 文件在，但 token 过期了。只看文件会误导用户。
         */
        if (!silent && hintEl) hintEl.textContent = '检测中…（先看本地账号，再试真实连接）';
        const r = await WB.probe();

        if (!r.ok) {
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--red)">✗ ' + esc(r.reason || '不可用') + '</span>' +
            '<div class="hint">需要本机安装并登录 WorkBuddy 桌面 App。</div>';
          if (acctEl) acctEl.innerHTML = '';
          return r;
        }

        // 本地有账号 → 再试真实连接
        if (!silent && hintEl) {
          hintEl.innerHTML = '<span style="color:var(--green)">✓ 本地有 ' + r.count +
            ' 个账号</span><div class="hint">正在试真实连接…</div>';
        }
        if (acctEl) {
          acctEl.innerHTML = '<div class="hint">账号：' +
            r.accounts.map(a => '<code>' + esc(a.id) + '</code>').join(' ') + '</div>';
        }

        const v = await WB.verify();

        if (v.ok) {
          if (hintEl) hintEl.innerHTML =
            '<span style="color:var(--green)">✓ ' + r.count + ' 个账号，连接正常</span>' +
            '<div class="hint">用时 ' + v.ms + 'ms · 模型 ' + esc(v.model || '') +
            ' · 账号 ' + esc(v.account || '') + '</div>';
          // 记下"已验证可用"，让启用按钮放心
          r.verified = true;
        } else {
          /**
           * 真实连接失败 → 这才是用户真正需要知道的。
           * 尤其是登录过期：必须让他去 WorkBuddy 重登，而不是在这里瞎试。
           */
          const isAuth = v.isAuthError || /401|403|登录|过期/.test(String(v.reason || ''));
          const title = isAuth ? '账号登录已过期' : '连接失败';
          if (hintEl) {
            hintEl.innerHTML =
              '<span style="color:var(--red)">✗ ' + esc(title) + '</span>' +
              '<div class="hint" style="white-space:pre-wrap;margin-top:6px;line-height:1.75">' +
              esc(String(v.reason || '').slice(0, 500)) + '</div>';
          }
          r.verified = false;
          r.verifyError = v.reason;
        }

        return r;
      }

      on('btn-wb-check', 'click', () => doProbe(false));

      on('btn-wb-enable', 'click', async () => {
        const r = await doProbe(true);
        if (!r.ok) {
          toast('WorkBuddy 不可用：' + (r.reason || ''), 'error');
          return;
        }
        // ★ 本地有账号但真实连接失败 → 不要让用户以为能用了
        if (r.verified === false) {
          toast('账号登录已过期，请先在 WorkBuddy 里重新登录', 'error');
          // 仍然滚到提示位置
          if (hintEl) hintEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        WB.setEnabled(true);
        paint();
        toast('已启用 WorkBuddy —— 之后所有 AI 调用都走它的积分', 'success');
      });

      on('btn-wb-disable', 'click', () => {
        WB.setEnabled(false);
        paint();
        toast('已关闭，改回用自己的 API Key', 'success');
      });

      on('btn-wb-test', 'click', async () => {
        if (!WB.isEnabled()) { toast('先点「启用 WorkBuddy」', 'warning'); return; }
        if (hintEl) hintEl.textContent = '测试中（会消耗一点点积分）…';
        try {
          const r = await WB.chat([{ role: 'user', content: '只回复两个字：收到' }]);
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--green)">✓ 通了！模型回复「' +
            esc((r.text || '').slice(0, 40)) + '」，用的是账号 ' + esc(r.account) + '</span>';
        } catch (e) {
          if (hintEl) hintEl.innerHTML = '<span style="color:var(--red)">✗ 失败：' + esc(e.message) + '</span>';
        }
      });

      paint();
      /**
       * ★ 加载时不再自动联网验证（2026-10-31）
       *
       * 旧版：每次进设置页都自动 doProbe(true)，跑一次 5 秒网络请求。
       * 用户只是打开设置页，就被迫等一次连接测试，没必要。
       *
       * 现在：只显示本地已有的账号状态（不联网）。
       * 真实验证只在两种情况下跑：
       *   ① 用户手动点「检测账号」（btn-wb-check）
       *   ② 用户点「启用 WorkBuddy」（btn-wb-enable）
       */
      // doProbe(true).catch(() => {});   // ← 已移除自动联网验证

    })();


    // 数据迁移向导（把网页版数据搬进桌面应用）
    on('btn-migrate', 'click', () => {
      window.open('迁移数据.html', '_blank');
    });

    // 显示备份到底存在哪个目录（打包装到 AppData 后用户找不到）
    (async function showDataDir() {
      try {
        const r = await fetch('/api/data-dir');
        const j = await r.json();
        const el = $('data-dir-hint');
        if (el && j && j.dir) {
          el.textContent = '备份目录：' + j.dir + (j.packaged ? '（桌面应用模式）' : '');
        }
      } catch (e) { /* 静态打开时没有这个接口，忽略 */ }
    })();

    on('btn-import', 'click', () => { const f = $('import-file'); if (f) f.click(); });
    on('import-file', 'change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const hint = $('backup-hint');
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const data = json && json.data && typeof json.data === 'object' ? json.data : json;
        const r = Storage.importAll(data, { replace: false });
        if (hint) hint.textContent = '✓ 已导入 ' + r.imported + ' 项数据' + (r.skipped.length ? '（' + r.skipped.length + ' 项失败）' : '');
        toast('导入成功，页面即将刷新', 'success');
        setTimeout(() => location.reload(), 900);
      } catch (err) {
        if (hint) hint.textContent = '✗ 导入失败：' + err.message;
        toast('导入失败：' + err.message, 'error');
      } finally { e.target.value = ''; }
    });

    // 城市填完/改了 → 教材版本重新按地区匹配（不用问用户）
    // ★ 同时重建选科列表：浙江是 7 选 3（含「技术」），填了浙江就要出现这一门
    on('q-city', 'change', () => {
      const prev = selectedSubjects.slice();
      initSubjectSelector();
      // 尽量保留用户已勾的（技术这类新增科目默认不勾）
      const box2 = $('q-subjects');
      if (box2) {
        box2.querySelectorAll('input[type=checkbox]').forEach(cb => {
          const keep = prev.indexOf(cb.value) >= 0;
          cb.checked = keep;
          if (cb.parentElement) cb.parentElement.classList.toggle('checked', keep);
        });
        selectedSubjects = prev.filter(s => {
          const cb = box2.querySelector('input[value="' + s + '"]');
          return !!cb;
        });
        updateSubjectHint();
      }
      renderTextbookRows('q-textbook', { subjects: wizardSixSubjects(), editionMode: 'auto' });
    });
    on('btn-test-api', 'click', async () => {
      const cfg = readProviderConfig('api-provider', 'api-model', 'api-model-custom', 'api-baseurl', 'api-key');
      const ok = await testProviderConfig(cfg, $('api-status'), $('btn-test-api'));
      if (ok) {
        saveProviderConfig(cfg, $('api-status'), true);
        $('api-status').textContent += ' · 已保存，可以进入下一步';
      }
    });
    on('btn-api-next', 'click', () => {
      /**
       * ★ 启用 WorkBuddy 时直接放行（2026-10-17）
       *   原来这里无条件走 saveProviderConfig，它内部要求 API Key 必填 ——
       *   所以即使用户已经启用 WorkBuddy，点「下一步」还是会被拦。
       */
      if (wbReady()) {
        const st = $('api-status');
        if (st) st.textContent = '使用 WorkBuddy，已跳过 API Key 配置';
        showWizard(2);
        return;
      }
      const cfg = readProviderConfig('api-provider', 'api-model', 'api-model-custom', 'api-baseurl', 'api-key');
      if (!saveProviderConfig(cfg, $('api-status'))) return;
      showWizard(2);
    });
    on('btn-back-1', 'click', () => showWizard(1));
    on('btn-analyze', 'click', runFullAnalysis);

    ;

    on('btn-start-learning', 'click', finishSetup);

    // 入口判断（★ 2026-10-24：和 init 开头用同一套规则，避免两处不一致）
    if (shouldSkipWizard()) {
      hideWizard();
      navigate('dashboard');
    } else {
      showWizard(1);
    }
    refreshShell();
    updateBadges();
    renderMemoryList();
    // 侧栏胶囊首帧就要在位（否则第一次打开是空白，点一下才出现）
    requestAnimationFrame(() => moveNavIndicator(document.querySelector('.nav-item.active')));
    // 语音服务探测：没接入时课程页会显示「暂未启用」，而不是给个点了没反应的按钮
    // ★ typeof 保护：speech.js 若未加载，这里不能抛错（否则整个 init 中断 → 白屏）
    try {
      if (typeof Speech !== 'undefined' && Speech.check) {
        Speech.check(true).then(() => {
          const page = $('page-course');
          if (page && page.classList.contains('active')) renderCourse();
        }).catch(() => {});
      }
    } catch (e) { console.warn('[学徒] 语音探测失败（不影响使用）:', e); }
        // ★ 数据安全：挂上自动备份（数据变化 → 防抖 20 秒 → 写盘）
    try {
      if (typeof BackupGuard !== 'undefined') BackupGuard.init();
    } catch (e) { console.warn('备份模块初始化失败（不影响使用）:', e); }

    /**
     * ★ DeepTutor 深度辅导（2026-10-18）
     *   和「快速问答」并列，不互相取代。
     *   初始化失败不影响原有功能。
     */
    try {
      if (typeof DeepTutorUI !== 'undefined') DeepTutorUI.init();
    } catch (e) { console.warn('DeepTutor 初始化失败（不影响使用）:', e); }

    /**
     * ★ 数据打通中心（2026-10-24）
     *   设置页里的同步面板。初始化失败不影响主程序。
     */
    try {
      if (typeof DTHub !== 'undefined') DTHub.init();
    } catch (e) { console.warn('数据打通中心初始化失败:', e); }

    /**
     * ★ 复习 UI（2026-10-24）
     *   今日复习 + 错题本筛选。初始化失败不影响其它功能。
     */
    try {
      if (typeof ReviewUI !== 'undefined') ReviewUI.init();

    // ★ 初始化推理能力测试（2026-10-31）
    try {
      if (typeof AptitudeUI !== "undefined" && AptitudeUI.mount) {
        AptitudeUI.mount();
        console.log("[aptitude] AptitudeUI.mount() 已调用");
      } else {
        console.warn("[aptitude] AptitudeUI 或 mount 不存在");
      }
    } catch (e) {
      console.error("[aptitude] mount 失败:", e);
    }
    } catch (e) { console.warn('复习 UI 初始化失败:', e); }

console.log('[学徒] 初始化完成');
  }

  return {
    init, navigate, toast, remember,
    renderDashboard, renderPlanner, renderQuiz, renderChat, renderPhoto,
    renderCamera, renderProgress, renderWeakness, renderImport, renderSettings,
    renderCourse, createCourse,
    courseFromProblem,
    generatePlan, generateQuiz, submitQuiz, toggleTask,
    analyzeUpload, runSubjectAnalyses, analyzeSubject, analyzeTotal,
    estimateProgress, currentEstimate, baselineScore, allSixSubjects, daysToExam,
    unlockStatus, PAPERS_PER_SUBJECT,
    renderTextbookRows, collectTextbookRows, saveTextbookRows,
    renderTextbookSummary, textbookSummaryText, persistTextbook, wizardSixSubjects,
    addImportRow, submitImport, delImport, exportData, clearLearningData,
    // 拍照读题
    photoAddFiles, analyzePhoto, photoClear, photoExplain, photoPractice,
    addPhotoMistakes, photoToImport,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
