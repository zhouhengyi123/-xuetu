/**
 * 教学知识库（Teaching）2026-11-01
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要它
 * ══════════════════════════════════════════════════════════════
 * 前面的 Memory 三层记的是「这个学生」：
 *   ① 档案（他是谁）② 对话（聊过什么）③ 事件（做过什么）
 *
 * 但 AI 还缺一类知识：**老师在长期教学里积累的经验**。
 *   · 「导数含参讨论，学生总在分类标准上漏情况」
 *   · 「电磁感应楞次定律，先教右手定则再讲楞次，顺序反了必错」
 *   · 「这份考点梳理是学校教研组给的」
 *
 * 这类数据的特点：
 *   · 是**通用知识**，不属于某一个学生 → 不该进档案记忆
 *   · 是**长文本**，不能全塞进 prompt → 必须按科目/关键词检索
 *   · 是**用户自己的资料**，要能导入、编辑、删除、导出
 *
 * ══════════════════════════════════════════════════════════════
 * 设计原则
 * ══════════════════════════════════════════════════════════════
 *   · **零依赖**：不引向量库、不引 embed 模型、不联网。
 *     检索用「中文二元组 + 关键词命中 + 科目过滤 + 重要度」打分，
 *     在本机几 KB~几 MB 的资料量下足够准，且离线可用。
 *   · **多种来源**：纯文本 / Markdown / JSON / CSV 都能进。
 *   · **可解释**：每条经验带科目、标签、重要度、来源，AI 引用时能说清出处。
 *   · **有上限**：注入 prompt 的字符数硬上限，绝不因资料多把上下文撑爆。
 *
 * 数据结构（Storage key: teaching_notes）
 *   {
 *     id, title, subject, tags[], kind, importance(1-5),
 *     content, source, createdAt, updatedAt, usedCount
 *   }
 */
const Teaching = (() => {

  const KEY = 'teaching_notes';       // 用户自己导入的
  const KEY_STATS = 'teaching_stats';
  const KEY_BUILTIN_OFF = 'teaching_builtin_off';   // 用户禁用的内置条目 id
  const KEY_BUILTIN_CACHE = 'teaching_builtin_cache'; // 内置库快照（便于检索加速/统计）

  /**
   * ★ 内置知识库（2026-11-01）
   *
   * 用户要求：「不要每次都把所有教学经验读一遍，而是内置大量经验，
   * 根据用户需要提取对应内容」。
   *
   * 做法：
   *   · 内置条目来自 shared/teaching-builtin.js（上百条，见该文件）
   *   · **不存进 localStorage**（省空间，且随版本升级自动更新）
   *   · 检索时和用户条目一起打分，但每次注入上限只有 3~4 条 / 约 1200 字
   *   · 用户可单独禁用某条内置条目（KEY_BUILTIN_OFF）
   *
   * 结果：库可以很大，但进 prompt 的永远只是最相关的那几条。
   */
  function builtinRaw() {
    try {
      if (typeof TEACHING_BUILTIN !== 'undefined' && Array.isArray(TEACHING_BUILTIN)) {
        return TEACHING_BUILTIN;
      }
    } catch (e) {}
    return [];
  }

  function builtinDisabled() {
    try {
      const v = Storage.get(KEY_BUILTIN_OFF, []);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  /** 把内置条目转成统一结构（id 稳定：bi-<下标>，便于禁用） */
  function builtinNotes() {
    const off = builtinDisabled();
    const out = [];
    builtinRaw().forEach((x, i) => {
      const id = 'bi-' + i;
      if (off.indexOf(id) >= 0) return;
      out.push({
        id,
        title: x.t,
        subject: normSubject(x.s),
        tags: Array.isArray(x.g) ? x.g : [],
        kind: KINDS[x.k] ? x.k : 'experience',
        importance: clampImportance(x.i),
        content: x.c,
        source: 'builtin',
        builtin: true,
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        usedCount: 0,
      });
    });
    return out;
  }

  /** 用户导入的条目 */
  function userNotes() {
    return all();
  }

  /** 全部可检索条目（用户 + 内置） */
  function allNotes() {
    return userNotes().concat(builtinNotes());
  }

  /** 单条正文上限，防止一条把整个 prompt 吃掉 */
  const MAX_CONTENT = 8000;
  /** 注入 prompt 的总字符预算 */
  const INJECT_BUDGET = 1600;
  /** 最多注入几条 */
  const INJECT_MAX_ITEMS = 4;

  /** 经验类型 */
  const KINDS = {
    experience: '教学经验',
    knowledge: '知识点',
    method: '解题方法',
    pitfall: '易错陷阱',
    exam: '考点梳理',
    question: '典型题',
    other: '其他',
  };

  // ────────────────────────────────────────────────
  //  基础读写
  // ────────────────────────────────────────────────

  function all() {
    try {
      const v = Storage.get(KEY, []);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try { Storage.set(KEY, list); return true; } catch (e) { return false; }
  }

  function newId() {
    return 'tn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function clampImportance(v) {
    const n = Number(v);
    if (!isFinite(n)) return 3;
    return Math.max(1, Math.min(5, Math.round(n)));
  }

  function normSubject(s) {
    const v = String(s || '').trim();
    if (!v || v === '通用' || v === '全部' || v === '综合') return '';
    // 允许「数学（理）」这类写法，取前缀匹配到的标准科目
    try {
      const all = (typeof ALL_SUBJECTS !== 'undefined') ? ALL_SUBJECTS : [];
      for (const sub of all) {
        if (v === sub || v.startsWith(sub)) return sub;
      }
    } catch (e) {}
    return v;
  }

  function normTags(t) {
    let arr = t;
    if (typeof t === 'string') arr = t.split(/[,，、;；\s]+/);
    if (!Array.isArray(arr)) return [];
    const out = [];
    arr.forEach(x => {
      const s = String(x || '').trim().replace(/^#/, '');
      if (s && s.length <= 20 && out.indexOf(s) < 0) out.push(s);
    });
    return out.slice(0, 12);
  }

  /**
   * 新增或更新一条。传 id 且已存在 = 更新。
   * @returns {object|null} 落库后的对象
   */
  function upsert(note) {
    if (!note || typeof note !== 'object') return null;
    const content = String(note.content || '').trim();
    const title = String(note.title || '').trim();
    if (!content && !title) return null;

    const list = all();
    const now = new Date().toISOString();
    let item = null;

    if (note.id) {
      const i = list.findIndex(x => x.id === note.id);
      if (i >= 0) {
        item = list[i];
        item.title = title || item.title;
        item.content = content.slice(0, MAX_CONTENT) || item.content;
        item.subject = normSubject(note.subject != null ? note.subject : item.subject);
        if (note.tags != null) item.tags = normTags(note.tags);
        if (note.kind) item.kind = KINDS[note.kind] ? note.kind : item.kind;
        if (note.importance != null) item.importance = clampImportance(note.importance);
        if (note.source != null) item.source = String(note.source).slice(0, 200);
        item.updatedAt = now;
      }
    }

    if (!item) {
      item = {
        id: note.id || newId(),
        title: title || (content.slice(0, 24).replace(/\s+/g, ' ') || '未命名'),
        subject: normSubject(note.subject),
        tags: normTags(note.tags),
        kind: KINDS[note.kind] ? note.kind : 'experience',
        importance: clampImportance(note.importance),
        content: content.slice(0, MAX_CONTENT),
        source: String(note.source || 'manual').slice(0, 200),
        createdAt: now,
        updatedAt: now,
        usedCount: 0,
      };
      list.push(item);
    }

    save(list);
    return item;
  }

  function remove(id) {
    const list = all();
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    return save(list);
  }

  function clear() {
    return save([]);
  }

  function get(id) {
    return all().find(x => x.id === id) || null;
  }

  // ────────────────────────────────────────────────
  //  检索：中文友好的轻量打分
  // ────────────────────────────────────────────────

  /** 中文/英文混合分词：中文取二元组，英文取单词 */
  function tokens(text) {
    const s = String(text || '').toLowerCase();
    const out = new Set();
    // 英文单词 / 数字
    (s.match(/[a-z][a-z0-9_+#.-]{1,}/g) || []).forEach(w => out.add(w));
    // 中文连续片段 → 二元组
    const zhRuns = s.match(/[\u4e00-\u9fa5]+/g) || [];
    zhRuns.forEach(run => {
      if (run.length === 1) { out.add(run); return; }
      for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2));
      // 长片段也保留原词，便于精确命中（如「电磁感应」）
      if (run.length <= 8) out.add(run);
    });
    return out;
  }

  /**
   * 高频通用词：它们出现在几乎所有教学资料里，命中它们不能说明相关。
   * 例：「定律」命中会把「欧姆定律」和「楞次定律」判成同一件事。
   * 过滤后，标题命中要求落在「实词」上才算强信号。
   */
  const STOP_TOKENS = new Set([
    '定律', '分析', '判断', '问题', '方法', '怎么', '意思', '内容', '题目',
    '学生', '老师', '老师', '做题', '复习', '学习', '知识', '理解', '掌握',
    '一下', '这个', '那个', '什么', '为什', '可以', '应该', '需要', '时候',
    '方向', '过程', '关系', '条件', '基础', '常见', '重要', '注意', '一般',
  ]);

  function isStopToken(t) {
    return STOP_TOKENS.has(t) || String(t || '').length < 2;
  }

  /**
   * 按查询检索。
   * @param {string} query  学生的问题 / 当前学习内容
   * @param {object} opts   { subject, limit, minScore, minTextHit, onlyUser }
   */
  function search(query, opts) {
    const o = opts || {};
    /**
     * ★ 2026-11-01：检索范围改为「用户导入 + 内置知识库」。
     *   内置上百条，但这里只返回前 limit 条（默认 3~4），
     *   绝不会把整库带进 prompt。
     */
    const list = (o.onlyUser ? userNotes() : allNotes());
    if (!list.length) return [];

    const qSubject = normSubject(o.subject);
    const qTok = tokens(query);
    const limit = Math.max(1, Math.min(50, o.limit || 5));

    const scored = list.map(n => {
      let score = 0;
      let offSubject = false;

      // ① 科目匹配：同科大幅加分；明确别的科目 → 直接标记排除
      if (qSubject) {
        if (n.subject === qSubject) score += 10;
        else if (!n.subject) score += 2;         // 通用经验对所有科目都有关
        else offSubject = true;                   // 明确是别的科目
      } else if (n.subject) {
        score += 1;
      }

      // ② 文本命中：标题权重更高
      const titleTok = tokens(n.title + ' ' + (n.tags || []).join(' '));
      const bodyTok = tokens(n.content);
      qTok.forEach(t => {
        if (titleTok.has(t)) score += 4;
        else if (bodyTok.has(t)) score += 1;
      });

      // ③ 标签精确命中
      const qs = String(query || '');
      (n.tags || []).forEach(tag => {
        if (tag && qs.indexOf(tag) >= 0) score += 5;
      });

      // ④ 重要度与新鲜度（弱影响，别盖过相关性）
      const impBonus = (n.importance || 3) * 0.6;
      score += impBonus;
      const days = (Date.now() - new Date(n.updatedAt || n.createdAt || 0).getTime()) / 86400000;
      if (isFinite(days)) score += Math.max(0, 2 - days / 30);

      /**
       * ★ 相关性得分（只看文本命中，不含科目/重要度）
       */
      let textHit = 0;      // 加权命中分
      let titleHits = 0;    // 标题/标签词命中
      let bodyHits = 0;     // 仅正文命中（且标题没有）
      let tagHits = 0;      // 标签精确出现在 query 里

      qTok.forEach(t => {
        if (isStopToken(t)) return;              // 通用词不计分
        if (titleTok.has(t)) { textHit += 4; titleHits++; }
        else if (bodyTok.has(t)) { textHit += 1; bodyHits++; }
      });
      (n.tags || []).forEach(tag => {
        if (tag && String(query || '').indexOf(tag) >= 0) { textHit += 5; tagHits++; }
      });

      /**
       * 强命中数 = 标题/标签命中 + 正文命中。
       * 用来区分「真在讲这件事」和「恰好共享一个高频词」。
       */
      const strong = titleHits + tagHits + bodyHits;

      return { note: n, score, offSubject, textHit, titleHits, tagHits, bodyHits, strong };
    });

    scored.sort((a, b) => b.score - a.score);

    /**
     * ★ 跨科过滤：只在「明确问某科」时生效。
     *   之前的做法是给别的科目扣 6 分，但只要正文命中几个二元组就能追平，
     *   结果物理题会把数学经验带进 prompt —— 既浪费 token 又容易误导。
     *
     *   现在：先剔除 offSubject；如果剔完一条不剩（说明该科还没导入资料），
     *   再退回「只保留通用条目」，仍然不带别科。
     */
    let pool = scored;
    if (qSubject) {
      const sameOrGeneral = scored.filter(x => !x.offSubject);
      pool = sameOrGeneral.length ? sameOrGeneral : scored.filter(x => !x.note.subject);
    }

    /**
     * ★ 相关性门槛（2026-11-01，共三级）
     *
     * ① textHit === 0 → 剔除
     *    不能只靠「同科 +10、重要度 +3」混进来。
     *
     * ② 必须有强信号：标题/标签命中，或正文命中 ≥2 个不同二元组
     *
     * ③ 「退一步」只在查询里的**实词**确实被覆盖时生效。
     *    曾经的 bug：查询「完全无关的内容」会因「内容」二字
     *    命中一条讲阅读理解的资料 —— 而「内容」正是用户用来
     *    表达「无关」的虚词。现在要求查询里至少有一个实词命中，
     *    且命中词数占实词数的一成以上，否则一律返回空。
     */
    const minText = (o.minTextHit != null) ? o.minTextHit : 1;
    let pool2 = pool.filter(x => x.textHit >= minText);
    pool2 = pool2.filter(x => (x.titleHits > 0 || x.tagHits > 0) || x.bodyHits >= 2);

    if (!pool2.length) {
      /**
       * 退一步：只保留「命中了查询实词」的条目。
       * 判定标准：实词命中数 / 实词总数 ≥ 0.2，
       * 且至少命中 2 个（单个词的偶然碰撞太普遍）。
       */
      const qWords = [...qTok].filter(t => !isStopToken(t));
      const qLen = Math.max(1, qWords.length);
      const weak = pool.filter(x => {
        const hit = x.titleHits + x.tagHits + x.bodyHits;
        return hit >= 2 && hit / qLen >= 0.2;
      }).slice(0, 1);
      pool2 = weak;
    }
    pool = pool2;

    const min = (o.minScore != null) ? o.minScore : 0;
    return pool.filter(x => x.score > min).slice(0, limit).map(x => x.note);
  }

  // ────────────────────────────────────────────────
  //  注入 prompt
  // ────────────────────────────────────────────────

  /**
   * 生成给 AI 的「教学经验」段落。
   * 没有资料 / 没命中 → 返回空字符串（不占 token）。
   */
  function promptBlock(query, opts) {
    const o = opts || {};
    let hits = [];
    try {
      /**
       * ★ 只取 3 条（用户库优先，内置库补位）
       *
       * 用户要求「不要每次把所有教学经验都读一遍」。
       * 内置库里有一百多条，但这里最多拿 3 条、总字数千字出头，
       * 命中不了就一条都不给 —— 宁可少，也不要一堆无关内容污染上下文。
       */
      hits = search(query, { subject: o.subject, limit: o.limit || 3 });
    } catch (e) { return ''; }

    if (!hits.length) return '';

    const L = [];
    L.push('【教学经验（按当前问题检索出的片段，仅供参考，不要照抄）】');
    let used = 0;
    hits.forEach(n => {
      const kindLabel = KINDS[n.kind] || '经验';
      const head = '- [' + kindLabel + (n.subject ? '·' + n.subject : '') + '] ' + n.title + '：';
      let body = String(n.content || '').replace(/\s+/g, ' ').trim();
      // 单条再压一次，避免一条就吃掉整个预算
      const cap = n.builtin ? 220 : 320;
      if (body.length > cap) body = body.slice(0, cap - 1) + '…';
      const room = INJECT_BUDGET - used - head.length;
      if (room <= 40) return;
      if (body.length > room) body = body.slice(0, room - 1) + '…';
      L.push(head + body);
      used += head.length + body.length;
      n.usedCount = (n.usedCount || 0) + 1;
    });
    if (L.length === 1) return '';

    // 只回写用户条目的 usedCount（内置条目是常量数组，不回写）
    try {
      const list = all();
      const map = new Map(hits.filter(h => !h.builtin).map(h => [h.id, h.usedCount]));
      let changed = false;
      list.forEach(x => {
        if (map.has(x.id) && map.get(x.id) !== x.usedCount) { x.usedCount = map.get(x.id); changed = true; }
      });
      if (changed) save(list);
    } catch (e) {}

    L.push('（用得上就用，用不上别硬套。）');
    return L.join('\n');
  }

  // ────────────────────────────────────────────────
  //  内置题库检索（出卷兜底用）
  // ────────────────────────────────────────────────

  /**
   * 从内置题库里按科目/知识点筛题。
   * @param {object} o { subject, knowledge, difficulty, count, excludeIds }
   * @returns {Array} 题目（结构同 data.js FALLBACKS）
   */
  function bankQuestions(o) {
    const opt = o || {};
    let bank = [];
    try {
      if (typeof TEACHING_QUESTIONS !== 'undefined' && TEACHING_QUESTIONS) bank = TEACHING_QUESTIONS;
    } catch (e) { return []; }

    const sub = normSubject(opt.subject);
    let list = [];
    if (sub && bank[sub]) list = bank[sub].slice();
    else {
      // 没指定科目：全部混起来
      Object.keys(bank).forEach(k => { list = list.concat(bank[k]); });
    }
    if (!list.length) return [];

    // 知识点模糊匹配
    const kw = String(opt.knowledge || '').trim();
    if (kw) {
      const kt = tokens(kw);
      list = list.filter(q => {
        const qt = tokens(q.knowledge || '');
        let hit = 0;
        kt.forEach(t => { if (qt.has(t)) hit++; });
        return hit > 0;
      });
      if (!list.length) {
        // 知识点没命中就别硬筛，退回到该科目全部题
        list = (sub && bank[sub]) ? bank[sub].slice() : [];
      }
    }

    // 难度过滤（宽松：优先取完全匹配，不够再放宽）
    const dif = String(opt.difficulty || '').trim();
    if (dif && dif !== 'normal') {
      const exact = list.filter(q => q.difficulty === dif);
      if (exact.length) list = exact;
    }

    // 排除已用过的
    const ex = Array.isArray(opt.excludeIds) ? opt.excludeIds : [];
    if (ex.length) list = list.filter(q => ex.indexOf(q.text) < 0);

    // 洗牌后取前 n 条
    list = list.slice().sort(() => Math.random() - 0.5);
    const n = Math.max(1, Math.min(30, opt.count || 10));
    return list.slice(0, n).map((q, i) => Object.assign({}, q, { index: i + 1 }));
  }

  /** 内置题库统计 */
  function bankStats() {
    let bank = {};
    try { if (typeof TEACHING_QUESTIONS !== 'undefined') bank = TEACHING_QUESTIONS; } catch (e) {}
    const out = { total: 0, bySubject: {} };
    Object.keys(bank).forEach(k => {
      const n = bank[k].length;
      out.bySubject[k] = n;
      out.total += n;
    });
    return out;
  }

  /** 内置经验条数 */
  function builtinStats() {
    const raw = builtinRaw();
    const bySubject = {};
    raw.forEach(x => {
      const s = x.s || '通用';
      bySubject[s] = (bySubject[s] || 0) + 1;
    });
    return { total: raw.length, disabled: builtinDisabled().length, bySubject };
  }

  /** 禁用/恢复一条内置经验 */
  function setBuiltinDisabled(id, off) {
    const cur = builtinDisabled().filter(x => x !== id);
    if (off) cur.push(id);
    try { Storage.set(KEY_BUILTIN_OFF, cur); return true; } catch (e) { return false; }
  }

  // ────────────────────────────────────────────────
  //  导入：多格式解析
  // ────────────────────────────────────────────────

  /**
   * 把一段自由文本切成多条经验。
   * 切分规则（从强到弱）：
   *   ① Markdown 标题（# / ## / ###） ② 空行分段 ③ 单条超长则整条保存
   */
  function splitByHeadings(text, fallbackTitle) {
    const src = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!src) return [];

    // 有 markdown 标题就按标题切
    const hasHeading = /^#{1,4}\s+\S/m.test(src);
    if (hasHeading) {
      const out = [];
      const lines = src.split('\n');
      let cur = null;
      for (const line of lines) {
        const m = line.match(/^(#{1,4})\s+(.+)$/);
        if (m) {
          if (cur && (cur.content.trim() || cur.title)) out.push(cur);
          cur = { title: m[2].trim().slice(0, 80), content: '', level: m[1].length };
        } else {
          if (!cur) cur = { title: fallbackTitle || '导入内容', content: '', level: 0 };
          cur.content += line + '\n';
        }
      }
      if (cur && (cur.content.trim() || cur.title)) out.push(cur);
      return out.filter(x => x.content.trim().length > 0 || x.title);
    }

    // 没有标题：按空行分段
    /**
     * ★ 2026-11-01 修：合并阈值定得太大（一度是 1200 → 又改成 80 字），
     *   都出过问题：
     *   · 1200 时，三段正常教学笔记（63~91 字）被硬合成一条，
     *     检索时整条进 prompt，把无关内容也带进去了
     *   · 80 时，73 字的第 2 段和 63 字的第 3 段仍被合并
     *
     *   正确判断不是「上一段多长」，而是「这一段是不是有话可说」。
     *   空行分隔天然就是作者的语义边界 —— 只有极短（<30 字，通常是
     *   「注意：」「小结：」这类过渡句）才和下一段合并。
     */
    const paras = src.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
    if (paras.length <= 1) {
      return [{ title: fallbackTitle || src.slice(0, 24).replace(/\s+/g, ' ') || '导入内容', content: src }];
    }
    const out = [];
    let buf = '';
    for (const p of paras) {
      if (!buf) { buf = p; continue; }
      if (buf.length < 30) {
        buf = buf + '\n\n' + p;         // 过渡句并入下一段
      } else {
        out.push({ title: buf.slice(0, 24).replace(/\s+/g, ' '), content: buf });
        buf = p;
      }
    }
    if (buf) out.push({ title: buf.slice(0, 24).replace(/\s+/g, ' '), content: buf });
    return out;
  }

  /** 解析 CSV（支持引号包裹的换行） */
  function parseCSV(text) {
    const src = String(text || '').replace(/\r\n/g, '\n').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQ) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim()));
  }

  /**
   * 统一的导入入口。
   * @param {string} text
   * @param {object} opts { format:'auto'|'text'|'markdown'|'json'|'csv', subject, source, kind, importance }
   * @returns {{added:number, skipped:number, items:Array, errors:string[]}}
   */
  function importText(text, opts) {
    const o = opts || {};
    const fmt = String(o.format || 'auto').toLowerCase();
    const src = String(text || '').replace(/^\uFEFF/, '');
    const errors = [];
    let drafts = [];

    const tryJSON = () => {
      const t = src.trim();
      if (!/^[\[{]/.test(t)) return false;
      try {
        const data = JSON.parse(t);
        // 支持三种形状：数组 / {notes:[]} / {items:[]}
        let arr = null;
        if (Array.isArray(data)) arr = data;
        else if (Array.isArray(data.notes)) arr = data.notes;
        else if (Array.isArray(data.items)) arr = data.items;
        else if (Array.isArray(data.data)) arr = data.data;
        if (!arr) return false;
        drafts = arr.map(x => ({
          title: x.title || x.name || x.topic || x.问题 || '',
          content: x.content || x.text || x.body || x.内容 || x.经验 || '',
          subject: x.subject || x.科目 || o.subject,
          tags: x.tags || x.标签 || o.tags,
          kind: x.kind || x.type || o.kind,
          importance: x.importance != null ? x.importance : o.importance,
          source: x.source || o.source || 'import-json',
        })).filter(d => d.content || d.title);
        return true;
      } catch (e) {
        errors.push('JSON 解析失败：' + e.message);
        return false;
      }
    };

    const tryCSV = () => {
      // 至少要有表头且逗号数稳定
      const firstLine = src.split('\n')[0] || '';
      if (firstLine.indexOf(',') < 0) return false;
      const rows = parseCSV(src);
      if (rows.length < 2) return false;
      const header = rows[0].map(h => String(h).trim().toLowerCase());
      const idx = (names) => {
        for (const n of names) {
          const i = header.indexOf(n);
          if (i >= 0) return i;
        }
        return -1;
      };
      const iTitle = idx(['title', '标题', '主题', 'name', '名称']);
      const iContent = idx(['content', '内容', '正文', 'experience', '经验', 'text']);
      const iSubject = idx(['subject', '科目', '学科']);
      const iTags = idx(['tags', '标签']);
      const iKind = idx(['kind', 'type', '类型']);
      const iImp = idx(['importance', '重要度', '权重']);
      if (iContent < 0 && iTitle < 0) return false;

      drafts = rows.slice(1).map(r => ({
        title: iTitle >= 0 ? r[iTitle] : '',
        content: iContent >= 0 ? r[iContent] : '',
        subject: iSubject >= 0 ? r[iSubject] : o.subject,
        tags: iTags >= 0 ? r[iTags] : o.tags,
        kind: iKind >= 0 ? r[iKind] : o.kind,
        importance: iImp >= 0 ? r[iImp] : o.importance,
        source: o.source || 'import-csv',
      })).filter(d => String(d.content || '').trim() || String(d.title || '').trim());
      return drafts.length > 0;
    };

    const useJSON = (fmt === 'json');
    const useCSV = (fmt === 'csv');

    if (useJSON) {
      if (!tryJSON()) return { added: 0, skipped: 0, items: [], errors };
    } else if (useCSV) {
      if (!tryCSV()) return { added: 0, skipped: 0, items: [], errors: ['CSV 解析失败或没有有效行'] };
    } else {
      // auto：先试 JSON，再试 CSV，最后按文本切分
      const okJson = tryJSON();
      if (!okJson) {
        const okCsv = tryCSV();
        if (!okCsv) {
          drafts = splitByHeadings(src, o.title || o.source || '导入内容').map(d => ({
            title: d.title,
            content: d.content,
            subject: o.subject,
            tags: o.tags,
            kind: o.kind,
            importance: o.importance,
            source: o.source || 'import-text',
          }));
        }
      }
    }

    const added = [];
    let skipped = 0;
    drafts.forEach(d => {
      const content = String(d.content || '').trim();
      const title = String(d.title || '').trim();
      if (!content && !title) { skipped++; return; }
      const item = upsert({
        title,
        content,
        subject: d.subject,
        tags: d.tags,
        kind: d.kind || 'experience',
        importance: d.importance,
        source: d.source || o.source || 'import',
      });
      if (item) added.push(item);
      else skipped++;
    });

    bumpStat('imported', added.length);
    return { added: added.length, skipped, items: added, errors };
  }

  // ────────────────────────────────────────────────
  //  导入：从文件对象（浏览器 File API）
  // ────────────────────────────────────────────────

  const TEXT_EXT = ['.txt', '.md', '.markdown', '.csv', '.json', '.log'];
  const OFFICE_EXT = ['.docx', '.xlsx', '.pdf'];

  function extOf(name) {
    const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
    return m ? m[0] : '';
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(new Error('读取失败：' + (file && file.name)));
      // 一律按 UTF-8 读；GBK 文本会出现替换字符，下面会提示
      fr.readAsText(file, 'utf-8');
    });
  }

  /**
   * 导入一个或一批文件。
   * @returns {Promise<{added,skipped,files:Array,errors:string[]}>}
   */
  async function importFiles(files, opts) {
    const o = opts || {};
    const arr = Array.from(files || []);
    const result = { added: 0, skipped: 0, files: [], errors: [] };

    for (const f of arr) {
      const ext = extOf(f.name);
      const baseName = String(f.name).replace(/\.[^.]+$/, '');
      try {
        if (TEXT_EXT.indexOf(ext) < 0) {
          if (OFFICE_EXT.indexOf(ext) >= 0) {
            result.errors.push(`${f.name}：暂不支持 ${ext} 直接解析，请先在 Word/Excel 里「另存为 .txt 或 .csv」再导入`);
          } else {
            result.errors.push(`${f.name}：不支持的格式 ${ext || '(无扩展名)'}`);
          }
          result.skipped++;
          result.files.push({ name: f.name, added: 0, skipped: true });
          continue;
        }

        const text = await readAsText(f);
        // 粗检测编码问题
        const bad = (text.match(/\uFFFD/g) || []).length;
        if (bad > Math.max(5, text.length * 0.02)) {
          result.errors.push(`${f.name}：疑似非 UTF-8 编码（出现 ${bad} 个乱码字符），请另存为 UTF-8 后重试`);
        }

        const fmt = ext === '.json' ? 'json' : (ext === '.csv' ? 'csv' : 'auto');
        const r = importText(text, {
          format: fmt,
          subject: o.subject,
          tags: o.tags,
          kind: o.kind,
          importance: o.importance,
          source: 'file:' + f.name,
          title: baseName,
        });
        result.added += r.added;
        result.skipped += r.skipped;
        result.errors.push(...r.errors);
        result.files.push({ name: f.name, added: r.added, skipped: r.skipped });
      } catch (e) {
        result.errors.push(`${f.name}：${e.message}`);
        result.skipped++;
        result.files.push({ name: f.name, added: 0, skipped: true });
      }
    }
    return result;
  }

  // ────────────────────────────────────────────────
  //  统计 / 导出
  // ────────────────────────────────────────────────

  function bumpStat(k, n) {
    try {
      const s = Storage.get(KEY_STATS, { imported: 0, injected: 0 }) || {};
      s[k] = (s[k] || 0) + (n || 1);
      Storage.set(KEY_STATS, s);
    } catch (e) {}
  }

  function stats() {
    const list = all();
    const bySubject = {};
    const byKind = {};
    list.forEach(n => {
      const s = n.subject || '通用';
      bySubject[s] = (bySubject[s] || 0) + 1;
      const k = n.kind || 'other';
      byKind[k] = (byKind[k] || 0) + 1;
    });
    let chars = 0;
    list.forEach(n => { chars += String(n.content || '').length; });
    // 内置库单独统计（不计入用户的 total）
    const bi = builtinStats();
    const bq = bankStats();
    return {
      total: list.length,
      chars,
      bySubject,
      byKind,
      counters: Storage.get(KEY_STATS, { imported: 0 }) || {},
      builtin: bi,          // { total, disabled, bySubject }
      bank: bq,             // { total, bySubject }
      searchable: list.length + bi.total - bi.disabled,
    };
  }

  /** 导出成 JSON（可再导入，也可给别人用） */
  function exportJSON() {
    return JSON.stringify({
      app: 'xuetu',
      type: 'teaching-notes',
      version: 1,
      exportedAt: new Date().toISOString(),
      notes: all().map(n => ({
        title: n.title, subject: n.subject, tags: n.tags,
        kind: n.kind, importance: n.importance,
        content: n.content, source: n.source,
      })),
    }, null, 2);
  }

  /** 导出成 Markdown（方便人读） */
  function exportMarkdown() {
    const list = all();
    if (!list.length) return '# 教学经验库\n\n（空）\n';
    const bySub = {};
    list.forEach(n => {
      const s = n.subject || '通用';
      (bySub[s] = bySub[s] || []).push(n);
    });
    const L = ['# 教学经验库', '', '> 导出于 ' + new Date().toLocaleString('zh-CN'), ''];
    Object.keys(bySub).forEach(sub => {
      L.push('## ' + sub, '');
      bySub[sub].forEach(n => {
        L.push('### ' + n.title);
        const meta = [];
        if (n.kind) meta.push(KINDS[n.kind] || n.kind);
        if (n.tags && n.tags.length) meta.push('标签：' + n.tags.join('、'));
        meta.push('重要度 ' + n.importance);
        L.push('*' + meta.join(' · ') + '*', '');
        L.push(n.content, '');
      });
    });
    return L.join('\n');
  }

  // ────────────────────────────────────────────────
  //  默认种子（首次使用给几条示例，可删）
  // ────────────────────────────────────────────────

  function seedIfEmpty() {
    if (all().length) return 0;
    const samples = [
      {
        title: '导数含参讨论：分类标准要先想清楚',
        subject: '数学',
        kind: 'pitfall',
        tags: ['导数', '含参讨论', '分类讨论'],
        importance: 4,
        content: '学生做含参导数题最常漏的是「参数使得导函数零点落在定义域外」这一支。' +
          '教学顺序：先求导 → 令导数为零解出含参根 → **先判断根是否在定义域内** → 再比较根与区间端点。' +
          '让学生每道题都先写一句「根是否在定义域内」，养成习惯后错误率明显下降。',
      },
      {
        title: '电磁感应：右手定则和楞次定律的顺序不能反',
        subject: '物理',
        kind: 'method',
        tags: ['电磁感应', '楞次定律', '右手定则'],
        importance: 4,
        content: '先讲楞次定律再讲右手定则，学生会把「阻碍磁通量变化」和「电流方向」混在一起。' +
          '正确顺序：先用右手定则定方向（导体切割磁感线的情形），再用楞次定律检查结论是否「阻碍变化」。' +
          '判断题先问一句：磁通量在变大还是变小？',
      },
      {
        title: '英语完形填空：先通读再选，不要边读边填',
        subject: '英语',
        kind: 'experience',
        tags: ['完形填空', '阅读策略'],
        importance: 3,
        content: '边读边填的正确率通常比「先通读一遍再填」低 10%~15%。' +
          '训练方法：第一遍只读不做题（约 90 秒），抓住文章主题和情感走向；第二遍再逐空选择。' +
          '遇到犹豫的题先跳过，靠后文线索回填。',
      },
    ];
    const list = [];
    const now = new Date().toISOString();
    samples.forEach(s => {
      list.push(Object.assign({
        id: newId(),
        tags: [], kind: 'experience', importance: 3,
        source: 'sample', createdAt: now, updatedAt: now, usedCount: 0,
      }, s));
    });
    save(list);
    return list.length;
  }

  return {
    KINDS,
    // 用户条目
    all, get, upsert, remove, clear, save,
    // 检索与注入
    search, promptBlock, tokens,
    // 导入
    importText, importFiles, splitByHeadings, parseCSV,
    // 内置知识库
    builtinNotes, builtinStats, builtinRaw, builtinDisabled, setBuiltinDisabled,
    userNotes, allNotes,
    // 内置题库
    bankQuestions, bankStats,
    // 统计与导出
    stats, exportJSON, exportMarkdown,
    seedIfEmpty,
    TEXT_EXT, OFFICE_EXT,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Teaching;
