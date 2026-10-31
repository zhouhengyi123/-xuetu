/**
 * 统一辅导入口（2026-10-31 新增）
 *
 * ══════════════════════════════════════════════════════════════
 * 用户原话
 * ══════════════════════════════════════════════════════════════
 * "AI 辅导三合一"
 * "看似有好几个 AI，其实是一个"
 * 学生关心的不是底层用哪个引擎，而是"讲懂这道题/补这章/查我会不会/做个演示"
 *
 * ══════════════════════════════════════════════════════════════
 * 设计
 * ══════════════════════════════════════════════════════════════
 * 一个输入框 + 四个意图按钮。路由规则：
 *
 *   讲一道题   → 优先深度辅导（DeepTutor 先探索学情再讲，
 *                适合啃难题）；DeepTutor 不在线 → 快速问答+档案
 *   补一个知识点 → 优先深度辅导（讲-例-练-测）；离线 → 快速问答
 *   检查我会不会 → Agent（get_student_data + run_code 出小测，
 *                或直接路由到 AI 出卷）
 *   做教学演示   → Agent（make_chart / make_3d_scene / make_animation
 *                / export_video —— 只有 Agent 有这些手）
 *
 * 任何意图都自动带上 StudentProfile.brief() —— 同一份记忆。
 * 需要切底层时，用一句话告诉用户为什么（不藏着）。
 */
const TutorHub = (() => {

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const INTENTS = [
    {
      id: 'explain',
      label: '讲一道题',
      hint: '把题目发过来，我一步步讲',
      placeholder: '把不会的题打出来（或拍好的题目文字）…',
      route: 'deep',
    },
    {
      id: 'learn',
      label: '补一个知识点',
      hint: '哪个知识点不懂，我带你过一遍',
      placeholder: '想补什么？如：导数的几何意义 / 电磁感应…',
      route: 'deep',
    },
    {
      id: 'check',
      label: '检查我会不会',
      hint: '出几道题考考你',
      placeholder: '想检查哪块？如：圆锥曲线 / 动量守恒…',
      route: 'agent',
    },
    {
      id: 'demo',
      label: '做个演示',
      hint: '画图、3D、动画，看得见的讲解',
      placeholder: '想看什么？如：正方体内切球 3D / 正弦波动画…',
      route: 'agent',
    },
  ];

  let currentIntent = 'explain';
  let busy = false;

  // ══════════════════════════════════════════════════
  //  渲染
  // ══════════════════════════════════════════════════

  function render() {
    const box = $('tutorhub-body');
    if (!box) return;
    box.innerHTML = '';

    // 意图选择条
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px';
    INTENTS.forEach(it => {
      const b = document.createElement('button');
      b.className = 'btn btn-sm ' + (currentIntent === it.id ? 'btn-primary' : 'btn-secondary');
      b.textContent = it.label;
      b.title = it.hint;
      b.addEventListener('click', () => {
        currentIntent = it.id;
        render();
      });
      bar.appendChild(b);
    });
    box.appendChild(bar);

    // 输入区
    const wrap = document.createElement('div');
    const cur = INTENTS.find(x => x.id === currentIntent) || INTENTS[0];

    wrap.innerHTML =
      '<div style="font-size:13px;color:var(--label-secondary);margin-bottom:8px">' + esc(cur.hint) + '</div>' +
      '<div style="display:flex;gap:10px">' +
      '<textarea id="tutorhub-input" rows="2" placeholder="' + esc(cur.placeholder) + '" ' +
      'style="flex:1;min-height:52px;max-height:160px;resize:none"></textarea>' +
      '<button class="btn btn-primary" id="tutorhub-send" style="height:52px;min-width:72px">开始</button>' +
      '</div>' +
      '<div id="tutorhub-route" class="hint" style="margin-top:8px;min-height:16px;font-size:11.5px"></div>' +
      '<div id="tutorhub-out" style="margin-top:14px"></div>';

    box.appendChild(wrap);

    const input = $('tutorhub-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      input.focus();
    }
    const btn = $('tutorhub-send');
    if (btn) btn.addEventListener('click', send);

    showRoute(cur).catch(function(){});   // 异步刷新，不阻塞渲染
  }

  async function showRoute(it) {
    const el = $('tutorhub-route');
    if (!el) return;

    const know = (typeof StudentProfile !== 'undefined') ? StudentProfile.knowsStudent() : null;
    // ★ 文案砍短、不劝退（2026-10-31）
    // 旧版"回答可能偏泛"——用户还没问就被劝退了。
    const knowHint = (know && know.score < 35)
      ? ' · 先传份卷子，我会更懂你'
      : '';

    if (it.route === 'deep') {
      el.textContent = '正在检查深度辅导服务…';

      /**
       * ★ 探测 + 延迟重试（2026-10-31）
       * 服务刚启动时第一次探测可能失败（进程在起但端口未就绪）。
       * 不要求用户刷新页面 —— 后台自动重试 3 次，成功后更新文案。
       */
      let online = await DTOnlineLive();
      let tries = 0;
      while (!online && tries < 3) {
        tries++;
        await new Promise(r => setTimeout(r, 4000));
        if (!el.isConnected) return;
        online = await DTOnlineLive();
      }
      if (!el.isConnected) return;

      el.textContent = online
        ? '深度辅导：先看你的情况再讲（约 20 秒）' + knowHint
        : '深度辅导未连上，改用快速问答（同样带你的档案）' + knowHint;
    } else if (it.route === 'agent') {
      el.textContent = 'Agent：能画图、做 3D、跑计算' + knowHint;
    }
  }

  /** 同步读缓存状态（仅用于立刻显示） */
  function DTOnline() {
    try { return !!(window.DTChat && DTChat.status && DTChat.status().connected); }
    catch (e) { return false; }
  }

  /**
   * ★ 实时探测（2026-10-31 修）
   * 页面刚渲染时 DTChat 还没连，缓存是 false ——
   * 只看缓存会把「深度辅导可用」误判成「不可用」，路由到快速问答。
   * 这里真的去连一次。
   */
  async function DTOnlineLive() {
    try {
      if (typeof DTChat === 'undefined' || !DTChat.connect) return false;
      const r = await DTChat.connect();
      return !!(r && r.ok);
    } catch (e) { return false; }
  }

  // ══════════════════════════════════════════════════
  // 发送（统一入口 → 自动路由）
  // ══════════════════════════════════════════════════

  async function send() {
    if (busy) return;
    const input = $('tutorhub-input');
    const out = $('tutorhub-out');
    if (!input || !out) return;
    const text = input.value.trim();
    if (!text) return;

    const it = INTENTS.find(x => x.id === currentIntent) || INTENTS[0];
    const brief = (typeof StudentProfile !== 'undefined') ? StudentProfile.brief() : '';

    busy = true;
    input.value = '';
    const btn = $('tutorhub-send');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    // ★ 记入统一记忆（2026-10-31）
    try {
      if (typeof Memory !== 'undefined') {
        Memory.addTurn({ by: 'student', ai: currentIntent, text: text });
      }
    } catch (e) {}

    // 用户消息
    out.innerHTML =
      '<div style="display:flex;gap:10px;margin-bottom:12px;flex-direction:row-reverse">' +
      '<div style="width:28px;height:28px;border-radius:50%;background:var(--bg-overlay);color:var(--label-secondary);' +
      'display:flex;align-items:center;justify-content:center;font-size:12px">我</div>' +
      '<div style="max-width:82%;padding:10px 14px;border-radius:12px;background:var(--accent);color:#fff;' +
      'font-size:13.5px;line-height:1.7;white-space:pre-wrap">' + esc(text) + '</div></div>' +
      '<div id="tutorhub-ans" style="min-height:40px"><span class="spinner"></span> ' +
      (it.route === 'deep' && DTOnline() ? '正在结合你的学情思考…' : '处理中…') + '</div>';

    const ansBox = $('tutorhub-ans');

    try {
      let answer = '';
      let engine = '';

      // ── 路由（2026-10-31：实时探测，不信缓存）──
      const deepOk = (it.route === 'deep') ? await DTOnlineLive() : false;

      if (it.route === 'deep' && deepOk) {
        engine = '深度辅导';
        if (ansBox) ansBox.innerHTML = '<span class="spinner"></span> 深度辅导正在结合你的学情思考…';
        const r = await DTChat.ask(text + '\n\n（请全程用简体中文回答，不要说英文。）', {});
        answer = (r && r.answer) || '';
        if (!r || !r.ok) {
          // 深度辅导失败 → 降级快速问答，并告诉用户
          engine = '快速问答（深度辅导刚才没答上来）';
          if (ansBox) ansBox.innerHTML = '<span class="spinner"></span> 换成快速问答重试…';
          answer = await quickAsk(text, brief);
        }
      } else if (it.route === 'agent') {
        engine = 'Agent';
        const r = await runAgent(text, it, brief);
        answer = r;
      } else {
        engine = '快速问答';
        answer = await quickAsk(text, brief);
      }

      // ★ 记 AI 回答
      try {
        if (typeof Memory !== 'undefined') {
          Memory.addTurn({ by: 'ai', ai: currentIntent, text: String(answer || '').slice(0, 200) });
        }
      } catch (e) {}

      ansBox.innerHTML =
        '<div style="display:flex;gap:10px">' +
        '<div style="width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;' +
        'display:flex;align-items:center;justify-content:center;font-size:12px">师</div>' +
        '<div style="flex:1;padding:12px 15px;border-radius:12px;background:var(--bg-layer-2);' +
        'font-size:13.5px;line-height:1.85;white-space:pre-wrap;word-break:break-word">' +
        mdLite(answer) +
        '<div style="margin-top:8px;font-size:11px;color:var(--label-tertiary)">—— ' + esc(engine) + '</div>' +
        '</div></div>';
    } catch (e) {
      ansBox.innerHTML = '<div style="color:var(--red);font-size:13px;padding:10px">出错了：' + esc(e.message) + '</div>';
    } finally {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = '开始'; }
    }
  }

  /** 快速问答（带共享档案） */
  async function quickAsk(text, brief) {
    const cfg = (typeof LLM !== 'undefined') ? LLM.getConfig() : null;
    if (!cfg || !cfg.apiKey) throw new Error('没有配置 AI 接口，请到设置页检查');

    const sys = [
      '你是「学徒」，这位学生的全程老师。直接、具体、给可执行的下一步。',
      '',
      brief,
    ].join('\n');

    const r = await LLM.chat([{ role: 'system', content: sys }, { role: 'user', content: text }]);
    return r || '';
  }

  /** Agent（带共享档案 + 意图化提示） */
  async function runAgent(text, it, brief) {
    const bridge = (typeof window !== 'undefined') ? window.agentBridge : null;
    if (!bridge) throw new Error('Agent 只在桌面应用里可用');

    const cfg = (typeof LLM !== 'undefined') ? LLM.getConfig() : null;
    if (!cfg || !cfg.apiKey) throw new Error('没有配置 AI 接口');

    const intentHint = {
      check: '学生想检查自己会不会某块知识。先调 get_student_data 看他的档案，然后' +
        '出一组 3~5 道由易到难的小题（直接在回答里给题，让他做完发回来，你再判）。',
      demo: '学生想要看得见的演示。根据内容选最合适的工具：' +
        '结构/模型 → make_3d_scene；变化过程 → make_animation；数据对比 → make_chart；' +
        '需要留视频 → 先做动画再 export_video。',
      explain: '学生想让你讲一道题。先调 get_student_data 了解他的水平，再分步讲。',
      learn: '学生想补一个知识点。先调 get_student_data，按他的起点讲。',
    }[it.id] || '';

    const sys = [
      '你是「学徒」，这位学生的全程老师。',
      intentHint,
      '',
      brief,
    ].join('\n');

    const r = await bridge.run({
      apiKey: cfg.apiKey,
      model: cfg.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
    });

    if (!r || !r.ok) throw new Error((r && r.error) || 'Agent 没返回结果');

    let extra = '';
    if (r.toolCalls && r.toolCalls.length) {
      const names = r.toolCalls.map(t => t.name);
      extra = '\n\n（用了工具：' + names.join('、') + '）';
    }
    return (r.answer || '') + extra;
  }

  /** 轻量 markdown */
  function mdLite(s) {
    let h = esc(s);
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/^### (.+)$/gm, '<div style="font-weight:650;margin:8px 0 4px">$1</div>');
    h = h.replace(/^## (.+)$/gm, '<div style="font-weight:700;font-size:14px;margin:10px 0 5px">$1</div>');
    h = h.replace(/`([^`]+)`/g, '<code style="background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;font-size:12.5px">$1</code>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  function init() { render(); }

  return { init, render, send };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TutorHub;
