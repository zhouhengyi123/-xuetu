/**
 * LLM 适配层 v2 — 8 家供应商 · 最新模型 · 统一 OpenAI 格式
 * 供应商: OpenAI / DeepSeek / Anthropic / 千问 / Kimi / 智谱 / LongCat / 自定义
 */
const LLM = (() => {

  /**
   * ★ 2026-11-07：全局反馈文案规范（教学法调研 P1）
   *
   * 依据：Kluger & DeNisi 1996（607 效应量，>1/3 反馈反而降低绩效，
   * 表扬 d=-0.17）；Wisniewski/Zierer/Hattie 2020（信息含量是核心，
   * self 层反馈最差）；Henderlong & Lepper 2002（process praise > person praise）；
   * Hattie & Timperley 2007（feed-up → feed-back → feed-forward）；
   * Chi 2001（长篇解释只带来浅层学习，reflection 才与深层理解相关）；
   * INSPIRE（间接纠错、不说「错」、让学生反思复述）。
   *
   * 这段会被追加到所有「会直接写给学生看」的 system prompt，
   * 抑制 LLM 天然的长篇讲透 + 空洞表扬倾向。
   */
  const FEEDBACK_RULES = [

    '【反馈与讲解规范（必须遵守）】',
    '1. 反馈模板 = 事实 + 定位 + 下一步动作。例：「第 2 步把 f\'(x)>0 当成了 f(x)>0，回到导数符号决定增减再试一次」。',
    '2. 禁止「太棒了/你真聪明/加油/继续加油」等指向人的表扬，禁止排名、「超过 X% 的同学」、连续打卡奖励。',
    '3. 纠错用间接提问（「若 x<0，这一步还成立吗？」），不要红叉羞辱；把挫折归因到题目难度与可控策略，保护信心但不空洞安慰。',
    '4. 解析限字：先给关键错步与正确思路，别写长篇「讲透」；留一句让学生自己归纳/复述，长解释只带来浅层学习。',
    '5. 每节结尾让学生用一句话写出「卡在哪一步 / 这步为什么」，不要问「听懂了吗」（学困生最容易说懂了）。',
    '6. 不因某天没学、专注度低而下调「现在水平」；过程信号只用于节奏建议。',
  ].join('\n');

  /** 给 system 文案追加反馈规范（中文源，其他 region 由 I18n 管输出语言） */
  function withFeedbackRules(systemText) {
    if (!systemText) return FEEDBACK_RULES;
    return String(systemText) + '\n\n' + FEEDBACK_RULES;
  }
  // ══ 供应商配置（最新模型名称） ══
  const PROVIDERS = {
    openai: {
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      /**
       * ★ 2026-10-31 更新
       *
       * 已删除（选到会报错）：
       *   gpt-4.5-preview  —— 2025-07-14 就删了
       *   o1 / o1-mini / o3-mini / o4-mini —— 2026-10-23 关停
       *   gpt-3.5-turbo    —— 存疑，不敢列
       *
       * o3 保留但标注：2026-12-11 关停
       */
      models: [
        { id: 'gpt-6-astra', name: 'GPT-6 Astra（旗舰）' },
        { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol（均衡）' },
        { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra（新）' },
        { id: 'gpt-6-luna', name: 'GPT-6 Luna（快 · 便宜）' },
        { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' },
        { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' },
        { id: 'gpt-5.4', name: 'GPT-5.4' },
        { id: 'gpt-4.1', name: 'GPT-4.1' },
        { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'o3', name: 'o3（推理 · 2026-12-11 停用）' },
      ],
    },
    deepseek: {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      /**
       * ★ 以实测为准（2026-10-31）
       *
       * 直接查 https://api.deepseek.com/v1/models 只返回这两个：
       *   deepseek-flash, deepseek-v4-pro
       *
       * 其它旧名（deepseek-chat / r1 等）不再列出 —— 列出来用户选了可能报错。
       * 如果官方后面改名，用下面的"自定义模型"填即可。
       */
      models: [
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4 Pro（旗舰）' },
        { id: 'deepseek-flash', name: 'DeepSeek Flash（快）' },
      ],
    },
    anthropic: {
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      /**
       * ★ 2026-10-31 更新
       *
       * 注意 ID 格式变了：现在是 claude-opus-5-5 这种，
       * 不再是 claude-opus-4-20250514 带日期的写法。
       *
       * 已删除：claude-3-5-* / claude-3-opus-*（已退休）
       */
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5（推荐）' },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5（快）' },
        { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
      ],
      isAnthropic: true,
    },
    qwen: {
      name: '千问 (Qwen)',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      /**
       * ★ 2026-10-31 更新
       *
       * 已删除（**必 404**）：
       *   qwen3-72b-chat / qwen3-32b-chat / qwen3-14b-chat
       *   —— 这三个 ID 在百炼平台从来就不存在（Qwen3 没有 72B 这个规格）
       *   qwen2.5-72b-instruct / qwen-omni-turbo —— 已过时
       *
       * 现在到 3.8 代。旧的 qwen-plus/max/flash 仍有效（官方兼容表还列着）。
       */
      models: [
        { id: 'qwen3.8-max', name: 'Qwen3.8 Max（旗舰）' },
        { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash（快）' },
        { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus' },
        { id: 'qwen3.7-flash', name: 'Qwen3.7 Flash' },
        { id: 'qwen-long', name: 'Qwen-Long（长文本）' },
        { id: 'qwen-max', name: 'Qwen Max（旧版 · 仍可用）' },
        { id: 'qwen-plus', name: 'Qwen Plus（旧版 · 仍可用）' },
        { id: 'qwen-flash', name: 'Qwen Flash（旧版 · 仍可用）' },
      ],
    },
    kimi: {
      name: 'Kimi (Moonshot)',
      baseUrl: 'https://api.moonshot.cn/v1',
      /**
       * ★ 2026-10-31 更新
       *
       * 已删除（**已下线**）：
       *   moonshot-v1-8k/32k/128k —— 2026-08-31 全线下线
       *   kimi-k2-0711-preview   —— 2026-05-25 下线
       *
       * 注意：K2 系列 2026-10-31 起停止新注册，12 月底全下线。
       */
      models: [
        { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro（旗舰）' },
        { id: 'kimi-k3.1-pro-highspeed', name: 'Kimi K3.1 Pro（高速）' },
        { id: 'kimi-k3', name: 'Kimi K3' },
        { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code' },
        { id: 'kimi-k2.6', name: 'Kimi K2.6' },
      ],
    },
    zhipu: {
      name: '智谱 (GLM)',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      /**
       * ★ 2026-10-31 更新
       *
       * ⚠️ GLM-5.3 强制思考：thinking.type 只接受 enabled，
       *    传 disabled 会直接报错。如果以后加"关闭思考"选项要注意。
       *
       * 已删除（官方表已删）：glm-4-plus / glm-4v-plus / glm-4-air / glm-4-airx
       */
      models: [
        { id: 'glm-5.3', name: 'GLM-5.3（旗舰 · 强制思考）' },
        { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash（快）' },
        { id: 'glm-5.3-flashx', name: 'GLM-5.3 FlashX' },
        { id: 'glm-5.2', name: 'GLM-5.2' },
        { id: 'glm-5.1', name: 'GLM-5.1' },
        { id: 'glm-5', name: 'GLM-5' },
        { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash（免费）' },
        { id: 'glm-4-long', name: 'GLM-4 Long（长文本）' },
        { id: 'glm-5v-turbo', name: 'GLM-5V Turbo（视觉）' },
        { id: 'glm-4.6v', name: 'GLM-4.6V（视觉）' },
      ],
    },
    minimax: {
      name: 'MiniMax',
      baseUrl: 'https://api.minimax.cn/v1',
      models: [
        { id: 'MiniMax-M3.1-Flash', name: 'MiniMax M3.1 Flash（快）' },
        { id: 'MiniMax-M3', name: 'MiniMax M3' },
      ],
    },
        longcat: {
      name: 'LongCat (龙猫)',
      baseUrl: 'https://api.longcat.chat/openai/v1',
      // 龙猫 2.5 是"默认思考"模型：不传 thinking 也会输出 reasoning_content。
      // 读图/抽 JSON 这类任务显式关掉更稳、更快、也不会把思考串进正文。
      thinkingBody: function (on) { return { thinking: { type: on ? 'enabled' : 'disabled' } }; },
      models: [
        { id: 'LongCat-2.5-Preview', name: 'LongCat-2.5-Preview（多模态·最新）' },
        { id: 'LongCat-2.0', name: 'LongCat-2.0' },
      ],
    },
    custom: {
      name: '自定义 (OpenAI 兼容)',
      baseUrl: '',
      models: [],
    },
  };

  // ══ 获取 / 保存配置 ══
  /**
   * ★ 默认配置（2026-10-31 开源版）
   *
   * ⚠️ 开源版**不预置任何 API Key**。
   *
   * 之前为了方便自用，这里写死了一个 DeepSeek key。
   * 开源后必须删掉——否则：
   *   ① 密钥泄露，任何人拉代码都能白嫖你的额度
   *   ② 别人以为这软件"自带"AI，实际用的是你的钱
   *
   * 现在：
   *   · 留空 → 首次启动引导用户自己填（设置页有「测试连接」）
   *   · 也支持 WorkBuddy 免费额度（如果用户本机装了 WorkBuddy）
   *
   * 如果你是自己用、想预置 key，在**本地**改这一行即可（不要提交到 git）。
   */
  const DEFAULT_CONFIG = {
    provider: 'deepseek',
    apiKey: '',            // ← 开源版留空，由用户自己填
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    enabled: false,        // ← 没 key 时不自动启用
  };

  function getConfig() {
    const cfg = Storage.get('llm_config', null);
    if (cfg && cfg.apiKey) return cfg;


    /**
     * 本地没有 → 用默认值，并**立刻写回**
     *   （这样下次就是从 Storage 读，不会每次重算）
     */
    const merged = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    if (merged.apiKey) {
      try { Storage.set('llm_config', merged); } catch (e) {}
    }
    return merged;
  }

  function saveConfig(config) {
    Storage.set('llm_config', { ...getConfig(), ...config, enabled: true });
  }

  function getProvider() {
    var cfg = getConfig();
    var p = PROVIDERS[cfg.provider] || PROVIDERS.deepseek;
    // Use provider-specific key if available
    var providerKey = Storage.getProviderKey(cfg.provider);
    return {
      ...p,
      baseUrl: cfg.provider === 'custom' ? cfg.baseUrl : p.baseUrl,
      apiKey: providerKey || cfg.apiKey,
      model: cfg.model,
      provider: cfg.provider,
    };
  }

  function getDefaultModel(provider) {
    const d = {
      openai: 'gpt-4o-mini',
      deepseek: 'deepseek-chat',
      anthropic: 'claude-haiku-4-20250514',
      qwen: 'qwen-plus-latest',
      kimi: 'moonshot-v1-32k',
      zhipu: 'glm-4-flash',
      longcat: 'LongCat-2.5-Preview',
      custom: '',
    };
    return d[provider] || '';
  }

  // ══════════════════════════════════════════════════════════
  //  读图（多模态）能力登记
  //  LongCat-2.5-Preview 的图片理解见官方更新日志 2026-09-25：
  //  「多模态理解：新增图片理解能力，可解析图像内容」
  // ══════════════════════════════════════════════════════════
  const VISION_MODELS = {
    longcat: ['LongCat-2.5-Preview'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.5-preview', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o1', 'o3', 'o4-mini'],
    anthropic: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250514',
                'claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'],
    qwen: ['qwen-max-latest', 'qwen-plus-latest', 'qwen-omni-turbo', 'qwen-vl-max-latest'],
    zhipu: ['glm-4v-plus', 'glm-4-plus', 'glm-5', 'glm-5-flash'],
    kimi: [],        // 目前登记的 Moonshot 模型都是纯文本
    deepseek: [],    // deepseek-chat / reasoner 都是纯文本
  };

  // 默认的读图模型（用户没单独配置时用它）
  const DEFAULT_VISION = { provider: 'longcat', model: 'LongCat-2.5-Preview' };
  const MAIN_FALLBACK = 'longcat';

  /** 该供应商+模型能不能吃图片。未登记的供应商（含 custom）不拦，返回 true。 */
  function modelSupportsVision(provider, model) {
    const list = VISION_MODELS[provider];
    if (!list) return true;
    if (!list.length) return false;
    return list.indexOf(model) >= 0;
  }

  /** 列出所有能读图的 (供应商, 模型) 组合，用于设置页下拉 */
  function listVisionModels() {
    const out = [];
    Object.keys(PROVIDERS).forEach(pid => {
      const allow = VISION_MODELS[pid];
      (PROVIDERS[pid].models || []).forEach(m => {
        if (allow === undefined ? pid === 'custom' : allow.indexOf(m.id) >= 0) {
          out.push({ provider: pid, providerName: PROVIDERS[pid].name, model: m.id, name: m.name });
        }
      });
    });
    return out;
  }

  function getVisionConfig() {
    return Storage.get('llm_vision_config', {
      provider: DEFAULT_VISION.provider,
      model: DEFAULT_VISION.model,
      baseUrl: '',
      apiKey: '',
    });
  }

  function saveVisionConfig(c) {
    Storage.set('llm_vision_config', Object.assign({}, getVisionConfig(), c || {}));
  }

  /** 读图实际使用的连接参数（读图配置里的 Key 优先，其次回落到主配置） */
  function getVisionProvider() {
    const c = getVisionConfig();
    const pid = c.provider || DEFAULT_VISION.provider;
    const p = PROVIDERS[pid] || PROVIDERS[MAIN_FALLBACK];
    const key = c.apiKey || Storage.getProviderKey(pid);
    return {
      provider: pid,
      name: p.name,
      baseUrl: pid === 'custom' ? (c.baseUrl || '') : p.baseUrl,
      apiKey: key,
      model: c.model || getDefaultModel(pid),
      isAnthropic: !!p.isAnthropic,
      thinkingBody: p.thinkingBody,
    };
  }

  // XHR fallback for environments where fetch is blocked
  function xhrRequest(url, headers, body) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      for (var key in headers) { xhr.setRequestHeader(key, headers[key]); }
      xhr.onload = function() {
        var mockResp = {
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status || 0,
          text: function() { return Promise.resolve(xhr.responseText || ''); },
          json: function() { try { return Promise.resolve(JSON.parse(xhr.responseText || '{}')); } catch(e) { return Promise.resolve({}); } }
        };
        resolve(mockResp);
      };
      xhr.onerror = function() { reject(new Error('XHR network error')); };
      xhr.ontimeout = function() { reject(new Error('XHR timeout')); };
      // ★ 读图/长文识别很慢，30 秒不够（原来 30s 会在大图批量识别时误判超时）
      xhr.timeout = 180000;
      // ★ 必须序列化：直接把对象交给 send()，浏览器会 toString 成 "[object Object]"，
      //   服务端报 "Unrecognized token 'object'" —— 看起来像"模型不支持图片"，其实是这里写坏了。
      var payload = (typeof body === 'string') ? body : JSON.stringify(body);
      xhr.send(payload);
    });
  }

  // ══ 统一人格：由 App 层注入，保证所有模块用的是"同一个老师" ══
  var personaProvider = null;
  function setPersona(fn) { personaProvider = (typeof fn === 'function') ? fn : null; }

  // ══ 核心请求 ══
  // chatRaw 返回完整响应（含 finish_reason），chat 只返回文本。
  // 拆开是为了能识别"被 max_tokens 截断"——截断的 JSON 解析必然失败，
  // 但错误信息里必须说清是截断，而不是笼统的"不是有效 JSON"。
  async function chatRaw(messages, opts = {}) {
    /**
     * ★ WorkBuddy 免费 Token 分支（2026-10-17，自用测试）
     *
     * 开了之后所有调用都走本机 WorkBuddy 账号的积分，不烧自己的 Key。
     * 放在最前面是为了**任何模块都自动生效**（出卷/批改/规划/估算/读图…），
     * 不用挨个改调用点。
     *
     * 读图（vision）走不了这条 —— WorkBuddy 的 auto 模型虽然支持图片，
     * 但走的是另一套参数，暂不接管，仍用用户自己的读图模型。
     */
    if (!opts._providerOverride && !opts.vision && WB.isEnabled()) {
      // 人格/记忆照样拼进去，保证"换个通道还是同一个老师"
      if (!opts.noPersona && personaProvider) {
        let persona = '';
        try { persona = personaProvider() || ''; } catch (e) { persona = ''; }
        if (persona) {
          const sys = messages.find(m => m && m.role === 'system');
          if (sys) sys.content = persona + '\n\n' + sys.content;
          else messages = [{ role: 'system', content: persona }].concat(messages);
        }
      }
      const r = await WB.chat(messages, {
        model: opts.model,
        temperature: opts.temperature,
      });
      // 保持与正常分支一致的返回结构（调用方都按这个读）
      return {
        text: r.text,
        finish_reason: 'stop',
        usage: r.usage || null,
        _via: 'workbuddy',
        _account: r.account,
      };
    }

    // 允许调用方指定另一套连接（读图时走"读图模型"，不一定是主模型）
    const p = opts._providerOverride || getProvider();
    if (!p.apiKey) throw new Error('请先在「设置」页面配置 API Key');

    // 把全局人格 + 共享记忆拼到 system 里，这样出卷/批改/规划/估算
    // 这些引擎调用也会带着同一份记忆，不会"换个页面就失忆"。
    if (!opts.noPersona && personaProvider) {
      let persona = '';
      try { persona = personaProvider() || ''; } catch (e) { persona = ''; }
      if (persona) {
        const sys = messages.find(m => m && m.role === 'system');
        if (sys) sys.content = persona + '\n\n' + sys.content;
        else messages = [{ role: 'system', content: persona }].concat(messages);
      }
    }

    const model = opts.model || p.model || getDefaultModel(p.provider);
    const url = `${p.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const temperature = opts.temperature ?? 0.7;
    /**
     * ★ 默认 4000（2026-10-31，原 2000）
     *
     * 新模型（deepseek-v4-pro / flash）是推理模型：
     * 先输出 reasoning_content，再输出 content，max_tokens 两者共用。
     * 2000 在小问题上够，但复杂题目（解析几何、作文）思考就吃掉一大半，
     * 正文没写完就截断 → 返回空或半截。
     *
     * 实测：max_tokens=20 时空字符串，100 时正常，说明留够就行。
     */
    const maxTokens = opts.maxTokens || 4000;

    let headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.apiKey}` };
    let body = { model, messages, temperature, max_tokens: maxTokens };

    // Anthropic 需要特殊处理
    if (p.isAnthropic) {
      const sysMsg = messages.find(m => m.role === 'system');
      const userMsgs = messages.filter(m => m.role !== 'system');
      body = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: userMsgs,
      };
      if (sysMsg) body.system = sysMsg.content;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': p.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    }

    if (opts.response_format && !p.isAnthropic) {
      body.response_format = opts.response_format;
    }

    /**
     * ★ 2026-11-07：思考强度（用户要求「调整思考强度」）
     *
     * 审计结论：当前 PROVIDERS 里**没有任何 provider 登记真正的
     * reasoning_effort**（OpenAI o 系列 / Claude extended thinking / GLM 思考预算
     * 都没接），只有 LongCat 有一个 `thinking: {enabled|disabled}` 布尔开关。
     * 所以做不出「低/中/高」三档，只能做「开 / 关」+「预算档位」。
     *
     * 这里实现两件确实可控的事：
     *   ① thinking 开关：high → 打开（若 provider 支持），low/off → 关闭
     *   ② 思考预算：high 时给推理模型留出更多 max_tokens
     *      （reasoning_content 与正文共用预算，见 :400-409 的旧坑）
     *
     * 明确不做：不伪造 `reasoning_effort` 字段发给不支持的供应商
     * （会被服务端拒绝或忽略，属于假装实现了）。
     */
    const effort = String(opts.reasoningEffort || '').toLowerCase();
    const thinkingOn = (effort === 'high' || effort === 'on' || opts.thinking === true);
    if (typeof p.thinkingBody === 'function' && !p.isAnthropic) {
      Object.assign(body, p.thinkingBody(thinkingOn));
    } else if (p.reasoningBody && !p.isAnthropic) {
      // 未来若有供应商登记了 effort 档位，从这里透传
      Object.assign(body, p.reasoningBody(effort));
    }
    if (effort === 'high' && maxTokens < 6000) {
      body.max_tokens = 6000;   // 给思考留预算，避免正文被截断
    }

    // CORS proxy support
    var useProxy = false; // Disabled: corsproxy.io no longer supports anonymous use

    /**
     * ★ 超时控制（2026-10-17 修 —— 这是一个真实的卡死 bug）
     *
     * 之前 `fetch` **没有任何超时**。当模型没配好、Key 错、或网络不通时，
     * fetch 不会报错，也不会返回 —— 它就一直挂着。
     * 外层虽然包了 try/catch，但 catch 只能接住"抛出的错误"，接不住"永远不返回"。
     * 结果：用户界面卡在「AI 正在分析…」再也不动，只能关掉应用。
     *
     * 现在：默认 120 秒硬超时（读图这种长任务可以传更大的 timeoutMs）。
     * 超时会抛 AbortError，转成一句人话给用户。
     */
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 120000;
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    let timeoutId = null;
    if (ctrl) timeoutId = setTimeout(() => ctrl.abort(), timeoutMs);

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(ctrl ? { signal: ctrl.signal } : {}),
      });
    } catch (e) {
      if (timeoutId) clearTimeout(timeoutId);
      // 超时：给可操作的提示，不要让用户干等
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message)))) {
        throw new Error('模型响应超时（' + Math.round(timeoutMs / 1000) + ' 秒没有返回）。' +
          '请检查：①网络是否通 ②API Key 是否正确 ③模型名是否存在');
      }
      // Try XHR fallback (some environments block fetch but allow XHR)
      try {
        resp = await xhrRequest(url, headers, body);
      } catch (e2) {
        throw new Error('网络请求失败: ' + e.message + ' (XHR也失败: ' + e2.message + ')。请尝试: 1) 换浏览器 2) 禁用扩展 3) 换网络');
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      const t = await resp.text();

      /**
       * ★ 错误信息可读化（2026-10-18 修）
       *
       * 用户截图里那三坨 "HTTP 401: <html><head><title>401 Authorization Required..."
       * 是**网关（openresty/nginx）返回的 HTML 错误页**被原样塞进了提示里。
       * 对用户毫无帮助 —— 他不知道是 Key 错了、地址错了、还是模型名错了。
       *
       * 现在：识别出"返回的是网页"→ 直接说"地址不对"，并给出正确写法。
       */
      let m = '';
      const looksHtml = /^\s*<(!doctype|html|head|body)/i.test(t) || /<title>/i.test(t);
      const gateway = /openresty|nginx|apache|cloudflare|aliyun|tencentcloud/i.test(t);

      if (looksHtml || gateway) {
        const is401 = resp.status === 401 || resp.status === 403;
        m = is401
          ? '接口地址不对（返回的是网关 401 页面，不是模型服务）'
          : '接口地址不对（返回的是网页，不是模型 API）';
        m += '\n\n当前请求打到了：' + (p.baseUrl || '(空)') + '/chat/completions';
        m += '\n\n常见原因：';
        m += '\n  · 用了需要额外鉴权的中转/代理地址，但没配对应的 Key';
        m += '\n  · baseUrl 多写了路径，或者少了 /v1';
        m += '\n\n正确的写法：';
        m += '\n  DeepSeek   https://api.deepseek.com/v1';
        m += '\n  OpenAI     https://api.openai.com/v1';
        m += '\n  通义千问   https://dashscope.aliyuncs.com/compatible-mode/v1';
        m += '\n\n或者：直接点上面「用 WorkBuddy」，不填 Key 也能用。';
      } else {
        m = 'API 错误 (' + resp.status + ')';
        try {
          const j = JSON.parse(t);
          m = (j.error && j.error.message) || j.message || j.msg || m;
        } catch (e) {
          const brief = String(t).replace(/\s+/g, ' ').trim().slice(0, 160);
          if (brief) m += '：' + brief;
        }

        if (resp.status === 401) m += '\n\n→ API Key 无效或没填。检查「设置」里的 Key。';
        else if (resp.status === 402) m += '\n\n→ 账户余额不足。';
        else if (resp.status === 403) m += '\n\n→ 没有权限，Key 可能不属于该模型。';
        else if (resp.status === 404) m += '\n\n→ 模型名不存在，或 baseUrl 路径不对。';
        else if (resp.status === 429) m += '\n\n→ 请求太频繁或额度用完了，等一会儿再试。';
        else if (resp.status >= 500) m += '\n\n→ 服务端出问题，不是你的错，稍后重试。';

        m += '\n\n请求地址：' + url;
        m += '\n使用模型：' + model;
      }

      throw new Error(m);
    }

    const data = await resp.json();
    return { data: data, provider: p, model: model, url: url };
  }

  /** 只取文本；并记录 finish_reason 供上层判断是否被截断 */
  let lastMeta = { finishReason: null, model: null, usage: null, truncated: false, at: 0 };

  /**
   * 把反馈规范追加到「面向学生」的 system 上。
   *
   * 只对含教学语义的 system 生效；纯抽取/判分/诊断类的 JSON 调用
   * （例如把教材口语折算成覆盖率）不追加，避免干扰结构化输出。
   */
  const TEACHING_SYSTEM_MARKERS = ['老师', '学生', '讲解', '解题', '批改', '反馈', '规划', '课程', '辅导', '出题', '学'];
  function attachFeedbackRules(messages) {
    if (!Array.isArray(messages)) return messages;
    return messages.map(m => {
      if (!m || m.role !== 'system' || typeof m.content !== 'string') return m;
      const hasTeaching = TEACHING_SYSTEM_MARKERS.some(k => m.content.indexOf(k) >= 0);
      // 纯 JSON 抽取：要求返回固定 JSON schema 且不面向学生展示 → 不追加
      const isPureExtraction = /返回 JSON|请以纯 JSON|response_format/.test(m.content) &&
        !/学生|讲解|反馈|规划/.test(m.content);
      if (hasTeaching && !isPureExtraction && m.content.indexOf(FEEDBACK_RULES.slice(0, 10)) < 0) {
        return Object.assign({}, m, { content: withFeedbackRules(m.content) });
      }
      return m;
    });
  }

  async function chat(messages, opts = {}) {
    const r = await chatRaw(attachFeedbackRules(messages), opts);

    /**
     * ★ WorkBuddy 分支（2026-10-17 修）
     *   chatRaw 走 WorkBuddy 时返回的是 {text, finish_reason, _via}，
     *   **没有 data 字段**。而下面读的是 data.choices[0].message.content，
     *   结果拿到空字符串 —— 界面上就是"AI 头像 + 空气泡"（用户截图就是这个）。
     *
     *   这里优先读 r.text，再退回标准 OpenAI 结构。
     */
    if (r && typeof r.text === 'string' && r._via === 'workbuddy') {
      lastMeta = {
        finishReason: r.finish_reason || 'stop',
        model: (r.model || 'workbuddy'),
        usage: r.usage || null,
        truncated: false,
        at: Date.now(),
      };
      return r.text;
    }

    const data = r.data || {};

    if (r.provider && r.provider.isAnthropic) {
      const txt = (data.content && data.content[0] && data.content[0].text) || '';
      lastMeta = { finishReason: data.stop_reason || null, model: r.model, usage: data.usage || null, truncated: data.stop_reason === 'max_tokens', at: Date.now() };
      return txt;
    }

    const choice = (data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    // 有些思考模型把正文放在 reasoning_content，content 为空时兜底
    const txt = msg.content || '';
    lastMeta = {
      finishReason: choice.finish_reason || null,
      model: data.model || r.model,
      usage: data.usage || null,
      truncated: choice.finish_reason === 'length',
      at: Date.now(),
    };

    /**
     * ★ 推理模型空内容自动重试（2026-10-31）
     *
     * 实测：deepseek-v4-pro / deepseek-flash 是推理模型，
     *   max_tokens=20  → finish=length, content=""（被思考吃光）
     *   max_tokens=100 → finish=stop,   content="2"
     *
     * 不重试的话，用户看到的是"AI 头像 + 空气泡"，
     * 或者 JSON 解析失败（chatJSON 拿空字符串）。
     */
    if (!txt && !opts._retriedForReasoning) {
      const rc = msg.reasoning_content || '';
      if (rc && choice.finish_reason === 'length') {
        // ★ maxTokens 是 chatRaw 的局部变量，这里用 opts 里的值（没有就用默认 4000）
        const cur = opts.maxTokens || 4000;
        const bigger = Math.min(32000, Math.max(8000, cur * 3));
        console.warn('[LLM] 思考未完成就截断（reasoning ' + rc.length + ' 字），提到 max_tokens=' + bigger + ' 重试…');
        return chat(messages, Object.assign({}, opts, {
          maxTokens: bigger,
          _retriedForReasoning: true,
        }));
      }
      if (rc) {
        console.warn('[LLM] content 为空，模型只返回了 reasoning_content（' + rc.length + ' 字）');
      }
    }
    return txt;
  }

  function getLastMeta() { return lastMeta; }

  async function chatJSON(messages, opts = {}) {
    if (messages[messages.length - 1]?.role === 'user' && !opts._skipHint) {
      messages[messages.length - 1].content += '\n\n请以纯 JSON 格式返回，不要包含 Markdown 代码块标记。';
    }
    const content = await chat(messages, { ...opts, response_format: { type: 'json_object' }, temperature: opts.temperature ?? 0.3 });
    try {
      return JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('AI 返回非 JSON 格式');
    }
  }

  // ══ AI 教学能力 ══

  async function generateQuiz({ subject, knowledge, difficulty, type, count, grade, textbook, onlyCovered }) {
    // 教材进度：决定"能不能出这道题"的硬约束
    let scope = '';
    if (textbook && (textbook.unit || textbook.edition)) {
      const desc = [textbook.edition, textbook.unit].filter(Boolean).join(' ');
      scope = `\n\n【教材进度 · 必须严格遵守】\n`
        + `这名学生${subject}的教材当前上到：${desc}\n`;
      if (onlyCovered === false) {
        scope += `（本次允许适度超前，但仍要标注哪些题超出进度。）`;
      } else {
        scope += `出题范围**只能覆盖到这个进度之前已经学过的内容**。具体要求：\n`
          + `1) 绝不能出现还没学的章节、公式、符号或概念；\n`
          + `2) 如果下面指定的知识点超出进度，就改用已学范围内最接近的知识点，并在 explanation 里说明；\n`
          + `3) 每道题的 knowledge 字段请写清楚具体到章节的知识点名，方便对照教材。`;
      }
    }

    return await chatJSON([{
      role: 'system',
      content: '你是高考命题专家，严格按照高考真题风格出题。\n\n★ 重要（2026-10-25）：题目要来自历年真题或模拟题，**不要自己编**。\n   如果不确定具体题目，就按照高考题型和难度出，但要符合真题风格。\n\n要求：\n· 每题都要有：题干、答案、解析、难度、知识点\n· 选择题要有 A/B/C/D 四个选项\n· 填空题要有明确答案\n· 解答题要有解题步骤\n\n严格返回 JSON（不要代码块）：\n{"questions":[{"text":"题干","type":"choice|fill|solve","options":["A...","B...","C...","D..."],"answer":"B","explanation":"解析","difficulty":"easy|normal|hard","knowledge":"知识点","fullScore":分值}]}'}, {
      role: 'user',
      content: `生成 ${count} 道${subject}题。年级:${grade||'高中'}。${knowledge?'知识点:'+knowledge:'知识点:综合随机'}。难度:${difficulty}。题型:${type==='mixed'?'混合':type}`
        + scope,
    }], { temperature: 0.8, maxTokens: 4000 });
  }

  async function analyzeQuiz({ quiz, answers }) {
    const detail = quiz.questions.map((q, i) => ({
      i: i + 1, text: q.text, type: q.type,
      correct: q.answer, student: answers[i] || '(未答)',
      knowledge: q.knowledge,
    }));
    return await chatJSON([{
      role: 'system',
      content: `你是${quiz.subject}教师，分析测验结果。
返回 JSON: {"score":0,"analysis":"整体评价","strengths":["..."],"weaknesses":["..."],"suggestions":["..."],"estimatedImpact":"对高考影响","mistakes":[{"i":0,"reason":"错因","focus":"复习重点"}]}`,
    }, {
      role: 'user',
      content: `科目:${quiz.subject}\n得分:${quiz.score}/${quiz.totalScore}\n详情:\n${JSON.stringify(detail, null, 2)}`,
    }], { maxTokens: 3000 });
  }

  /**
   * 生成每日学习计划。
   *
   * ★ 2026-10-24 修：新增 focusSubject / intensity / intensityHint
   *   旧版签名只有 6 个参数，UI 里的「侧重科目」和「强度」传不进来，
   *   用户选了也不影响生成结果 —— 两个下拉框形同虚设。
   */
  async function generateStudyPlan({
    hours, subjects, weaknesses, goal, current, examDate,
    focusSubject, intensity, intensityHint,
    todayDay, todayMinutes, todayNote, routinePrompt,
  }) {
    const days = examDate ? Math.max(1, Math.ceil((new Date(examDate) - new Date()) / 86400000)) : 180;

    const focusLine = focusSubject
      ? `\n【学生的明确要求】这次要重点安排「${focusSubject}」——它应该占最大的时间份额，其他科目保持不掉队即可。不要平均分配。`
      : '';

    const intensityLine = intensityHint ? `\n【强度偏好】${intensityHint}` : '';

    /**
     * ★ 2026-11-07：作息节奏
     *
     * 原来只有「每日 Xh」一个标量，AI 不知道今天星期几、是不是住校、
     * 今晚是不是只有晚自习两小时。现在把用户自己设定的作息原样传进去。
     * 没设置作息时不注入这一段（不编造），保持原来的通用行为。
     */
    const routineLine = routinePrompt ? '\n' + routinePrompt : '';
    const todayLine = todayDay
      ? `\n【今天】${todayDay}${todayNote ? '（' + todayNote + '）' : ''}，可用 ${todayMinutes || Math.round(hours * 60)} 分钟。只排今天能完成的任务，不要排超过这个时长。`
      : '';
    const routineSystem = routinePrompt
      ? '\n· 学生设了作息时，一周各天的任务量必须按对应日的可用分钟变化，标为「不安排」的日子不要排任务；不要七天平均分配。'
      : '';

    return await chatJSON([{
      role: 'system',
      content: `你是高考备考规划师。

返回 JSON: {"dailyPlan":[{"task":"名称","subject":"科目","duration":30,"type":"practice|review|weakness","description":"说明","knowledge":"知识点","action":"对应动作"}],"weeklyPlan":[{"day":"周一","tasks":["任务1"],"totalMinutes":180}],"tips":["建议"]}

要求：
· dailyPlan 的总时长要贴近学生的可用时间；
· 每个任务的 task 要具体可执行（如"做 8 道导数求导题"，不要写"练习数学"）；
· action 字段写清楚学生点开这个任务该做什么，用下面四种之一：
    "开始课程：<课程主题>" / "重做错题：<知识点>" / "做练习：<题量>" / "复习：<内容>"
· 有薄弱点时，薄弱点优先；` + routineSystem,
    }, {
      role: 'user',
      content: `每日${hours}h。科目:${subjects.join('、')}。薄弱:${weaknesses.map(w => w.name).join('、') || '无'}。目标:${goal}分。当前:${current}分。距高考:${days}天` + focusLine + intensityLine + todayLine + routineLine,
    }], { maxTokens: 3000 });
  }

  // ══════════════════════════════════════════════════════════
  //  可视化课程（Course）—— 按需求生成课程，PPT 式分页 + 图解 + 互动
  // ══════════════════════════════════════════════════════════

  /**
   * ① 生成课程目录。
   * 返回 [{no,title,goal,minutes,points:[...]}] —— 只出大纲，快（学生确认后再逐节生成内容）。
   */
  async function courseOutline({ request, subject, grade, level, textbook, weakPoints }) {
    return await chatJSON([{
      role: 'system',
      content: `你是资深${subject || ''}老师，为学生定制一门**小而精**的课。

★ 重要（2026-10-25）：
1. **必须基于教科书**：先了解学生用的是哪本教材（人教版、苏教版等），
   按照教材章节顺序出目录。
2. **先诊断再推荐**：根据学生的知识点覆盖情况，
   推荐他现在应该学什么（不要让用户选）。
3. **要有前置知识**：如果学生某个知识点没学，要先安排前置知识。
4. **像老师一样**：根据学生的薄弱点和目标，主动推荐学习路径。

要求：
· 3~6 节，每节 10~25 分钟能学完
· 每节必须是一个**可检验的小目标**（如"会用五点法画 y=sin(2x) 一个周期"）
· 节与节之间要有**先后依赖**（前一节是后一节的工具）
· 第一版从"学生当前卡住的地方"切入，不要从课本第一章重讲

严格返回 JSON（不要代码块）：
{"title":"课程名","subject":"科目","summary":"一句话说明这门课解决什么",
  "outline":[{"no":1,"title":"小节名","goal":"学完能做到什么","minutes":15,
    "points":["这个点的要点1","要点2"],"keyFormula":"本节核心公式或方法（可为空字符串）",
    "prerequisite":"前置知识（如果学生没学，要先补）"}]}`,}, {
      role: 'user',
      content: '我想学：' + request
        + (subject ? '\n科目：' + subject : '')
        + (grade ? '\n年级：' + grade : '')
        + (level ? '\n我的水平：' + level : '')
        + (textbook ? '\n教材进度：' + textbook : '')
        + (weakPoints && weakPoints.length ? '\n我已知的薄弱点：' + weakPoints.join('、') : '')
        + '\n\n请按我的需求规划目录，不要照搬课本大纲。',
    }], { temperature: 0.5, maxTokens: 2600 });
  }

  /**
   * ② 生成单节内容 —— 可视化结构。
   * 每一节是一串"幻灯片"，每张幻灯片有一个版式类型：
   *   cover  封面（本节目标）
   *   concept 概念讲解（含图解）
   *   formula 公式/定理（居中大字 + 逐项说明）
   *   steps  步骤法（编号步骤板）
   *   example 例题（题干 + 分步演算 + 结论）
   *   compare 对比表（两栏对照，如"先平移"vs"先伸缩"）
   *   chart  图像/曲线（用 SVG 坐标图或数据点描述）
   *   tip    易错提醒
   *   summary 本节小结（要点清单）
   *   quiz   随堂练习（题目 + 选项/填空 + 答案解析）
   */
  async function courseLesson({ course, lesson, studentNote }) {
    return await chatJSON([{
      role: 'system',
      content: `你是${course.subject || ''}老师，正在给学生上「${lesson.title}」这一节。
本节目标：${lesson.goal || ''}
要点：${(lesson.points || []).join('；') || '（自行安排）'}

请把这节课做成**可视化的分页讲义**（像 PPT 一样一页一页翻），不是一大段文字。

每页 JSON 字段：
{"kind":"cover|concept|formula|steps|example|compare|chart|tip|summary|quiz",
 "title":"这一页的小标题",
 "body":"讲解正文（可用 \\n 换行；口语化、像老师说话，每段不超过 3 行）",
 "bullets":["要点1","要点2"],
 "formula":"公式或核心式（kind=formula 时必填，其它可空）",
 "formulaParts":[{"sym":"A","mean":"振幅，决定最高最低差多少"}],
 "steps":["第一步…","第二步…"],
 "compare":{"leftTitle":"先平移","rightTitle":"先伸缩","rows":[["做法","…"],["优点","…"],["易错","…"]]},
 "chart":{"type":"sine|parabola|line|bars|none","title":"y=sin(2x+π/3) 的图","note":"说明",
   "curves":[{"label":"原函数","color":"blue","points":[[0,0],[0.5,1],[1,0]]}],
   "xRange":[-6.28,6.28],"yRange":[-2,2]},
 "example":{"question":"题目","solution":["第一步…","第二步…"],"answer":"最终答案","why":"这题在考什么"},
 "quiz":{"question":"练习题目","type":"choice|fill","options":["A…","B…","C…","D…"],
   "answer":"正确答案","explain":"为什么","pitfall":"常见错法"}}

硬性要求：
· 8~14 页；顺序建议 cover → concept(1~2) → formula/steps(1~2) → example(1~2) → compare/chart(0~1) → tip(0~1) → summary → quiz(1~2)；
· **每节至少 1 个 example、至少 1 个 quiz**；数学/物理/化学尽量给 chart 或 formula；
· body 要像老师当面讲，不要书面语堆砌；不要出现"本页将介绍"这类空话；
· chart 的 points 用真实数值（自己算好），不要写"略"；
· quiz 的 answer 必须是选项字母或明确答案文本，explain 要讲清错因。

严格返回 JSON：{"pages":[...]}`, 
    }, {
      role: 'user',
      content: '请生成「' + lesson.title + '」这一节的分页讲义。'
        + (studentNote ? '\n\n学生特别提到：' + studentNote : '')
        + (course.grade ? '\n年级：' + course.grade : ''),
    }], { temperature: 0.6, maxTokens: 8000 });
  }

  /**
   * ③ 学员就某一页提问（互动核心）—— 引导式，不直接抛答案。
   */
  async function courseAsk({ course, lesson, page, question, history }) {
    const msgs = [{
      role: 'system',
      content: `你是${course.subject || ''}老师，学生正在学「${lesson.title}」。
当前这一页标题：${page.title || ''}
这一页内容：${String(page.body || '').slice(0, 600)}

学生提问时：
· 先判断他卡在哪一步，**针对那一步**重讲，不要从头再讲一遍；
· 先抛一个引导性问题让他自己想一想（如"你还记得 y=sin x 的周期怎么算吗"），再给讲解；
· 用新的角度/类比/更小的例子重讲，不要重复原文；
· 他反复不懂时，把这一步拆成更小的步骤；
· 全程口语化，像真人老师，不要客套话，不要"作为一个AI"。
不要输出 Markdown 标题符号，用短段落加换行即可。`,
    }];
    (history || []).slice(-6).forEach(h => msgs.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
    msgs.push({ role: 'user', content: question });
    const reply = await chat(msgs, { temperature: 0.7, maxTokens: 1600 });
    return { reply: reply };
  }

  /**
   * ④ 判随堂练习 + 错因分类。
   */
  async function courseGrade({ course, lesson, quiz, studentAnswer }) {
    return await chatJSON([{
      role: 'system',
      content: `你是${course.subject || ''}老师，判一道随堂练习。
错因分类只能从这些里选：计算失误 / 概念混淆 / 公式误用 / 审题偏差 / 方法不会 / 步骤不完整 / 粗心看错。
即使学生答对了，也要指出"关键一步是什么"，帮他确认真的会了。

严格返回 JSON：
{"correct":true或false,"score":0到100的整数,
 "reason":"错因（答对则填 '无'）",
 "comment":"一两句话点评，口语化",
 "keyStep":"做对这道题的关键一步",
 "nextTip":"下一步该注意什么"}`,
    }, {
      role: 'user',
      content: '题目：' + (quiz.question || '') + '\n'
        + (quiz.options && quiz.options.length ? '选项：' + quiz.options.join(' / ') + '\n' : '')
        + '正确答案：' + (quiz.answer || '') + '\n'
        + '标准解析：' + (quiz.explain || '') + '\n'
        + '学生作答：' + (studentAnswer || '（未作答）'),
    }], { temperature: 0.2, maxTokens: 900 });
  }

  /**
   * ⑤ 出错后出同类巩固题（换个数字/换个问法，考同一个点）。
   */
  async function coursePractice({ course, lesson, quiz, reason, count }) {
    return await chatJSON([{
      role: 'system',
      content: `针对学生刚做错的一道题，出同类巩固题。
要求：
· 考**同一个知识点**，但换数字、换问法、换情境，不要只改一个数；
· 由易到难（第 1 题确认概念，第 2 题变形，第 3 题综合）；
· 学生刚错在：${reason || '未知'}，所以要在这一步设置"防错设计"。

严格返回 JSON：
{"items":[{"question":"题目","type":"choice|fill","options":["A…","B…","C…","D…"],
 "answer":"答案","explain":"解析","focus":"这题在练什么"}]}`,
    }, {
      role: 'user',
      content: '原题：' + (quiz.question || '') + '\n正确答案：' + (quiz.answer || '')
        + '\n学生错因：' + (reason || '未判定')
        + '\n请出 ' + (count || 3) + ' 道同类题。',
    }], { temperature: 0.7, maxTokens: 2600 });
  }

  /**
   * ⑥ 学完整节的小结（把这一节真正学到的东西记进系统）
   */
  async function courseRecap({ course, lesson, wrongCount, askedCount }) {
    return await chatJSON([{
      role: 'system',
      content: `学生刚学完一节，请给出一段 2~3 句的收尾，并提取要记进错题本的点。
严格返回 JSON：{"recap":"收尾话","mastered":["已掌握的点"],"needWork":["还需巩固的点"],
 "mistakes":[{"knowledge":"知识点","question":"题目要点","reason":"错因"}]}`,
    }, {
      role: 'user',
      content: '课程：' + (course.title || '') + '\n本节：' + lesson.title
        + '\n本节目标：' + (lesson.goal || '')
        + '\n练习错误数：' + (wrongCount || 0)
        + '\n提问次数：' + (askedCount || 0),
    }], { temperature: 0.4, maxTokens: 1200 });
  }

  /**
   * 成绩估算：要模型给**两个**数字
   *   currentEstimate   —— 现在去高考能考多少（只由已有证据决定）   *   projectedEstimate —— 到高考时预计能考多少（结合剩余时间与每日投入）
   * 我们把已经算好的统计证据（题目合并正确率、样本量、趋势）交给它，让它做判断而不是瞎猜。
   */
  async function estimateScore({ current, goal, examDate, daysLeft, hoursPerDay, evidence, missing, localTotal, localProjected, subjectTargets }) {
    const days = daysLeft != null ? daysLeft
      : (examDate ? Math.max(1, Math.ceil((new Date(examDate) - new Date()) / 86400000)) : 180);

    const cov = (evidence || []).map(e =>
      `${e.subject}：满分${e.maxScore}，${e.现有试卷数}份卷/${e.已判定题目数}题，`
      + `做对${e.做对}错${e.做错}，题目正确率${e.题目正确率 == null ? '—' : (e.题目正确率 * 100).toFixed(1) + '%'}，`
      + `卷面平均${e.卷面平均得分率 == null ? '—' : (e.卷面平均得分率 * 100).toFixed(1) + '%'}`
      + (e.高考折算系数 != null ? `，已按高考难度折算 ×${e.高考折算系数} → 高考等效${e.高考等效得分率 == null ? '—' : (e.高考等效得分率 * 100).toFixed(1) + '%'}` : '')
      + (e.本卷难度档_1到5_3等于高考平均 != null
          ? `，本次卷子难度${e.本卷难度档_1到5_3等于高考平均}档（3=高考平均，>3偏难、<3偏易，难度修正×${e.本卷难度修正}）`
          : '，本卷难度未判定（按学科基准折算）')
      + (e.教材覆盖率 != null
          ? `，教材覆盖率${(e.教材覆盖率 * 100).toFixed(0)}%（来源${e.教材覆盖率来源 || 'AI折算'}；已学：${e.已学内容 || '—'}，`
            + `没学的章节高考里按0分算，已扣）`
          : '，教材进度未填或无法折算（这次没有按未学章节扣分）')
      + `，错题${e.错题数}条，趋势${e.趋势}，本地推算现在${e.本地推算现在分}、高考${e.本地推算高考分}`
    ).join('\n');

    const miss = (missing && missing.length) ? missing.join('、') : '（无）';
    const stList = (subjectTargets && Object.keys(subjectTargets).length)
      ? Object.keys(subjectTargets).map(s => s + ' ' + subjectTargets[s] + '分').join('、')
      : '（未设置）';

    return await chatJSON([{
      role: 'system',
      content: `你是高考成绩数据分析师。只根据给定证据推理，**严禁编造未提供的数据**。

要求你把两个分数区分开：
- currentEstimate = 学生**现在**去参加高考能考到的总分（只由已有证据决定，不含未来进步）
- projectedEstimate = 到**高考时**预计能考到的总分（= 现在水平 + 剩余时间内的合理进步）

关于进步幅度，必须遵守：
1) 分数越高的科目提升越慢（从 90% 提到 95% 比从 60% 提到 70% 难得多）；
2) 时间有边际递减，**不要把剩余天数线性换算成提分**；
3) 样本量小的科目（题目数少）要给更保守的估计，不要因为某科看起来高就当真；
4) 任何一科的预测都不得超过该科满分；
5) 不要为了讨好学生而虚高；
6) **卷子难度档是相对高考判定的（3=高考平均）**：低于 3 档说明这份卷子比高考容易，
   卷面分虚高，不要据此上调估计；高于 3 档才允许小幅上修，且不得推翻上面的保守原则。
7) **教材覆盖率已经扣过，且本地会强制**：没学的章节在高考里拿不到分，本地推算的"现在分"
   是覆盖率之后的数，也是每科 current 的硬上限（±10%）。不要以"他还有潜力"为由抬高
   ——潜力属于 projectedEstimate。你给的每科 current 若超出上限，会被本地拦下来。
8) **每科目标分（学生自己设的）**：${stList}。分析里要对照目标说清哪科差距最大、
   现在的节奏到高考能不能达到，达不到就直说差多少。

返回 JSON：
{"currentEstimate":数字或null,"projectedEstimate":数字或null,
 "subjectEstimates":{"语文":{"current":数字,"projected":数字},...},
 "confidence":0到1,"analysis":"200字内的整体分析","suggestion":"接下来30天最该做的一件事",
 "keyGains":[{"subject":"科目","gain":数字,"reason":"为什么这科能提这么多"}]}`,
    }, {
      role: 'user',
      content: `目标:${goal}分。距高考:${days}天。每日可用学习时间:${hoursPerDay || 3}小时。每科目标分:${stList}。`
        + `\n本地模型算出的参考值：现在${localTotal == null ? '—' : localTotal}分、高考${localProjected == null ? '—' : localProjected}分（已扣教材覆盖率；可用它校准，但你有理由可以偏离）。`
        + `\n\n【各科证据】\n${cov}`
        + `\n\n【完全没有数据的科目（这些必须返回 null，绝对不许补数字）】\n${miss}`,
    }], { maxTokens: 2500, temperature: 0.2 });
  }

  async function analyzeWeakness({ mistakes, records }) {
    return await chatJSON([{
      role: 'system',
      content: `你是教师，分析薄弱知识点。
返回 JSON: {"weaknesses":[{"name":"知识点","subject":"科目","level":"critical|warning|improving","errorRate":0.5,"occurrences":3,"suggestion":"建议","priority":1}],"summary":"总结"}`,
    }, {
      role: 'user',
      content: `错题:\n${JSON.stringify(mistakes.slice(-30), null, 2)}\n\n记录:\n${JSON.stringify(records.slice(-10), null, 2)}`,
    }], { maxTokens: 2500 });
  }

  /**
   * 教材覆盖率：把学生填的口语化进度（"刚上解析几何的直线"）折成
   * "高考卷里学过的考点占多少分"。这是只有大模型能做的判断：
   * ① 要懂口语（"必修的最后一本"=必修第三册）；② 要按教材版本知道全书结构；
   * ③ 各章在高考里的分值不一样（导数/圆锥曲线远大于集合/复数），不能数章节数。
   * 返回 {subject: {coverage:0~1, learned, remaining, reason}}；学不了的科不许编。
   */
  async function textbookCoverage({ digest }) {
    return await chatJSON([{
      role: 'system',
      content: `你是熟悉人教版/统编版/湘教版等各版高中教材结构和高考考纲的老师。学生用口语填了每科"教材学到哪"，你要把它折算成**高考考点覆盖率**。

规则：
1) coverage = 学过的内容在一张完整高考卷里能对应到的分值占比（0~1，可到两位小数）。按各章在高考的分值权重折算，不要简单数章节数——比如数学只上到必修一，覆盖率远小于 5/16，因为导数、圆锥曲线、数列占大头。
2) "学到某章/刚上某节"= 那一章以及之前都算学过；正在上的章节算学过（他在学）。
3) 要懂口语："必修的最后一本"=必修第三册，"解析几何的直线"=选择性必修第一册第二章直线和圆的方程，"大卫·科波菲尔"=统编版选择性必修上册第三单元。
4) 他填"上到选修一了"按选修一第一章算。
5) 高考不考的内容（比如数学的"集合与常用逻辑用语"占比很小）不计入权重；选考科目的高考范围只有选定的选考模块。
6) 只输出学生填了的科目。**学不了/看不懂的科目给 null，绝不编造。**
7) learned = 已学内容的一行概括（30字内），remaining = 还没学的主要章节（30字内），reason = 为什么是这个覆盖率（40字内，要说清高考分值权重）。

返回 JSON：
{"数学":{"coverage":0.31,"learned":"必修一全部+必修二到立体几何初步","remaining":"复数、统计概率、选必一二三","reason":"已学章节高考分值约31%，导数圆锥曲线数列未学"},"语文":{"coverage":null,...}}`,
    }, {
      role: 'user',
      content: `学生填的教材进度：\n${digest}`,
    }], { maxTokens: 2000, temperature: 0.1 });
  }

  /**
   * 多模态读图 —— 统一的图片输入入口。
   *
   * 走的是读图模型（默认 LongCat-2.5-Preview），与主对话模型解耦：
   * 主模型可以是纯文本的 deepseek，读图仍然正常。
   *
   * @param {Array<{mime:string,b64:string}>} images 已压缩过的图片
   * @param {string} prompt 文本指令（图片由本函数拼进去）
   * @param {object} opts {maxTokens, temperature, thinking, persona, provider}
   * @returns {Promise<string>} 模型返回的原始文本
   */
  async function vision(images, prompt, opts = {}) {
    /**
     * ★ WorkBuddy 读图分支（2026-10-17，自用测试）
     *   开了 WorkBuddy 之后，读图也走它，完全不花自己的 Key。
     *   放在最前面，这样"识别试卷"这个最费钱的环节也免费。
     */
    if (!opts.provider && typeof WB !== 'undefined' && WB.isEnabled()) {
      try {
        const r = await WB.vision(images, prompt, { model: opts.model });
        return { text: r.text, finishReason: 'stop', truncated: false, model: r.model };
      } catch (e) {
        // 走不通就回落到自己的读图模型，别让用户卡住
        console.warn('[学徒] WorkBuddy 读图失败，回落到自己的读图模型:', e.message);
      }
    }

    const vp = opts.provider || getVisionProvider();

    if (!vp.apiKey) {
      throw new Error('「' + (vp.name || vp.provider) + '」还没有 API Key。请到「设置 → 读图模型」里配置。');
    }
    if (!modelSupportsVision(vp.provider, vp.model)) {
      throw new Error('「' + vp.model + '」不支持图片输入。请到「设置 → 读图模型」里换成多模态模型（如 LongCat-2.5-Preview）。');
    }
    if (!images || !images.length) throw new Error('没有可识别的图片');

    const parts = [{ type: 'text', text: prompt }];
    images.forEach(function (img) {
      const mime = img.mime || 'image/jpeg';
      if (vp.isAnthropic) {
        // Anthropic 用 base64 图文块
        parts.push({ type: 'image', source: { type: 'base64', media_type: mime, data: img.b64 } });
      } else {
        // OpenAI 兼容格式（龙猫 / DeepSeek / 千问 / 智谱 / GPT 都是这个）
        parts.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + img.b64 } });
      }
    });

    try {
      const text = await chat([{ role: 'user', content: parts }], {
        _providerOverride: vp,
        maxTokens: opts.maxTokens || 8000,
        temperature: opts.temperature === undefined ? 0.2 : opts.temperature,
        thinking: opts.thinking === true,
        // 读题是机械抽取任务，默认不带人格与记忆，省 token 也更稳
        noPersona: opts.persona !== true,
      });
      const meta = getLastMeta();
      return { text: text, finishReason: meta.finishReason, truncated: !!meta.truncated, model: meta.model };
    } catch (e) {
      // 图片相关失败往往是"接法不对"而不是"网络挂了"，给一句能直接照做的提示
      const m = String(e && e.message || e);
      if (/400|415|422|invalid|image|content|multimodal|vision/i.test(m)) {
        throw new Error(m +
          '\n→ 排查建议：①到「设置 → 读图模型」点「测试读图」确认这个模型真能收图；' +
          '②若该模型不支持图片输入，换 LongCat-2.5-Preview / gpt-4o / qwen-omni-turbo / glm-4v-plus；' +
          '③图片已自动压到长边 1600px，若仍报体积错误可减少张数。');
      }
      throw e;
    }
  }

  /** 设置页的「测试读图」：发一张 1x1 的图，验证模型真的吃图片 */
  async function testVision(cfg) {
    const prev = getVisionConfig();
    let vp;
    if (cfg) {
      const p = PROVIDERS[cfg.provider] || PROVIDERS[MAIN_FALLBACK];
      vp = {
        provider: cfg.provider, name: p.name,
        baseUrl: cfg.provider === 'custom' ? (cfg.baseUrl || '') : p.baseUrl,
        apiKey: cfg.apiKey || Storage.getProviderKey(cfg.provider),
        model: cfg.model, isAnthropic: !!p.isAnthropic, thinkingBody: p.thinkingBody,
      };
    } else {
      vp = getVisionProvider();
    }
    if (!vp.apiKey) throw new Error('请先填写读图模型的 API Key');
    if (!modelSupportsVision(vp.provider, vp.model)) {
      throw new Error('「' + vp.model + '」不在已知支持图片的模型列表里');
    }

    // 一张 2x2 的白色 PNG，足够验证链路能收图片
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8Dwn4GBgYGJAQoAHgQCAZ7iErsAAAAASUVORK5CYII=';
    const r = await vision([{ mime: 'image/png', b64: b64 }],
      '这是一张测试图。请只回复两个字：收到。', { maxTokens: 64, temperature: 0 });
    return { ok: true, model: vp.model, reply: String(r.text || '').slice(0, 40) };
  }

  async function recognizeImage(b64, mime = 'image/jpeg') {
    const r = await vision([{ mime: mime, b64: b64 }],
      '识别图片中的题目。只返回 JSON：{"title":"","content":"","questions":[{"text":"","options":["A.x"]}],"subject":"科目"}',
      { maxTokens: 2500 });
    return parseLooseJSON(r.text);
  }

  /**
   * 模型常把字符串里的换行直接写成真实换行（JSON 里非法）。
   * 这里把字符串内部的裸 \n \r \t 转义掉，不动结构。
   */
  function sanitizeJSONStrings(s) {
    let out = '', inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { out += ch; esc = false; continue; }
        if (ch === '\\') { out += ch; esc = true; continue; }
        if (ch === '"') { out += ch; inStr = false; continue; }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { out += '\\r'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        out += ch;
        continue;
      }
      if (ch === '"') inStr = true;
      out += ch;
    }
    return out;
  }

  /** 容错 JSON 解析：去围栏 → 直接解析 → 转义裸换行 → 截取括号 → 修补截断 */
  function parseLooseJSON(text) {
    let s = String(text == null ? '' : text).trim();
    if (!s) throw new Error('AI 返回为空');

    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) s = fence[1].trim();

    try { return JSON.parse(s); } catch (e) { /* 继续 */ }

    // 去掉末尾多余的围栏，再试"字符串里有裸换行"的情况
    let t = s.replace(/```[\s\S]*$/, '').trim();
    try { return JSON.parse(sanitizeJSONStrings(t)); } catch (e) { /* 继续 */ }

    // 从第一个 { 或 [ 开始，处理"前后有解释文字"
    let a = t.search(/[{[]/);
    if (a < 0) {
      const err = new Error('AI 返回的不是有效 JSON');
      err.raw = s;
      throw err;
    }
    const tail = t.slice(a);

    // 到最后一个 } 或 ] 的完整片段
    const b = Math.max(tail.lastIndexOf('}'), tail.lastIndexOf(']'));
    if (b > 0) {
      const body = tail.slice(0, b + 1);
      try { return JSON.parse(body); } catch (e) { /* 继续 */ }
      try { return JSON.parse(sanitizeJSONStrings(body)); } catch (e) { /* 继续 */ }
    }

    // 被 max_tokens 截断：整个尾巴当地候修补（不能先截到最后一个 }，
    // 那会丢掉截断点之后的半截内容，修补出来的对象会缺字段）
    const fixed = repairTruncatedJSON(sanitizeJSONStrings(tail).replace(/[\s,]+$/, ''));
    if (fixed !== null && fixed !== undefined) return fixed;

    const err = new Error('AI 返回的不是有效 JSON');
    err.raw = s;
    throw err;
  }

  /** 统计括号/字符串状态；结构错乱返回 null */
  function braceState(s) {
    let cu = 0, sq = 0, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') cu++;
      else if (ch === '}') cu--;
      else if (ch === '[') sq++;
      else if (ch === ']') sq--;
      if (cu < 0 || sq < 0) return null;
    }
    if (inStr && esc) return null;
    return { cu: cu, sq: sq, inStr: inStr };
  }

  /** 输出被 max_tokens 截断时，回退到最后一个完整元素并补齐括号 */
  function repairTruncatedJSON(s) {
    let t = String(s).replace(/[\s,]+$/, '');
    for (let attempt = 0; attempt < 400 && t.length > 1; attempt++) {
      const st = braceState(t);
      if (st) {
        const cand = t + (st.inStr ? '"' : '') + ']'.repeat(st.sq) + '}'.repeat(st.cu);
        try { return JSON.parse(cand); } catch (e) { /* 继续回退 */ }
      }
      let cut = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
      if (cut < 0) cut = t.lastIndexOf('"');
      if (cut < 0) return null;
      t = t.slice(0, cut + 1).replace(/[\s,]+$/, '');
    }
    return null;
  }

  // ══ 连接测试（使用 XHR） ══
  async function testConnection(cfg) {
    /**
     * ★ 改用 diagnose（2026-10-18）
     *   原来这里自己拼 URL、自己解析错误，和 chat() 的逻辑重复且不一致。
     *   现在统一走 diagnose()：它会先做配置自检，再真发一次请求，
     *   并把"打到哪、返回什么、该怎么改"整理成人话。
     *
     *   如果传了 cfg（用户在表单里改了还没保存），就临时用这份配置试。
     */
    if (cfg) {
      // 用临时配置试一次，不动已保存的
      const saved = getConfig();
      try {
        saveConfig({ ...cfg, enabled: true });
        const r = await diagnose();
        if (!r.ok) throw new Error(r.error);
        return { model: r.model, reply: r.reply };
      } finally {
        // 还原（用户可能只是测试，没打算保存）
        Storage.set('llm_config', saved);
      }
    }
    const r = await diagnose();
    if (!r.ok) {
      const err = new Error(r.error);
      err.diagnosis = r;
      throw err;
    }
    return { model: r.model, reply: r.reply };
  }

  /**
   * ★ 连接诊断（2026-10-18 新增）
   *
   * 为什么需要：用户配置错误时只看到一个 401，不知道该改什么。
   * 这个函数把"实际请求的 URL / 模型 / Key 前几位 / 返回了什么"全列出来，
   * 界面直接展示，用户能自己判断是哪里填错了。
   */
  async function diagnose() {
    const cfg = getConfig();
    const p = getProvider();
    const info = {
      provider: cfg.provider,
      providerName: (PROVIDERS[cfg.provider] || {}).name || cfg.provider,
      baseUrl: p.baseUrl || '',
      model: p.model || getDefaultModel(cfg.provider) || '(未设置)',
      url: (p.baseUrl || '').replace(/\/$/, '') + '/chat/completions',
      keyPresent: !!p.apiKey,
      keyPrefix: p.apiKey ? (p.apiKey.slice(0, 6) + '…' + p.apiKey.slice(-4)) : '',
      keyLength: p.apiKey ? p.apiKey.length : 0,
      workbuddy: (typeof WB !== 'undefined' && WB.available()) ? WB.isEnabled() : false,
      ok: false,
      error: '',
      hint: '',
    };

    // 配置自检（不发请求就能发现的错）
    const problems = [];
    if (!info.workbuddy) {
      if (!info.baseUrl) problems.push('没填接口地址（baseUrl）');
      else if (!/^https?:\/\//i.test(info.baseUrl)) problems.push('接口地址必须以 http:// 或 https:// 开头');
      if (!info.keyPresent) problems.push('没填 API Key');
      if (!info.model || info.model === '(未设置)') problems.push('没选模型');
      if (info.baseUrl && /\/chat\/completions$/i.test(info.baseUrl)) {
        problems.push('接口地址里不要带 /chat/completions（程序会自动加）');
      }
      if (info.baseUrl && !/\/v\d+$/i.test(info.baseUrl) && /openai|deepseek|dashscope|moonshot|bigmodel/i.test(info.baseUrl)) {
        problems.push('这个地址可能少了 /v1（如 https://api.deepseek.com/v1）');
      }
    }

    if (problems.length) {
      info.error = problems.join('；');
      info.hint = '配置有问题，还没发请求就已经能看出来。';
      return info;
    }

    // 真发一次
    try {
      const t = await chat([{ role: 'user', content: '只回复两个字：正常' }],
        { maxTokens: 20, timeoutMs: 30000 });
      info.ok = true;
      info.reply = String(t || '').slice(0, 50);
      info.hint = '连接正常';
    } catch (e) {
      info.error = String(e.message || e);
      if (/网关|不是模型服务/.test(info.error)) {
        info.hint = '这个地址返回的是网页，不是 API。换一个真正的接口地址，或者用 WorkBuddy。';
      } else if (/401|Key 无效/.test(info.error)) {
        info.hint = 'Key 不对。去供应商后台重新复制一个，注意不要带空格。';
      } else if (/超时/.test(info.error)) {
        info.hint = '网络不通，或者这个地址本来就访问不了。';
      } else if (/404/.test(info.error)) {
        info.hint = '地址或模型名不对。检查 baseUrl 结尾是不是 /v1。';
      }
    }
    return info;
  }

  /**
   * ★ 从 API 拉取真实模型列表（2026-10-31 修订）
   *
   * 各家模型 ID 更新很快，硬编码清单总会过时。
   * 用用户自己的 key 查 /models，拿到服务端真实支持的模型。
   *
   * 已处理三家的差异：
   *   · Anthropic 鉴权用 x-api-key，不是 Bearer
   *   · 千问返回 {output:{models:[{model}]}}，不是 {data:[{id}]}
   *   · OpenAI 返回带 shutdown_date，会顺带给出"90 天内下线"预警
   *
   * @returns {Promise<{ok, models:string[], sunsetting?:Array, error?:string}>}
   */
  async function listModels(cfg) {
    const c = cfg || getConfig();
    if (!c.apiKey) return { ok: false, models: [], error: '还没填 API Key' };
    if (!c.baseUrl) return { ok: false, models: [], error: '没有 API 地址' };

    const base = String(c.baseUrl).replace(/\/$/, '');
    const isAnthropic = /anthropic\.com/.test(base);
    const isQwen = /dashscope|aliyuncs/.test(base);

    /**
     * ★ 各家鉴权方式不同（2026-10-31 修）
     *
     * OpenAI 兼容：Authorization: Bearer
     * Anthropic ：x-api-key + anthropic-version（发 Bearer 一定 401）
     */
    const headers = isAnthropic
      ? {
          'x-api-key': c.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        }
      : { 'Authorization': 'Bearer ' + c.apiKey };

    /**
     * ★ 各家 URL 不同（2026-10-31 修）
     *
     * Anthropic：/v1/models（baseUrl 本身已含 /v1）
     * 千问     ：官方是 GET /api/v1/models，但兼容模式 /compatible-mode/v1/models
     *            也能用（会返回 OpenAI 兼容结构）
     * 其他     ：baseUrl + /models
     */
    let url;
    if (isQwen) {
      // 千问兼容模式：保留 /compatible-mode/v1 + /models
      url = base + '/models';
    } else {
      url = base + '/models';
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const resp = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);

      if (!resp.ok) {
        let hint = '';
        if (resp.status === 401 || resp.status === 403) hint = '（Key 不对，或这家用别的鉴权方式）';
        if (resp.status === 404) hint = '（这个服务商不支持列模型，直接手填模型名）';
        return { ok: false, models: [], error: 'HTTP ' + resp.status + hint };
      }

      const j = await resp.json();

      /**
       * ★ 各家返回结构不同（2026-10-31 修）
       *
       * OpenAI 兼容：{ data: [{ id, shutdown_date? }] }
       * 千问原生  ：{ output: { models: [{ model, ... }], total } }
       * Anthropic ：{ data: [{ id, display_name }] }
       */
      let raw = [];
      if (Array.isArray(j.data)) raw = j.data;
      else if (j.output && Array.isArray(j.output.models)) raw = j.output.models;
      else if (Array.isArray(j.models)) raw = j.models;

      const models = [];
      const sunsetting = [];

      raw.forEach(function (m) {
        const id = typeof m === 'string' ? m : (m.id || m.model || m.name);
        if (!id) return;
        models.push(id);

        // ★ OpenAI 的下线预警（2026-10-31）
        //   官方 /v1/models 会给每个模型带 shutdown_date（YYYY-MM-DD）
        if (m.shutdown_date) {
          const days = Math.ceil((new Date(m.shutdown_date) - new Date()) / 86400000);
          if (days >= 0 && days <= 90) {
            sunsetting.push({ id: id, date: m.shutdown_date, days: days });
          }
        }
      });

      models.sort();

      if (!models.length) {
        return {
          ok: false,
          models: [],
          error: '接口通了但没解析出模型（这家返回结构可能变了），直接手填模型名即可',
        };
      }

      return { ok: true, models: models, sunsetting: sunsetting };
    } catch (e) {
      return { ok: false, models: [], error: e.message };
    }
  }

  return {
    listModels,
    
    PROVIDERS,
    diagnose, getConfig, saveConfig, getProvider, setPersona,
    chat, chatJSON, chatRaw, getLastMeta, parseLooseJSON,
    vision, testVision, recognizeImage,
    modelSupportsVision, listVisionModels,
    getVisionConfig, saveVisionConfig, getVisionProvider, DEFAULT_VISION,
    generateQuiz, analyzeQuiz, generateStudyPlan,
    courseOutline, courseLesson, courseAsk, courseGrade, coursePractice, courseRecap,
    estimateScore, analyzeWeakness, textbookCoverage,
    testConnection, getDefaultModel,
  };
})();
