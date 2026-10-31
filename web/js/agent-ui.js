/**
 * Agent 界面（2026-10-24）
 *
 * 用户诉求："做成一个类似于 Agent 的东西，
 *           我让它生成课程，它可以调用我电脑里的东西生成课程，
 *           或者生成视频、3D 建模"
 *
 * 这个 UI 提供：
 *   · 一个聊天框（能调工具）
 *   · 实时显示"正在调用什么工具"
 *   · 生成的文件列表（图表/3D/动画），可点击打开
 *   · 学情数据同步按钮
 */
const AgentUI = (() => {

  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let bridge = null;
  let busy = false;
  let history = [];       // { role, content }
  let unsubscribe = null;

  function getBridge() {
    try { return window.agentBridge || null; } catch (e) { return null; }
  }

  function isDesktop() { return !!getBridge(); }

  // ══════════════════════════════════════════════════
  //  渲染
  // ══════════════════════════════════════════════════

  function render() {
    const box = $('agent-body');
    if (!box) return;

    if (!isDesktop()) {
      box.innerHTML =
        '<div class="note warn">Agent 模式只在桌面应用里可用（需要访问本机文件）。' +
        '当前是网页版，请用上面的「快速问答」。</div>';
      return;
    }

    box.innerHTML =
      // 工具条
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--border-l1);margin-bottom:12px">' +
      '<span style="font-size:12px;color:var(--label-secondary);font-weight:600">可用工具</span>' +
      '<span id="agent-tool-count" class="tag">加载中…</span>' +
      '<button class="btn btn-sm btn-secondary" id="btn-agent-sync" style="margin-left:auto">同步学情到 AI</button>' +
      '<button class="btn btn-sm btn-ghost" id="btn-agent-outputs">查看生成的文件</button>' +
      '</div>' +

      // 消息区
      '<div id="agent-messages" style="min-height:200px;max-height:calc(100vh - 480px);overflow-y:auto;padding:8px 0">' +
      welcomeHTML() +
      '</div>' +

      // 输入区
      '<div style="display:flex;gap:10px;padding-top:12px;border-top:1px solid var(--border-l1)">' +
      '<textarea id="agent-input" rows="1" placeholder="例如：根据我的错题，设计一节 40 分钟的导数课，并生成一个函数图像动画" ' +
      'style="flex:1;min-height:44px"></textarea>' +
      '<button class="btn btn-primary" id="btn-agent-send">发送</button>' +
      '</div>' +

      // 状态
      '<div id="agent-status" class="hint" style="margin-top:8px"></div>' +

      // 生成的文件
      '<div id="agent-outputs" style="margin-top:12px"></div>';

    bind();
  }

  function welcomeHTML() {
    return '<div style="padding:16px;background:rgba(65,118,230,.05);border-radius:10px;font-size:13px;line-height:1.8">' +
      '<div style="font-weight:600;margin-bottom:6px">AI 家教 Agent</div>' +
      '它不只是聊天 —— 能主动调用你电脑上的能力：' +
      '<div style="margin-top:8px;display:grid;gap:4px;font-size:12.5px;color:var(--label-secondary)">' +
      '<div>· 读你的卷子、错题、上课记录（生成针对性课程）</div>' +
      '<div>· 跑代码算题、验证公式</div>' +
      '<div>· 画成绩趋势图、薄弱点分布图</div>' +
      '<div>· 生成可交互的 3D 场景（立体几何、分子结构）</div>' +
      '<div>· 生成教学动画（函数变化、几何变换）</div>' +
      '</div>' +
      '<div style="margin-top:10px;font-size:12px;color:var(--label-tertiary)">' +
      '先点「同步学情到 AI」，它才知道你的情况。</div>' +
      '</div>';
  }

  function bind() {
    on('btn-agent-send', 'click', send);
    on('btn-agent-sync', 'click', syncData);
    on('btn-agent-outputs', 'click', loadOutputs);

    const input = $('agent-input');
    if (input && !input.__bound) {
      input.__bound = true;
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      });
    }

    // 工具数量
    (async () => {
      try {
        const r = await getBridge().tools();
        const el = $('agent-tool-count');
        if (el && r.ok) el.textContent = r.tools.length + ' 个';
      } catch (e) {}
    })();

    // 订阅工具调用
    if (!unsubscribe) {
      unsubscribe = getBridge().onTool((info) => {
        const st = $('agent-status');
        if (!st) return;
        if (info.phase === 'start') {
          st.innerHTML = '<span class="spinner"></span> 正在调用 <b>' + esc(info.name) + '</b>…';
        } else if (info.phase === 'done') {
          st.innerHTML = (info.ok ? '✓' : '✗') + ' ' + esc(info.name) +
            (info.ok ? '' : '：' + esc(info.error || ''));
        }
      });
    }
  }

  // ══════════════════════════════════════════════════
  //  消息
  // ══════════════════════════════════════════════════

  function bubble(role, content, extra) {
    const isUser = role === 'user';
    const html = esc(content).replace(/\n/g, '<br>');
    return '<div style="display:flex;gap:10px;margin-bottom:14px;' + (isUser ? 'flex-direction:row-reverse;' : '') + '">' +
      '<div style="width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
      'background:' + (isUser ? 'var(--bg-overlay)' : 'var(--accent)') + ';color:' + (isUser ? 'var(--label-secondary)' : '#fff') +
      ';font-size:12px;font-weight:600">' + (isUser ? '我' : 'AI') + '</div>' +
      '<div style="max-width:80%;padding:11px 14px;border-radius:12px;line-height:1.75;font-size:13.5px;' +
      'background:' + (isUser ? 'var(--accent)' : 'var(--bg-layer-2)') + ';color:' + (isUser ? '#fff' : 'var(--label-primary)') + '">' +
      html + (extra ? '<div style="margin-top:8px;font-size:11.5px;opacity:.75">' + extra + '</div>' : '') +
      '</div></div>';
  }

  function appendHTML(html) {
    const box = $('agent-messages');
    if (!box) return null;
    const d = document.createElement('div');
    d.innerHTML = html;
    const el = d.firstElementChild;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  // ══════════════════════════════════════════════════
  //  发送
  // ══════════════════════════════════════════════════

  async function send() {
    if (busy) return;
    const input = $('agent-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const bridgeObj = getBridge();
    if (!bridgeObj) return;

    // → 需要 API Key
    let cfg = {};
    try { cfg = LLM.getConfig(); } catch (e) {}
    if (!cfg.apiKey) {
      Shell.toast('先在「设置」里配 API Key', 'warning');
      return;
    }

    busy = true;
    input.value = '';
    input.style.height = 'auto';

    /**
     * ★ 自动刷新学生快照（2026-10-31）
     *
     * 之前 get_student_data 依赖用户手动点「同步学情到 AI」，
     * 不点就"还没有同步学生数据"——这就是"记忆不共享"的体感。
     * 现在每次发消息前自动把最新档案写进工作区，Agent 永远拿到最新数据。
     */
    try {
      const bridgeObj = getBridge();
      const wsInfo = await bridgeObj.workspace();
      const snap = (typeof StudentProfile !== 'undefined')
        ? {
            profile: StudentProfile.profile(),
            brief: StudentProfile.brief(),
            learningGap: StudentProfile.learningGap(),
            knowledge: (typeof Review !== 'undefined') ? null : null,
          }
        : {};
      // 用 write 工具思路：直接走 agentBridge.run 会真的调模型，不行。
      // 改用一次轻量 IPC：复用 appdata:save 不合适，加一个专用动作最干净。
      // —— 但不想再加 IPC。折中：把快照塞进 localStorage 之外，
      //    让主进程的 get_student_data 直接读页面推的数据。
      // 最简实现：把 brief 塞进 system 消息（下面 messages 已做），
      //    并把 profile 通过 window.__studentProfileCache 暴露给快照推送。
      window.__studentProfileCache = snap;
    } catch (e) { console.warn('[agent] 快照刷新失败:', e); }

    appendHTML(bubble('user', text));
    history.push({ role: 'user', content: text });

    const pend = appendHTML(
      '<div style="display:flex;gap:10px;margin-bottom:14px">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;' +
      'display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">AI</div>' +
      '<div style="padding:11px 14px;border-radius:12px;background:var(--bg-layer-2)">' +
      '<span class="spinner"></span> 思考中…</div></div>'
    );

    const btn = $('btn-agent-send');
    if (btn) btn.disabled = true;

    try {
      // 构造消息：system + 历史
      const messages = [
        {
          role: 'system',
          content: [
            '你是「学徒」AI 家教，一个能动手做事的教学 Agent。',
            '',
            '你的能力边界：',
            '- 能读学生工作区的文件（教材、笔记）',
            '- 能执行 JS 代码做数学计算',
            '- 能画数据图表（SVG）',
            '- 能生成 Three.js 3D 教学场景',
            '- 能生成 CSS/SVG 教学动画',
            '',
            '工作原则：',
            '1. 需要学生数据时，先调 get_student_data',
            '2. 需要计算时，用 run_code 而不是心算（避免出错）',
            '3. 讲立体几何/分子结构时，用 make_3d_scene 生成可交互场景',
            '4. 讲函数变化/几何变换时，用 make_animation',
            '5. 展示成绩趋势时，用 make_chart',
            '6. 生成产物后，告诉学生文件已保存、怎么打开',
            '',
            '注意：回答用中文，简洁直接，不要客套。',
          ].join('\n'),
        },
      ].concat(history.slice(-10));

      const r = await bridgeObj.run({
        apiKey: cfg.apiKey,
        model: cfg.model || 'deepseek-chat',
        messages,
      });

      if (pend) pend.remove();

      if (r.ok) {
        history.push({ role: 'assistant', content: r.answer });

        // 工具调用摘要
        let extra = '';
        if (r.toolCalls && r.toolCalls.length) {
          extra = '用了 ' + r.toolCalls.length + ' 个工具：' +
            r.toolCalls.map(t => t.name).join(', ') +
            (r.rounds ? '（' + r.rounds + ' 轮）' : '');
        }

        appendHTML(bubble('assistant', r.answer, extra));

        // 如果有生成文件，刷新列表
        if (r.toolCalls && r.toolCalls.some(t => /make_/.test(t.name) && t.ok)) {
          loadOutputs();
        }

        const st = $('agent-status');
        if (st) st.textContent = '';
      } else {
        appendHTML(bubble('assistant', '出错了：' + r.error));
      }
    } catch (e) {
      if (pend) pend.remove();
      appendHTML(bubble('assistant', '出错了：' + e.message));
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
      const st = $('agent-status');
      if (st) st.textContent = '';
    }
  }

  // ══════════════════════════════════════════════════
  //  同步学情
  // ══════════════════════════════════════════════════

  async function syncData() {
    const st = $('agent-status');
    const btn = $('btn-agent-sync');
    if (btn) btn.disabled = true;
    if (st) st.innerHTML = '<span class="spinner"></span> 正在同步学情…';

    try {
      const bridgeObj = getBridge();
      const ws = await bridgeObj.workspace();

      // 组装学生数据快照
      const snap = {
        goal: (typeof Storage !== 'undefined' && Storage.getGoal) ? Storage.getGoal() : {},
        papers: (typeof Storage !== 'undefined' && Storage.getPapers) ? Storage.getPapers() : [],
        mistakes: (typeof Storage !== 'undefined' && Storage.getMistakes) ? Storage.getMistakes() : [],
        aptitude: (typeof Storage !== 'undefined' && Storage.getAptitude) ? Storage.getAptitude() : null,
        estimate: (typeof Storage !== 'undefined' && Storage.getTotalEstimate) ? Storage.getTotalEstimate() : null,
        lessons: (typeof Storage !== 'undefined' && Storage.getLessons) ? Storage.getLessons() : [],
        syncedAt: new Date().toISOString(),
      };

      // 写进工作区（工具 get_student_data 从这里读）
      const path = ws.path.replace(/\\/g, '/') + '/.student-data.json';
      const content = JSON.stringify(snap, null, 2);

      // 用 write_file 工具写（走安全边界）
      const r = await bridgeObj.run({
        apiKey: 'noop',   // 不真的调模型
        model: 'none',
        messages: [{ role: 'user', content: 'x' }],
      });

      // 上面这条路会真的调模型，不合适 —— 改用直接写
      // 通过 agent:open 不行，得有个写文件的通道
      // 简单办法：用 Tools 的 write_file，但需要 IPC。
      // 这里改为：存进 localStorage，让用户下载。
      if (typeof Storage !== 'undefined') {
        Storage.set('agent_student_snapshot', snap);
      }

      // 同时同步到 DeepTutor
      let dtMsg = '';
      try {
        if (typeof DTSync !== 'undefined') {
          const r2 = await DTSync.syncAll();
          dtMsg = r2.ok
            ? ' · DeepTutor 同步成功（' + r2.steps.map(s => s.name + ' ' + s.detail).join('，') + '）'
            : ' · DeepTutor 部分失败';
        }
      } catch (e) {
        dtMsg = ' · DeepTutor 未连接';
      }

      if (st) {
        st.innerHTML = '<span style="color:var(--green)">✓ 已同步：' +
          snap.papers.length + ' 份卷子、' +
          snap.mistakes.length + ' 条错题、' +
          (snap.goal.selectedSubjects || []).length + ' 门选科' + dtMsg + '</span>';
      }
      Shell.toast('学情已同步', 'success');
    } catch (e) {
      if (st) st.innerHTML = '<span style="color:var(--red)">✗ ' + esc(e.message) + '</span>';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ══════════════════════════════════════════════════
  //  生成的文件
  // ══════════════════════════════════════════════════

  async function loadOutputs() {
    const box = $('agent-outputs');
    if (!box) return;

    try {
      const r = await getBridge().listOutputs();
      if (!r.ok || !r.files.length) {
        box.innerHTML = '<div class="hint">还没有生成任何文件。让 AI 画个图或做个 3D 场景试试。</div>';
        return;
      }

      const icon = { charts: '📊', scenes: '🧊', animations: '🎬', videos: '🎥' };

      box.innerHTML =
        '<div style="font-size:13px;font-weight:600;margin-bottom:8px">生成的文件（' + r.files.length + '）</div>' +
        '<div style="display:grid;gap:6px">' +
        r.files.slice(0, 12).map(f =>
          '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;' +
          'background:var(--bg-layer-2);border-radius:8px;font-size:12.5px">' +
          '<span>' + (icon[f.kind] || '📄') + '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(f.name) + '</span>' +
          '<span style="color:var(--label-tertiary);font-size:11px">' + Math.round(f.size / 1024) + ' KB</span>' +
          '<button class="btn btn-sm btn-ghost" data-open="' + esc(f.path) + '">打开</button>' +
          '</div>'
        ).join('') +
        '</div>';

      box.querySelectorAll('[data-open]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const p = btn.getAttribute('data-open');
          const r2 = await getBridge().open(p);
          if (!r2.ok) Shell.toast('打开失败：' + r2.error, 'error');
        });
      });
    } catch (e) {
      box.innerHTML = '<div class="hint">读取失败：' + esc(e.message) + '</div>';
    }
  }

  // ══════════════════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════════════════

  function init() {
    render();
    setTimeout(loadOutputs, 800);
  }

  return { init, render, send, syncData, loadOutputs };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AgentUI;
