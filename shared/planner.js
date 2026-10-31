/**
 * 学习规划引擎 v0.4 — AI 驱动，所有分析调用大模型
 */
const Planner = (() => {
  /**
   * 生成每日学习计划（AI 驱动）
   */
  async function generateDailyPlan(settings) {
    var goal = Storage.getGoal();
    var weak = await ProgressEngine.analyzeWeakness(Storage.getRecords(), Storage.getMistakes());
    var totalMin = settings.hours * 60;

    /**
     * ★ 把用户的真实选择传下去（2026-10-24 修）
     *
     * 旧版问题：UI 有「侧重科目」和「强度」两个下拉框，
     *   调用方也把值传进了 settings，但这里**没往下传给 LLM**。
     *   结果：用户选"重点数学"，AI 生成的计划完全不受影响 ——
     *   这两个选项成了装饰品。
     *
     * 现在把 subject / intensity 一起传给 LLM.generateStudyPlan。
     */
    var focusSubject = (settings.subject && settings.subject !== 'auto') ? settings.subject : '';
    var intensity = settings.intensity || 'normal';

    var intensityHint = {
      easy: '轻松：每个任务 15-20 分钟，任务之间留缓冲，总量控制在可用时间的 70%',
      normal: '正常：每个任务 20-30 分钟，总量接近可用时间',
      hard: '高强度：每个任务 30-40 分钟，尽量排满，重点科目占更多份额',
    }[intensity] || '';

    try {
      var plan = await LLM.generateStudyPlan({
        hours: settings.hours,
        subjects: goal.selectedSubjects || goal.subjects,
        weaknesses: weak.list || [],
        goal: goal.target,
        current: goal.current,
        examDate: goal.examDate,

        // ★ 新增：让 AI 真正知道用户的选择
        focusSubject: focusSubject,
        intensity: intensity,
        intensityHint: intensityHint,
      });

      if (plan.dailyPlan) {
        plan.dailyPlan = plan.dailyPlan.map(function(t, i) {
          return { id: 't_' + Date.now() + '_' + i, t: t, completed: false };
        });
      }

      // 记忆由 App 层统一写入（保持所有模块共用一个 AI 人格）

      return {
        t: plan,
        totalMin: totalMin,
        date: new Date().toDateString(),
        method: 'ai',
        // ★ 记下用了什么设置，UI 可以显示"按你的设置生成"
        focusSubject: focusSubject,
        intensity: intensity,
      };
    } catch (e) {
      console.warn('AI规划失败:', e);
    }

    // 本地降级（也尊重侧重科目和强度）
    return localPlan(settings, totalMin, weak.list || [], goal);
  }

  function localPlan(settings, totalMin, weaknesses, goal) {
    var tasks = [];
    var rem = totalMin;
    var weakMin = Math.round(totalMin * 0.6);
    var sorted = weaknesses.slice(0, 6);

    if (sorted.length) {
      var per = Math.max(10, Math.floor(weakMin / sorted.length));
      sorted.forEach(function(w, i) {
        if (rem <= 0) return;
        var d = Math.min(per, rem);
        tasks.push({ id: 't_' + Date.now() + '_w' + i, t: { task: '巩固: ' + w.name, subject: w.subject, duration: d, type: 'weakness', description: '错误率 ' + Math.round((w.errorRate || 0) * 100) + '%' }, completed: false });
        rem -= d;
      });
    }

    var subs = settings.subject === 'auto' ? (goal.selectedSubjects || goal.subjects) : [settings.subject];
    var pracMin = totalMin - weakMin;
    subs.forEach(function(sub, si) {
      if (rem <= 0) return;
      var d = Math.min(Math.floor(pracMin / subs.length), rem);
      tasks.push({ id: 't_' + Date.now() + '_p' + si, t: { task: sub + ' 专题训练', subject: sub, duration: d, type: 'practice', description: '保持手感' }, completed: false });
      rem -= d;
    });

    if (rem > 5) {
      tasks.push({ id: 't_' + Date.now() + '_r', t: { task: '错题回顾与总结', subject: '通用', duration: rem, type: 'review', description: '回顾错题' }, completed: false });
    }

    return { t: { dailyPlan: tasks }, totalMin: totalMin, date: new Date().toDateString(), method: 'local' };
  }

  function getTodayTasks() {
    var p = Storage.getDaily();
    if (p.date !== new Date().toDateString()) return null;
    return { t: p, tasks: p.tasks.map(function(t) { return { t: t.t, completed: p.done.includes(t.id), id: t.id }; }) };
  }

  function savePlan(plan) {
    Storage.setDaily({ date: plan.date, tasks: plan.t.dailyPlan || [], done: [], totalMinutes: plan.totalMin });
  }

  /**
   * 勾选/取消任务。
   *
   * ★ 2026-10-24 改：不再把「计划时长」直接记成「学习时长」
   *
   * 旧行为：勾选一个 40 分钟的任务 → 立刻 +40 分钟学习时长。
   * 问题：
   *   · 用户可能只花了 15 分钟；也可能压根没做只是勾掉
   *   · 学习统计、学习监控、估分的时间权重全被这个假数据污染
   *
   * 新行为：
   *   · 完成 → 记「计划 40 分钟已完成」，但不计入实际学习时长
   *   · 实际时长由真实行为产生（做测验、看课程时长、学习监控）
   *   · 这样"计划"与"实际"是两条独立的数据
   */
  function completeTask(taskId) {
    var before = Storage.getDaily();
    var task = before.tasks.find(function(t) { return t.id === taskId; });
    if (!task) return before;

    var p = Storage.toggleTask(taskId);
    var credited = p.credited || [];
    var planned = p.planned || {};

    var nowDone = p.done.includes(taskId);

    if (nowDone && task.t && task.t.duration) {
      // 只记录"这个任务计划多少分钟、已完成"，不碰实际学习时长
      planned[taskId] = {
        plannedMin: Number(task.t.duration) || 0,
        at: new Date().toISOString(),
      };
    } else if (!nowDone && planned[taskId]) {
      delete planned[taskId];
    }

    p.planned = planned;
    Storage.setDaily(p);
    return p;
  }

  /** 今日完成情况（计划 vs 实际分开） */
  function todayProgress() {
    var d = Storage.getDaily();
    var tasks = d.tasks || [];
    var done = d.done || [];
    var planned = d.planned || {};

    var plannedMin = 0;      // 计划总时长
    var completedPlannedMin = 0;   // 已完成任务的计划时长
    var doneCount = 0;

    tasks.forEach(function(t) {
      var dur = Number(t.t && t.t.duration) || 0;
      plannedMin += dur;
      if (done.indexOf(t.id) >= 0) {
        doneCount++;
        completedPlannedMin += dur;
      }
    });

    return {
      total: tasks.length,
      done: doneCount,
      plannedMin: plannedMin,
      completedPlannedMin: completedPlannedMin,
      // 实际学习时长从 stats 拿（真实行为产生）
      actualMin: (Storage.getStats().minutes || 0),
    };
  }

  return { generateDailyPlan, getTodayTasks, savePlan, completeTask, todayProgress };
})();
