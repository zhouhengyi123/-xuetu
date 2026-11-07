/**
 * 提前建模缓存（ModelCache）2026-11-07
 *
 * ══════════════════════════════════════════════════════════════
 * 用户诉求与审计结论
 * ══════════════════════════════════════════════════════════════
 * 用户：「实现提前预判建模（例如上课前提前建好模型，而不是等到需要时再建，
 *        因为那样太慢了）」
 *
 * Agent 审计的关键发现：
 *   · 「建模」在代码里没有对应实体，最接近的是两类：
 *       ① 本地数值统计（evidence-v2/progress/student-profile）——**本来就免费、同步**
 *       ② LLM 结构化抽取（estimateScore/analyzeWeakness/textbookCoverage）
 *   · 真正慢的是：生成计划 = 先 analyzeWeakness 再 generateStudyPlan，
 *     **2 次串行 LLM**；估分 1~2 次；判难度 N 份卷子逐份串行。
 *   · 「延长建模时间（加 maxTokens / 多轮自检）」**不建议**：
 *     progress.js 把 AI 估分硬夹在本地值 ±10~15%，多给 token 只变慢不变好。
 *   · 因此正确做法是「提前算好 + 缓存」，而不是「算得更久」。
 *
 * ★ 教学法的补充修正（VanLehn 2011 / INSPIRE）：
 *   「预判」应该是**静默备课** —— 系统悄悄备好提示链与错因清单，
 *   学生卡住时逐层给，绝不提前宣告「我预判你会卡在这」。
 *   本模块只做静默预计算，不做主动弹窗。
 *
 * ══════════════════════════════════════════════════════════════
 * 只缓存输入稳定的产物（严格限定范围）
 * ══════════════════════════════════════════════════════════════
 *   ✅ 教材覆盖率（输入=教材进度，已有签名缓存机制，作为模板）
 *   ✅ 本地数值统计（evidence-v2.estimateAll，免费，随时可算）
 *   ✅ overlay 掌握度 + 高频错因清单（TutorSession，来自真实作答）
 *   ✅ 薄弱点（输入=错题+记录，变化不频繁）—— 带指纹失效
 *
 *   ❌ 不缓存 generateStudyPlan（依赖 hours/subject/intensity 当次选择，
 *      提前生成必然用错参数）
 *   ❌ 不缓存 courseOutline / courseLesson（依赖用户当场输入）
 *   ❌ 不缓存 aiEstimate 的 LLM 结论（被夹得几乎等于本地值，
 *      缓存收益低、过期风险高）
 *
 * ══════════════════════════════════════════════════════════════
 * 三条硬约束（缺一不可）
 * ══════════════════════════════════════════════════════════════
 *   ① 指纹失效：教材进度/试卷数/错题数/记录数/goal/region/模型 变化即失效
 *   ② 无 Key 静默降级：开源版默认没配 Key，预生成必须 try/catch 吞掉，
 *      绝不弹错、绝不阻塞启动
 *   ③ 单例 in-flight：启动预生成和用户点击不会发两次同样的请求
 *   ④ 24h 兜底过期：防长期不重启导致陈旧结论污染所有 AI 的 system 提示
 */
const ModelCache = (() => {

  const KEY = 'student_model_v1';
  const MAX_AGE_MS = 24 * 3600 * 1000;

  /** 生成输入指纹：任何影响结论的输入变了就失效 */
  function signature() {
    const parts = [];
    function push(k, v) { parts.push(k + '=' + String(v == null ? '' : v)); }
    try {
      const g = Storage.getGoal();
      push('target', g.target); push('current', g.current);
      push('examDate', g.examDate); push('hours', g.hours);
      push('sel', (g.selectedSubjects || []).join(','));
      push('papers', Storage.getPapers().length);
      push('mistakes', Storage.getMistakes().length);
      push('records', Storage.getRecords().length);
      push('lessons', (Storage.getLessons ? Storage.getLessons().length : 0));
      // 教材进度签名（复用现有口径）
      const tb = Storage.getTextbook ? Storage.getTextbook() : {};
      push('tb', JSON.stringify(tb));
      // 考试制度 + 适用学年度：换 region 或换교육과정都必须失效
      push('region', (typeof Region !== 'undefined') ? Region.current() : 'cn-gaokao');
      push('curriculum', (typeof Region !== 'undefined' && Region.curriculum) ? (Region.curriculum() || '') : '');
      // 模型：换模型不复用旧结论
      const cfg = (typeof LLM !== 'undefined' && LLM.getConfig) ? LLM.getConfig() : {};
      push('model', cfg.model || ''); push('provider', cfg.provider || '');
    } catch (e) { parts.push('err=' + e.message); }
    // 简单稳定哈希（djb2），不需要 crypto
    const s = parts.join('|');
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + '-' + s.length;
  }

  function read() {
    try { const v = Storage.get(KEY, null); return (v && typeof v === 'object') ? v : null; }
    catch (e) { return null; }
  }

  function write(v) {
    try { Storage.set(KEY, Object.assign({}, v, { builtAt: new Date().toISOString() })); return true; }
    catch (e) { return false; }
  }

  /** 缓存是否有效 */
  function valid() {
    const v = read();
    if (!v || !v.sig) return false;
    if (v.sig !== signature()) return false;
    const age = Date.now() - new Date(v.builtAt || 0).getTime();
    if (!isFinite(age) || age > MAX_AGE_MS) return false;
    return true;
  }

  /** 供 UI/AI 读缓存（失效就返回 null，不返回旧数据） */
  function get() { return valid() ? read() : null; }

  function invalidate() {
    const v = read();
    if (v) { v.sig = '__invalid__'; try { Storage.set(KEY, v); } catch (e) {} }
  }

  let _inFlight = null;

  /**
   * 静默预计算（启动时调一次）。
   * 只做免费的本地计算 + 组装「备课包」，**不主动发 LLM 请求**。
   *
   * 为什么不让预计算自动调 LLM：
   *   · 开源版默认没配 Key（llm.js DEFAULT_CONFIG.apiKey=''）
   *   · 用户没点任何按钮却在烧 API 额度，是明显的越界
   *   · analyzeWeakness 在 generateDailyPlan 里还会再调一次，两处都预生成会重复计费
   *
   * 所以它做的是：把「需要时才算」的免费部分提前算好并缓存，
   * 让 UI 首屏立刻有真实结论；LLM 部分仍保持惰性（用户点才调）。
   */
  async function precompute(opts) {
    const o = opts || {};
    if (_inFlight) return _inFlight;       // 单例并发锁
    _inFlight = (async () => {
      const sig = signature();
      const existing = get();
      if (existing && existing.sig === sig && !o.force) return existing;

      const out = {
        sig,
        builtAt: new Date().toISOString(),
        keyPresent: hasKey(),
        region: (typeof Region !== 'undefined') ? Region.current() : 'cn-gaokao',
      };

      // ① 本地数值统计（免费、同步）
      try {
        if (typeof EvidenceEngine !== 'undefined') {
          out.numeric = EvidenceEngine.estimateAll({
            goal: Storage.getGoal(), papers: Storage.getPapers(),
            lessons: (Storage.getLessons ? Storage.getLessons() : []),
            quizzes: [], aptitude: (Storage.getAptitude ? Storage.getAptitude() : null),
          });
        }
      } catch (e) { out.numeric = null; }

      // ② overlay 掌握度 + 高频错因（教学法：这才是「提前建模」该建的东西）
      try {
        if (typeof TutorSession !== 'undefined') {
          out.overlay = TutorSession.overlayAll();
          out.frequentMisses = TutorSession.frequentMisses(5);
        }
      } catch (e) { out.overlay = {}; out.frequentMisses = []; }

      // ③ 学生画像摘要（本地拼装，免费）
      try {
        if (typeof StudentProfile !== 'undefined') out.brief = StudentProfile.brief();
      } catch (e) { out.brief = ''; }

      // ④ 过程信号（弱证据，只展示，不进后验）
      try {
        if (typeof Engagement !== 'undefined') out.engagement = Engagement.collect();
      } catch (e) { out.engagement = null; }

      // ⑤ 备课包：把内置错因经验按高频错因检索好，静默备着（不弹窗）
      try {
        if (typeof Teaching !== 'undefined' && out.frequentMisses && out.frequentMisses.length) {
          out.preparedHints = out.frequentMisses.map(m =>
            Teaching.search(m.knowledge, { limit: 2 }).map(n => n.title));
        } else out.preparedHints = [];
      } catch (e) { out.preparedHints = []; }

      write(out);
      return out;
    })();
    try { return await _inFlight; } finally { _inFlight = null; }
  }

  function hasKey() {
    try {
      const cfg = (typeof LLM !== 'undefined' && LLM.getConfig) ? LLM.getConfig() : null;
      return !!(cfg && cfg.apiKey);
    } catch (e) { return false; }
  }

  /** 给 AI 的一段（静默备课，学生卡住才用；不注入也能正常工作） */
  function promptBlock() {
    const v = get();
    if (!v) return '';
    const parts = ['【课前备课（系统已提前算好，学生卡住时才逐层给，不要提前宣告）】'];
    if (v.frequentMisses && v.frequentMisses.length) {
      parts.push('- 反复错的知识点：' + v.frequentMisses.map(m => m.knowledge).join('、'));
    }
    if (v.overlay && Object.keys(v.overlay).length) {
      const todo = Object.keys(v.overlay).filter(k => v.overlay[k] === 'todo');
      if (todo.length) parts.push('- 还没掌握：' + todo.slice(0, 6).join('、'));
    }
    parts.push('（只记「会 / 不会」，不推断学生的错误概念 —— 真人也做不到精准诊断。）');
    return parts.length > 2 ? parts.join('\n') : '';
  }

  /** 供 UI 显示的状态 */
  function status() {
    const v = read();
    return {
      cached: !!v,
      valid: valid(),
      sig: v ? v.sig : null,
      builtAt: v ? v.builtAt : null,
      keyPresent: v ? v.keyPresent : hasKey(),
      hasNumeric: !!(v && v.numeric),
      overlayCount: v && v.overlay ? Object.keys(v.overlay).length : 0,
      missCount: v && v.frequentMisses ? v.frequentMisses.length : 0,
    };
  }

  return { signature, get, valid, invalidate, precompute, promptBlock, status, MAX_AGE_MS };
})();

if (typeof window !== 'undefined') window.ModelCache = ModelCache;
if (typeof module !== 'undefined' && module.exports) module.exports = ModelCache;
