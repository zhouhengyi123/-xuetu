/**
 * 内置题库（2026-11-01）
 *
 * ══════════════════════════════════════════════════════════════
 * 定位
 * ══════════════════════════════════════════════════════════════
 * 用户要求：「内置大量高考题和一些联考题」。
 *
 * 这些题的作用是**兜底**：AI 模型没配置 / 调用失败 / 断网时，
 * 出卷功能仍然能出题，不至于开天窗。
 *
 * 结构完全对齐 shared/data.js 的 FALLBACKS 格式：
 *   { type, difficulty, knowledge, text, options, answer, explanation }
 *   · type: choice（选择）| fill（填空）
 *   · difficulty: easy | normal | hard
 *   · options/answer 的选项字母一致（answer 只写字母，如 'B'）
 *
 * ══════════════════════════════════════════════════════════════
 * 题目来源说明（重要，避免误导）
 * ══════════════════════════════════════════════════════════════
 * 这里收录的是**高考/联考高频考点与典型题型**，题目为按该题型
 * 改写或原创的等效题，**不是逐字照搬的历年真题原题**。
 * 原因：真题原文受版权保护，且逐字题容易被学生背答案而非掌握方法。
 *
 * 每条都标 `src` 说明类型：
 *   'gk'  高考真题同型（考点、难度、设问方式对齐）
 *   'lm'  联考/校考典型题
 *   'base' 基础必备
 * 界面上会如实展示这个来源，不谎称是原题。
 */
const TEACHING_QUESTIONS = {
  // ══════════════════════════════════════════════
  //  数学
  // ══════════════════════════════════════════════
  '数学': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "导数", text: "已知函数 f(x)=x³-3x，则 f(x) 的极大值为（  ）", options: ["A. -2","B. 0","C. 1","D. 2"], answer: "D", explanation: "f'(x)=3x²-3=3(x-1)(x+1)。x=-1 时取极大值 f(-1)=2。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "导数", text: "若函数 f(x)=ln x - ax 在区间 [1,+∞) 上单调递减，则实数 a 的取值范围是（  ）", options: ["A. a≥1","B. a>1","C. a≥1/e","D. a>1/e"], answer: "A", explanation: "f'(x)=1/x - a。在 [1,+∞) 上单调递减 ⟺ f'(x)≤0 恒成立 ⟺ a ≥ 1/x 对一切 x≥1 成立。而 1/x 在 [1,+∞) 上最大值为 1（x=1 处取到），所以 a ≥ 1。〔注：若区间是 (0,+∞)，则 1/x 无上界，不存在这样的有限 a —— 这是本题设 [1,+∞) 的原因。〕" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "圆锥曲线", text: "椭圆 x²/25 + y²/9 = 1 的离心率为（  ）", options: ["A. 3/5","B. 3/4","C. 5/4","D. 4/5"], answer: "D", explanation: "a²=25, b²=9 → c²=16, c=4。e=c/a=4/5。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "数列", text: "等差数列 {aₙ} 中，a₁=2，a₃+a₅=16，则公差 d 为（  ）", options: ["A. 1","B. 3","C. 4","D. 2"], answer: "D", explanation: "a₃=a₁+2d，a₅=a₁+4d，相加 2a₁+6d=16 → 4+6d=16 → d=2。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "三角函数", text: "函数 y=2sin(2x+π/6) 的最小正周期是（  ）", options: ["A. π/2","B. 2π","C. 4π","D. π"], answer: "D", explanation: "T=2π/|ω|=2π/2=π。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "概率", text: "从 1,2,3,4,5 中任取两个不同的数，其和为偶数的概率是（  ）", options: ["A. 3/5","B. 1/2","C. 4/5","D. 2/5"], answer: "D", explanation: "C(5,2)=10 种。和为偶数需同奇偶：奇数 3 个取 2 有 3 种，偶数 2 个取 2 有 1 种，共 4 种 → 4/10=2/5。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "立体几何", text: "正方体 ABCD-A₁B₁C₁D₁ 中，异面直线 A₁B 与 B₁C 所成角为（  ）", options: ["A. 30°","B. 45°","C. 60°","D. 90°"], answer: "C", explanation: "平移 B₁C 到 A₁D，即求 ∠BA₁D。三角形 A₁BD 三边均为面对角线，是正三角形 → 60°。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "集合", text: "设集合 A={x|-1<x<3}，B={x|x≥2}，则 A∩B=（  ）", options: ["A. {x|2≤x<3}","B. {x|2<x<3}","C. {x|-1<x≤2}","D. {x|x>-1}"], answer: "A", explanation: "取交集：x 同时满足 -1<x<3 和 x≥2，即 2≤x<3。" },
    { src: "gk", type: "fill", difficulty: "normal", knowledge: "复数", text: "复数 z=(1+2i)/(1-i) 的虚部为 ______", answer: "3/2", explanation: "z=(1+2i)(1+i)/[(1-i)(1+i)]=(-1+3i)/2=-1/2+3i/2，虚部 3/2。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "向量", text: "已知向量 a=(1,2)，b=(x,-1)，若 a⊥b，则 x=（  ）", options: ["A. -2","B. 1/2","C. -1/2","D. 2"], answer: "D", explanation: "垂直 ⟺ 点积为 0：1·x+2·(-1)=0 → x=2。" },
    { src: "lm", type: "choice", difficulty: "hard", knowledge: "导数", text: "曲线 y=x³-2x 在点 (1,-1) 处的切线方程为（  ）", options: ["A. y=x-2","B. y=-x","C. y=3x-4","D. y=x"], answer: "A", explanation: "y'=3x²-2，在 x=1 处斜率=1。过 (1,-1)：y+1=1·(x-1) → y=x-2。" },
    { src: "base", type: "fill", difficulty: "easy", knowledge: "函数", text: "函数 f(x)=√(x-1) 的定义域为 ______", answer: "[1,+∞)", explanation: "根号内需 ≥0：x-1≥0 → x≥1。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "函数", text: "函数 f(x)=2x+1，则 f(3)=（  ）", options: ["A. 5","B. 6","C. 7","D. 8"], answer: "C", explanation: "f(3)=2×3+1=7。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "指数对数", text: "log₂8 =（  ）", options: ["A. 2","B. 4","C. 8","D. 3"], answer: "D", explanation: "2³=8，所以 log₂8=3。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "三角函数", text: "cos60° =（  ）", options: ["A. 1/2","B. √3/2","C. √2/2","D. 1"], answer: "A", explanation: "cos60°=1/2 是特殊角函数值。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "向量", text: "向量 a=(3,4) 的模为（  ）", options: ["A. 3","B. 4","C. 5","D. 7"], answer: "C", explanation: "|a|=√(3²+4²)=√25=5。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "数列", text: "等比数列 a₁=3，q=2，则 a₄=（  ）", options: ["A. 12","B. 18","C. 24","D. 48"], answer: "C", explanation: "a₄=a₁q³=3×8=24。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "不等式", text: "不等式 x-3>0 的解集是（  ）", options: ["A. x>3","B. x<3","C. x>0","D. x<0"], answer: "A", explanation: "移项得 x>3。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "立体几何", text: "棱长为 2 的正方体体积为（  ）", options: ["A. 4","B. 6","C. 8","D. 12"], answer: "C", explanation: "V=a³=2³=8。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "概率", text: "掷一枚均匀骰子，出现偶数的概率是（  ）", options: ["A. 1/6","B. 1/3","C. 1/2","D. 2/3"], answer: "C", explanation: "偶数有 2,4,6 共 3 个，3/6=1/2。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "统计", text: "数据 2,4,6,8,10 的平均数是（  ）", options: ["A. 5","B. 7","C. 8","D. 6"], answer: "D", explanation: "(2+4+6+8+10)/5=30/5=6。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "解析几何", text: "圆 x²+y²=9 的半径是（  ）", options: ["A. 9","B. 4.5","C. √3","D. 3"], answer: "D", explanation: "r²=9 → r=3。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "导数", text: "f(x)=x² 的导数是（  ）", options: ["A. x","B. 2x","C. x²","D. 2"], answer: "B", explanation: "(x²)'=2x。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "复数", text: "复数 (2+i)+(1-3i)=（  ）", options: ["A. 3-2i","B. 3+2i","C. 1-2i","D. 3-4i"], answer: "A", explanation: "实部相加 2+1=3，虚部相加 1-3=-2 → 3-2i。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "集合", text: "集合 {1,2,3} 的子集个数是（  ）", options: ["A. 3","B. 6","C. 8","D. 9"], answer: "C", explanation: "含 n 个元素的集合有 2ⁿ 个子集，2³=8。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "三角恒等变换", text: "sin2α =（  ）", options: ["A. 2sinα","B. 2sinαcosα","C. sin²α","D. cos²α-sin²α"], answer: "B", explanation: "二倍角公式 sin2α=2sinαcosα。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "函数", text: "函数 y=x²-2x+3 的最小值是（  ）", options: ["A. 1","B. 3","C. 4","D. 2"], answer: "D", explanation: "y=(x-1)²+2，x=1 时取最小值 2。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "数列", text: "等差数列前 n 项和 Sₙ=n(n+1)/2，则第 5 项 a₅=（  ）", options: ["A. 4","B. 6","C. 15","D. 5"], answer: "D", explanation: "S₅=15，S₄=10，a₅=S₅-S₄=5。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "概率", text: "甲乙独立完成某任务，成功率分别 0.8 和 0.5，两人都成功的概率是（  ）", options: ["A. 0.3","B. 0.65","C. 0.9","D. 0.4"], answer: "D", explanation: "独立事件：0.8×0.5=0.4。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "圆锥曲线", text: "双曲线 x²/9-y²/16=1 的渐近线方程是（  ）", options: ["A. y=±(3/4)x","B. y=±(4/3)x","C. y=±(9/16)x","D. y=±x"], answer: "B", explanation: "a=3,b=4，渐近线 y=±(b/a)x=±(4/3)x。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "导数", text: "若函数 f(x)=x³-3ax 在区间 (0,1) 内单调递减，则 a 的取值范围是（  ）", options: ["A. a≥1","B. a≤1","C. a>1","D. a<1"], answer: "A", explanation: "f'(x)=3x²-3a。在 (0,1) 内单调递减 ⟺ f'(x)≤0 在 (0,1) 恒成立 ⟺ a≥x² 对 x∈(0,1) 成立。x² 在 (0,1) 上趋于 1，故 a≥1。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "圆锥曲线", text: "过抛物线 y²=4x 焦点的直线交抛物线于 A、B 两点，若 |AB|=8，则 AB 中点到 y 轴的距离为（  ）", options: ["A. 2","B. 4","C. 6","D. 3"], answer: "D", explanation: "抛物线 y²=4x 的焦点 (1,0)，准线 x=-1。|AB|=x₁+x₂+2=8 → x₁+x₂=6。中点横坐标 = 3，到 y 轴距离 = 3。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "数列", text: "数列 {aₙ} 满足 a₁=1，aₙ₊₁=2aₙ+1，则 a₅=（  ）", options: ["A. 15","B. 33","C. 63","D. 31"], answer: "D", explanation: "构造：aₙ₊₁+1=2(aₙ+1)，故 {aₙ+1} 是首项 2、公比 2 的等比数列。aₙ+1=2ⁿ → a₅=2⁵-1=31。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "立体几何", text: "正方体棱长为 2，其内切球的表面积为（  ）", options: ["A. 2π","B. 8π","C. 16π","D. 4π"], answer: "D", explanation: "内切球半径 r=棱长/2=1，表面积 S=4πr²=4π。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "概率", text: "甲乙丙三人独立破译一份密码，概率分别为 1/2、1/3、1/4，则密码被破译的概率为（  ）", options: ["A. 3/4","B. 1/4","C. 2/3","D. 11/12"], answer: "A", explanation: "用对立事件：都破译不出 = (1/2)(2/3)(3/4)=1/4。所以至少一人破译 = 1-1/4 = 3/4。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "三角函数", text: "若 sinα+cosα=1/2，则 sinαcosα=（  ）", options: ["A. -3/8","B. 3/8","C. -1/4","D. 1/4"], answer: "A", explanation: "两边平方：1+2sinαcosα=1/4 → 2sinαcosα=-3/4 → sinαcosα=-3/8。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "集合", text: "集合 A={1,2}，B={2,3}，则 A∪B=（  ）", options: ["A. {2}","B. {1,2,3}","C. {1,3}","D. {1,2}"], answer: "B", explanation: "并集取所有元素：{1,2,3}。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "函数", text: "f(x)=3x-2，则 f(1)=（  ）", options: ["A. 1","B. 3","C. 5","D. -1"], answer: "A", explanation: "f(1)=3×1-2=1。" },
    { src: "base", type: "fill", difficulty: "easy", knowledge: "指数", text: "2⁵ = ______", answer: "32", explanation: "2⁵=2×2×2×2×2=32。" },
  ],

  // ══════════════════════════════════════════════
  //  物理
  // ══════════════════════════════════════════════
  '物理': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "运动学", text: "物体做匀加速直线运动，初速度 2 m/s，加速度 2 m/s²，3 s 末的速度为（  ）", options: ["A. 6 m/s","B. 10 m/s","C. 12 m/s","D. 8 m/s"], answer: "D", explanation: "v=v₀+at=2+2×3=8 m/s。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "牛顿定律", text: "质量 2 kg 的物体受 6 N 合外力，其加速度为（  ）", options: ["A. 1 m/s²","B. 2 m/s²","C. 3 m/s²","D. 12 m/s²"], answer: "C", explanation: "a=F/m=6/2=3 m/s²。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "电磁感应", text: "闭合回路中磁通量在 0.2 s 内由 0.4 Wb 均匀减小到 0，感应电动势大小为（  ）", options: ["A. 0.5 V","B. 1 V","C. 2 V","D. 4 V"], answer: "C", explanation: "E=ΔΦ/Δt=0.4/0.2=2 V。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "圆周运动", text: "质量 m 的小球以速率 v 做半径 r 的匀速圆周运动，向心力大小为（  ）", options: ["A. mv/r","B. mv²/r","C. mv²r","D. mr/v"], answer: "B", explanation: "F=mv²/r。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "电场", text: "两点电荷间距离变为原来的 2 倍，库仑力变为原来的（  ）", options: ["A. 2 倍","B. 1/2","C. 1/4","D. 4 倍"], answer: "C", explanation: "F=kq₁q₂/r²，r 变 2 倍 → F 变 1/4。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "机械能", text: "质量 1 kg 物体从 5 m 高处自由下落（g=10），落地时动能为（  ）", options: ["A. 5 J","B. 100 J","C. 500 J","D. 50 J"], answer: "D", explanation: "机械能守恒：Ek=mgh=1×10×5=50 J。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "光学", text: "光从空气射入水中，下列说法正确的是（  ）", options: ["A. 频率变大","B. 波长变短","C. 速度变大","D. 频率变小"], answer: "B", explanation: "频率由光源决定不变；水中速度变小，由 v=λf，波长变短。" },
    { src: "base", type: "fill", difficulty: "easy", knowledge: "单位", text: "1 kW·h = ______ J", answer: "3.6×10⁶", explanation: "1000 W × 3600 s = 3.6×10⁶ J。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "运动学", text: "匀速直线运动的速度 5 m/s，经过 4 s 的位移是（  ）", options: ["A. 5 m","B. 9 m","C. 20 m","D. 1.25 m"], answer: "C", explanation: "x=vt=5×4=20 m。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "力学", text: "重力加速度取 g=10 m/s²，质量 3 kg 物体所受重力为（  ）", options: ["A. 3 N","B. 13 N","C. 30 N","D. 300 N"], answer: "C", explanation: "G=mg=3×10=30 N。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "功和能", text: "用 20 N 的水平力推动物体移动 5 m，做功为（  ）", options: ["A. 4 J","B. 25 J","C. 100 J","D. 200 J"], answer: "C", explanation: "W=Fs=20×5=100 J（力与位移同向）。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "电学", text: "电阻 10 Ω，通过电流 2 A，两端电压为（  ）", options: ["A. 5 V","B. 12 V","C. 20 V","D. 0.2 V"], answer: "C", explanation: "U=IR=2×10=20 V。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "电功率", text: "额定功率 1000 W 的电器工作 2 h，消耗电能为（  ）", options: ["A. 0.5 kW·h","B. 2000 kW·h","C. 500 kW·h","D. 2 kW·h"], answer: "D", explanation: "W=Pt=1 kW×2 h=2 kW·h。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "磁通量", text: "线圈面积 0.1 m²，磁感应强度 2 T 且垂直穿过，磁通量为（  ）", options: ["A. 0.05 Wb","B. 2 Wb","C. 20 Wb","D. 0.2 Wb"], answer: "D", explanation: "Φ=BS=2×0.1=0.2 Wb（垂直时 cosθ=1）。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "折射", text: "光从空气进入玻璃（折射率 1.5），下列说法正确的是（  ）", options: ["A. 速度变大","B. 波长变长","C. 频率不变","D. 频率变小"], answer: "C", explanation: "频率由光源决定，进入介质后不变；速度和波长都变小。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "波", text: "波长 2 m，频率 5 Hz 的波速为（  ）", options: ["A. 0.4 m/s","B. 2.5 m/s","C. 7 m/s","D. 10 m/s"], answer: "D", explanation: "v=λf=2×5=10 m/s。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "动量", text: "质量 2 kg 速度 3 m/s 的物体动量为（  ）", options: ["A. 1.5 kg·m/s","B. 5 kg·m/s","C. 6 kg·m/s","D. 9 kg·m/s"], answer: "C", explanation: "p=mv=2×3=6 kg·m/s。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "牛顿定律", text: "物体做匀速直线运动时，所受合外力（  ）", options: ["A. 为零","B. 恒定不为零","C. 不断增大","D. 无法判断"], answer: "A", explanation: "匀速直线运动即加速度为零，由 F=ma 得合外力为零。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "光学", text: "全反射发生的条件是（  ）", options: ["A. 光从光密介质射向光疏介质且入射角大于临界角","B. 光从光疏射向光密","C. 入射角小于临界角","D. 任何情况"], answer: "A", explanation: "必须同时满足：从光密到光疏，且入射角大于临界角。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "电场", text: "点电荷 Q=2×10⁻⁶ C，距其 0.3 m 处的场强（k=9×10⁹）为（  ）", options: ["A. 2×10⁵ N/C","B. 2×10⁶ N/C","C. 6×10⁵ N/C","D. 1×10⁵ N/C"], answer: "A", explanation: "E=kQ/r²=9×10⁹×2×10⁻⁶/0.09=2×10⁵ N/C。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "圆周运动", text: "半径 2 m，周期 4 s 的匀速圆周运动，线速度为（  ）", options: ["A. 0.5 m/s","B. 2π m/s","C. 4π m/s","D. π m/s"], answer: "D", explanation: "v=2πr/T=2π×2/4=π m/s。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "单位制", text: "下列属于国际单位制基本单位的是（  ）", options: ["A. 牛顿","B. 焦耳","C. 千克","D. 瓦特"], answer: "C", explanation: "基本单位有 7 个：m、kg、s、A、K、mol、cd。牛顿、焦耳、瓦特都是导出单位。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "电磁感应", text: "导体棒长 0.5 m，以 4 m/s 垂直切割磁感线（B=0.2 T），产生的感应电动势为（  ）", options: ["A. 0.04 V","B. 4 V","C. 0.8 V","D. 0.4 V"], answer: "D", explanation: "E=BLv=0.2×0.5×4=0.4 V。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "力学", text: "质量 2 kg 物体从 5 m 高处自由下落（不计阻力，g=10），落地前瞬间的动量为（  ）", options: ["A. 10 kg·m/s","B. 40 kg·m/s","C. 100 kg·m/s","D. 20 kg·m/s"], answer: "D", explanation: "v=√(2gh)=√(2×10×5)=√100=10 m/s。p=mv=2×10=20 kg·m/s。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "电路", text: "电源电动势 12 V，内阻 1 Ω，外接电阻 5 Ω，则路端电压为（  ）", options: ["A. 10 V","B. 12 V","C. 2 V","D. 5 V"], answer: "A", explanation: "I=E/(R+r)=12/6=2 A。U端=E-Ir=12-2×1=10 V。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "单位", text: "力的国际单位是（  ）", options: ["A. 焦耳","B. 牛顿","C. 瓦特","D. 帕斯卡"], answer: "B", explanation: "力的单位是牛顿 N；焦耳是功，瓦特是功率，帕斯卡是压强。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "速度", text: "汽车 2 小时行驶 120 km，平均速度为（  ）", options: ["A. 60 km/h","B. 120 km/h","C. 240 km/h","D. 30 km/h"], answer: "A", explanation: "v=s/t=120/2=60 km/h。" },
  ],

  // ══════════════════════════════════════════════
  //  化学
  // ══════════════════════════════════════════════
  '化学': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "物质的量", text: "标准状况下 11.2 L O₂ 的物质的量为（  ）", options: ["A. 0.25 mol","B. 1 mol","C. 2 mol","D. 0.5 mol"], answer: "D", explanation: "n=V/Vm=11.2/22.4=0.5 mol。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "氧化还原", text: "下列反应中，氧化剂是（  ）  Zn + CuSO₄ → ZnSO₄ + Cu", options: ["A. Zn","B. CuSO₄","C. ZnSO₄","D. Cu"], answer: "B", explanation: "Cu²⁺ 得电子被还原，CuSO₄ 是氧化剂；Zn 失电子是还原剂。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "元素周期律", text: "下列气态氢化物中最稳定的是（  ）", options: ["A. CH₄","B. NH₃","C. H₂O","D. HF"], answer: "D", explanation: "非金属性越强，氢化物越稳定。F 非金属性最强 → HF 最稳定。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "化学平衡", text: "对于反应 N₂+3H₂⇌2NH₃（放热），升高温度，平衡（  ）", options: ["A. 正向移动","B. 逆向移动","C. 不移动","D. 无法判断"], answer: "B", explanation: "放热反应升温向吸热方向（逆反应）移动。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "溶液", text: "pH=3 的盐酸稀释 100 倍后，pH 约为（  ）", options: ["A. 4","B. 6","C. 3","D. 5"], answer: "D", explanation: "c(H⁺) 由 10⁻³ 变为 10⁻⁵，pH=5。" },
    { src: "lm", type: "fill", difficulty: "normal", knowledge: "摩尔质量", text: "4.4 g CO₂ 的物质的量为 ______ mol（C=12, O=16）", answer: "0.1", explanation: "M=44 g/mol，n=4.4/44=0.1 mol。" },
    { src: "base", type: "choice", difficulty: "easy", knowledge: "酸碱", text: "下列物质属于强电解质的是（  ）", options: ["A. 醋酸","B. 氨水","C. NaCl","D. 蔗糖"], answer: "C", explanation: "NaCl 在水中完全电离，是强电解质；醋酸、氨水是弱电解质，蔗糖是非电解质。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "化学式", text: "水的化学式是（  ）", options: ["A. H₂O","B. HO₂","C. H₂O₂","D. OH"], answer: "A", explanation: "水由 2 个氢原子和 1 个氧原子构成。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "物质的量", text: "1 mol 任何物质所含的粒子数约为（  ）", options: ["A. 6.02×10²³","B. 6.02×10²²","C. 3.01×10²³","D. 1.0×10²³"], answer: "A", explanation: "阿伏加德罗常数 Nᴀ≈6.02×10²³ /mol。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "摩尔质量", text: "NaOH 的摩尔质量是（  ）（Na=23,O=16,H=1）", options: ["A. 39 g/mol","B. 56 g/mol","C. 23 g/mol","D. 40 g/mol"], answer: "D", explanation: "23+16+1=40 g/mol。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "氧化还原", text: "下列物质中硫元素化合价为 +6 的是（  ）", options: ["A. H₂S","B. SO₂","C. H₂SO₄","D. S"], answer: "C", explanation: "H₂SO₄ 中 S 为 +6；H₂S 是 -2，SO₂ 是 +4，单质 S 是 0。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "溶液浓度", text: "1 L 溶液含 2 mol NaCl，其物质的量浓度为（  ）", options: ["A. 0.5 mol/L","B. 1 mol/L","C. 2 mol/L","D. 4 mol/L"], answer: "C", explanation: "c=n/V=2/1=2 mol/L。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "元素周期表", text: "原子序数为 11 的元素是（  ）", options: ["A. Na","B. Mg","C. K","D. Ne"], answer: "A", explanation: "11 号元素是钠 Na，第三周期第 ⅠA 族。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "化学键", text: "NaCl 中的化学键类型是（  ）", options: ["A. 共价键","B. 离子键","C. 金属键","D. 氢键"], answer: "B", explanation: "活泼金属与活泼非金属之间形成离子键。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "反应速率", text: "升高温度，化学反应速率通常（  ）", options: ["A. 增大","B. 减小","C. 不变","D. 先增后减"], answer: "A", explanation: "升温使活化分子百分数增加，反应速率增大。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "酸碱中和", text: "0.1 mol/L HCl 溶液的 pH 为（  ）", options: ["A. 0.1","B. 2","C. 7","D. 1"], answer: "D", explanation: "c(H⁺)=0.1 mol/L，pH=-lg0.1=1。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "有机", text: "乙醇的结构简式是（  ）", options: ["A. CH₃OH","B. C₂H₅OH","C. CH₃COOH","D. C₆H₆"], answer: "B", explanation: "乙醇 C₂H₅OH；CH₃OH 是甲醇，CH₃COOH 是乙酸。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "化学平衡", text: "对于 H₂(g)+I₂(g)⇌2HI(g)，增大压强，平衡（  ）", options: ["A. 正向移动","B. 逆向移动","C. 不移动","D. 无法判断"], answer: "C", explanation: "两边气体分子数相等（1+1=2），改变压强不影响平衡。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "实验", text: "检验 CO₃²⁻ 常用的试剂是（  ）", options: ["A. 稀盐酸","B. NaOH","C. NaCl","D. KNO₃"], answer: "A", explanation: "加稀盐酸产生能使澄清石灰水变浑浊的 CO₂ 气体。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "化学反应计算", text: "4 g 氢气完全燃烧生成水，需要氧气多少克（H=1, O=16）", options: ["A. 16 g","B. 4 g","C. 64 g","D. 32 g"], answer: "D", explanation: "2H₂+O₂→2H₂O。4 g H₂ = 2 mol，需 1 mol O₂ = 32 g。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "溶液", text: "将 4 g NaOH 溶于水配成 1 L 溶液，其物质的量浓度为（Na=23,O=16,H=1）", options: ["A. 0.1 mol/L","B. 1 mol/L","C. 0.4 mol/L","D. 4 mol/L"], answer: "A", explanation: "M(NaOH)=40 g/mol，n=4/40=0.1 mol，c=0.1/1=0.1 mol/L。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "常见物质", text: "下列物质中属于纯净物的是（  ）", options: ["A. 空气","B. 蒸馏水","C. 海水","D. 石油"], answer: "B", explanation: "蒸馏水只含 H₂O 一种物质；其余都是混合物。" },
  ],

  // ══════════════════════════════════════════════
  //  生物
  // ══════════════════════════════════════════════
  '生物': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "细胞结构", text: "下列细胞器中，被称为「动力车间」的是（  ）", options: ["A. 核糖体","B. 线粒体","C. 高尔基体","D. 溶酶体"], answer: "B", explanation: "线粒体是有氧呼吸主要场所，为细胞提供能量。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "遗传规律", text: "AaBb（两对基因独立遗传）× aabb，后代基因型种类为（  ）", options: ["A. 2 种","B. 4 种","C. 8 种","D. 16 种"], answer: "B", explanation: "Aa×aa→2 种，Bb×bb→2 种，独立遗传 2×2=4 种。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "光合作用", text: "光合作用光反应阶段产生的物质不包括（  ）", options: ["A. O₂","B. [H]（NADPH）","C. ATP","D. C₃"], answer: "D", explanation: "C₃ 是暗反应（卡尔文循环）的中间产物，光反应不产生。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "稳态", text: "人体内环境不包括（  ）", options: ["A. 血浆","B. 组织液","C. 淋巴","D. 细胞内液"], answer: "D", explanation: "内环境 = 细胞外液 = 血浆 + 组织液 + 淋巴。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "细胞分裂", text: "减数第一次分裂后期发生的是（  ）", options: ["A. 着丝点分裂","B. 同源染色体分离","C. 姐妹染色单体分离","D. 染色体复制"], answer: "B", explanation: "减Ⅰ后期同源染色体分离；着丝点分裂在减Ⅱ后期。" },
    { src: "base", type: "fill", difficulty: "easy", knowledge: "遗传物质", text: "DNA 的基本组成单位是 ______", answer: "脱氧核苷酸", explanation: "由脱氧核糖、磷酸、含氮碱基组成。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "细胞结构", text: "蓝藻属于（  ）", options: ["A. 真核生物","B. 原核生物","C. 病毒","D. 真菌"], answer: "B", explanation: "蓝藻（蓝细菌）没有核膜包被的细胞核，属原核生物。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "细胞结构", text: "植物细胞特有的结构是（  ）", options: ["A. 线粒体","B. 细胞膜","C. 细胞壁","D. 核糖体"], answer: "C", explanation: "细胞壁（纤维素）是植物细胞特有；动物细胞没有。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "遗传", text: "人类体细胞染色体的数目是（  ）", options: ["A. 23 条","B. 46 条","C. 22 对","D. 24 对"], answer: "B", explanation: "人体细胞有 23 对 = 46 条染色体。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "遗传", text: "DNA 复制方式是（  ）", options: ["A. 全保留复制","B. 半保留复制","C. 弥散复制","D. 不复制"], answer: "B", explanation: "DNA 复制为半保留复制：每个子代 DNA 含一条母链和一条新链。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "代谢", text: "有氧呼吸产生 ATP 最多的阶段是（  ）", options: ["A. 第一阶段","B. 第二阶段","C. 第三阶段","D. 三阶段相同"], answer: "C", explanation: "第三阶段（电子传递链）产生 ATP 最多，约 26~28 个。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "稳态", text: "人体血糖调节的主要激素是（  ）", options: ["A. 胰岛素和胰高血糖素","B. 甲状腺素","C. 肾上腺素和生长激素","D. 抗利尿激素"], answer: "A", explanation: "胰岛素降血糖，胰高血糖素升血糖，二者拮抗调节。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "免疫", text: "下列属于特异性免疫的是（  ）", options: ["A. 皮肤阻挡病原体","B. 吞噬细胞吞噬","C. 抗体与抗原结合","D. 溶菌酶杀菌"], answer: "C", explanation: "A、B、D 都是非特异性免疫；抗体与抗原特异性结合属体液免疫。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "遗传规律", text: "两对等位基因独立遗传的杂合子 AaBb 自交，后代中双隐性个体占（  ）", options: ["A. 1/16","B. 1/8","C. 1/4","D. 9/16"], answer: "A", explanation: "aabb 概率 = 1/4×1/4=1/16。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "进化", text: "现代生物进化理论认为，进化的实质是（  ）", options: ["A. 种群基因频率的改变","B. 个体性状改变","C. 物种数目增加","D. 器官发达"], answer: "A", explanation: "进化实质是种群基因频率的定向改变，单位是种群不是个体。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "遗传计算", text: "杂合子 Aa 自交，后代中表现型与亲本相同的个体占（  ）", options: ["A. 1/4","B. 1/2","C. 3/4","D. 1"], answer: "C", explanation: "Aa×Aa → 1AA:2Aa:1aa。表现型显性（AA+Aa）占 3/4，与亲本 Aa（显性）相同。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "细胞", text: "细胞中含量最多的化合物是（  ）", options: ["A. 蛋白质","B. 水","C. 糖类","D. 脂质"], answer: "B", explanation: "水是细胞中含量最多的化合物（约 85%~90%）。" },
  ],

  // ══════════════════════════════════════════════
  //  语文
  // ══════════════════════════════════════════════
  '语文': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "成语", text: "下列各句中，加点成语使用恰当的一项是（  ）", options: ["A. 他的演讲鞭辟入里，令人叹服","B. 这道菜味道十分差强人意","C. 他学习成绩好，真是文不加点","D. 大家对他的意见莫衷一是"], answer: "A", explanation: "A 恰当。「差强人意」是大体令人满意（B 误用）；「文不加点」形容写文章快（C 误用）；「莫衷一是」指意见分歧，不能指个人（D 误用）。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "病句", text: "下列各句中没有语病的一项是（  ）", options: ["A. 通过这次活动，使我提高了认识","B. 他不但会画画，而且我也喜欢画画","C. 我们要善于发现问题并及时解决问题","D. 这次考试的成绩，比上次有了明显改善"], answer: "C", explanation: "A 缺主语（删「通过」或「使」）；B 关联词主语不一致；D 「成绩改善」搭配不当，应为「提高」。" },
    { src: "gk", type: "fill", difficulty: "normal", knowledge: "默写", text: "锲而舍之，朽木不折；______，金石可镂。（《劝学》）", answer: "锲而不舍", explanation: "注意「锲」的写法，不要写成「契」。" },
    { src: "gk", type: "fill", difficulty: "normal", knowledge: "默写", text: "青冥浩荡不见底，______。（《梦游天姥吟留别》）", answer: "日月照耀金银台", explanation: "注意「耀」不写「曜」。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "文言实词", text: "「顾」在下列句中意为「回头看」的是（  ）", options: ["A. 三顾臣于草庐之中","B. 顾念蓄劣物终无所用","C. 荆轲顾笑武阳","D. 顾吾念之"], answer: "C", explanation: "A 拜访；B 但是；C 回头看；D 只是。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "文学常识", text: "《红楼梦》的作者是（  ）", options: ["A. 罗贯中","B. 曹雪芹","C. 吴承恩","D. 施耐庵"], answer: "B", explanation: "《红楼梦》前 80 回为曹雪芹所著。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "成语", text: "「不刊之论」的意思是（  ）", options: ["A. 不能刊登的言论","B. 不可改动的正确言论","C. 没有价值的话","D. 未发表的见解"], answer: "B", explanation: "「刊」是削除、修改之意，不刊之论指无法修改的正确言论。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "文言实词", text: "「去」在「去国怀乡」中的意思是（  ）", options: ["A. 到……去","B. 离开","C. 除去","D. 距离"], answer: "B", explanation: "古汉语「去」多指离开，「去国」即离开国都。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "病句", text: "下列句子没有语病的是（  ）", options: ["A. 能否取得好成绩，关键在于努力","B. 通过这次活动，使我们懂得了团结","C. 他的写作水平有了明显的进步","D. 我们要防止交通事故不再发生"], answer: "A", explanation: "B 缺主语；C 「水平」与「进步」搭配不当（应为提高）；D 否定不当。" },
    { src: "gk", type: "fill", difficulty: "normal", knowledge: "默写", text: "长风破浪会有时，______。（《行路难》）", answer: "直挂云帆济沧海", explanation: "注意「济」和「沧」的写法。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "文言虚词", text: "「之」在「句读之不知」中的用法是（  ）", options: ["A. 结构助词「的」","B. 代词","C. 宾语前置的标志","D. 动词「到」"], answer: "C", explanation: "「句读之不知」即「不知句读」，之 是宾语前置的标志。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "诗歌", text: "「大江东去，浪淘尽」出自（  ）", options: ["A. 苏轼《念奴娇·赤壁怀古》","B. 李清照《声声慢》","C. 辛弃疾《永遇乐》","D. 柳永《雨霖铃》"], answer: "A", explanation: "出自苏轼《念奴娇·赤壁怀古》，豪放派代表作。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "文言实词", text: "「微夫人之力不及此」中「微」的意思是（  ）", options: ["A. 微小","B. 如果没有","C. 稍微","D. 隐约"], answer: "B", explanation: "「微」在古汉语中常表假设否定，「如果没有」。此句出自《烛之武退秦师》。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "文学常识", text: "《静夜思》的作者是（  ）", options: ["A. 杜甫","B. 李白","C. 白居易","D. 王维"], answer: "B", explanation: "《静夜思》是李白的名作。" },
  ],

  // ══════════════════════════════════════════════
  //  英语
  // ══════════════════════════════════════════════
  '英语': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "动词时态", text: "By the time he arrived, the meeting ______ for ten minutes.", options: ["A. had begun","B. had been on","C. has begun","D. began"], answer: "B", explanation: "for ten minutes 表示持续，begin 是短暂动词不能与持续时间连用，改用 be on。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "非谓语", text: "______ from the top of the hill, the city looks beautiful.", options: ["A. Seeing","B. Seen","C. To see","D. Having seen"], answer: "B", explanation: "the city 与 see 是被动关系（城市被看），用过去分词作状语。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "定语从句", text: "This is the house ______ I lived in last year.", options: ["A. which","B. where","C. when","D. what"], answer: "A", explanation: "介词 in 后面缺宾语，用 which（in which = where，但此处 in 已在句末，所以用 which）。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "虚拟语气", text: "If I ______ you, I would accept the offer.", options: ["A. am","B. was","C. were","D. be"], answer: "C", explanation: "与现在事实相反的虚拟，be 动词一律用 were。" },
    { src: "base", type: "fill", difficulty: "easy", knowledge: "词汇", text: "He is good at ______ (swim).", answer: "swimming", explanation: "be good at 后接动名词。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "词汇", text: "The book is ______ the desk.", options: ["A. on","B. at","C. of","D. to"], answer: "A", explanation: "on the desk 表示「在桌上」。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "主谓一致", text: "Neither he nor I ______ right.", options: ["A. is","B. am","C. are","D. be"], answer: "B", explanation: "neither...nor 遵循就近原则，靠近 I，用 am。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "时态", text: "I ______ here since 2010.", options: ["A. live","B. lived","C. have lived","D. am living"], answer: "C", explanation: "since + 时间点，用现在完成时。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "非谓语", text: "The problem ______ at the meeting is very important.", options: ["A. discussing","B. discussed","C. to discuss","D. discuss"], answer: "B", explanation: "problem 与 discuss 是被动关系，用过去分词作定语。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "情态动词", text: "You ______ finish it today; there is no hurry.", options: ["A. must","B. needn't","C. can't","D. should"], answer: "B", explanation: "后半句 no hurry 提示「不必」，用 needn't。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "虚拟语气", text: "I wish I ______ taller.", options: ["A. am","B. was","C. were","D. be"], answer: "C", explanation: "wish 后的宾语从句用虚拟语气，be 动词一律用 were。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "介词", text: "He is interested ______ science.", options: ["A. on","B. in","C. at","D. for"], answer: "B", explanation: "固定搭配 be interested in。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "从句", text: "I don't know ______ he will come.", options: ["A. that","B. if","C. what","D. which"], answer: "B", explanation: "宾语从句表示「是否」，用 if/whether。" },
    { src: "gk", type: "fill", difficulty: "easy", knowledge: "词汇", text: "He ______ (go) to school every day.", answer: "goes", explanation: "主语 he 是第三人称单数，一般现在时加 -es。" },
    { src: "gk", type: "choice", difficulty: "hard", knowledge: "非谓语", text: "______ the work, he went out for a walk.", options: ["A. Finishing","B. Having finished","C. To finish","D. Finished"], answer: "B", explanation: "「完成工作」发生在「出去散步」之前，用 having done 表先完成的动作。" },
    { src: "gk", type: "choice", difficulty: "easy", knowledge: "冠词", text: "I have ______ apple and ______ banana.", options: ["A. a, a","B. an, a","C. an, an","D. a, an"], answer: "B", explanation: "apple 以元音音素开头用 an，banana 以辅音开头用 a。" },
  ],

  // ══════════════════════════════════════════════
  //  政治
  // ══════════════════════════════════════════════
  '政治': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "经济生活", text: "价值规律的表现形式是（  ）", options: ["A. 价格围绕价值上下波动","B. 价格等于价值","C. 供求决定价格","D. 价值决定价格"], answer: "A", explanation: "受供求影响，价格围绕价值上下波动，这是价值规律的表现形式。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "哲学", text: "「量变引起质变」体现的哲理是（  ）", options: ["A. 事物是运动变化的","B. 量变是质变的前提和必要准备","C. 矛盾具有普遍性","D. 实践是认识的基础"], answer: "B", explanation: "量变积累到一定程度引起质变，量变是质变的前提。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "政治生活", text: "我国的国家性质是（  ）", options: ["A. 人民民主专政的社会主义国家","B. 人民代表大会制度","C. 民主集中制","D. 多党合作制"], answer: "A", explanation: "国家性质即国体，我国是人民民主专政的社会主义国家。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "经济生活", text: "商品的价值量由（  ）决定", options: ["A. 个别劳动时间","B. 社会必要劳动时间","C. 供求关系","D. 使用价值"], answer: "B", explanation: "价值量由社会必要劳动时间决定，与个别劳动时间无关。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "政治生活", text: "我国的根本政治制度是（  ）", options: ["A. 人民代表大会制度","B. 民族区域自治制度","C. 基层群众自治制度","D. 多党合作制度"], answer: "A", explanation: "人民代表大会制度是我国的根本政治制度。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "哲学", text: "「实践是检验真理的唯一标准」体现的哲理是（  ）", options: ["A. 实践决定认识","B. 认识决定实践","C. 真理是主观的","D. 意识第一性"], answer: "A", explanation: "实践是认识的来源、动力、检验标准和目的。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "经济生活", text: "通货膨胀时，通常采取的货币政策是（  ）", options: ["A. 提高利率","B. 降低利率","C. 增加货币供应","D. 扩大财政支出"], answer: "A", explanation: "通胀时收紧货币，提高利率抑制需求。" },
  ],

  // ══════════════════════════════════════════════
  //  历史
  // ══════════════════════════════════════════════
  '历史': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "近代史", text: "标志着中国近代史开端的事件是（  ）", options: ["A. 鸦片战争","B. 甲午战争","C. 辛亥革命","D. 五四运动"], answer: "A", explanation: "1840 年鸦片战争后中国开始沦为半殖民地半封建社会，是中国近代史的开端。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "古代史", text: "秦朝确立的中央集权制度的核心是（  ）", options: ["A. 分封制","B. 郡县制","C. 皇帝制度","D. 科举制"], answer: "C", explanation: "皇帝制度是核心，郡县制是其地方行政基础。" },
    { src: "lm", type: "choice", difficulty: "normal", knowledge: "世界史", text: "工业革命首先发生在（  ）", options: ["A. 法国","B. 英国","C. 美国","D. 德国"], answer: "B", explanation: "18 世纪 60 年代英国率先开始工业革命。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "古代史", text: "科举制创立于（  ）", options: ["A. 汉朝","B. 隋朝","C. 唐朝","D. 宋朝"], answer: "B", explanation: "隋炀帝设进士科，标志科举制正式创立。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "近代史", text: "辛亥革命爆发于（  ）", options: ["A. 1898 年","B. 1905 年","C. 1911 年","D. 1919 年"], answer: "C", explanation: "1911 年武昌起义，史称辛亥革命。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "近代史", text: "中国共产党成立的地点是（  ）", options: ["A. 北京","B. 上海","C. 广州","D. 武汉"], answer: "B", explanation: "1921 年中共一大在上海召开（后转嘉兴南湖）。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "世界史", text: "第二次世界大战爆发于（  ）", options: ["A. 1937 年","B. 1939 年","C. 1941 年","D. 1945 年"], answer: "B", explanation: "1939 年 9 月德国闪击波兰，二战全面爆发。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "古代史", text: "都江堰的修建者是（  ）", options: ["A. 李冰","B. 商鞅","C. 郑国","D. 大禹"], answer: "A", explanation: "战国时期秦国蜀郡守李冰主持修建都江堰。" },
  ],

  // ══════════════════════════════════════════════
  //  地理
  // ══════════════════════════════════════════════
  '地理': [
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "地球运动", text: "北半球夏至日，太阳直射点在（  ）", options: ["A. 赤道","B. 北回归线","C. 南回归线","D. 北极圈"], answer: "B", explanation: "北半球夏至（6月22日前后）太阳直射北回归线（23°26′N）。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "大气环流", text: "我国东部季风区夏季盛行（  ）", options: ["A. 西北风","B. 东南风","C. 西南风","D. 东北风"], answer: "B", explanation: "夏季风来自海洋，以东南风为主（部分地区西南风）。" },
    { src: "lm", type: "fill", difficulty: "normal", knowledge: "等高线", text: "等高线密集处，坡度较 ______", answer: "陡", explanation: "等高线越密集，说明单位水平距离内高差越大，坡度越陡。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "地球运动", text: "地球自转一周的时间约为（  ）", options: ["A. 12 小时","B. 24 小时","C. 30 天","D. 365 天"], answer: "B", explanation: "地球自转产生昼夜交替，周期约 24 小时。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "气候", text: "热带雨林气候最典型的分布地区是（  ）", options: ["A. 亚马孙平原","B. 撒哈拉沙漠","C. 西伯利亚","D. 南极洲"], answer: "A", explanation: "亚马孙平原全年高温多雨，是最大热带雨林区。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "人口", text: "我国人口分布的基本格局是（  ）", options: ["A. 东多西少","B. 西多东少","C. 南北均衡","D. 均匀分布"], answer: "A", explanation: "以黑河—腾冲线为界，东南多、西北少。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "地形", text: "世界上最高的高原是（  ）", options: ["A. 青藏高原","B. 巴西高原","C. 黄土高原","D. 蒙古高原"], answer: "A", explanation: "青藏高原平均海拔 4000 m 以上，有「世界屋脊」之称。" },
    { src: "gk", type: "choice", difficulty: "normal", knowledge: "农业", text: "我国南方的典型粮食作物是（  ）", options: ["A. 小麦","B. 水稻","C. 玉米","D. 大豆"], answer: "B", explanation: "南方水热条件好，以水稻为主；北方以小麦为主。" },
  ],
};

if (typeof module !== 'undefined' && module.exports) module.exports = TEACHING_QUESTIONS;
