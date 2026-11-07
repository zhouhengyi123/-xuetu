/**
 * 考试制度 Region Profile（2026-11-07）
 *
 * ══════════════════════════════════════════════════════════════
 * 为什么需要它
 * ══════════════════════════════════════════════════════════════
 * 用户明确要求「适配日韩的考试制度和他们的教材的知识点」。
 * 审计确认：原来整个产品是中国高考专用 —— 科目名/满分/等级赋分/
 * 教材版本/考试日期/难度折算系数/五阶段进度条全是硬编码。
 *
 * 这里把「一套考试制度」抽象成 region profile：
 *   · 科目列表与满分
 *   · 计分规则（原始分 / 等级赋分 / 9등급 / 各校配点）
 *   · 考试日期（可多个阶段，如日本共通テスト + 二次試験）
 *   · 知识点库（按科目，来自学習指導要領 / 교육과정）
 *   · 教材版本（可编辑起点，不伪装成唯一事实）
 *   · 哪些估分/折算功能可用
 *
 * ══════════════════════════════════════════════════════════════
 * 数据诚实性分级（重要）
 * ══════════════════════════════════════════════════════════════
 * 每个 profile 的字段带 `certainty` 标记：
 *   'official'  制度性事实，已核实（科目名、满分、考试月份、评价方式）
 *   'common'    通行做法（配点比例、教材出版社、常见选科组合）
 *   'editable'  **可编辑起点**：知识点体系与教材版本因学校/出版社/年度而异，
 *               我们给一套合理起点让用户改，不写成「系统知道的事实」
 *
 * 明确不做：
 *   · 不把中国高考的「难度折算系数 / 等级赋分」换算成日韩系数冒充校准
 *     （没有历年数据，那会是伪精确）→ 日韩模式下这些功能直接禁用
 *   · 不把中文科目名翻译成日韩文冒充本地化 → 用本地科目名
 *   · 不宣称「支持共通テスト/수능 官方数据」→ 只说「按公开制度建模」
 *
 * 默认 region = 'cn-gaokao'，行为与原来完全一致（向后兼容）。
 */
const Region = (() => {

  const KEY = 'region_v1';

  // ══════════════════════════════════════════════════════════
  //  中国高考（默认，原样保留，不改动任何既有行为）
  // ══════════════════════════════════════════════════════════
  const CN_GAOKAO = {
    id: 'cn-gaokao',
    label: '中国大陆 · 高考',
    nativeLabel: '普通高等学校招生全国统一考试',
    lang: 'zh-CN',
    certainty: 'official',
    examName: '高考',
    subjects: ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '技术'],
    coreSubjects: ['语文', '数学', '英语'],
    maxScores: {
      '语文': 150, '数学': 150, '英语': 150,
      '物理': 100, '化学': 100, '生物': 100,
      '政治': 100, '历史': 100, '地理': 100, '技术': 100,
    },
    totalMax: 750,
    scoring: {
      type: 'raw+assigned',           // 原始分 + 选考等级赋分
      hasGradeAssigned: true,
      gradeRange: [40, 100],
      // 中国模式沿用既有 progress.js 的 logistic 位次换算
      assignModel: 'zhejiang-logistic',
    },
    examDates: [{ label: '高考', month: 6, day: 7, certainty: 'official' }],
    stages: ['筑基', '提分', '突破', '冲刺', '决战'],
    knowledgeEditable: false,       // 沿用 data.js KNOWLEDGE_BY_GRADE
    difficultyFactorEnabled: true,  // data.js EXAM_DIFFICULTY 可用
    estimateEnabled: true,
    planEnabled: true,
    notes: '科目体系、估分模型、教材库与倒计时仅适用于中国大陆高考。',
  };

  // ══════════════════════════════════════════════════════════
  //  日本 · 大学入学共通テスト + 各大学二次試験
  //
  //  ★ 2026-11-07 核实修正（来源见 docs/真人家教方法论调研.md 与下方 sources）：
  //   · 「6教科8科目」不是共通テスト的科目数，而是国立大学一般選抜
  //     要求报考的科目数原则；共テ本体 2025 年度起为 **7教科21科目**。
  //   · 学習指導要領 = 平成30年(2018)告示、2022 年度递进实施、
  //     2025 年度入試起适用（不是「令和版」）。
  //   · 2026年度(令和8)本試験 = 2026-01-17(土)・18(日)；2027 = 2027-01-16・17。
  //   · 国語 200点 = 近代以降の文章110 + 古文45 + 漢文45；
  //     英語 200点 = リーディング100 + リスニング100。
  //   · 得点調整 / 段階表示(9段階) 都「不是」中国式赋分，且 R7/R8 均不实施得点調整。
  //   · 数学教科书主流 5 社不含三省堂（三省堂是国语/英语侧）。
  // ══════════════════════════════════════════════════════════
  const JP_COMMON_TEST = {
    id: 'jp-common-test',
    label: '日本 · 共通テスト + 二次試験',
    nativeLabel: '大学入学共通テスト / 個別学力検査',
    lang: 'ja-JP',
    certainty: 'official',
    examName: '共通テスト',
    subjects: ['国語', '数学①', '数学②', '外国語', '地理歴史・公民', '理科', '情報'],
    coreSubjects: ['国語', '数学①', '数学②', '外国語'],
    /** 「6教科8科目」是国立大学一般選抜的原则，不是共テ科目数 */
    nationalUnivPrinciple: '6教科8科目（国立大学協会 2022-01-28 基本方針，2025年度入試起）',
    commonTestStructure: '7教科21科目（2025年度起，情報Ⅰ 新设）',
    curriculum: {
      id: 'H30_2018', declared: '2018-03-30', implementedFrom: '2022-04',
      firstApplicableExamYear: 2025, tracks: ['new', 'old_transitional'],
      certainty: 'official',
    },
    /**
     * 共通テスト**没有统一总分** —— 各大学按学部需要选用科目并自行换算配点
     * （傾斜配点：情報100→50、英語200→400 等）。
     * 这里只存各科「素点」，绝不显示为「总分 1100 / 你考了 900」这种伪精确。
     */
    maxScores: {
      '国語': 200, '数学①': 100, '数学②': 100, '外国語': 200,
      '地理歴史・公民': 100, '理科': 100, '情報': 100,
    },
    /** 分野别素点（官方 DNC / 河合塾核实） */
    subRanges: {
      '国語': [
        { name: '近代以降の文章', max: 110 }, { name: '古文', max: 45 }, { name: '漢文', max: 45 },
      ],
      '外国語': [
        { name: 'リーディング', max: 100, minutes: 80 },
        { name: 'リスニング', max: 100, minutes: 60 },
      ],
    },
    totalMax: null,                  // 关键：null = 不存在统一总分
    noUnifiedTotal: true,
    noUnifiedTotalNote: '共通テストに統一された合計点はありません。各大学が科目・配点を独自に指定します（傾斜配点）。',
    scoring: {
      type: 'raw-per-university',    // 各校配点，无赋分
      hasGradeAssigned: false,
      assignModel: null,
      // 三个易混淆机制，明确区分，都不参与估分
      gradeScoringEnabled: false,
      scoreAdjustment: { enabled: false, note: '得点調整は事後・只加不减・DNC判定。令和7/8 とも実施しない。', r7: 'not_implemented', r8: 'not_implemented' },
      stanine: { levels: 9, referenceOnly: true, perYearTable: true, usedBy: 'university_option', note: '段階表示は位置表示であって計点ではない。大学は利用しなくてよい。' },
    },
    examDates: [
      { label: '共通テスト', month: 1, dayNote: '1月中旬の土日2日間', certainty: 'official',
        confirmed: { '2025年度': '2025-01-18,19', '2026年度(令和8)': '2026-01-17,18', '2027年度(令和9)': '2027-01-16,17' } },
      { label: '追・再試験', month: 1, dayNote: '本試験の翌週', certainty: 'official' },
      { label: '二次試験（国公立・前期）', month: 2, dayNote: '2月下旬', certainty: 'official' },
      { label: '私立一般入試', month: 2, dayNote: '2月上旬〜中旬', certainty: 'common' },
    ],
    stages: ['共通テスト', '自己採点', '国公立出願', '二次試験(前期)', '二次試験(後期)', '合格発表'],
    /** 共テ:二次 比例无官方统计 → 故意留 null，禁止写死 */
    commonVsSecondaryRatio: null,
    knowledgeEditable: true,
    /**
     * 数学：学習指導要領（平成30年告示）解説 + 学習指導要領LOD +
     * JASSO 官方 EJU シラバス 四源交叉核实（34 条，按 I/A/II/B/III/C 分组）。
     * 「可编辑起点」：出版社章序不同，但大项目/知识点集合一致（検定準拠要領），
     * 所以只需 1 套库 + textbook_edition 字段，不需要每社一份。
     *
     * ⚠️ 「行列」在现行大纲只在数学C「数学的な表現の工夫」里以
     *   「離散グラフ・行列」轻量出现，不是中国线性代数式独立大单元。
     */
    knowledge: {
      '数学': [
        // 数学Ⅰ
        '数と式 / 数与式', '集合と命題 / 集合与命题', '二次関数 / 二次函数',
        '二次方程式・二次不等式 / 二次方程与不等式', '図形と計量 / 图形与计量',
        '三角比 / 三角比', '正弦定理・余弦定理 / 正弦余弦定理', 'データの分析 / 数据分析',
        // 数学A
        '場合の数 / 计数', '順列・組合せ / 排列组合', '確率 / 概率',
        '図形の性質 / 图形性质', '空間図形 / 空间图形', '整数の性質 / 整数性质',
        // 数学Ⅱ
        'いろいろな式 / 各类式子', '複素数と方程式 / 复数与方程',
        '図形と方程式 / 图形与方程', '指数関数・対数関数 / 指数与对数函数',
        '三角関数 / 三角函数', '微分・積分の考え / 微分积分初步',
        // 数学B
        '数列 / 数列', '統計的な推測 / 统计推断',
        // 数学Ⅲ
        '極限 / 极限', '分数関数・無理関数 / 分式与无理函数',
        '微分法 / 微分法', '積分法 / 积分法',
        // 数学C
        'ベクトル / 向量', '平面上の曲線 / 平面曲线(二次曲线)',
        '複素数平面 / 复平面', '数学的な表現の工夫 / 数学表达(離散グラフ・行列)',
      ],
      '理科（物理）': [
        '運動の表し方 / 运动的表示', '力のつり合い / 力的平衡',
        'ニュートンの運動の3法則 / 牛顿三定律', '仕事と運動エネルギー / 功与动能',
        '力学的エネルギー保存 / 机械能守恒', '運動量と力積 / 动量与冲量',
        '衝突 / 碰撞', '等速円運動・単振動 / 圆周运动与简谐振动',
        '熱と温度・熱力学 / 热与热力学', '気体の状態方程式 / 气体状态方程',
        '波の性質・定在波 / 波与驻波', '光の反射・屈折・干渉 / 光的反射折射干涉',
        '電場・電位・コンデンサー / 电场电位电容', '電流・直流回路 / 电流与电路',
        '磁場・電磁誘導・交流 / 磁场电磁感应交流', '電子・原子核 / 原子与量子',
      ],
      '理科（化学）': [
        '純物質と混合物 / 纯净物与混合物', '原子の構造・周期律 / 原子结构与周期律',
        '化学結合 / 化学键', '物質量(モル) / 物质的量', '化学反応式と量的関係 / 化学计量',
        '酸・塩基・中和滴定 / 酸碱与滴定', '酸化還元 / 氧化还原',
        '状態変化・蒸気圧 / 状态变化与相图', '理想気体・溶解平衡 / 气体与溶解平衡',
        '反応熱・ヘスの法則 / 反应热与盖斯定律', '電池・電気分解 / 电池与电解',
        '反応速度・化学平衡 / 速率与平衡', '電離平衡・緩衝液 / 电离平衡',
        '典型元素・遷移元素 / 无机元素', '官能基・有機化合物 / 有机官能团',
        '単糖類・高分子化合物 / 糖类与高分子',
      ],
      '理科（生物）': [
        '生命の起源と細胞の進化 / 生命起源', '突然変異・遺伝子と染色体 / 突变与遗传',
        '遺伝子頻度・自然選択 / 进化机制', '生物の系統と分類 / 系统分类',
        '生体物質・細胞小器官 / 细胞与分子', 'タンパク質・酵素・膜輸送 / 蛋白质与信号',
        '同化と異化・ATP / 代谢与ATP', '光合成 / 光合作用', '呼吸・発酵 / 呼吸与发酵',
        'DNAの複製・転写・翻訳 / 中心法则', '遺伝子発現調節・発生 / 发育与调控',
        '体液・自律神経・免疫 / 人体内环境', 'ニューロン・筋収縮 / 神经与肌肉',
        '植物ホルモン / 植物激素', '個体群・生態系 / 生态',
      ],
      // 国语/英语不是知识点型学科 → 用 unit × skill_tag（设计建议，非官方清单）
      '国語': ['近代以降の文章(評論・論説)', '実用的文章・資料読解', '古文', '漢文',
        '要旨把握・要約', '論理構造の把握', '古典文法(助動詞・係り結び)', '句法・訓読', '記述・論述'],
      '英語': ['リーディング(読解)', 'リスニング(聴解)', '語彙・語法', '文法(時制・態・関係詞・仮定法)',
        '構文把握・速読', '推論・文脈', '論理・表現(主張・根拠)', '英作文・スピーチ'],
      '地理歴史・公民': ['地理総合', '歴史総合', '日本史探究', '世界史探究', '公共', '倫理', '政治・経済'],
      '情報': ['情報社会の問題解決', 'コミュニケーションと情報技術', 'コンピュータとプログラミング',
        '情報通信ネットワークとデータベース', '情報デザイン・情報モラル・セキュリティ', '統計とデータ活用'],
    },
    /** 数学科主流 5 社（教科書協会核实）；三省堂是国语/英语侧，不是数学主流 */
    textbookPublishers: ['東京書籍', '実教出版', '新興出版社啓林館', '数研出版', '第一学習社'],
    textbookNeedsMultipleTrees: false,   // 只需 1 套库 + edition 字段
    subjectTypes: { 数学: 'knowledge_point', 理科: 'knowledge_point', 情報: 'knowledge_point', 国語: 'unit_x_skill_tag', 英語: 'unit_x_skill_tag' },
    designProposal: true,                // 国语/英语 unit 划分是设计建议，不是官方清单
    textbookCertainty: 'editable',
    sources: [
      'https://www.dnc.ac.jp/kyotsu/kako_shiken_jouhou/r8/',
      'https://www.keinet.ne.jp/exam/basic/structure/center.html',
      'https://www.mext.go.jp/a_menu/shotou/new-cs/1407074.htm',
      'https://www.jasso.go.jp/ryugaku/eju/examinee/syllabus/mathematics.html',
    ],
    difficultyFactorEnabled: false,  // 没有中国式「真题 vs 模拟卷」折算依据 → 禁用
    estimateEnabled: false,          // 无统一总分、无历年配点 → 不做「预测总分」
    planEnabled: true,               // 按科目与考试日期排计划仍可用
    disabledModules: ['总分预估', '等级赋分', '得点調整', '段階表示换分', '难度折算系数', '高考进度条'],
    notes: '日本：共通テスト（7教科21科目，1月中旬土日2天）+ 各大学二次試験（2月下旬）。「6教科8科目」是国立大学一般選抜的原则。各校傾斜配点不同，无统一总分、无中国式赋分；得点調整与段階表示均不参与估分。知识点以学習指導要領(H30)+JASSO EJU シラバス为骨架，出版社章序不同但大项目一致，故只需 1 套库 + textbook_edition。',
  };

  // ══════════════════════════════════════════════════════════
  //  韩国 · 대학수학능력시험（수능 / CSAT）+ 학생부
  //  制度事实：9등급制、绝对/相对评价、11月实施、선택과목、수시/정시
  // ══════════════════════════════════════════════════════════
  const KR_CSAT = {
    id: 'kr-csat',
    label: '한국 · 수능(CSAT) + 학생부',
    nativeLabel: '대학수학능력시험 / 학생부',
    lang: 'ko-KR',
    certainty: 'official',
    examName: '수능',
    subjects: ['국어', '수학', '영어', '한국사', '탐구', '제2외국어·한문'],
    coreSubjects: ['국어', '수학', '영어'],
    /**
     * 수능 各科满分（원점수 기준）：국어/수학 100、영어 100(절대평가)、
     * 한국사 50、탐구 과목당 50(최대 2과목 100)、제2외국어 50。
     * 但 대학이 활용하는 건 표준점수/백분위/등급 —— 원점수 합계는 공식 지표가 아님。
     */
    maxScores: {
      '국어': 100, '수학': 100, '영어': 100,
      '한국사': 50, '탐구': 50, '제2외국어·한문': 50,
    },
    totalMax: null,                  // 원점수 합계는 공식 총점이 아님
    noUnifiedTotal: true,
    noUnifiedTotalNote: '수능은 표준점수·백분위·등급으로 활용되며 원점수 합계가 공식 총점은 아닙니다.',
    scoring: {
      type: '9grade',               // 9등급（상대평가）+ 절대평가
      hasGradeAssigned: false,      // 중국식 赋分과 다름
      has9Grade: true,
      gradeCount: 9,
      /**
       * 상대평가(국어/수학/탐구) 등급 누적비율（표준점수 기준）：
       * 4/11/23/40/60/77/89/96/100%，각 구간 4/7/12/17/20/17/12/7/4%.
       *
       * ⚠️ 절대평가 과목(영어/한국사/제2외국어)은 이 비율을 쓰지 않고
       *    원점수 고정 컷으로 등급을 준다（아래 absoluteCuts）。
       * ⚠️ 등급구분표준점수(등급컷)는 매년·매과목 KICE 가 시험 후 공표하므로
       *    이 누적비율을 **점수 경계로 하드코딩하면 안 된다**.
       *    소프트웨어는 비율만 참고하고, 실제 등급 변환은 하지 않는다.
       */
      gradeCumulative: [4, 11, 23, 40, 60, 77, 89, 96, 100],
      relativeEvalSubjects: ['국어', '수학', '탐구'],
      absoluteEvalSubjects: ['영어', '한국사', '제2외국어·한문'],
      // 절대평가 원점수 고정 컷（만점 / 등급 경계）
      absoluteCuts: {
        '영어': { max: 100, cuts: [90, 80, 70, 60, 50, 40, 30, 20] },
        '한국사': { max: 50, cuts: [40, 35, 30, 25, 20, 15, 10, 5] },
        '제2외국어·한문': { max: 50, cuts: [45, 40, 35, 30, 25, 20, 15, 10] },
      },
      gradeCutNote: '등급컷은 매년 KICE 가 시험 후 공표합니다. 누적비율은 구조 이해용이며 점수 경계로 쓰지 않습니다.',
      assignModel: null,            // 禁用中国 logistic 赋分
    },
    /**
     * ★ 적용 학년도（교육과정）维度 —— 只做一套会错。
     * 2026/2027 학년도: 2015 개정, 공통+선택과목, 내신 9등급
     * 2028 학년도~: 2022 개정 연계 「통합형 수능」，선택과목 폐지,
     *   수학 범위 = 대수·미적분Ⅰ·확률과 통계，탐구 = 통합사회·통합과학 전원 필수，
     *   내신 5등급(A~E) 상대평가。
     * 出处：교육부 2023-12-27 보도자료 / 2025-07-07 시행세부계획 공고
     */
    curriculumVariants: {
      '2026': {
        label: '2026/2027 학년도（2015 개정 · 선택과목）',
        certainty: 'official',
        examDate: '2026학년도: 2025-11-13(목) / 2027학년도: 2026-11-19(목)',
        naesinGrades: 9,
        hasSelectiveSubjects: true,
        knowledgeSet: '2015',
      },
      '2028': {
        label: '2028 학년도~（2022 개정 · 통합형 수능）',
        certainty: 'official',
        examDate: '2027-11 예정（매년 11월 셋째 주 목요일，정확 일자는 미공고）',
        naesinGrades: 5,
        // 내신 5등급 상대평가 누적비율 10/34/66/90/100%，성취도 A~E 병기
        naesinCumulative: [10, 34, 66, 90, 100],
        achievementLevels: ['A', 'B', 'C', 'D', 'E'],
        hasSelectiveSubjects: false,
        knowledgeSet: '2022',
        note: '선택과목 폐지, 수학=대수·미적분Ⅰ·확률과 통계, 탐구=통합사회·통합과학 전원 응시, 심화수학(미적분Ⅱ·기하) 미포함. 내신 5등급+성취도 A~E.',
      },
    },
    defaultCurriculum: '2026',
    /**
     * 수학 선택과목 / 국어 선택과목（2022 개정 교육과정 연계）
     */
    /**
     * 공통 + 선택 구조（2015 개정 / 2026·2027학년도）
     * ★ 「독서와 문법」「문학」是学校课程科目名，不是수능선택과목 —— 不要写进去。
     */
    selectable: {
      '수학': {
        common: ['수학Ⅰ', '수학Ⅱ'],
        electives: ['확률과 통계 / 概率与统计', '미적분 / 微积分', '기하 / 几何'],
        pick: 1,
      },
      '국어': {
        common: ['독서', '문학'],
        electives: ['화법과 작문 / 说话与写作', '언어와 매체 / 语言与媒体'],
        pick: 1,
      },
      '탐구': {
        maxPick: 2,
        '사회탐구': ['생활과 윤리', '윤리와 사상', '한국지리', '세계지리', '동아시아사', '세계사', '경제', '정치와 법', '사회·문화'],
        '과학탐구': ['물리학Ⅰ', '화학Ⅰ', '생명과학Ⅰ', '지구과학Ⅰ', '물리학Ⅱ', '화학Ⅱ', '생명과학Ⅱ', '지구과학Ⅱ'],
      },
      '제2외국어·한문': ['독일어Ⅰ', '프랑스어Ⅰ', '스페인어Ⅰ', '중국어Ⅰ', '일본어Ⅰ', '러시아어Ⅰ', '아랍어Ⅰ', '베트남어Ⅰ', '한문Ⅰ'],
    },
    /** 法定必考：韩国史 미응시 시 수능 자체가 무효 */
    mandatoryNote: '한국사는 법정 필수. 미응시 시 수능 응시 자체가 무효 처리되고 성적 전체가 제공되지 않습니다.',
    /** 한국사 / 사회탐구 只做轻量标签，不建深知识树（2028 통합사회로 대체됨） */
    knowledgeDepth: { '한국사': 'light_tags', '사회탐구': 'unit_skeleton' },
    examDates: [
      { label: '수능', month: 11, dayNote: '11월 셋째 주 목요일', certainty: 'official',
        confirmed: { '2026학년도': '2025-11-13', '2027학년도': '2026-11-19' } },
      { label: '수시 원서접수', month: 9, dayNote: '9월 초', certainty: 'common' },
      { label: '정시 원서접수', month: 12, dayNote: '12월 말~1월 초', certainty: 'common' },
    ],
    stages: ['개념 정리', '기출 분석', '실전 연습', '약점 보완', '수능 직전'],
    knowledgeEditable: true,
    /**
     * 수학：2015 개정 / 2022 개정 교육과정의 주요 단원（可编辑起点）
     */
    /**
     * 수학：2015 개정 교육과정 기준（2026/2027 학년도 수능）。
     * 来源：교육부 고시 제2015-74호 + MATH FACTORY 내용체계 정리 + 위키交叉。
     *
     * ★ 2026-11-07 核实纠正：「행렬 / 矩阵」**不属于 2015 개정 수능
     *   수학 출제범위**（2009 개정「기하와 벡터」에 있었으나 삭제됨）。
     *   2022 개정「대수」에「행렬과 그래프」로 재도입되었다는 자료는 있으나
     *   교육과정 원문 미확인 → 标为 추정，不作为수능 考点写死。
     *   原knowledge 里若含「행렬」应删除或降级为 2022 추정 항목。
     *
     * 知识点库须双版本并存（2015 / 2022），用 curriculumVariants 切换。
     */
    knowledge: {
      '수학': [
        // 공통「수학」(고1)
        '다항식의 연산·인수분해 / 多项式运算与因式分解', '나머지정리·인수정리 / 余数与因式定理',
        '복소수와 이차방정식 판별식 / 复数与二次方程判别式', '이차함수의 그래프·최대최소 / 二次函数图像与最值',
        '이차부등식·연립부등식 / 二次与联立不等式', '평면좌표(거리·내분점) / 平面坐标',
        '직선·원의 방정식 / 直线与圆的方程', '도형의 이동 / 图形变换',
        '집합과 명제 / 集合与命题', '함수·합성함수·역함수 / 函数与复合反函数',
        '유리함수·무리함수 / 有理无理函数', '경우의 수·순열·조합 / 计数排列组合',
        // 수학Ⅰ
        '지수의 확장과 지수법칙 / 指数扩展', '로그의 뜻·상용로그 / 对数与常用对数',
        '지수함수 / 指数函数', '로그함수 / 对数函数', '일반각과 호도법 / 广义角与弧度',
        '삼각함수 / 三角函数', '사인·코사인 법칙 / 正弦余弦定理',
        '등차·등비수열과 합 / 等差等比数列', '합의 기호 ∑ / 求和符号', '수학적 귀납법 / 数学归纳法',
        // 수학Ⅱ
        '함수의 극한과 연속 / 函数极限与连续', '미분계수와 도함수 / 导数与求导',
        '접선의 방정식 / 切线方程', '함수의 증감·극대극소 / 增减性与极值',
        '롤의 정리·평균값 정리 / 罗尔与平均值定理', '부정적분·정적분 / 不定定积分',
        '정적분의 활용 / 定积分应用',
        // 선택「미적분」
        '수열의 극한·급수 / 数列极限与级数', '삼각함수 덧셈정리 / 三角加法定理',
        '합성함수 미분·치환·부분적분 / 链式换元分部积分',
        // 선택「확률과 통계」
        '원순열·중복조합·이항정리 / 圆排列可重组二项式',
        '조건부확률·이항·정규분포 / 条件概率与分布', '모평균 추정 / 总体均值估计',
        // 선택「기하」★ 벡터在这里；행렬不在此
        '이차곡선 / 二次曲线', '평면벡터와 내적 / 平面向量与内积',
        '공간도형·공간좌표 / 空间图形与坐标',
        '극한 / 极限',
        // 2022 개정 추정（미확인，不写死为수능考点）
        '행렬과 그래프(2022 대수, 추정·미확인) / 矩阵与图(2022推测)',
      ],
      '과학탐구（물리학）': ['역학 / 力学', '에너지 / 能量', '파동 / 波动', '전기·자기 / 电磁', '열 / 热', '원자·핵 / 原子核', '운동량 / 动量'],
      '과학탐구（화학）': ['물질의 구조 / 物质结构', '화학 결합 / 化学键', '화학 반응 / 化学反应', '산·염기 / 酸碱', '산화·환원 / 氧化还原', '유기화학 / 有机化学', '화학 평형 / 化学平衡'],
      '과학탐구（생명과학）': ['세포 / 细胞', '물질대사 / 代谢', '유전 / 遗传', '발생 / 发育', '생태 / 生态', '진화 / 进化', '항상성 / 稳态'],
      '과학탐구（지구과학）': ['지구 / 地球', '대기 / 大气', '해양 / 海洋', '지질 / 地质', '천문 / 天文'],
      '국어': ['독서 / 阅读', '문학 / 文学', '화법과 작문 / 说话与写作', '언어와 매체 / 语言与媒体', '문법 / 语法', '고전시가 / 古典诗歌', '현대소설 / 现代小说'],
      '영어': ['독해 / 阅读', '어휘 / 词汇', '문법 / 语法', '듣기 / 听力', '쓰기 / 写作', '구문 / 句法'],
      '한국사': ['선사·고대 / 史前古代', '고려 / 高丽', '조선 / 朝鲜', '근현대 / 近现代', '독립운동 / 独立运动'],
      '사회탐구': ['윤리 / 伦理', '지리 / 地理', '역사 / 历史', '경제 / 经济', '정치와 법 / 政治与法', '사회·문화 / 社会文化'],
    },
    textbookCertainty: 'editable',
    naesin: {
      recordOnly: true,             // 학생부/내신は「記録するだけ、予測しない」
      policy: 'record_only_no_prediction',
      note: '내신(교과 성적/등급)은 학교·학년도·과목유형마다 산식이 달라 예측하지 않고 기록만 합니다. 학교 간 비교도 하지 않습니다.',
      recordFields: ['과목명', '학기', '이수학점', '원점수', '과목평균', '표준편차', '성취도(A~E)', '석차', '수강자수', '석차등급', '등급제버전(9|5)', 'user_entered', 'unverified'],
      noDerived: ['예상 내신 등급', '환산점수', '합격확률'],
    },
    /** 수시 / 정시（수능최저 是大学别·年度别外部数据，不内置） */
    admissions: {
      tracks: ['수시', '정시'],
      susiTypes: ['학생부교과', '학생부종합', '논술', '실기'],
      maxSusiApplications: 6,
      jeongsiGroups: ['가', '나', '다'],
      csatMinimum: 'per_university_per_year',
      note: '수능 등급 하나로 합격을 예측하지 않습니다. 수능최저 충족 여부는 대학×전형×학년도 외부 데이터가 필요합니다.',
    },
    /** 国语/英语非知识点型 → 用题型×文本类型×能力标签，mastery 只统计题型正确率 */
    subjectTypes: {
      '수학': 'knowledge_point', '과학탐구': 'knowledge_point',
      '국어': 'genre_skill_function', '영어': 'genre_skill_function',
      '한국사': 'era_tag', '사회탐구': 'unit_skeleton',
    },
    ebsLinkage: 'indirect',        // EBS 수능특강·수능완성 간접연계
    difficultyFactorEnabled: false,
    estimateEnabled: false,          // 无中国式总分预测（9등급/표준점수 대학별 환산）
    planEnabled: true,
    disabledModules: ['总分预估', '等级赋分', '难度折算系数', '高考进度条', '내신 예측', '합격확률', '등급컷 하드코딩'],
    notes: '한국：수능(11월 셋째 주 목요일, 2027학년도=2026-11-19) + 수시/정시 + 학생부. 9등급제·절대/상대평가·공통+선택과목(2015개정, 2026/2027학년도). 2028학년도부터 통합형 수능(선택과목 폐지·내신 5등급) — curriculumVariants 로 구분합니다. 원점수 합계는 공식 총점이 아니며(성적표는 표준점수/백분위/등급만), 등급컷은 매년 KICE 공표값을 따르므로 점수 경계를 하드코딩하지 않습니다. 내신은 기록만 하고 예측·학교간 비교를 하지 않습니다. 「행렬」은 2015개정 수능 출제범위가 아닙니다.',
  };

  const PROFILES = { 'cn-gaokao': CN_GAOKAO, 'jp-common-test': JP_COMMON_TEST, 'kr-csat': KR_CSAT };
  const CURRICULUM_KEY = 'region_curriculum_v1';

  function current() {
    try {
      const id = Storage.get(KEY, 'cn-gaokao');
      return PROFILES[id] ? id : 'cn-gaokao';
    } catch (e) { return 'cn-gaokao'; }
  }

  /** 当前适用学年度（仅对有 curriculumVariants 的 region 有意义） */
  function curriculum() {
    const p = profile();
    if (!p.curriculumVariants) return null;
    try {
      const v = Storage.get(CURRICULUM_KEY, p.defaultCurriculum);
      return p.curriculumVariants[v] ? v : p.defaultCurriculum;
    } catch (e) { return p.defaultCurriculum; }
  }

  function setCurriculum(v) {
    const p = profile();
    if (!p.curriculumVariants || !p.curriculumVariants[v]) return false;
    try { Storage.set(CURRICULUM_KEY, v); return true; } catch (e) { return false; }
  }

  /** 学年度切换后，知识点集要跟着变（先给可编辑起点，不硬编码两套完整库） */
  function variantMeta() {
    const p = profile();
    const c = curriculum();
    if (!c) return null;
    return Object.assign({ id: c }, p.curriculumVariants[c]);
  }

  function profile(id) { return PROFILES[id || current()] || CN_GAOKAO; }
  function set(id) {
    if (!PROFILES[id]) return false;
    try { Storage.set(KEY, id); return true; } catch (e) { return false; }
  }

  /** 这个 region 是否允许某个中国高考专用模块 */
  function allows(moduleId) {
    const p = profile();
    const d = p.disabledModules || [];
    return d.indexOf(moduleId) < 0;
  }

  /** 知识点列表（日韩走可编辑库，中国沿用 data.js） */
  function knowledge(subject) {
    const p = profile();
    if (p.knowledge && p.knowledge[subject]) return p.knowledge[subject].slice();
    return null;
  }

  /** 给 AI 的一段「制度说明」，避免模型拿中国高考套日韩 */
  function promptBlock() {
    const p = profile();
    if (p.id === 'cn-gaokao') return '';
    const lines = [
      '【考试制度（重要：不要用中国高考的框架回答）】',
      '- 制度：' + p.nativeLabel + '（' + p.label + '）',
      '- 科目：' + p.subjects.join('、'),
      '- 计分：' + p.scoring.type + (p.scoring.has9Grade ? '（9등급制，상대/절대평가混用）' : ''),
      p.noUnifiedTotal ? '- 没有统一总分：' + p.noUnifiedTotalNote : '',
      '- 考试节点：' + p.examDates.map(d => d.label + '（' + d.month + '月' + (d.dayNote || (d.day + '日')) + '）').join('；'),
      variantMeta() ? '- 适用学年度/교육과정：' + variantMeta().label + '（' + (variantMeta().note || '') + '）' : '',
      p.scoring.gradeCutNote ? '- ' + p.scoring.gradeCutNote : '',
      '- 禁用模块：' + (p.disabledModules || []).join('、') || '无',
      '- 教材知识点为可编辑起点，不要断言「官方指定教材」。',
      '- 请全程用' + (p.lang === 'ja-JP' ? '日语' : '韩语') + '回答，不要套用高考/赋分/人教版等中国概念。',
    ].filter(Boolean);
    return lines.join('\n');
  }

  function meta() {
    const p = profile();
    return {
      id: p.id, label: p.label, nativeLabel: p.nativeLabel, lang: p.lang,
      examName: p.examName, subjects: p.subjects.slice(), totalMax: p.totalMax,
      noUnifiedTotal: !!p.noUnifiedTotal,
      disabledModules: (p.disabledModules || []).slice(),
      knowledgeEditable: !!p.knowledgeEditable,
      estimateEnabled: !!p.estimateEnabled,
      all: Object.keys(PROFILES).map(k => ({ id: k, label: PROFILES[k].label })),
    };
  }

  return { PROFILES, current, profile, set, allows, knowledge, promptBlock, meta,
    curriculum, setCurriculum, variantMeta };
})();

if (typeof window !== 'undefined') window.Region = Region;
if (typeof module !== 'undefined' && module.exports) module.exports = Region;
