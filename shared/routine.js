/**
 * 作息与周节奏（Routine）2026-11-07
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要它
 * ══════════════════════════════════════════════════════════════
 * 用户指出：大部分学生是住宿生，布置每周任务时必须适配住校节奏。
 * 但更根本的问题是：原来「本周节奏」卡片里显示的是**编造的数字** ——
 *   app.js 里 `Math.round(120 + (i % 3) * 30)` 硬造了每天的分钟数。
 * 用户说「缺真实数据」，这就是最典型的一处。
 *
 * ══════════════════════════════════════════════════════════════
 * 设计原则（重要）
 * ══════════════════════════════════════════════════════════════
 *  · **不假装知道**：没有真实住校生用户数据，就不硬编码一套
 *    「周日返校 / 周五离校 / 晚自习 19:00-21:30」当成事实。
 *    那是拿猜测冒充真实数据，比编造分钟数更糟。
 *  · **做成可选模板 + 可编辑**：提供几种常见作息轮廓供用户选，
 *    每个字段都能改；不选就用「未设置」，界面显示真实记录的数据。
 *  · **真实优先**：一周里每天显示的是「实际学习时长 / 计划时长」，
 *    没有记录就显示「—」，绝不填充假数字。
 *  · **只影响节奏，不编造行为**：作息决定「哪天该排多少任务」，
 *    不会倒过来虚构「这周你学了 3 小时」。
 *
 * 数据结构（Storage key: xt_routine_v1）
 *   {
 *     preset: 'boarding5' | 'boarding6' | 'day' | 'custom' | null,
 *     week: [ { day:'周一', availableMin:120, note:'晚自习', kind:'study' }, ... 7 项 ],
 *     updatedAt
 *   }
 *   availableMin 为 null 表示「这天不安排 / 未知」，界面显示「—」
 */
const Routine = (() => {

  const KEY = 'routine_v1';
  const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  /** 内置轮廓：只作起点，所有值用户都能改 */
  const PRESETS = {
    boarding5: {
      label: '住校 · 周日晚返校',
      hint: '周一至周五在校，周五晚离校，周日晚上返校。工作日靠晚自习，周末在家。',
      week: [
        { availableMin: 120, note: '晚自习' },
        { availableMin: 120, note: '晚自习' },
        { availableMin: 120, note: '晚自习' },
        { availableMin: 120, note: '晚自习' },
        { availableMin: 60,  note: '周五离校，只排轻任务' },
        { availableMin: 180, note: '在家，可整块时间' },
        { availableMin: 90,  note: '周日晚返校，收心 + 下周预习' },
      ],
    },
    boarding6: {
      label: '住校 · 全周在校',
      hint: '整周都在学校，周末也有晚自习，但白天有课，可自由支配时间较少。',
      week: [
        { availableMin: 110, note: '晚自习' },
        { availableMin: 110, note: '晚自习' },
        { availableMin: 110, note: '晚自习' },
        { availableMin: 110, note: '晚自习' },
        { availableMin: 110, note: '晚自习' },
        { availableMin: 150, note: '周六下午 + 晚自习' },
        { availableMin: 120, note: '周日整理与预习' },
      ],
    },
    day: {
      label: '走读 · 每天回家',
      hint: '每天放学回家，时间较完整但受通勤与家庭节奏影响。',
      week: [
        { availableMin: 120, note: '放学后' },
        { availableMin: 120, note: '放学后' },
        { availableMin: 120, note: '放学后' },
        { availableMin: 120, note: '放学后' },
        { availableMin: 90,  note: '周五放松' },
        { availableMin: 240, note: '周末整块时间' },
        { availableMin: 180, note: '周末收心' },
      ],
    },
  };

  function defaults() {
    return { preset: null, week: null, updatedAt: null };
  }

  function get() {
    try {
      const v = Storage.get(KEY, null);
      return (v && typeof v === 'object') ? v : defaults();
    } catch (e) { return defaults(); }
  }

  function save(v) {
    try {
      Storage.set(KEY, Object.assign({}, v, { updatedAt: new Date().toISOString() }));
      return true;
    } catch (e) { return false; }
  }

  /** 应用一个内置轮廓（可被后续逐日编辑覆盖） */
  function applyPreset(id) {
    const p = PRESETS[id];
    if (!p) return null;
    const week = DAYS.map((day, i) => Object.assign({
      day,
      kind: 'study',
    }, p.week[i] || {}));
    const v = { preset: id, week };
    save(v);
    return v;
  }

  /** 清空（回到「未设置」，界面显示真实数据而非编造值） */
  function clear() {
    return save(defaults());
  }

  /** 用户改某一天的可用分钟 / 备注 */
  function setDay(index, patch) {
    const v = get();
    if (!v.week) return null;
    const i = Number(index);
    if (!isFinite(i) || i < 0 || i > 6) return null;
    Object.assign(v.week[i], patch || {});
    v.preset = 'custom';
    save(v);
    return v;
  }

  /** 是否已配置 */
  function isConfigured() {
    const v = get();
    return !!(v.week && v.week.length === 7);
  }

  /** 某天建议的可用分钟（null = 未配置 / 不安排，界面显示「—」） */
  function minutesFor(index) {
    const v = get();
    if (!v.week || !v.week[index]) return null;
    const raw = v.week[index].availableMin;
    // null / '' 表示「不安排」，不能 Number(null)→0 当成「安排 0 分钟」
    if (raw == null || raw === '') return null;
    const m = Number(raw);
    return isFinite(m) && m >= 0 ? m : null;
  }

  /** 今天（本地星期）的建议分钟 */
  function todayMinutes() {
    const dow = (new Date().getDay() + 6) % 7;   // 0=周一
    return minutesFor(dow);
  }

  /**
   * 生成给 LLM 的作息描述。
   * 未配置时返回空串（不编造），让 LLM 按用户当次给的 hours 排。
   */
  function promptBlock() {
    const v = get();
    if (!v.week || v.week.length !== 7) return '';
    const lines = v.week.map((d, i) => {
      const m = (d.availableMin == null || d.availableMin === '') ? '不安排' : (Number(d.availableMin) + ' 分钟');
      return '- ' + DAYS[i] + '：' + m + (d.note ? '（' + d.note + '）' : '');
    });
    return '【学生作息（由用户自己设定，请严格按这个节奏排一周任务）】\n' +
      lines.join('\n') +
      '\n注意：只在这些可用时间内安排任务；标为「不安排」的日子不要排任务。' +
      '周计划里每天的总时长要贴近对应日的可用分钟，不要平均分配。';
  }

  /** 给 UI 用的完整数据（含 preset 元信息） */
  function forUI() {
    const v = get();
    const preset = v.preset && PRESETS[v.preset] ? PRESETS[v.preset] : null;
    return {
      configured: isConfigured(),
      preset: v.preset,
      presetLabel: preset ? preset.label : (v.preset === 'custom' ? '自定义' : '未设置'),
      hint: preset ? preset.hint : '',
      week: v.week ? v.week.map((d, i) => Object.assign({ day: DAYS[i] }, d)) : null,
      updatedAt: v.updatedAt,
    };
  }

  return {
    DAYS, PRESETS,
    get, save, applyPreset, clear, setDay,
    isConfigured, minutesFor, todayMinutes,
    promptBlock, forUI,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Routine;
