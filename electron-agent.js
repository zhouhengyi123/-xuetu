/**
 * Agent 运行时（2026-10-24）
 *
 * 把 DeepSeek 的 function calling 和本地工具接起来。
 *
 * 循环：
 *   ① 用户提问
 *   ② 发给模型，附带工具清单
 *   ③ 模型返回 tool_calls → 执行 → 结果回填
 *   ④ 再发给模型，直到它给出最终答案
 *
 * 上限：最多 8 轮（防死循环）
 */
const fs = require('fs');
const path = require('path');
const Tools = require('./electron-tools.js');

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const MAX_ROUNDS = 8;

/**
 * 一次 Agent 对话。
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array} opts.messages  [{role, content}]
 * @param {function} opts.onTool 工具执行时的回调（用于 UI 实时显示）
 * @returns {Promise<{ok, answer, toolCalls, error}>}
 */
async function runAgent(opts) {
  const apiKey = opts.apiKey;
  const model = opts.model || 'deepseek-chat';
  const onTool = typeof opts.onTool === 'function' ? opts.onTool : () => {};

  if (!apiKey) return { ok: false, error: '没有 API Key' };

  let messages = (opts.messages || []).slice();
  const toolCalls = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let resp;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120000);

      resp = await fetch(DEEPSEEK_BASE + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model,
          messages,
          tools: Tools.TOOLS,
          tool_choice: 'auto',
          temperature: 0.4,
          max_tokens: 4000,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
    } catch (e) {
      if (e.name === 'AbortError') return { ok: false, error: '模型响应超时' };
      return { ok: false, error: '网络错误: ' + e.message };
    }

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      let m = 'HTTP ' + resp.status;
      try { m = JSON.parse(t).error?.message || m; } catch (e) {}
      return { ok: false, error: m };
    }

    const data = await resp.json();
    const choice = data.choices && data.choices[0];
    if (!choice) return { ok: false, error: '模型没返回结果' };

    const msg = choice.message || {};

    // ── 没有工具调用 → 这就是最终答案 ──
    if (!msg.tool_calls || !msg.tool_calls.length) {
      return {
        ok: true,
        answer: String(msg.content || ''),
        toolCalls,
        rounds: round + 1,
      };
    }

    // ── 有工具调用 → 逐个执行 ──
    messages.push({
      role: 'assistant',
      content: msg.content || '',
      tool_calls: msg.tool_calls,
    });

    for (const call of msg.tool_calls) {
      const fn = call.function || {};
      const name = fn.name;
      let args = {};
      try {
        args = fn.arguments ? JSON.parse(fn.arguments) : {};
      } catch (e) {
        args = {};
      }

      onTool({ phase: 'start', name, args, round });

      const result = await Tools.execute(name, args);

      toolCalls.push({
        name,
        args,
        ok: result.ok,
        error: result.error || '',
        round,
      });

      onTool({ phase: 'done', name, ok: result.ok, error: result.error || '', round });

      // 特殊处理：3D/动画/图表生成后，把文件存到工作区
      if (result.ok && (result.html || result.svg)) {
        try {
          if (result.html) {
            const kind = name === 'make_3d_scene' ? 'scenes' : 'animations';
            const safeTitle = String(args.title || 'untitled')
              .replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
            const fname = path.join(Tools.workspace(), kind, safeTitle + '_' + Date.now() + '.html');
            fs.mkdirSync(path.dirname(fname), { recursive: true });
            fs.writeFileSync(fname, result.html, 'utf8');
            result.savedPath = fname;
          }
          if (result.svg) {
            const safeTitle = String(args.title || 'chart')
              .replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
            const fname = path.join(Tools.workspace(), 'charts', safeTitle + '_' + Date.now() + '.svg');
            fs.mkdirSync(path.dirname(fname), { recursive: true });
            fs.writeFileSync(fname, result.svg, 'utf8');
            result.savedPath = fname;
          }
        } catch (e) {}
      }

      // 回填结果
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: Tools.resultToText(name, result) +
          (result.savedPath ? '\n已保存到: ' + result.savedPath : ''),
      });
    }
  }

  return {
    ok: false,
    error: '工具调用超过 ' + MAX_ROUNDS + ' 轮，已停止',
    toolCalls,
  };
}

/**
 * 流式版本（给 UI 用）：边跑边把内容吐出来。
 * 实现上是先跑完再一次性返回 —— 因为工具调用必须等结果。
 * 真正的流式只在"最终答案"那一段做。
 */
async function runAgentStream(opts, emit) {
  const e = typeof emit === 'function' ? emit : () => {};
  const r = await runAgent(Object.assign({}, opts, {
    onTool: (info) => e({ type: 'tool', ...info }),
  }));

  if (r.ok) {
    // 把答案按块吐出来（模拟流式，让 UI 有打字感）
    const text = r.answer;
    const CHUNK = 40;
    for (let i = 0; i < text.length; i += CHUNK) {
      e({ type: 'delta', text: text.slice(i, i + CHUNK) });
      await new Promise(res => setTimeout(res, 18));
    }
    e({ type: 'done', toolCalls: r.toolCalls, rounds: r.rounds });
  } else {
    e({ type: 'error', message: r.error });
  }

  return r;
}

module.exports = { runAgent, runAgentStream, TOOLS: Tools.TOOLS };
