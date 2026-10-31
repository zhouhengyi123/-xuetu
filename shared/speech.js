/**
 * 课程朗读（TTS）—— 让老师真的"讲"出声。
 *
 * ⚠️ 当前状态（2026-10-17）：**暂未启用**。
 *   之前本地部署的 MOSS-TTS-Nano（728MB 模型）已不在磁盘上，用户决定后续改接 API。
 *   所以现在 running 时会探测不到服务、明确提示"暂未启用"，而不是假装能播。
 *   代码完整保留，接上任何提供 /health 与 /tts.wav 的服务就能直接工作。
 *
 * 引擎设计（原计划）：**MOSS-TTS-Nano**（OpenMOSS 出品，0.1B，CPU 实时，48kHz）
 *   为什么不用浏览器自带的 Web Speech API：
 *     用户实测它的中文太"人机"，所以要自己的声音。
 *
 * 它跑在一个独立服务里（默认 127.0.0.1:8123），因为模型太大，浏览器里跑不了。
 *
 * 本模块负责：
 *   ① 探测服务是否在跑（不在就提示用户，而不是静默失败）
 *   ② 把"一页讲义"转成朗读文本 —— **练习页绝不念答案**，
 *      数学符号转成能读出来的话（ω→欧米伽、π→派、x²→x 的平方）
 *   ③ 播放控制：整页连读、句间无缝、随时打断、翻页自动读
 *   ④ 音色/语速选择（存 localStorage）
 *
 * 播放方式：把每句话的 URL 交给 <audio> 依次播放。
 *   不用 <audio src=整页> 的原因：整页要等十几秒才出声；
 *   按句请求能"第一句 1~3 秒就出声"，后面的句子边播边合成（预取下一句）。
 */
const Speech = (() => {
  const KEY_VOICE = 'tts_voice';      // 选中的音色
  const KEY_RATE = 'tts_rate';        // 语速（MOSS 走服务端，前端做播放速率）
  const KEY_AUTO = 'tts_auto';        // 翻页自动朗读
  const KEY_BASE = 'tts_base';        // 服务地址（用户可改）

  const DEFAULT_BASE = 'http://127.0.0.1:8123';

  let base = null;
  let health = null;                  // {ok, loaded, voices, ...}
  let healthCheckedAt = 0;
  let listeners = [];

  // 播放状态
  let audio = null;                   // 当前 <audio>
  let plan = [];                      // 待播句子 [{text}]
  let idx = 0;
  let playing = false;
  let paused = false;
  let prefetch = null;                // 预取的下一句 URL
  let session = 0;                    // 会话号：切页/重播时 +1，用于丢弃旧回调
  let lastError = '';

  function emit() { listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
  function on(fn) { listeners.push(fn); }
  function off(fn) { listeners = listeners.filter(f => f !== fn); }

  function apiBase() {
    if (base == null) base = Storage.get(KEY_BASE, DEFAULT_BASE) || DEFAULT_BASE;
    return String(base).replace(/\/$/, '');
  }
  function setBase(u) { base = String(u || '').trim() || DEFAULT_BASE; Storage.set(KEY_BASE, base); health = null; emit(); }

  /** 探测服务。返回 health 对象；服务没起时 ok:false 且带原因。 */
  async function check(force) {
    const now = Date.now();
    if (!force && health && now - healthCheckedAt < 15000) return health;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(apiBase() + '/health', { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      health = await r.json();
      health.ok = true;
    } catch (e) {
      health = {
        ok: false,
        reason: (e && e.name === 'AbortError') ? '连接超时' : (e && e.message) || '连接失败',
        voices: [],
      };
    }
    healthCheckedAt = Date.now();
    emit();
    return health;
  }
  function serviceOk() { return !!(health && health.ok); }
  function voices() { return (health && health.voices) || []; }
  function voice() {
    const want = Storage.get(KEY_VOICE, '');
    const vs = voices();
    if (want && vs.some(v => v.id === want)) return want;
    return (health && health.default_voice) || 'Xiaoyu';
  }
  function setVoice(id) { Storage.set(KEY_VOICE, String(id || '')); emit(); }
  function rate() {
    const r = Number(Storage.get(KEY_RATE, 1));
    return isFinite(r) && r >= 0.5 && r <= 2 ? r : 1;
  }
  function setRate(r) { Storage.set(KEY_RATE, Number(r) || 1); if (audio) audio.playbackRate = rate(); emit(); }
  function autoRead() { return !!Storage.get(KEY_AUTO, false); }
  function setAutoRead(v) { Storage.set(KEY_AUTO, !!v); emit(); }

  // ══════════════════════════════════════════════════════════
  //  文本 → 可朗读的话
  // ══════════════════════════════════════════════════════════
  /**
   * 数学符号口语化。不处理的话，模型会念"omega"、把 x² 读成"x2"或直接跳过。
   * 这是"像老师在讲"和"像机器念符号"的分界。
   */
  const SPEAK_MAP = [
    [/\bAsin\b/g, 'A 倍的 sin'],
    [/ω/g, '欧米伽'], [/φ/g, 'fai'], [/π/g, '派'], [/θ/g, '西塔'],
    [/α/g, '阿尔法'], [/β/g, '贝塔'], [/γ/g, '伽马'],
    [/≤/g, '小于等于'], [/≥/g, '大于等于'], [/≠/g, '不等于'], [/≈/g, '约等于'],
    [/→/g, '到'], [/×/g, '乘'], [/÷/g, '除以'], [/±/g, '正负'], [/∞/g, '无穷'],
    [/²/g, ' 的平方'], [/³/g, ' 的立方'],
    [/∈/g, '属于'], [/⊂/g, '包含于'], [/∪/g, '并集'], [/∩/g, '交集'], [/∑/g, '求和'], [/√/g, '根号'],
    [/%/g, '百分之'],
    // 常见的英文字母变量，让它念字母而不是单词
    [/\bk\b/g, 'k'], [/\ba\b/g, 'a'],
  ];
  function speakable(text) {
    let t = String(text == null ? '' : text);
    // 去掉 Markdown 标记（**粗体**、`代码`、行首 # 与 -）
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
    t = t.replace(/^#{1,6}\s*/gm, '').replace(/^[-*·•]\s*/gm, '');
    SPEAK_MAP.forEach(([re, rep]) => { t = t.replace(re, rep); });
    return t.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  }

  /**
   * 把一页讲义转成朗读文本（一串句子）。
   * ★ 练习页只念题目和选项，**绝不念 answer/explain/pitfall**，
   *   否则就是把答案念出来（和刚修掉的"答案自己跳出来"是同一类错误）。
   */
  function pageToTexts(page) {
    if (!page) return [];
    const out = [];
    const push = (s) => { const v = speakable(s); if (v) out.push(v); };

    if (page.kind === 'quiz' && page.quiz) {
      push(page.title);
      push(page.quiz.question);
      if (Array.isArray(page.quiz.options) && page.quiz.options.length) {
        push('选项：' + page.quiz.options.map(o => speakable(String(o))).join('；'));
      } else {
        push('请你想一想，然后在下面写出答案。');
      }
      return out;
    }

    push(page.title);

    if (page.kind === 'example' && page.example) {
      push(page.example.question);
      if (page.example.solution && page.example.solution.length) {
        push('解：' + page.example.solution.map(speakable).join('。'));
      }
      if (page.example.answer) push('所以答案是：' + page.example.answer + '。');
      if (page.example.why) push('这道题考的是：' + page.example.why + '。');
      return out;
    }

    push(page.body);
    if (page.formula) push('核心公式：' + page.formula + '。');
    if (Array.isArray(page.formulaParts) && page.formulaParts.length) {
      push(page.formulaParts.map(x => (x.sym || '') + ' 表示 ' + speakable(x.mean || '')).join('；') + '。');
    }
    if (Array.isArray(page.steps) && page.steps.length) {
      push('步骤是：' + page.steps.map((s, i) => '第' + (i + 1) + '步，' + speakable(s)).join('。') + '。');
    }
    if (Array.isArray(page.bullets) && page.bullets.length) {
      push(page.bullets.map(speakable).join('。') + '。');
    }
    if (page.compare) {
      const c = page.compare;
      push('对比一下：' + (c.leftTitle || '') + '，和' + (c.rightTitle || '') + '。');
      (c.rows || []).forEach(r => {
        if (r) push(speakable((r[0] || '') + '：' + (r[1] || '') + '，' + (r[2] || '') + '。'));
      });
    }
    if (page.chart && page.chart.note) push(page.chart.note);
    return out;
  }

  /** 单句再切短（服务端也会切；这里切是为了"更早出声"和请求更小） */
  function chop(text, max) {
    const m = max || 60;
    if (text.length <= m) return [text];
    const out = [];
    let buf = '';
    text.split(/(?<=[。！？；，、!?;,])/).forEach(s => {
      if ((buf + s).length > m && buf) { out.push(buf); buf = ''; }
      if (s.length > m) {
        for (let i = 0; i < s.length; i += m) out.push(s.slice(i, i + m));
      } else buf += s;
    });
    if (buf.trim()) out.push(buf.trim());
    return out.filter(x => x.trim());
  }

  // ══════════════════════════════════════════════════════════
  //  播放
  // ══════════════════════════════════════════════════════════
  function urlFor(text, voiceId) {
    return apiBase() + '/tts.wav?text=' + encodeURIComponent(text)
      + '&voice=' + encodeURIComponent(voiceId || voice());
  }

  /**
   * 读一页（把整页切成句子，逐句请求、边播边取下一句）。
   * opts.onProgress(i, total) 用于 UI 显示读到第几句。
   */
  async function speakPage(page, opts) {
    const texts = pageToTexts(page);
    let flat = [];
    texts.forEach(t => { chop(t).forEach(x => flat.push(x)); });
    return speakList(flat, opts);
  }

  /** 读一串句子 */
  async function speakList(texts, opts) {
    opts = opts || {};
    stop();
    if (!texts || !texts.length) { lastError = '这一页没有可朗读的内容'; emit(); return false; }

    const h = await check();
    if (!h.ok) {
      // ★ 当前是"暂未接入"状态，措辞要如实，别让用户以为是自己搞坏了
      lastError = '朗读功能暂未启用（语音服务未接入：' + (h.reason || '连不上') + '）';
      emit();
      if (opts.onError) opts.onError(lastError);
      return false;
    }

    session++;
    const my = session;
    plan = texts.slice();
    idx = 0;
    playing = true;
    paused = false;
    lastError = '';
    emit();

    playFrom(my, opts);
    return true;
  }

  function playFrom(my, opts) {
    if (my !== session || !playing) return;
    if (idx >= plan.length) {
      playing = false;
      emit();
      if (opts && opts.onDone) opts.onDone();
      return;
    }
    const txt = plan[idx];
    const a = new Audio();
    a.preload = 'auto';
    a.playbackRate = rate();
    audio = a;
    let started = false;

    const advance = (err) => {
      if (my !== session) return;
      if (err) {
        lastError = '这段没合成出来：' + err;
        emit();
        if (opts && opts.onError) opts.onError(lastError);
      }
      idx++;
      if (opts && opts.onProgress) opts.onProgress(idx, plan.length);
      playFrom(my, opts);
    };

    a.onended = () => advance(null);
    a.onerror = () => advance('音频加载失败');
    a.onplaying = () => { if (!started) { started = true; emit(); } };

    a.src = urlFor(txt);
    const p = a.play();
    if (p && p.catch) {
      p.catch(e => {
        // 浏览器要求用户手势才能自动播放：这种情况下标记出来，让 UI 提示点一下
        if (e && /NotAllowedError|user gesture/i.test(e.message || '')) {
          playing = false;
          lastError = '浏览器要求先点一下页面才能出声（点「朗读」按钮即可）';
          emit();
          if (opts && opts.onError) opts.onError(lastError);
        } else {
          advance(e && e.message);
        }
      });
    }

    // 提前把下一句的音频拉进缓存，做到句间无缝
    if (prefetch) { try { prefetch.src = ''; } catch (e) {} }
    if (plan[idx + 1]) {
      prefetch = new Audio();
      prefetch.preload = 'auto';
      prefetch.src = urlFor(plan[idx + 1]);
    }
  }

  function stop() {
    session++;
    playing = false;
    paused = false;
    plan = [];
    idx = 0;
    if (audio) { try { audio.pause(); audio.src = ''; } catch (e) {} audio = null; }
    if (prefetch) { try { prefetch.src = ''; } catch (e) {} prefetch = null; }
    emit();
  }
  function pause() {
    if (audio && playing) { try { audio.pause(); } catch (e) {} paused = true; emit(); }
  }
  function resume() {
    if (audio && paused) { try { audio.play(); } catch (e) {} paused = false; emit(); }
  }
  function isPlaying() { return playing && !paused; }
  function isPaused() { return paused; }
  function errorText() { return lastError; }
  /** 当前进度（读到第几句 / 共几句），UI 用来显示 */
  function progress() { return { idx: idx, total: plan.length }; }

  return {
    check, serviceOk, voices, voice, setVoice,
    rate, setRate, autoRead, setAutoRead,
    apiBase, setBase,
    speakable, pageToTexts, chop,
    speakPage, speakList,
    stop, pause, resume, isPlaying, isPaused, errorText, progress,
    on, off, emit,
  };
})();
