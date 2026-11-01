/**
 * DeepTutor 原生对话客户端（2026-10-24）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么要有这个
 * ══════════════════════════════════════════════════════════════
 * 用户原话："你这个完全就是一个非常拉的接入，现在就是没什么接入"
 *
 * 之前用 iframe 把整个 DeepTutor 网页塞进来：
 *   · 两套侧栏并列，视觉割裂
 *   · 学徒的数据传不进去（只能靠 DTSync 异步写）
 *   · 深色/浅色主题对不上
 *
 * 现在改用 WebSocket 直连，完全用学徒自己的 UI：
 *   · 消息用学徒的气泡样式
 *   · 流式打字效果
 *   · 能看到"思考中/正在回答"的阶段
 *   · 数据天然共享（都在同一个页面，Storage 直接读）
 *
 * ══════════════════════════════════════════════════════════════
 * 协议（实测自 deeptutor/api/contracts/turn_protocol.py）
 * ══════════════════════════════════════════════════════════════
 *   连接：ws://127.0.0.1:8001/ws
 *   发送：{protocol_version:"2.0", type:"start_turn", content:"...", capability:"chat"}
 *   接收：session → stage_start → progress → content → stage_end → result → done
 *
 *   ★ 关键教训：**不要订阅**（subscribe_turn / subscribe_session）。
 *     start_turn 本身就会推全部事件，再订阅会导致消息重复投递
 *     （实测收到 237 条消息，重复很严重）。
 *     用 seq 去重也治不了根 —— 正确做法是根本不订阅。
 */
const DTChat = (() => {

  const WS_URL = 'ws://127.0.0.1:8001/ws';
    /**
   * ★ 超时收紧（2026-10-31）
   * 实测：DeepTutor 正常 15~25 秒返回，但某些输入会卡在探索循环 120 秒不返回。
   * 45 秒够正常回答，卡死时也能及时重试而不是干等 2 分钟。
   */
  const TIMEOUT = 45000;

  let ws = null;
  let connected = false;
  let sessionId = null;
  let turnId = null;
  let busy = false;
  let seenSeq = {};       // 去重：key -> true

  // 统计
  let stats = { turns: 0, errors: 0 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ══════════════════════════════════════════════════
  //  连接管理
  // ══════════════════════════════════════════════════

  function connect() {
    return new Promise((resolve) => {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        resolve({ ok: true });
        return;
      }

      try { if (ws) ws.close(); } catch (e) {}

      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ ok: false, error: '连接超时（5 秒）' });
      }, 5000);

      try {
        ws = new WebSocket(WS_URL);
      } catch (e) {
        clearTimeout(timer);
        resolve({ ok: false, error: 'WebSocket 初始化失败: ' + e.message });
        return;
      }

      ws.onopen = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        connected = true;
        resolve({ ok: true });
      };

      ws.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        connected = false;
        resolve({ ok: false, error: '连不上 DeepTutor（:8001），深度辅导需要它' });
      };

      ws.onclose = () => {
        connected = false;
      };
    });
  }

  // ══════════════════════════════════════════════════
  //  发一轮对话
  // ══════════════════════════════════════════════════

  /**
   * @param {string} content 提问
   * @param {object} opts { onDelta(text), onStage(name), onDone(answer), onError(msg) }
   */
  /**
   * ★ 带重试的 ask（2026-10-31）
   *
   * DeepTutor 偶尔卡在探索循环不返回。策略：
   *   第一次失败 → 换问法重试（明确要求"直接回答，不要探索"）
   *   第二次也失败 → 才放弃，让上层降级到快速问答
   */
  async function ask(content, opts) {
    const first = await askOnce(content, opts);
    if (first && first.ok && (first.answer || '').length > 0) return first;

    // 失败/空答案 → 换问法重试一次
    const retryText = String(content) +
      '\n\n【重要】请直接回答，不要搜索、不要查资料、不要探索。用你已有的知识回答。';
    console.log('[dt-chat] 首次失败（' + ((first && first.error) || '空答案') + '），换问法重试…');
    const second = await askOnce(retryText, opts);

    if (second && second.ok && (second.answer || '').length > 0) return second;

    // 两次都失败：返回信息更全的那个
    return {
      ok: false,
      answer: (first && first.answer) || (second && second.answer) || '',
      error: (second && second.error) || (first && first.error) || '深度辅导没有返回内容',
      retried: true,
    };
  }

  async function askOnce(content, opts) {
    /**
     * ★ 注入学生上下文（2026-10-31）
     *
     * 深度辅导之前完全不知道学生是谁 —— 审计发现的缺口。
     * 现在每次请求前把统一记忆拼进 content。
     */
    try {
      if (typeof Memory !== 'undefined' && Memory.context) {
        // ★ 带上这次的问题，让教学经验库能按关键词检索（2026-11-01）
        const mem = Memory.context({
          forAi: 'deep',
          includeTurns: false,
          query: typeof content === 'string' ? content.slice(0, 400) : '',
          subject: (opts && opts.subject) || '',
        });
        if (mem && mem.text && mem.text.length > 50) {
          content = mem.text + '\n\n---\n\n' + content;
        }
      }
    } catch (e) { console.warn('[dt] 记忆注入失败:', e); }

    const o = opts || {};
    const onDelta = typeof o.onDelta === 'function' ? o.onDelta : () => {};
    const onStage = typeof o.onStage === 'function' ? o.onStage : () => {};
    const onDone = typeof o.onDone === 'function' ? o.onDone : () => {};
    const onError = typeof o.onError === 'function' ? o.onError : () => {};

    if (busy) return { ok: false, error: '上一条还没答完' };

    const conn = await connect();
    if (!conn.ok) {
      onError(conn.error);
      return { ok: false, error: conn.error };
    }

    busy = true;
    seenSeq = {};
    let answer = '';

    return new Promise((resolve) => {
      let finished = false;

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        busy = false;
        cleanup();
        const err = '深度辅导响应超时（' + (TIMEOUT / 1000) + ' 秒）';
        onError(err);
        resolve({ ok: false, error: err, answer });
      }, TIMEOUT);

      function cleanup() {
        clearTimeout(timer);
        try {
          ws.onmessage = null;
          ws.onerror = null;
        } catch (e) {}
      }

      function finish(ok, extra) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        busy = false;
        cleanup();
        if (ok) { stats.turns++; }
        else { stats.errors++; }
        resolve(Object.assign({ ok, answer }, extra || {}));
      }

      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }

        const t = m.type || '?';

        // ── 去重（同一事件可能投递多次）──
        const key = (m.session_id || '') + '|' + (m.turn_id || '') + '|' + t + '|' + (m.seq || 0);
        if (seenSeq[key]) return;
        seenSeq[key] = true;

        // ── session → 记住会话 id ──
        if (t === 'session') {
          sessionId = m.session_id || m.sessionId || sessionId;
          turnId = m.turn_id || m.turnId || turnId;
          return;
        }

        // ── 阶段提示 ──
        if (t === 'stage_start') {
          onStage(m.stage || m.source || 'thinking');
          return;
        }
        if (t === 'progress') {
          const label = (m.metadata && m.metadata.label) || m.content || '';
          if (label && /explor|think|reason|search/i.test(label)) onStage(label);
          return;
        }

        // ── 内容流 ──
        if (t === 'content') {
          const piece = m.content || m.text || '';
          if (piece) {
            answer += piece;
            onDelta(piece);
          }
          return;
        }
        // ── 工具调用/结果（DeepTutor 自己的工具，展示一下）──
        if (t === 'tool_call') {
          const name = (m.metadata && m.metadata.name) || m.content || 'tool';
          onStage('调用 ' + name);
          return;
        }
        if (t === 'tool_result') {
          onStage('处理结果…');
          return;
        }

        // ── 结果（这才是完整答案）──
        if (t === 'result') {
          /**
           * ★ 关键：result 事件里有完整回答（2026-10-24 实测）
           *
           * 消息流结构：
           *   session → stage_start → progress → content×N → stage_end → result → done
           *
           * content 是一条一条的碎片（实测 154 条）。但对于"多轮探索"的
           * 深度对话，content 可能只是第一轮旁白，最终答案在 result 里。
           *
           * result 的形状：{ response: "完整答案文本", ... }
           *
           * 这里把完整文本用 onReplace 回调传给 UI（而不是让 UI 累加）。
           */
          const full = m.response || m.content || m.text || '';
          if (full && String(full).length > 0) {
            answer = String(full);
            if (typeof o.onReplace === 'function') {
              o.onReplace(answer);
            } else {
              onDelta(answer);
            }
          }
          return;
        }

        // ── 完成 ──
        if (t === 'done') {
          finish(true, { answer });
          onDone(answer);
          return;
        }

        // ── 错误 ──
        if (t === 'error') {
          const msg = m.message || (m.metadata && m.metadata.message) || m.content || '未知错误';
          finish(false, { error: msg });
          onError(msg);
          return;
        }
      };

      // 发送
      try {
        /**
         * ★ 用语言指令代替协议字段（2026-10-24 踩坑记录）
         *
         * 试过的三条路：
         *   ① StartTurnCommand 加 language / reply_language_override
         *      → 服务器返回 protocol_error（WireModel 是 extra="forbid"），整轮失败
         *   ② 改 DeepTutor 的 main.yaml system.language: zh-CN
         *      → config show 显示已生效，但 agent 回答仍是英文
         *        （它的 agent 系统提示词自己决定语言，不看这个配置）
         *   ③ 把语言要求写进 content
         *      → 这个是有效的，因为模型会遵循用户消息里的明确指令
         *
         * 所以用 ③。代价是消息里多一句话，但这比返回英文好。
         */
        const LANG_HINT = '\n\n（请全程用简体中文回答，不要说英文。）';
        const payload = String(content).includes('用简体中文回答')
          ? String(content)
          : String(content) + LANG_HINT;

        ws.send(JSON.stringify({
          protocol_version: '2.0',
          type: 'start_turn',
          content: payload,
          capability: 'chat',
          session_id: sessionId || undefined,
        }));
      } catch (e) {
        finish(false, { error: '发送失败: ' + e.message });
        onError('发送失败: ' + e.message);
      }
    });
  }

  function reset() {
    sessionId = null;
    turnId = null;
  }

  function status() {
    return {
      connected,
      sessionId,
      busy,
      stats,
    };
  }

  return { connect, ask, reset, status };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DTChat;
