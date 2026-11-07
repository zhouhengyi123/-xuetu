/**
 * 一节课（TutorSession）2026-11-07
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么加这个模块
 * ══════════════════════════════════════════════════════════════
 * 教学法调研（见 docs/真人家教方法论调研.md）的最强结论：
 *
 *   VanLehn 2011：真人一对一 d≈0.79，step-based 智能辅导 d≈0.76，几乎一样。
 *   有效性唯一站得住的两个解释 = ①即时反馈 ②脚手架（递进提示、延伸思路）。
 *   而「学徒」原来只有「一次性交卷 → 批改」，做题中途没有介入、没有提示链。
 *   真人老师其实也不精准诊断迷思概念，只建模「哪些知识还没掌握」(overlay)。
 *
 * 所以这个模块不做什么：
 *   · 不宣称「精准诊断你的错误概念」（连真人都做不到）
 *   · 不做摄像头/情感打分
 *   · 不用「听懂了吗」自我报告（Chi 2001：差生最容易说懂了）
 *   · 不说「这题很简单」「你真棒」（Kluger&DeNisi：表扬 d=-0.17）
 *
 * 一节课闭环（对齐新东方 120min SOP 与 Graesser 5-step frame）：
 *   ① 课前诊断（2~3 道，定位起点，不是评分）
 *   ② 分步例题：每步作答 → 即时反馈 → 错了给递进提示（5~6 级，逐步 faded）
 *   ③ 出门测（2~3 道同型变式，检验是否真会）
 *   ④ 一句话复盘（学生自己写，替代「已完成」打勾）
 *
 * ★ 出门测达标才结课（掌握学习，Bloom 1984 / VanLehn 2011 复核）：
 *   2 sigma 的真正来源是「90% 掌握阈值」而非老师个人魅力。
 *   所以出门测正确率 < 90% 时不给结课，提示回到薄弱知识点的变式练习。
 *
 * ★ 反馈文案规范（Kluger&DeNisi 1996 / Hattie&Timperley 2007）：
 *   模板 = 事实 + 定位 + 下一步动作；禁止「太棒了/你真聪明/加油」；
 *   纠错用间接提问而非红叉羞辱；保护信心靠「归因到题目难度 + 可控策略」。
 *
 * ★ 预判 = 静默备好提示链，学生卡住才逐层给（INSPIRE Informed/Progressive），
 *   不提前宣告「我预判你会卡在这」—— 真人的预判是课前备课，课堂仍是学生先动。
 *
 * 数据结构（Storage key: xt_tutor_session_v1）
 *   {
 *     id, subject, topic, startedAt, finishedAt,
 *     stage: 'diagnose'|'guided'|'exit'|'recap'|'done',
 *     diagnose: [{ q, answer, correct }],
 *     guided: [{ steps:[{prompt, expected, hints:[...]}], curStep, hintLevel, attempts, done }],
 *     exit:   [{ q, answer, correct }],
 *     recap: string,          // 学生自己写的一句话
 *     overlay: { knowledge: '掌握/未掌握' }  // 只记「会/不会」，不编迷思概念
 *   }
 */
const TutorSession = (() => {

  const KEY = 'tutor_session_v1';
  const KEY_HISTORY = 'tutor_session_history';

  /** 提示链的层级：从最轻的提示到最具体的「几乎给答案」，逐步 faded */
  const HINT_STAGES = [
    { level: 1, label: '再想一想', kind: 'nudge' },
    { level: 2, label: '看清题目问的是什么', kind: 'reframe' },
    { level: 3, label: '回忆一下这个知识点用哪条公式/定理', kind: 'recall' },
    { level: 4, label: '试试把已知条件先写下来，圈出要求的量', kind: 'step' },
    { level: 5, label: '第一步应该先做 X（只给第一步，后面自己续）', kind: 'firstStep' },
    { level: 6, label: '完整思路给你，看完请自己重做一遍', kind: 'bottomOut' },
  ];

  function newId() {
    return 'ts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  function blank() {
    return {
      id: null, subject: '', topic: '', startedAt: null, finishedAt: null,
      stage: 'diagnose', diagnose: [], guided: [], exit: [], recap: '', overlay: {},
    };
  }

  function get() {
    try { const v = Storage.get(KEY, null); return (v && typeof v === 'object') ? v : blank(); }
    catch (e) { return blank(); }
  }

  function save(s) { try { Storage.set(KEY, s); return true; } catch (e) { return false; } }

  /** 开一节新课：诊断题由调用方（AI 或题库）给，这里只建骨架，不编题 */
  function start(subject, topic, diagnoseQs) {
    const s = blank();
    s.id = newId();
    s.subject = subject || '';
    s.topic = topic || '';
    s.startedAt = new Date().toISOString();
    s.diagnose = (diagnoseQs || []).map(q => ({
      q: String(q.q || q.text || ''),
      answer: String(q.answer || ''),
      correct: null,
      knowledge: String(q.knowledge || ''),
    }));
    s.stage = s.diagnose.length ? 'diagnose' : 'guided';
    save(s);
    return s;
  }

  /** 记一道诊断题的作答（即时判定，不评分不排名） */
  function answerDiagnose(index, studentAnswer) {
    const s = get();
    const q = s.diagnose[index];
    if (!q) return s;
    q.correct = judge(q.answer, studentAnswer);
    // overlay：只记「会 / 不会」，不推断迷思概念
    if (q.knowledge) s.overlay[q.knowledge] = q.correct ? 'ok' : 'todo';
    // 全部诊断做完 → 进入分步例题
    if (s.diagnose.every(x => x.correct != null)) s.stage = 'guided';
    save(s);
    return s;
  }

  /** 加入一道分步例题（步骤 + 每步的递进提示由调用方给） */
  function addGuided(steps, knowledge) {
    const s = get();
    s.guided.push({
      steps: (steps || []).map(t => ({
        prompt: String(t.prompt || ''),
        expected: String(t.expected || ''),
        hints: Array.isArray(t.hints) ? t.hints.map(String) : [],
      })),
      knowledge: String(knowledge || ''),
      curStep: 0,
      hintLevel: 0,
      attempts: 0,
      done: false,
    });
    s.stage = 'guided';
    save(s);
    return s;
  }

  /**
   * 提交当前一步的作答 → 返回即时反馈（核心）
   * 反馈只给「下一步动作」，不表扬、不说简单。
   */
  function answerStep(guidedIndex, studentAnswer) {
    const s = get();
    const g = s.guided[guidedIndex];
    if (!g || g.done) return { ok: false, error: '没有进行中的分步题' };
    const step = g.steps[g.curStep];
    if (!step) return { ok: false, error: '步骤索引越界' };

    g.attempts++;
    const correct = judge(step.expected, studentAnswer);

    if (correct) {
      g.curStep++;
      g.hintLevel = 0;                     // 进入下一步，提示重新 faded 到 0
      if (g.curStep >= g.steps.length) {
        g.done = true;
        if (g.knowledge) s.overlay[g.knowledge] = 'ok';
      }
      // 全部例题做完 → 出门测
      if (s.guided.every(x => x.done)) s.stage = 'exit';
      save(s);
      return {
        ok: true, correct: true,
        feedback: '这一步对了。' + (g.done ? '这道题做完了，继续下一道。' : '接着做下一步：' + (g.steps[g.curStep] ? g.steps[g.curStep].prompt : '')),
        nextStep: g.done ? null : g.curStep,
        stage: s.stage,
      };
    }

    // 错了：给下一级提示（即时介入，而不是等交卷）
    const nextLevel = Math.min(HINT_STAGES.length, g.hintLevel + 1);
    g.hintLevel = nextLevel;
    const hs = HINT_STAGES[nextLevel - 1];
    const custom = step.hints[nextLevel - 1] || '';
    save(s);
    return {
      ok: true, correct: false,
      feedback: '这一步还不对（不是「你不行」，是这一步的某个环节要改）。' +
        '先别往下做，按这个提示再试一次：' + (custom || hs.label),
      hintLevel: nextLevel,
      hintKind: hs.kind,
      // bottom-out 之后仍错：让学生自己重做，不直接给答案抄
      needRedo: nextLevel >= HINT_STAGES.length,
    };
  }

  /** 请求下一级提示（学生主动要） */
  function requestHint(guidedIndex) {
    const s = get();
    const g = s.guided[guidedIndex];
    if (!g || g.done) return null;
    const next = Math.min(HINT_STAGES.length, g.hintLevel + 1);
    g.hintLevel = next;
    const hs = HINT_STAGES[next - 1];
    const step = g.steps[g.curStep];
    save(s);
    return {
      hintLevel: next,
      kind: hs.kind,
      text: (step && step.hints[next - 1]) || hs.label,
      isBottomOut: next >= HINT_STAGES.length,
    };
  }

  /** 出门测 */
  function setExit(qs) {
    const s = get();
    s.exit = (qs || []).map(q => ({
      q: String(q.q || q.text || ''),
      answer: String(q.answer || ''),
      correct: null,
      knowledge: String(q.knowledge || ''),
    }));
    s.stage = 'exit';
    save(s);
    return s;
  }

  /** 出门测：达标（≥90%）才结课，否则回到薄弱变式（掌握学习阈值） */
  function answerExit(index, studentAnswer) {
    const s = get();
    const q = s.exit[index];
    if (!q) return { ok: false };
    q.correct = judge(q.answer, studentAnswer);
    if (q.knowledge) s.overlay[q.knowledge] = q.correct ? 'ok' : 'todo';

    if (s.exit.every(x => x.correct != null)) {
      const r = rate(s.exit);
      if (r != null && r >= 90) {
        s.stage = 'recap';
      } else {
        // 不达标：不结课，明确说出「哪一题还错 + 下一步做什么」
        s.stage = 'guided';
        const weak = s.exit.filter(x => x.correct === false)
          .map(x => x.knowledge).filter(Boolean);
        save(s);
        return {
          ok: true, passed: false, rate: r, weak,
          feedback: '出门测 ' + r + '%，还没到 90% 的掌握线。' +
            (weak.length ? '还没稳的是：' + weak.join('、') + '。' : '') +
            '下一步：把这几题换个数字重做一遍，不看答案，做完再来测。' +
            '这不是你不行，是这一步还没练够 —— 练够就过。',
        };
      }
    }
    save(s);
    return { ok: true, passed: s.stage === 'recap', rate: rate(s.exit) };
  }

  /** 学生自己写一句话复盘（替代「已完成」打勾） */
  function setRecap(text) {
    const s = get();
    s.recap = String(text || '').trim().slice(0, 300);
    s.stage = 'done';
    s.finishedAt = new Date().toISOString();
    save(s);
    // 存一份历史，供 overlay 掌握度累积（不编分数）
    try {
      const h = Storage.get(KEY_HISTORY, []) || [];
      h.push({
        id: s.id, subject: s.subject, topic: s.topic,
        finishedAt: s.finishedAt, overlay: s.overlay, recap: s.recap,
        diagnoseRate: rate(s.diagnose), exitRate: rate(s.exit),
        // 保留逐题明细（只存对错与知识点，不存答案文本，省空间）
        questions: s.diagnose.concat(s.exit).map(q => ({
          knowledge: q.knowledge || '', correct: q.correct === true,
        })),
      });
      if (h.length > 60) h.shift();
      Storage.set(KEY_HISTORY, h);
    } catch (e) {}
    return s;
  }

  function clear() { return save(blank()); }

  /** 累计 overlay：跨多节课的知识点掌握状态（给「提前建模」用） */
  function overlayAll() {
    try {
      const h = Storage.get(KEY_HISTORY, []) || [];
      const out = {};
      h.forEach(sess => {
        Object.keys(sess.overlay || {}).forEach(k => {
          // 最近一次为准；只记 ok/todo，不推断迷思概念
          out[k] = sess.overlay[k];
        });
      });
      return out;
    } catch (e) { return {}; }
  }

  /** 高频错因清单：出门测/诊断反复错的知识点（不叫「迷思概念」） */
  function frequentMisses(limit) {
    try {
      const h = Storage.get(KEY_HISTORY, []) || [];
      const cnt = {};
      h.forEach(sess => {
        // 兼容新旧两种历史结构
        const qs = sess.questions || (sess.diagnose || []).concat(sess.exit || []);
        qs.forEach(q => {
          if (q && q.knowledge && q.correct === false) cnt[q.knowledge] = (cnt[q.knowledge] || 0) + 1;
        });
      });
      return Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])
        .slice(0, limit || 5)
        .map(k => ({ knowledge: k, misses: cnt[k] }));
    } catch (e) { return []; }
  }

  // ── 工具 ──
  function judge(expected, given) {
    const norm = v => String(v == null ? '' : v).trim()
      .replace(/\s+/g, '').replace(/[，,。.；;]/g, '').toLowerCase();
    const a = norm(expected), b = norm(given);
    if (!a || !b) return false;
    if (a === b) return true;
    // 选择题答案字母
    if (/^[a-d]$/.test(a) && b.length <= 3 && b.indexOf(a) >= 0) return true;
    // 数值容差
    const na = Number(a), nb = Number(b);
    if (isFinite(na) && isFinite(nb)) return Math.abs(na - nb) < 1e-6;
    return false;
  }

  function rate(arr) {
    const a = arr || [];
    if (!a.length) return null;
    return Math.round(a.filter(x => x.correct === true).length / a.length * 100);
  }

  function status() {
    const s = get();
    return {
      active: !!s.id && s.stage !== 'done',
      stage: s.stage,
      diagnoseRate: rate(s.diagnose),
      exitRate: rate(s.exit),
      guidedDone: s.guided.filter(g => g.done).length,
      guidedTotal: s.guided.length,
      hasRecap: !!s.recap,
    };
  }

  return {
    HINT_STAGES,
    start, get, save, clear,
    answerDiagnose, addGuided, answerStep, requestHint,
    setExit, answerExit, setRecap,
    overlayAll, frequentMisses, status,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = TutorSession;
