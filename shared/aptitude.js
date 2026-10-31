/**
 * 图形推理测验（瑞文风格）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么用图形推理
 * ══════════════════════════════════════════════════════════════
 * 瑞文推理测验（Raven's Progressive Matrices）是流体智力（Gf）的经典测量，
 * 优势：
 *   ① **不依赖语言和知识** —— 对中文语境的学生尤其公平，
 *      不会因为"没见过某类题"而失分
 *   ② **文化公平** —— 图形关系是通用的
 *   ③ 与学业成绩相关稳定（一般 g 相关 r≈0.4~0.5）
 *
 * 但要诚实：这不是标准化常模测验。所以：
 *   · 结果标成"百分位估计"而不是"IQ 120"
 *   · 给出置信区间，而不是一个精确数字
 *   · 明确告知这是**能力倾向参考**，不是判决
 *
 * ══════════════════════════════════════════════════════════════
 * 设计
 * ══════════════════════════════════════════════════════════════
 * 12 题，5 分钟，难度递增：
 *   1-4 题：单维度变化（大小、旋转、填充）
 *   5-8 题：双维度组合（形状+颜色、数量+位置）
 *   9-12 题：三阶矩阵推理（行列双重规律）
 *
 * 每题的选项用 SVG 动态生成，不依赖图片资源。
 */
const AptitudeTest = (() => {

  // ══════════════════════════════════════════════════════
  //  图形生成工具
  // ══════════════════════════════════════════════════════

  const SVG_NS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">';

  /** 生成一个基本图形 */
  function shape(kind, opts) {
    const o = opts || {};
    const fill = o.fill === 'black' ? '#1f2937' : o.fill === 'gray' ? '#9ca3af' : 'none';
    const stroke = '#1f2937';
    const sw = o.sw || 2.5;
    const scale = o.scale || 1;
    const rotate = o.rotate || 0;

    let inner = '';
    const cx = 50, cy = 50;
    const r = 26 * scale;

    if (kind === 'circle') {
      inner = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else if (kind === 'square') {
      const s = r * 1.55;
      inner = `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else if (kind === 'triangle') {
      const s = r * 1.7;
      const pts = `${cx},${cy - s / 2} ${cx + s / 2},${cy + s / 3} ${cx - s / 2},${cy + s / 3}`;
      inner = `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else if (kind === 'diamond') {
      const s = r * 1.5;
      const pts = `${cx},${cy - s / 2} ${cx + s / 2},${cy} ${cx},${cy + s / 2} ${cx - s / 2},${cy}`;
      inner = `<polygon points="${pts}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else if (kind === 'cross') {
      const s = r * 1.4, t = s / 3;
      inner = `<path d="M${cx - t},${cy - s / 2} h${2 * t} v${s / 2 - t} h${s / 2 - t} v${2 * t} h${-(s / 2 - t)} v${s / 2 - t} h${-2 * t} v${-(s / 2 - t)} h${-(s / 2 - t)} v${-2 * t} h${s / 2 - t} z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    } else if (kind === 'dot') {
      inner = `<circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="${fill === 'none' ? '#1f2937' : fill}"/>`;
    } else if (kind === 'star') {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const ang = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 === 0 ? r * 1.15 : r * 0.5;
        pts.push(`${cx + Math.cos(ang) * rr},${cy + Math.sin(ang) * rr}`);
      }
      inner = `<polygon points="${pts.join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    }

    const transform = rotate ? ` transform="rotate(${rotate} ${cx} ${cy})"` : '';
    return SVG_NS + `<g${transform}>${inner}</g></svg>`;
  }

  /** 生成一个"格子"（用于矩阵题） */
  function cell(content, opts) {
    const o = opts || {};
    const bg = o.bg || 'transparent';
    const border = o.border ? `stroke="#d1d5db" stroke-width="1"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="background:${bg}">` +
      (o.border ? `<rect x="0.5" y="0.5" width="99" height="99" fill="none" ${border}/>` : '') +
      content.replace(/<\/?svg[^>]*>/g, '') + '</svg>';
  }

  // ══════════════════════════════════════════════════════
  //  题库（12 题，难度递增）
  // ══════════════════════════════════════════════════════

  const QUESTIONS = [
    // ── 1-4：单维度变化 ──
    {
      id: 1, difficulty: 1,
      prompt: '接下来应该是什么？',
      matrix: [shape('circle', { scale: 0.5 }), shape('circle', { scale: 0.75 }), shape('circle', { scale: 1.0 })],
      layout: 'row',
      options: [
        shape('circle', { scale: 1.25 }),
        shape('circle', { scale: 1.0 }),
        shape('square', { scale: 1.0 }),
        shape('circle', { scale: 0.5 }),
      ],
      answer: 0,
      explain: '圆在逐渐变大，所以下一个更大。',
    },
    {
      id: 2, difficulty: 1,
      prompt: '接下来应该是什么？',
      matrix: [shape('square', { rotate: 0 }), shape('square', { rotate: 45 }), shape('square', { rotate: 90 })],
      layout: 'row',
      options: [
        shape('square', { rotate: 90 }),
        shape('square', { rotate: 135 }),
        shape('diamond', { rotate: 0 }),
        shape('square', { rotate: 0 }),
      ],
      answer: 1,
      explain: '每次顺时针转 45°，所以下一个是 135°。',
    },
    {
      id: 3, difficulty: 1,
      prompt: '接下来应该是什么？',
      matrix: [
        shape('triangle', { fill: 'none' }),
        shape('triangle', { fill: 'gray' }),
        shape('triangle', { fill: 'black' }),
      ],
      layout: 'row',
      options: [
        shape('triangle', { fill: 'black' }),
        shape('triangle', { fill: 'none' }),
        shape('diamond', { fill: 'black' }),
        shape('triangle', { fill: 'none', scale: 0.7 }),
      ],
      answer: 1,
      explain: '颜色依次是空→灰→黑，再回到空，形成循环。',
    },
    {
      id: 4, difficulty: 2,
      prompt: '接下来应该是什么？',
      matrix: [
        shape('circle', { scale: 1.2 }),
        shape('circle', { scale: 0.9 }),
        shape('circle', { scale: 0.6 }),
      ],
      layout: 'row',
      options: [
        shape('circle', { scale: 0.3 }),
        shape('circle', { scale: 0.6 }),
        shape('circle', { scale: 1.0 }),
        shape('dot', { scale: 1.0 }),
      ],
      answer: 0,
      explain: '每次缩小同一比例，所以继续变小。',
    },

    // ── 5-8：双维度组合 ──
    {
      id: 5, difficulty: 2,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('circle', { fill: 'none' }), shape('square', { fill: 'none' }),
        shape('square', { fill: 'none' }), null,   // null = 待填空格
      ],
      layout: 'grid2',
      options: [
        shape('circle', { fill: 'none' }),
        shape('square', { fill: 'black' }),
        shape('circle', { fill: 'black' }),
        shape('triangle', { fill: 'none' }),
      ],
      answer: 0,
      explain: '2×2 矩阵里，每行每列都各有一个圆和一个方，缺的是圆。',
    },
    {
      id: 6, difficulty: 2,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('triangle', { fill: 'none', scale: 0.7 }), shape('triangle', { fill: 'none', scale: 1.0 }),
        shape('triangle', { fill: 'none', scale: 1.0 }), null,
      ],
      layout: 'grid2',
      options: [
        shape('triangle', { fill: 'none', scale: 1.3 }),
        shape('triangle', { fill: 'black', scale: 1.3 }),
        shape('circle', { fill: 'none', scale: 1.3 }),
        shape('triangle', { fill: 'none', scale: 0.7 }),
      ],
      answer: 0,
      explain: '形状不变（都是三角），大小沿行列递增，缺的是更大的三角。',
    },
    {
      id: 7, difficulty: 3,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('circle', { fill: 'black' }), shape('circle', { fill: 'none' }),
        shape('square', { fill: 'black' }), null,
      ],
      layout: 'grid2',
      options: [
        shape('square', { fill: 'none' }),
        shape('square', { fill: 'black' }),
        shape('circle', { fill: 'none' }),
        shape('diamond', { fill: 'none' }),
      ],
      answer: 0,
      explain: '规律：行决定形状（圆/方），列决定填充（黑/空）。缺的是空方。',
    },
    {
      id: 8, difficulty: 3,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('dot', {}), shape('dot', {}), shape('dot', {}),
        shape('dot', {}), null, shape('dot', {}),
        shape('dot', {}), shape('dot', {}), shape('dot', {}),
      ],
      layout: 'grid3',
      options: [
        shape('dot', {}),
        shape('circle', { fill: 'none' }),
        shape('square', {}),
        shape('dot', { fill: 'gray' }),
      ],
      answer: 0,
      explain: '3×3 全是同样的点，缺的也是点。这题是干扰项多的送分题。',
    },

    // ── 9-12：三阶矩阵推理 ──
    {
      id: 9, difficulty: 4,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('circle', { scale: 0.6 }), shape('circle', { scale: 0.8 }), shape('circle', { scale: 1.0 }),
        shape('square', { scale: 0.6 }), shape('square', { scale: 0.8 }), shape('square', { scale: 1.0 }),
        shape('triangle', { scale: 0.6 }), shape('triangle', { scale: 0.8 }), null,
      ],
      layout: 'grid3',
      options: [
        shape('triangle', { scale: 1.0 }),
        shape('triangle', { scale: 0.8 }),
        shape('square', { scale: 1.0 }),
        shape('circle', { scale: 1.0 }),
      ],
      answer: 0,
      explain: '行=形状（圆/方/三角），列=大小（小/中/大）。缺的是大三角。',
    },
    {
      id: 10, difficulty: 4,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('circle', { fill: 'none', rotate: 0 }), shape('circle', { fill: 'black', rotate: 0 }), shape('circle', { fill: 'gray', rotate: 0 }),
        shape('square', { fill: 'none', rotate: 0 }), shape('square', { fill: 'black', rotate: 0 }), shape('square', { fill: 'gray', rotate: 0 }),
        shape('triangle', { fill: 'none', rotate: 0 }), shape('triangle', { fill: 'black', rotate: 0 }), null,
      ],
      layout: 'grid3',
      options: [
        shape('triangle', { fill: 'gray', rotate: 0 }),
        shape('triangle', { fill: 'black', rotate: 0 }),
        shape('triangle', { fill: 'none', rotate: 0 }),
        shape('square', { fill: 'gray', rotate: 0 }),
      ],
      answer: 0,
      explain: '行=形状，列=填充（空/黑/灰）。缺的是灰三角。',
    },
    {
      id: 11, difficulty: 5,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('circle', { scale: 0.6 }), shape('circle', { scale: 0.8, fill: 'gray' }), shape('circle', { scale: 1.0, fill: 'black' }),
        shape('square', { scale: 0.6 }), shape('square', { scale: 0.8, fill: 'gray' }), shape('square', { scale: 1.0, fill: 'black' }),
        shape('diamond', { scale: 0.6 }), shape('diamond', { scale: 0.8, fill: 'gray' }), null,
      ],
      layout: 'grid3',
      options: [
        shape('diamond', { scale: 1.0, fill: 'black' }),
        shape('diamond', { scale: 1.0, fill: 'gray' }),
        shape('diamond', { scale: 0.8, fill: 'black' }),
        shape('circle', { scale: 1.0, fill: 'black' }),
      ],
      answer: 0,
      explain: '行列同时变化：形状按行、大小和填充按列递增。缺的是大号黑色菱形。',
    },
    {
      id: 12, difficulty: 5,
      prompt: '缺少的那一格是什么？',
      matrix: [
        shape('circle', { scale: 1.0, rotate: 0 }), shape('square', { scale: 1.0, rotate: 45 }), shape('triangle', { scale: 1.0, rotate: 0 }),
        shape('square', { scale: 1.0, rotate: 45 }), shape('triangle', { scale: 1.0, rotate: 0 }), shape('circle', { scale: 1.0, rotate: 0 }),
        shape('triangle', { scale: 1.0, rotate: 0 }), shape('circle', { scale: 1.0, rotate: 0 }), null,
      ],
      layout: 'grid3',
      options: [
        shape('square', { scale: 1.0, rotate: 45 }),
        shape('circle', { scale: 1.0, rotate: 0 }),
        shape('triangle', { scale: 1.0, rotate: 0 }),
        shape('diamond', { scale: 1.0, rotate: 0 }),
      ],
      answer: 0,
      explain: '每行每列都包含圆、方、三角各一次（拉丁方阵），缺的是方。',
    },
  ];

  /**
   * 计分
   *
   * ★ 诚实说明：这**不是**标准化常模测验。
   * 下面是基于"12 题、难度递增"的粗略百分位映射，
   * 参考的是瑞文标准推理测验（SPM）的经验分布形状：
   *   · 大部分人能做对前 6-8 题（简单题区分度低）
   *   · 后 4 题是主要的区分区间
   *
   * 所以分数映射用**加权**：后面难题权重更高。
   */
  function scoreOf(answers) {
    // answers: [{ id, choice }]
    let correct = 0;
    let weightedGot = 0;
    let weightedTotal = 0;

    QUESTIONS.forEach(q => {
      const a = answers.find(x => x.id === q.id);
      const got = a && a.choice === q.answer;
      const w = 0.5 + 0.25 * q.difficulty;    // 难度 1 → 0.75，难度 5 → 1.75
      weightedTotal += w;
      if (got) { weightedGot += w; correct++; }
    });

    const weightedRate = weightedTotal > 0 ? weightedGot / weightedTotal : 0;

    /**
     * 加权正确率 → 百分位
     *
     * 映射依据：假设人群的加权正确率近似 Beta 分布，
     * 均值约 0.55（一半人能做出中等题），标准差约 0.20。
     * 用正态近似的 CDF 转成百分位。
     */
    const mean = 0.55, sd = 0.20;
    const z = (weightedRate - mean) / sd;
    // 正态 CDF 近似
    const cdf = (x) => {
      const t = 1 / (1 + 0.2316419 * Math.abs(x));
      const d = 0.3989423 * Math.exp(-x * x / 2);
      const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
      return x > 0 ? 1 - p : p;
    };
    const percentile = Math.max(0.02, Math.min(0.99, cdf(z)));

    /**
     * 标准误
     *
     * 12 题测验的测量标准误（SEM）大约对应百分位 ±0.12。
     * 题目越少，越不可靠 —— 这是诚信问题，不能给假精确。
     */
    const se = 0.12;

    return {
      correct,
      total: QUESTIONS.length,
      weightedRate: Math.round(weightedRate * 1000) / 1000,
      percentile: Math.round(percentile * 100) / 100,
      se,
      // 百分位的 80% 区间
      range: {
        low: Math.max(0.01, Math.round((percentile - 1.28 * se) * 100) / 100),
        high: Math.min(0.99, Math.round((percentile + 1.28 * se) * 100) / 100),
      },
      // 分维度（粗略）
      detail: QUESTIONS.map(q => {
        const a = answers.find(x => x.id === q.id);
        return {
          id: q.id,
          difficulty: q.difficulty,
          correct: !!(a && a.choice === q.answer),
          chosen: a ? a.choice : null,
          answer: q.answer,
        };
      }),
    };
  }

  /** 生成一份完整试卷（含 SVG） */
  function build() {
    return QUESTIONS.map(q => ({
      id: q.id,
      difficulty: q.difficulty,
      prompt: q.prompt,
      layout: q.layout,
      matrix: q.matrix,
      options: q.options,
      // 不暴露答案给前端渲染，但计分时要用（这里保留，前端别显示）
      _answer: q.answer,
      _explain: q.explain,
    }));
  }

  /** 检查答案（提交后调用） */
  function check(answers) {
    const results = QUESTIONS.map(q => {
      const a = answers.find(x => x.id === q.id);
      return {
        id: q.id,
        chosen: a ? a.choice : null,
        answer: q.answer,
        correct: !!(a && a.choice === q.answer),
        explain: q.explain,
      };
    });
    return { results, score: scoreOf(answers) };
  }

  return { build, check, scoreOf, _QUESTIONS: QUESTIONS };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = AptitudeTest;
