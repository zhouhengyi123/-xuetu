/**
 * 深度辅导 UI（2026-10-24 重写：iframe → 原生 WebSocket）
 *
 * 用户原话："你这个完全就是一个非常拉的接入，现在就是没什么接入"
 *
 * 之前：iframe 塞整个 DeepTutor 网页，两套侧栏并列，视觉割裂。
 * 现在：WebSocket 直连，用学徒自己的气泡样式，流式打字。
 */
const DeepTutorUI = (() => {

  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let currentMode = 'tutorhub';     // 'tutorhub'(默认统一入口) | 'quick' | 'agent' | 'deep'
  let busy = false;
  let initialized = false;
  let history = [];                 // [{role, content}]

  // ══════════════════════════════════════
  //  渲染
  // ══════════════════════════════════════

  function renderMessage(role, content, extra) {
    const isUser = role === 'user';
    return '<div class="dt-msg" style="display:flex;gap:10px;margin-bottom:16px;' +
      (isUser ? 'flex-direction:row-reverse;' : '') + '">' +
      '<div style="width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;' +
      'justify-content:center;font-size:12px;font-weight:600;' +
      'background:' + (isUser ? 'var(--bg-overlay)' : 'var(--accent)') + ';' +
      'color:' + (isUser ? 'var(--label-secondary)' : '#fff') + '">' + (isUser ? '我' : '深') + '</div>' +
      '<div style="max-width:82%;padding:11px 15px;border-radius:12px;line-height:1.8;font-size:13.5px;' +
      'white-space:pre-wrap;word-break:break-word;' +
      'background:' + (isUser ? 'var(--accent)' : 'var(--bg-layer-2)') + ';' +
      'color:' + (isUser ? '#fff' : 'var(--label-primary)') + '">' +
      formatContent(content) +
      (extra ? '<div style="margin-top:8px;font-size:11px;opacity:.7">' + esc(extra) + '</div>' : '') +
      '</div></div>';
  }

  /**
   * 轻量 markdown + 数学渲染（2026-10-24）
   *
   * DeepTutor 的回答里大量使用：
   *   · **粗体**
   *   · `行内代码`
   *   · ## 小标题
   *   · $行内公式$ 和 $$块级公式$$
   *   · 列表、引用
   *
   * 不引入 MathJax/KaTeX（那要额外 300KB+ 且离线不可用），
   * 这里做**可读性降级**：把 LaTeX 转成人能看的样子。
   *   $k^2=4$      → k² = 4
   *   \frac{a}{b}  → (a)/(b)
   *   \sqrt{x}     → √(x)
   *   \Delta       → Δ
   */
  function formatContent(s) {
    let h = esc(s);

    // ── 先处理数学（在 escape 之后，所以 \ 还在）──

    // 块级公式 $$...$$ → 居中等宽显示
    h = h.replace(/\$\$([\s\S]+?)\$\$/g, (match, expr) => {
      return '<div style="margin:10px 0;padding:10px 14px;background:rgba(0,0,0,.035);' +
        'border-radius:7px;font-family:ui-monospace,Consolas,monospace;font-size:13px;' +
        'overflow-x:auto;line-height:1.7">' + tidyLatex(expr) + '</div>';
    });

    // 行内公式 $...$ → 等宽高亮
    h = h.replace(/\$([^$\n]+?)\$/g, (match, expr) => {
      return '<code style="background:rgba(65,118,230,.08);color:#1e40af;' +
        'padding:1px 5px;border-radius:4px;font-family:ui-monospace,Consolas,monospace;' +
        'font-size:12.8px">' + tidyLatex(expr) + '</code>';
    });

    // ── markdown ──

    // 小标题
    h = h.replace(/^### (.+)$/gm, '<div style="font-size:13.5px;font-weight:650;margin:12px 0 6px">$1</div>');
    h = h.replace(/^## (.+)$/gm, '<div style="font-size:14.5px;font-weight:650;margin:14px 0 7px">$1</div>');
    h = h.replace(/^# (.+)$/gm, '<div style="font-size:15.5px;font-weight:700;margin:14px 0 8px">$1</div>');

    // 粗体、行内代码
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/`([^`]+)`/g,
      '<code style="background:rgba(0,0,0,.06);padding:1px 5px;border-radius:4px;font-size:12.5px">$1</code>');

    // 引用
    h = h.replace(/^&gt; (.+)$/gm,
      '<div style="border-left:3px solid var(--border-l2);padding-left:10px;' +
      'margin:8px 0;color:var(--label-secondary);font-size:13px">$1</div>');

    // 分隔线
    h = h.replace(/^---+$/gm, '<hr style="border:none;border-top:1px solid var(--border-l1);margin:12px 0">');

    // 列表
    h = h.replace(/^[-*] (.+)$/gm, '<div style="padding-left:16px;text-indent:-10px">· $1</div>');
    h = h.replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:18px;text-indent:-14px">$1. $2</div>');

    // 换行
    h = h.replace(/\n/g, '<br>');

    return h;
  }

  /** 把常见 LaTeX 转成可读文本 */
  function tidyLatex(expr) {
    let t = String(expr || '');

    // \frac{a}{b} → (a)/(b)
    t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    t = t.replace(/\\dfrac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
    t = t.replace(/\\tfrac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');

    // \sqrt{x} → √(x)
    t = t.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');

    // 希腊字母
    const greek = {
      alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ',
      epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
      lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
      phi: 'φ', varphi: 'φ', omega: 'ω', Omega: 'Ω', Sigma: 'Σ',
    };
    Object.keys(greek).forEach(k => {
      t = t.replace(new RegExp('\\\\' + k + '\\b', 'g'), greek[k]);
    });

    // 运算符
    t = t.replace(/\\times/g, '×').replace(/\\div/g, '÷')
      .replace(/\\cdot/g, '·').replace(/\\pm/g, '±')
      .replace(/\\leq/g, '≤').replace(/\\geq/g, '≥')
      .replace(/\\neq/g, '≠').replace(/\\approx/g, '≈')
      .replace(/\\infty/g, '∞').replace(/\\to/g, '→')
      .replace(/\\Rightarrow/g, '⇒').replace(/\\Leftarrow/g, '⇐')
      .replace(/\\perp/g, '⊥').replace(/\\parallel/g, '∥')
      .replace(/\\angle/g, '∠').replace(/\\triangle/g, '△')
      .replace(/\\sum/g, 'Σ').replace(/\\int/g, '∫')
      .replace(/\\ln/g, 'ln').replace(/\\log/g, 'log')
      .replace(/\\sin/g, 'sin').replace(/\\cos/g, 'cos').replace(/\\tan/g, 'tan');

    // 上标：x^2 → x²；x^{2} → x²
    const sup = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
    t = t.replace(/\^\{([^{}]+)\}/g, (m, g) => {
      if (/^[0-9]+$/.test(g)) return g.split('').map(c => sup[c] || c).join('');
      return '^(' + g + ')';
    });
    t = t.replace(/\^([0-9])/g, (m, d) => sup[d] || d);
    t = t.replace(/\^([a-zA-Z])/g, '^$1');

    // 下划线：x_1 → x₁
    const sub = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
    t = t.replace(/_\{([^{}]+)\}/g, (m, g) => {
      if (/^[0-9]+$/.test(g)) return g.split('').map(c => sub[c] || c).join('');
      return '[' + g + ']';
    });
    t = t.replace(/_([0-9])/g, (m, d) => sub[d] || d);

    // 清理剩余反斜杠命令
    t = t.replace(/\\text\{([^{}]*)\}/g, '$1');
    t = t.replace(/\\mathrm\{([^{}]*)\}/g, '$1');
    t = t.replace(/\\left|\\right/g, '');
    t = t.replace(/\\([a-zA-Z]+)/g, '$1');   // 兜底：去掉反斜杠
    t = t.replace(/[{}]/g, '');              // 去掉多余花括号

    return t;
  }

  function appendMsg(html) {
    const box = $('deep-messages');
    if (!box) return null;
    const welcome = $('deep-welcome');
    if (welcome) welcome.remove();

    const d = document.createElement('div');
    d.innerHTML = html;
    const el = d.firstElementChild;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
    return el;
  }

  function setStage(text) {
    const st = $('deep-stage');
    if (st) st.innerHTML = text ? '<span class="spinner"></span> ' + esc(text) : '';
  }

  // ══════════════════════════════════════
  //  发送
  // ══════════════════════════════════════

  async function send() {
    if (busy) return;

    const input = $('deep-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (typeof DTChat === 'undefined') {
      setStage('深度辅导模块未加载');
      return;
    }

    busy = true;
    input.value = '';
    input.style.height = 'auto';

    appendMsg(renderMessage('user', text));
    history.push({ role: 'user', content: text });

    // 占位气泡（流式填充）
    const holder = appendMsg(
      '<div style="display:flex;gap:10px;margin-bottom:16px">' +
      '<div style="width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;' +
      'display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600">深</div>' +
      '<div class="dt-stream" style="max-width:82%;padding:11px 15px;border-radius:12px;line-height:1.8;' +
      'font-size:13.5px;background:var(--bg-layer-2);white-space:pre-wrap;word-break:break-word">' +
      '<span class="spinner"></span> <span style="color:var(--label-tertiary)">思考中…</span></div></div>'
    );

    const streamBox = holder ? holder.querySelector('.dt-stream') : null;
    let acc = '';
    let firstChunk = true;

    const btn = $('btn-deep-send');
    if (btn) btn.disabled = true;
    setStage('思考中…');

    try {
      const r = await DTChat.ask(text, {
        onStage: (stage) => {
          const map = {
            responding: '正在组织答案…',
            thinking: '思考中…',
            Exploring: '正在探索…',
          };
          setStage(map[stage] || stage);
        },

        onDelta: (piece) => {
          if (firstChunk) {
            firstChunk = false;
            if (streamBox) streamBox.innerHTML = '';
            setStage('');
          }
          acc += piece;
          if (streamBox) {
            streamBox.innerHTML = formatContent(acc);
            const box = $('deep-messages');
            if (box) box.scrollTop = box.scrollHeight;
          }
        },

        /**
         * ★ 完整答案替换（2026-10-24）
         *   DeepTutor 的 content 流可能只是探索旁白，
         *   最终答案在 result 事件里。这里收到完整文本就整体替换。
         */
        onReplace: (full) => {
          firstChunk = false;
          acc = String(full || '');
          if (streamBox) {
            streamBox.innerHTML = formatContent(acc);
            const box = $('deep-messages');
            if (box) box.scrollTop = box.scrollHeight;
          }
          setStage('');
        },

        onDone: () => setStage(''),

        onError: (msg) => {
          if (streamBox) {
            streamBox.innerHTML = '<span style="color:var(--red)">' + esc(msg) + '</span>';
          }
          setStage('');
        },
      });

      if (r.ok && r.answer) {
        history.push({ role: 'assistant', content: r.answer });
        if (streamBox && firstChunk) {
          streamBox.innerHTML = formatContent(r.answer);
        }
      } else if (!r.ok && !acc) {
        if (streamBox) {
          streamBox.innerHTML = '<span style="color:var(--red)">' + esc(r.error || '未收到回答') + '</span>';
        }
      }

      updateStatus(true);
    } catch (e) {
      if (streamBox) {
        streamBox.innerHTML = '<span style="color:var(--red)">' + esc(e.message) + '</span>';
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
      setStage('');
    }
  }

  // ══════════════════════════════════════
  //  状态
  // ══════════════════════════════════════

  function updateStatus(ok) {
    const st = $('deep-status');
    if (!st) return;
    st.textContent = ok ? '已连接' : '未连接';
    st.style.color = ok ? 'var(--green)' : 'var(--amber)';
  }

  async function checkConn() {
    const st = $('deep-status');
    if (st) { st.textContent = '检查中…'; st.style.color = 'var(--label-tertiary)'; }

    if (typeof DTChat === 'undefined') {
      updateStatus(false);
      return false;
    }

    const r = await DTChat.connect();
    updateStatus(r.ok);
    return r.ok;
  }

  function newChat() {
    if (typeof DTChat !== 'undefined') DTChat.reset();
    history = [];
    const box = $('deep-messages');
    if (box) {
      box.innerHTML =
        '<div id="deep-welcome" style="max-width:560px;margin:40px auto;text-align:center">' +
        '<div style="font-size:15px;font-weight:600;margin-bottom:8px">新对话</div>' +
        '<div style="font-size:13px;color:var(--label-secondary);line-height:1.8">' +
        '已经清空了上下文，可以聊新话题了。</div></div>';
    }
  }

  // ══════════════════════════════════════
  //  模式切换
  // ══════════════════════════════════════

  function setMode(mode) {
    currentMode = (mode === 'deep' || mode === 'agent' || mode === 'tutorhub') ? mode : 'quick';

    const quickBox = $('chat-quick');
    const deepBox = $('chat-deep');
    const agentBox = $('chat-agent');
    const btnQuick = $('btn-mode-quick');
    const btnAgent = $('btn-mode-agent');
    const btnDeep = $('btn-mode-deep');
    const hint = $('chat-mode-hint');

    if (quickBox) quickBox.classList.toggle('hidden', currentMode !== 'quick');
    if (deepBox) deepBox.classList.toggle('hidden', currentMode !== 'deep');
    if (agentBox) agentBox.classList.toggle('hidden', currentMode !== 'agent');
    const hubBox = $('chat-tutorhub');
    if (hubBox) hubBox.classList.toggle('hidden', currentMode !== 'tutorhub');

    const activeStyle = 'height:28px;border:none;background:#fff;box-shadow:var(--shadow-xs);font-weight:600;color:var(--label-primary)';
    const idleStyle = 'height:28px;border:none;background:transparent;color:var(--label-secondary)';
    const hubBtn = $('btn-mode-tutorhub');
    if (hubBtn) hubBtn.style.cssText = currentMode === 'tutorhub' ? activeStyle : idleStyle;
    if (btnQuick) btnQuick.style.cssText = currentMode === 'quick' ? activeStyle : idleStyle;
    if (btnAgent) btnAgent.style.cssText = currentMode === 'agent' ? activeStyle : idleStyle;
    if (btnDeep) btnDeep.style.cssText = currentMode === 'deep' ? activeStyle : idleStyle;

    if (hint) {
      hint.textContent = currentMode === 'quick'
        ? '快速问答：直接问马上答 · Agent：能调本机工具 · 深度辅导：讲-例-练-测'
        : currentMode === 'agent'
          ? 'Agent 能读你的错题、跑代码、画图、做 3D 场景和教学动画'
          : '深度辅导会先想一遍再回答，适合啃难题';
    }

    try { Storage.set('chat_mode', currentMode); } catch (e) {}

    if (currentMode === 'deep') checkConn();
    if (currentMode === 'agent') {
      try { if (typeof AgentUI !== 'undefined') AgentUI.init(); } catch (e) {}
    }
    if (currentMode === 'tutorhub') {
      try { if (typeof TutorHub !== 'undefined') TutorHub.init(); } catch (e) { console.warn('TutorHub 初始化失败:', e); }
    }
  }

  // ══════════════════════════════════════
  //  初始化
  // ══════════════════════════════════════

  function init() {
    if (initialized) return;
    initialized = true;

    on('btn-mode-tutorhub', 'click', () => setMode('tutorhub'));
    on('btn-mode-quick', 'click', () => setMode('quick'));
    on('btn-mode-agent', 'click', () => setMode('agent'));
    on('btn-mode-deep', 'click', () => setMode('deep'));

    on('btn-deep-send', 'click', send);
    on('btn-deep-new', 'click', newChat);
    on('btn-deep-retry', 'click', checkConn);

    const input = $('deep-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 140) + 'px';
      });
    }

    // 建议问题
    document.querySelectorAll('.deep-suggest').forEach(btn => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-q');
        if (q && input) {
          input.value = q;
          input.focus();
        }
      });
    });

    // 恢复上次的模式
    try {
      const saved = Storage.get('chat_mode', 'tutorhub');
      if (saved === 'deep' || saved === 'agent' || saved === 'tutorhub' || saved === 'quick') setMode(saved);
      else setMode('tutorhub');
    } catch (e) {}

    // 后台探活（不阻塞）
    setTimeout(() => {
      if (typeof DTChat !== 'undefined') {
        DTChat.connect().then(r => updateStatus(r.ok));
      }
    }, 1200);
  }

  return { init, setMode, checkConn, newChat, send };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DeepTutorUI;
