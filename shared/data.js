/**
 * 基础数据 v0.5 — 3+3选科模式
 * ★ 2026-10-10：适配浙江省（7 选 3，含「技术」）
 */
const DB = (() => {
  // 必考科目
  const CORE_SUBJECTS = ['语文', '数学', '英语'];
  /**
   * 选考科目。
   * ★ 浙江是**7 选 3**（多一门「技术」，含通用技术 + 信息技术），
   *   其余 3+3 省份是 6 选 3。这里统一列 7 门，由省份规则决定可选范围。
   */
  const SELECTABLE_SUBJECTS = ['物理', '化学', '生物', '政治', '历史', '地理', '技术'];
  // 所有科目
  const ALL_SUBJECTS = [...CORE_SUBJECTS, ...SELECTABLE_SUBJECTS];

  /** 各省份允许的选考科目（决定问卷里能勾哪些） */
  const PROVINCE_SELECTABLE = {
    '浙江': ['物理', '化学', '生物', '政治', '历史', '地理', '技术'],
    // 其余 3+3 省份：6 选 3，没有技术
    'default': ['物理', '化学', '生物', '政治', '历史', '地理'],
  };

  // 科目满分
  const MAX_SCORES = {
    '语文': 150, '数学': 150, '英语': 150,
    '物理': 100, '化学': 100, '生物': 100,
    '政治': 100, '历史': 100, '地理': 100, '技术': 100
  };

  // 知识点库（按年级×科目）
  const KNOWLEDGE_BY_GRADE = {
    高一: {
      数学: ['集合与常用逻辑用语','一元二次函数、方程和不等式','函数的概念与性质','指数函数与对数函数','三角函数','函数综合应用','平面向量','复数','立体几何初步','统计','概率'],
      语文: ['现代文阅读(论述类)','现代文阅读(文学类)','文言文阅读','古诗词鉴赏','名篇名句默写','语言文字运用','写作(记叙文)'],
      英语: ['定语从句','名词性从句','状语从句','阅读理解(应用文)','阅读理解(记叙文)','阅读理解(说明文)','完形填空','语法填空','书面表达'],
      物理: ['运动的描述','匀变速直线运动','相互作用','牛顿运动定律','曲线运动','万有引力与航天','机械能守恒定律'],
      化学: ['物质及其变化','物质的量','金属及其化合物','非金属及其化合物','物质结构','化学反应与能量','有机化合物'],
      生物: ['走近细胞','组成细胞的分子','细胞的基本结构','细胞的物质输入和输出','细胞的能量供应和利用','细胞的生命历程'],
      政治: ['经济生活','政治生活','文化生活','生活与哲学'],
      历史: ['中国古代史','中国近代史','世界古代史','世界近代史'],
      地理: ['自然地理','人文地理','区域地理']
    },
    高二: {
      数学: ['空间向量与立体几何','直线和圆的方程','圆锥曲线(椭圆/双曲线/抛物线)','数列(等差/等比)','导数及其应用','计数原理','随机变量及其分布','成对数据的统计分析'],
      语文: ['信息类文本阅读','文学类文本阅读','文言文阅读(史传)','古代诗歌鉴赏','名篇名句默写','语言文字运用','写作(议论文/应用文)','名著阅读(红楼梦/乡土中国)'],
      英语: ['非谓语动词','虚拟语气','倒装省略','阅读理解(议论文)','阅读理解(科普)','七选五','完形填空(夹叙夹议)','读后续写'],
      物理: ['静电场','恒定电流','磁场','电磁感应','交变电流','传感器','机械振动与机械波','光学','电磁波','相对论初步','动量守恒定律','波粒二象性'],
      化学: ['化学反应与能量','化学反应速率与化学平衡','水溶液中的离子反应与平衡','化学反应与电能','化学反应的热效应','有机高分子','物质结构与性质'],
      生物: ['遗传因子的发现','基因和染色体的关系','基因的本质','基因的表达','基因突变及其他变异','生物的进化','人体的内环境与稳态','动物和人体生命活动的调节','植物的激素调节'],
      政治: ['经济生活','政治生活','文化生活','生活与哲学','国家和国际组织常识','经济学常识'],
      历史: ['世界现代史','中国现代史','文化史','经济史','政治史'],
      地理: ['自然地理综合','人文地理综合','区域地理综合','旅游地理','环境保护']
    },
    高三: {
      数学: ['函数与导数综合','三角函数与解三角形','数列综合','立体几何综合','解析几何综合','概率统计综合','坐标系与参数方程','不等式选讲','压轴题(函数与导数)','压轴题(解析几何)','压轴题(创新题)'],
      语文: ['信息类文本阅读','文学类文本阅读','文言文阅读','古代诗歌鉴赏','名篇名句默写','语言文字运用','写作(议论文/应用文/概要写作)','高考真题演练','名著阅读'],
      英语: ['阅读理解(七选五/细节理解/推理判断/主旨大意)','完形填空','语法填空','短文改错','书面表达(应用文/读后续写/概要写作)','高考真题演练','听力训练'],
      物理: ['力与运动综合','电磁学综合','热学光学原子物理','物理实验综合','力学综合','电磁感应综合','高考真题演练','压轴题训练'],
      化学: ['化学实验综合','化工流程综合','反应原理综合','有机综合','结构综合','高考真题演练','压轴题训练'],
      生物: ['细胞代谢综合','遗传综合','调节综合','生态综合','实验探究综合','生物技术实践','高考真题演练','压轴题训练'],
      政治: ['经济生活','政治生活','文化生活','生活与哲学','高考真题演练','时政热点'],
      历史: ['中国古代史','中国近现代史','世界史','文化史','高考真题演练','史料研读'],
      地理: ['自然地理','人文地理','区域地理','高考真题演练','地理实践'],
      技术: ['数据与信息','算法与程序实现','数据处理与应用','信息系统与社会','信息系统集成','数据结构','网络基础','技术及其性质','技术设计原则','发现与明确问题','方案构思与呈现','制作与试验','结构与设计','流程与设计','系统与设计','控制与设计']
    }
  };

  // 内置备用题库
  const FALLBACKS = {
    数学: [
      {type:'choice',difficulty:'easy',knowledge:'函数基础',text:'函数 f(x)=x²-4x+3 的对称轴是（  ）',options:['A. x=1','B. x=2','C. x=3','D. x=4'],answer:'B',explanation:'x=-b/(2a)=4/2=2'},
      {type:'choice',difficulty:'normal',knowledge:'导数',text:'f(x)=eˣsinx 在 x=0 处的导数为（  ）',options:['A. 0','B. 1','C. e','D. 2'],answer:'B',explanation:"f'(x)=eˣsinx+eˣcosx, f'(0)=1"},
      {type:'choice',difficulty:'normal',knowledge:'三角函数',text:'sin240°的值是（  ）',options:['A. 1/2','B. -1/2','C. √3/2','D. -√3/2'],answer:'D',explanation:'sin240°=sin(180°+60°)=-sin60°=-√3/2'},
      {type:'fill',difficulty:'easy',knowledge:'集合',text:'A={1,2,3}, B={2,3,4}, A∩B=______',answer:'{2,3}',explanation:'取公共元素'},
      {type:'choice',difficulty:'hard',knowledge:'解析几何',text:'椭圆 x²/4+y²/3=1 的离心率为（  ）',options:['A. 1/2','B. √3/2','C. √2/2','D. √3/3'],answer:'A',explanation:'c²=a²-b²=1, e=c/a=1/2'},
      {type:'choice',difficulty:'normal',knowledge:'概率',text:'从5男3女中选3人，恰好1名女生的概率为（  ）',options:['A. 15/28','B. 5/14','C. 3/8','D. 1/4'],answer:'A',explanation:'C(5,2)×C(3,1)/C(8,3)=10×3/56=15/28'},
      {type:'fill',difficulty:'easy',knowledge:'复数',text:'(1+i)²=______',answer:'2i',explanation:'(1+i)²=1+2i+i²=2i'},
      {type:'choice',difficulty:'normal',knowledge:'数列',text:'等差数列a₁=2,d=3, a₁₀=（  ）',options:['A. 27','B. 29','C. 31','D. 33'],answer:'B',explanation:'a₁₀=2+9×3=29'},
      {type:'answer',difficulty:'hard',knowledge:'导数应用',text:'求 f(x)=x³-3x 在[-2,2]上的最值。',answer:"f'(x)=3x²-3=0→x=±1。f(-2)=-2,f(-1)=2,f(1)=-2,f(2)=2。最大2，最小-2。",explanation:'求导→临界点→端点比较'},
      {type:'choice',difficulty:'easy',knowledge:'不等式',text:'a>b>0,正确的是（  ）',options:['A. 1/a>1/b','B. a²<b²','C. a²>b²','D. √a<√b'],answer:'C',explanation:'同号时大小关系保持'}
    ],
    语文: [
      {type:'choice',difficulty:'normal',knowledge:'现代文阅读',text:'关于文学常识正确的是（  ）',options:['A. 红楼梦作者罗贯中','B. 狂人日记是第一篇白话小说','C. 唐宋八大家含李白杜甫','D. 水浒传取材于东汉'],answer:'B',explanation:'狂人日记1918年发表'},
      {type:'fill',difficulty:'easy',knowledge:'名篇名句',text:'子在川上曰:"______，不舍昼夜。"',answer:'逝者如斯夫',explanation:'《论语·子罕》'}
    ],
    英语: [
      {type:'choice',difficulty:'normal',knowledge:'语法',text:'The teacher recommended that we ______ English every day.',options:['A. read','B. reading','C. to read','D. reads'],answer:'A',explanation:'recommend 后接虚拟语气'},
      {type:'choice',difficulty:'easy',knowledge:'语法',text:'She has studied here ______ 2020.',options:['A. for','B. since','C. from','D. in'],answer:'B',explanation:'since+时间点'}
    ]
  };

  function getKnowledge(grade, subject) {
    var g = KNOWLEDGE_BY_GRADE[grade];
    return (g && g[subject]) || [];
  }

  function getFallback(subject, n) {
    var qs = FALLBACKS[subject] || [];
    if (!qs.length) {
      return Array.from({length:n}, function(_,i) {
        return {type:'choice',difficulty:'normal',text:subject+'练习题'+(i+1),options:['A.选项A','B.选项B','C.选项C','D.选项D'],answer:'A',knowledge:'综合',explanation:''};
      });
    }
    return qs.slice().sort(function(){return Math.random()-.5}).slice(0, Math.min(n, qs.length));
  }

  // ══ 教材进度提示 ══
  // 只是 datalist 的建议值，用户可以随手改；不同教材版本差异大，
  // 所以不强制从固定列表里选，最终由大模型理解学生填的文字。
  var TEXTBOOK_HINTS = {
    '语文': ['必修上册 第一单元', '必修上册 第三单元', '必修下册 第一单元', '必修下册 第五单元',
             '选择性必修上册 第二单元', '选择性必修中册 第一单元', '选择性必修下册 第一单元'],
    '数学': ['必修第一册 第一章 集合与常用逻辑用语', '必修第一册 第二章 一元二次函数、方程和不等式',
             '必修第一册 第三章 函数的概念与性质', '必修第一册 第四章 指数函数与对数函数',
             '必修第一册 第五章 三角函数', '必修第二册 第六章 平面向量及其应用',
             '必修第二册 第七章 复数', '必修第二册 第八章 立体几何初步',
             '必修第二册 第九章 统计', '必修第二册 第十章 概率',
             '选择性必修第一册 第一章 空间向量与立体几何', '选择性必修第一册 第二章 直线和圆的方程',
             '选择性必修第一册 第三章 圆锥曲线的方程', '选择性必修第二册 第四章 数列',
             '选择性必修第二册 第五章 一元函数的导数及其应用', '选择性必修第三册 第六章 计数原理'],
    '英语': ['必修一 Welcome Unit', '必修一 Unit 3', '必修一 Unit 5', '必修二 Unit 1',
             '必修二 Unit 4', '必修三 Unit 2', '选择性必修一 Unit 1', '选择性必修一 Unit 3',
             '选择性必修二 Unit 1', '选择性必修三 Unit 2'],
    '物理': ['必修第一册 第一章 运动的描述', '必修第一册 第二章 匀变速直线运动的研究',
             '必修第一册 第三章 相互作用——力', '必修第一册 第四章 运动和力的关系',
             '必修第二册 第五章 抛体运动', '必修第二册 第六章 圆周运动',
             '必修第二册 第七章 万有引力与宇宙航行', '必修第二册 第八章 机械能守恒定律',
             '必修第三册 第九章 静电场及其应用', '必修第三册 第十章 静电场中的能量',
             '必修第三册 第十一章 电路及其应用', '必修第三册 第十二章 电能 能量守恒定律',
             '必修第三册 第十三章 电磁感应与电磁波初步',
             '选择性必修第一册 第一章 动量守恒定律', '选择性必修第一册 第二章 机械振动',
             '选择性必修第二册 第一章 安培力与洛伦兹力', '选择性必修第三册 第一章 分子动理论'],
    '化学': ['必修第一册 第一章 物质及其变化', '必修第一册 第二章 海水中的重要元素——钠和氯',
             '必修第一册 第三章 铁 金属材料', '必修第一册 第四章 物质结构 元素周期律',
             '必修第二册 第五章 化工生产中的重要非金属元素', '必修第二册 第六章 化学反应与能量',
             '必修第二册 第七章 有机化合物', '必修第二册 第八章 化学与可持续发展',
             '选择性必修1 第一章 化学反应的热效应', '选择性必修1 第二章 化学反应速率与化学平衡',
             '选择性必修1 第三章 水溶液中的离子反应与平衡',
             '选择性必修2 第一章 原子结构与性质', '选择性必修3 第一章 有机化合物的结构特点与研究方法'],
    '生物': ['必修1 第1章 走近细胞', '必修1 第2章 组成细胞的分子', '必修1 第3章 细胞的基本结构',
             '必修1 第4章 细胞的物质输入和输出', '必修1 第5章 细胞的能量供应和利用',
             '必修1 第6章 细胞的生命历程', '必修2 第1章 遗传因子的发现',
             '必修2 第2章 基因和染色体的关系', '必修2 第3章 基因的本质',
             '必修2 第4章 基因的表达', '必修2 第5章 基因突变及其他变异',
             '选择性必修1 第1章 人体的内环境与稳态', '选择性必修1 第3章 体液调节',
             '选择性必修2 第1章 种群及其动态', '选择性必修3 第1章 发酵工程'],
    '政治': ['必修1 中国特色社会主义', '必修2 经济与社会', '必修3 政治与法治', '必修4 哲学与文化',
             '选择性必修1 当代国际政治与经济', '选择性必修2 法律与生活', '选择性必修3 逻辑与思维'],
    '历史': ['中外历史纲要（上）第一单元', '中外历史纲要（上）第二单元', '中外历史纲要（上）第四单元',
             '中外历史纲要（上）第七单元', '中外历史纲要（下）第一单元', '中外历史纲要（下）第四单元',
             '国家制度与社会治理 第一单元', '经济与社会生活 第一单元',
             '文化交流与传播 第一单元', '史料实证与历史解释'],
    '地理': ['必修第一册 第一章 宇宙中的地球', '必修第一册 第二章 地球上的大气',
             '必修第一册 第三章 地球上的水', '必修第一册 第四章 地貌',
             '必修第一册 第五章 植被与土壤', '必修第一册 第六章 自然灾害',
             '必修第二册 第一章 人口', '必修第二册 第二章 乡村和城镇',
             '必修第二册 第三章 产业区位因素', '必修第二册 第四章 交通运铺布局与区域发展',
             '选择性必修1 第一章 地球的运动', '选择性必修1 第二章 地表形态的塑造',
             '选择性必修2 第一章 区域与区域发展', '选择性必修3 第一章 自然环境与人类社会'],
    // ★ 浙江特有：技术 = 信息技术 + 通用技术（浙教版）
    '技术': ['信息技术 必修1 数据与计算 第一章 数据与信息',
             '信息技术 必修1 数据与计算 第二章 算法与程序实现',
             '信息技术 必修1 数据与计算 第三章 数据处理与应用',
             '信息技术 必修2 信息系统与社会 第一章 信息系统与社会',
             '信息技术 必修2 信息系统与社会 第二章 信息系统的集成',
             '信息技术 选择性必修1 数据与数据结构 第一章 数据与数据结构',
             '信息技术 选择性必修2 网络基础 第一章 网络基础',
             '通用技术 必修1 技术与设计1 第一章 技术及其性质',
             '通用技术 必修1 技术与设计1 第二章 技术设计的原则与评价',
             '通用技术 必修1 技术与设计1 第三章 发现与明确问题',
             '通用技术 必修1 技术与设计1 第四章 方案的构思与呈现',
             '通用技术 必修1 技术与设计1 第五章 制作与试验',
             '通用技术 必修2 技术与设计2 第一章 结构与设计',
             '通用技术 必修2 技术与设计2 第二章 流程与设计',
             '通用技术 必修2 技术与设计2 第三章 系统与设计',
             '通用技术 必修2 技术与设计2 第四章 控制与设计'],
  };

  /** 常见教材版本，用于 datalist 提示 */
  var TEXTBOOK_EDITIONS = [
    '人教版', '人教A版', '人教B版', '苏教版', '北师大版', '外研版', '译林版',
    '沪教版', '湘教版', '鲁教版', '粤教版', '中图版', '岳麓版', '教科版', '其他',
  ];

  // ══ 教材版本按地区自动匹配 ══
  // 已确认：语文、历史、思想政治自 2019 年起用统编（部编）教材，全国统一
  // （教育部 http://www.moe.gov.cn/fbh/live/2019/51084/sfcl/201908/t20190827_395965.html）。
  // 其余科目各省选用不同版本，官方没有全国对照表，下面是按各省常见选用做的推测，
  // 界面上会标明"推测、可修改"，用户可以随手改。
  var EDITION_UNIFIED = ['语文', '历史', '政治'];

  var REGION_EDITIONS = {
    '上海': { '数学': '沪教版', '英语': '沪教牛津版', '物理': '沪科版', '化学': '沪科版', '生物': '沪科版', '地理': '沪教版' },
    '江苏': { '数学': '苏教版', '英语': '译林版', '物理': '人教版', '化学': '苏教版', '生物': '苏教版', '地理': '人教版' },
    '浙江': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '浙科版', '地理': '湘教版' },
    '山东': { '数学': '人教A版', '英语': '外研版', '物理': '鲁科版', '化学': '鲁科版', '生物': '人教版', '地理': '鲁教版' },
    '广东': { '数学': '人教A版', '英语': '人教版', '物理': '粤教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '湖南': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '湘教版' },
    '湖北': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '北京': { '数学': '人教B版', '英语': '北师大版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '中图版' },
    '天津': { '数学': '人教A版', '英语': '外研版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '河北': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '河南': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '四川': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '重庆': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '福建': { '数学': '人教A版', '英语': '人教版', '物理': '鲁科版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '安徽': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '江西': { '数学': '北师大版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '陕西': { '数学': '北师大版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '山西': { '数学': '人教A版', '英语': '外研版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '辽宁': { '数学': '人教B版', '英语': '外研版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '吉林': { '数学': '人教A版', '英语': '外研版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '黑龙江': { '数学': '人教A版', '英语': '外研版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '内蒙古': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '广西': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '云南': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '贵州': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '甘肃': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '新疆': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
    '海南': { '数学': '人教A版', '英语': '人教版', '物理': '人教版', '化学': '人教版', '生物': '人教版', '地理': '人教版' },
  };

  /** 直辖市/省会/常见城市 → 省级归属（用户可能只写城市名） */
  var CITY_TO_REGION = {
    '上海': '上海', '北京': '北京', '天津': '天津', '重庆': '重庆',
    '南京': '江苏', '苏州': '江苏', '无锡': '江苏', '常州': '江苏', '南通': '江苏', '徐州': '江苏', '扬州': '江苏', '盐城': '江苏', '泰州': '江苏', '镇江': '江苏', '淮安': '江苏', '连云港': '江苏', '宿迁': '江苏',
    '杭州': '浙江', '宁波': '浙江', '温州': '浙江', '嘉兴': '浙江', '绍兴': '浙江', '金华': '浙江', '台州': '浙江', '湖州': '浙江', '衢州': '浙江', '丽水': '浙江', '舟山': '浙江',
    '济南': '山东', '青岛': '山东', '烟台': '山东', '潍坊': '山东', '临沂': '山东', '淄博': '山东', '济宁': '山东', '泰安': '山东', '威海': '山东', '日照': '山东', '德州': '山东', '聊城': '山东', '滨州': '山东', '菏泽': '山东', '枣庄': '山东', '东营': '山东',
    '广州': '广东', '深圳': '广东', '珠海': '广东', '佛山': '广东', '东莞': '广东', '中山': '广东', '惠州': '广东', '汕头': '广东', '湛江': '广东', '江门': '广东', '肇庆': '广东', '茂名': '广东', '揭阳': '广东', '梅州': '广东', '清远': '广东', '韶关': '广东',
    '长沙': '湖南', '株洲': '湖南', '湘潭': '湖南', '衡阳': '湖南', '岳阳': '湖南', '常德': '湖南', '郴州': '湖南', '邵阳': '湖南', '益阳': '湖南', '永州': '湖南', '怀化': '湖南', '娄底': '湖南', '张家界': '湖南',
    '武汉': '湖北', '宜昌': '湖北', '襄阳': '湖北', '荆州': '湖北', '黄石': '湖北', '十堰': '湖北', '孝感': '湖北', '荆门': '湖北', '黄冈': '湖北', '咸宁': '湖北', '随州': '湖北',
    '成都': '四川', '绵阳': '四川', '德阳': '四川', '南充': '四川', '宜宾': '四川', '泸州': '四川', '自贡': '四川', '乐山': '四川', '达州': '四川',
    '福州': '福建', '厦门': '福建', '泉州': '福建', '漳州': '福建', '莆田': '福建', '三明': '福建', '南平': '福建', '龙岩': '福建', '宁德': '福建',
    '合肥': '安徽', '芜湖': '安徽', '蚌埠': '安徽', '安庆': '安徽', '马鞍山': '安徽', '淮南': '安徽', '淮北': '安徽', '阜阳': '安徽',
    '郑州': '河南', '洛阳': '河南', '开封': '河南', '新乡': '河南', '安阳': '河南', '南阳': '河南', '许昌': '河南', '平顶山': '河南',
    '石家庄': '河北', '唐山': '河北', '保定': '河北', '邯郸': '河北', '邢台': '河北', '沧州': '河北', '廊坊': '河北', '秦皇岛': '河北', '张家口': '河北', '承德': '河北', '衡水': '河北',
    '太原': '山西', '大同': '山西', '临汾': '山西', '运城': '山西', '长治': '山西',
    '沈阳': '辽宁', '大连': '辽宁', '鞍山': '辽宁', '抚顺': '辽宁', '锦州': '辽宁', '营口': '辽宁', '丹东': '辽宁',
    '长春': '吉林', '吉林': '吉林', '四平': '吉林', '通化': '吉林',
    '哈尔滨': '黑龙江', '齐齐哈尔': '黑龙江', '大庆': '黑龙江', '牡丹江': '黑龙江', '佳木斯': '黑龙江',
    '呼和浩特': '内蒙古', '包头': '内蒙古', '鄂尔多斯': '内蒙古',
    '南宁': '广西', '桂林': '广西', '柳州': '广西', '北海': '广西',
    '昆明': '云南', '大理': '云南', '曲靖': '云南', '玉溪': '云南',
    '贵阳': '贵州', '遵义': '贵州', '六盘水': '贵州',
    '西安': '陕西', '咸阳': '陕西', '宝鸡': '陕西', '渭南': '陕西', '榆林': '陕西',
    '兰州': '甘肃', '天水': '甘肃', '白银': '甘肃',
    '乌鲁木齐': '新疆', '克拉玛依': '新疆',
    '海口': '海南', '三亚': '海南',
    '南昌': '江西', '赣州': '江西', '九江': '江西', '上饶': '江西', '宜春': '江西', '吉安': '江西',
  };

  /** 把用户输入的"省份/城市"归一到一个省 */
  function normalizeRegion(input) {
    if (!input) return '';
    var s = String(input).trim();
    // 去掉"省/市/自治区/壮族/回族/维吾尔"等后缀再比
    var keys = Object.keys(REGION_EDITIONS);
    for (var i = 0; i < keys.length; i++) {
      if (s.indexOf(keys[i]) >= 0) return keys[i];
    }
    var cities = Object.keys(CITY_TO_REGION);
    for (var j = 0; j < cities.length; j++) {
      if (s.indexOf(cities[j]) >= 0) return CITY_TO_REGION[cities[j]];
    }
    return '';
  }

  /**
   * 自动匹配某一科的教材版本。
   * @returns {{edition:string, certain:boolean, region:string}}
   *   certain=true 表示全国统一（语文/历史/政治），false 表示按地区推测
   */
  function detectEdition(city, subject) {
    var region = normalizeRegion(city);
    if (EDITION_UNIFIED.indexOf(subject) >= 0) {
      return { edition: '统编版（部编）', certain: true, region: region };
    }
    var map = region ? REGION_EDITIONS[region] : null;
    var ed = (map && map[subject]) || '人教版';
    return { edition: ed, certain: false, region: region };
  }

  /** 一次性给出六科的匹配结果 */
  function detectEditions(city, subjects) {
    var out = {};
    (subjects || []).forEach(function(s) { out[s] = detectEdition(city, s); });
    return out;
  }

  // ══ 高考难度基准（把"模拟卷/作业得分率"折算成"高考等效得分率"） ══
  // 数据来源：2026-10-02 用 LongCat-2.5-Preview 分析近 10 年（2015—2024）高考真题得出。
  // 折算系数 = 高考等效得分率 ÷ 模拟卷得分率。数学、物理折算最狠（压轴区分度高，
  // 模拟卷还原不出来）；语文、英语温和（基础题占比大、批改标准接近）。
  var EXAM_DIFFICULTY = {
    '语文': { factor: 0.88, level: 0.62, avgRate: [0.68, 0.72], loss: '现代文概括、文言翻译、作文深度' },
    '数学': { factor: 0.72, level: 0.78, avgRate: [0.55, 0.62], loss: '解析几何计算、导数综合、选填压轴' },
    '英语': { factor: 0.90, level: 0.58, avgRate: [0.72, 0.78], loss: '完形逻辑链、阅读推断、续写表达' },
    '物理': { factor: 0.70, level: 0.75, avgRate: [0.52, 0.60], loss: '电磁综合计算、实验设计、多过程分析' },
    '化学': { factor: 0.78, level: 0.70, avgRate: [0.58, 0.65], loss: '原理综合、实验探究、有机推断' },
    '生物': { factor: 0.80, level: 0.68, avgRate: [0.60, 0.66], loss: '遗传计算、实验探究、表述规范' },
    '政治': { factor: 0.86, level: 0.60, avgRate: [0.66, 0.72], loss: '材料分析、术语准确、评分点覆盖' },
    '历史': { factor: 0.84, level: 0.63, avgRate: [0.64, 0.70], loss: '史料解读、小论文论证、时空定位' },
    '地理': { factor: 0.82, level: 0.65, avgRate: [0.62, 0.68], loss: '简答题规范性、区域综合分析、术语准确' },
    // ★ 浙江特有：技术（通用技术 + 信息技术）。难度介于生物与地理之间，
    //   主要失分在算法实现与三视图/结构分析。
    '技术': { factor: 0.84, level: 0.64, avgRate: [0.64, 0.70], loss: '算法实现、三视图、结构分析、信息系统综合' },
  };

  // 来源档：这份卷子离高考有多近。
  // ★ 键必须和应用**真实产生**的来源值一致（app.js srcLabel: school/homework/mock/quiz/upload
  //   + photo/manual/unknown）。旧版写的是 exam/photo/unknown，其中 exam 根本不存在，
  //   school/mock/upload 全落到默认 1 —— 来源修正等于没生效。
  var SOURCE_LEVELS = {
    real:     { mul: 1.00, absolute: true, label: '高考真题' },   // 它就是尺子本身，不做折算
    // ★ 联考/模考：命题贴近高考，不该再乘学科基准（0.72 那类系数是拿校内卷测出来的）
    mock:     { mul: 1.00, noSubjectDiscount: true, label: '模拟考试/联考' },
    school:   { mul: 0.97, label: '学校考试' },
    // 上传的卷子大多是联考/真卷扫描件
    upload:   { mul: 1.00, noSubjectDiscount: true, label: '上传试卷' },
    quiz:     { mul: 1.00, label: 'AI 出卷' },
    photo:    { mul: 0.95, label: '拍照读题（多为作业/练习册）' },
    homework: { mul: 0.90, label: '日常作业' },
    manual:   { mul: 1.00, label: '手动录入' },
    unknown:  { mul: 1.00, label: '未标注' },
    exam:     { mul: 1.00, label: '考试（旧键）' },
  };
  // 兼容旧名：老的调用点还在读这个常量
  var SOURCE_DIFFICULTY_ADJ = {};
  Object.keys(SOURCE_LEVELS).forEach(function(k) { SOURCE_DIFFICULTY_ADJ[k] = SOURCE_LEVELS[k].absolute ? 1 : SOURCE_LEVELS[k].mul; });

  // ══ 逐题难度（相对高考） ══
  // ★ 关键约定：1~5 档的基准是**高考真题**，不是"这所学校平时的难度"。
  //   3 档 = 与高考平均难度相当。模型判档时必须拿高考当尺子，
  //   这样"这份卷子比高考难还是易"才有意义，而不是永远往中间值 3 收缩。
  var DIFF_ANCHORS = [
    { level: 1, label: '送分题', desc: '高考几乎不考，看一眼就会' },
    { level: 2, label: '基础题', desc: '高考里的简单题，套路固定' },
    { level: 3, label: '中档题', desc: '与高考平均难度相当（基准）' },
    { level: 4, label: '难题', desc: '高考里的难题，要两步以上转化' },
    { level: 5, label: '压轴题', desc: '高考压轴/选拔档，多数人做不完' },
  ];

  var DIFF_WORDS = {
    '送分': 1, '送分题': 1, '极易': 1, '很简单': 1,
    '易': 2, '简单': 2, '基础': 2, '基础题': 2, '较易': 2,
    '中': 3, '中等': 3, '中档': 3, '中档题': 3, '一般': 3, '普通': 3, 'medium': 3,
    '较难': 4, '难': 4, '难题': 4, 'hard': 4, '偏难': 4,
    '很难': 5, '困难': 5, '压轴': 5, '压轴题': 5, '极难': 5,
  };

  /** 把模型给的各种写法（3 / "3" / 0.6 / "中等" / "较难"）统一成 1~5 档 */
  function normDifficulty(v) {
    if (v == null) return null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      if (DIFF_WORDS[s] != null) return DIFF_WORDS[s];
      var m = s.match(/-?[0-9]+(\.[0-9]+)?/);
      if (!m) return null;
      v = parseFloat(m[0]);
    }
    v = Number(v);
    if (!isFinite(v) || v <= 0) return null;
    if (v <= 5) return Math.max(1, Math.min(5, v));          // 已经是 1~5 档
    if (v <= 10) return Math.max(1, Math.min(5, v / 2));      // 10 分制
    if (v <= 100) return Math.max(1, Math.min(5, v / 20));    // 百分制难度值
    return null;
  }

  /** 单题难度（1~5 档，3 = 高考平均） */
  function questionDifficulty(q) {
    if (!q) return null;
    return normDifficulty(q.difficulty != null ? q.difficulty
      : q.diff != null ? q.diff : q.difficultyLevel);
  }

  /**
   * 一份卷子的整体难度（1~5 档）：按分值加权，缺分值就按题均。
   * 没有逐题难度时退回卷子自报的 difficulty 字段。
   */
  function paperDifficulty(p) {
    if (!p) return null;
    var qs = Array.isArray(p.questions) ? p.questions : [];
    var sw = 0, sv = 0, n = 0, sn = 0;
    qs.forEach(function(q) {
      var d = questionDifficulty(q);
      if (d == null) return;
      n++; sn += d;
      var w = Number(q.score);
      if (isFinite(w) && w > 0) { sw += w; sv += d * w; }
    });
    if (sw > 0) return Math.round((sv / sw) * 1000) / 1000;
    if (n > 0) return Math.round((sn / n) * 1000) / 1000;
    return normDifficulty(p.difficulty);
  }

  /**
   * 难度修正系数：**这份卷子**比高考难多少 / 易多少。
   * 1~5 档里 3 档 = 高考平均，所以离 3 越远修正越大；每差 1 档 ±5%。
   * 封顶 [0.80, 1.10]：偏难给的加成必须封顶（一次超难题不能把预测吹起来），
   * 偏易给的折扣不需要封那么死（高估比低估危险）。
   */
  function difficultyAdj(level) {
    if (level == null) return 1;
    var gap = Number(level) - 3;
    if (!isFinite(gap)) return 1;
    var adj = 1 + gap * 0.05;
    return Math.round(Math.max(0.80, Math.min(1.10, adj)) * 10000) / 10000;
  }

  /** 把难度档位说成人话："偏易 1.4 档 → 再打 0.93 折" */
  function difficultyNote(level) {
    if (level == null) return '本卷难度未判定（按学科基准折算）';
    var gap = Number(level) - 3;
    var tag = gap <= -1 ? '明显偏易' : gap < -0.3 ? '偏易'
      : gap <= 0.3 ? '与高考相当' : gap < 1 ? '偏难' : '明显偏难';
    var adj = difficultyAdj(level);
    return '本卷难度 ' + (Math.round(level * 100) / 100) + ' 档（高考基准 3 档）→ ' + tag
      + '，难度修正 ×' + adj;
  }

  /**
   * ★ 高分段收敛（2026-10-10，方案 B）
   *
   * 问题：折算原来是**纯线性**的 —— 不管卷面考多少，都乘同一个系数。
   *   数学（基准 0.72）的学生在校内卷考**满分 150**，系统只给 105 分
   *   （150 × 0.6984），等于认定他"高考一定丢 30%"。
   *   这在**高分段**是过度惩罚：能把一套卷子做到满分，说明这套卷覆盖的知识点
   *   他基本都掌握了，再按平均折扣扣掉三成没有依据。
   *
   * 做法：低分段照常打折（校内卷确实比高考容易），**越高越轻**，封顶 maxFactor。
   *   p ≤ start        → 系数不动（保持原折扣）
   *   p >  start        → 线性放开到 maxFactor
   *
   * 注意：
   *   · 只对**打折（factor < 1）**的卷子生效；真题那种 ≥1 的系数不被动（不能往下压）。
   *   · 这是**先验**，不是实测；maxFactor 给的是"上限"而不是"目标"，
   *     宁可保守（高估比低估危险——这条原则在别处也写着）。
   *   · 与"难度档修正"是两件事：难度档是模型对**这份卷子**的直接测量，
   *     本函数只调节"校内卷比高考容易"这笔先验折扣。
   */
  var SCORE_TAPER = {
    /**
     * 收敛起点：**75% 及以下不动**。
     *
     * 为什么不是 60%：收敛的依据是"能把卷子做到很接近满分，说明这套卷覆盖的知识点
     * 基本掌握了，再按平均折扣扣三成没有依据"。70% 只是中档分，在这个分段
     * "校内卷比高考容易"的先验依然成立，不该提前放开 —— 否则会让主流分段整体虚高，
     * 而虚高比低估更危险（这条原则在 difficultyAdj 里也写着）。
     */
    start: 0.75,
    maxFactor: 0.88,    // 满分时的折算上限（仍不等于 1：校内卷确实不是高考）
  };

  /**
   * 按卷面得分率收敛折算系数。
   * @param {number} p      本卷卷面得分率（0~1）
   * @param {number} factor 原本的折算系数
   * @returns {number} 收敛后的系数（≥ factor，≤ maxFactor）
   */
  function scoreTaper(p, factor) {
    var f = Number(factor);
    if (!isFinite(f)) return factor;
    if (!(f < SCORE_TAPER.maxFactor)) return f;          // 已经不打折（真题 1.0 等）→ 不动
    var pr = Number(p);
    if (!isFinite(pr)) return f;
    if (pr <= SCORE_TAPER.start) return f;               // 低分段：保持原折扣
    var t = (pr - SCORE_TAPER.start) / (1 - SCORE_TAPER.start);
    t = Math.max(0, Math.min(1, t));
    return Math.round((f + (SCORE_TAPER.maxFactor - f) * t) * 10000) / 10000;
  }

  /** 把收敛说成人话，给界面/依据列用 */
  function scoreTaperNote(p, factor) {
    var eff = scoreTaper(p, factor);
    if (eff === factor) return '';
    return '高分段收敛 ' + Number(factor).toFixed(4) + ' → ' + eff.toFixed(4) +
      '（卷面 ' + Math.round(Number(p) * 100) + '% 已接近满分，不再按平均折扣扣）';
  }

  /**
   * ══════════════════════════════════════════════════════════
   *  浙江选考「等级赋分」（P3，2026-10-10）
   * ══════════════════════════════════════════════════════════
   *
   * 官方依据：浙江省教育考试院《浙江省2022年高考招生相关政策问答》问答 2 / 6
   *   https://www.zjzs.net/art/2022/6/19/art_159_7037.html
   *
   * 原文要点：
   *   · 必考语数外每门满分 150，**按得分**计入总成绩；选考**按等级赋分**，每门满分 100，
   *     起点赋分 40 分；考生满分 750。
   *   · 以**当次当科考试考生卷面得分为依据**，按最接近的累计比例划定等级并赋分。
   *   · 20 个赋分区间，区间内**按等比例转换**，四舍五入。
   *   · 保障基数 6.5 万人（某科赋分人数不足时按 6.5 万从高到低赋分）。
   *
   * ★ 关键认知：赋分**不是**卷面分的固定函数 —— 它依赖"当次当科全体考生的卷面分布"。
   *   我们只有一名学生，拿不到那个分布，所以**分布必须是显式假设**，
   *   而**区间边界是官方给定的、可审计的**。这两者要在界面上分开说清楚。
   */

  /** 20 个赋分区间的累计人数比例（百分比，与官方表一致） */
  const ZJ_GRADE_BANDS = [
    { t2: 100, t1: 97, cum: 1 },   // 第 1 区间：原等级 1（1%）
    { t2: 97, t1: 94, cum: 3 },    // 原等级 2（+2%）
    { t2: 94, t1: 91, cum: 6 },
    { t2: 91, t1: 88, cum: 10 },
    { t2: 88, t1: 85, cum: 15 },
    { t2: 85, t1: 82, cum: 21 },
    { t2: 82, t1: 79, cum: 28 },
    { t2: 79, t1: 76, cum: 36 },
    { t2: 76, t1: 73, cum: 43 },
    { t2: 73, t1: 70, cum: 50 },
    { t2: 70, t1: 67, cum: 57 },
    { t2: 67, t1: 64, cum: 64 },
    { t2: 64, t1: 61, cum: 71 },
    { t2: 61, t1: 58, cum: 78 },
    { t2: 58, t1: 55, cum: 84 },
    { t2: 55, t1: 52, cum: 89 },
    { t2: 52, t1: 49, cum: 93 },
    { t2: 49, t1: 46, cum: 96 },
    { t2: 46, t1: 43, cum: 98 },
    { t2: 43, t1: 40, cum: 100 },
  ];

  /**
   * 由「全省排名百分位」得到赋分。
   *
   * @param {number} percentileTop 该生的**位次百分位**：0 = 全省第一，1 = 全省最后。
   *        注意不是"超过多少人"，而是"排在多少人之前"（越小越好）。
   * @returns {{score:number, band:object, rank:number}|null}
   *
   * 说明：我们只知道"他在自己水平上的位置估计"，不知道精确位次，
   *      所以调用方应传入**估计位次**，并把结果当作**区间**呈现。
   */
  function zjGradeFromPercentile(percentileTop) {
    var p = Number(percentileTop);
    if (!isFinite(p)) return null;
    p = Math.max(0, Math.min(0.999999, p));
    var cumPct = p * 100;                       // 转成"前 x%"
    // 找落在哪个累计区间（cum 是累计人数比例上界）
    var idx = 0;
    for (var i = 0; i < ZJ_GRADE_BANDS.length; i++) {
      if (cumPct <= ZJ_GRADE_BANDS[i].cum + 1e-9) { idx = i; break; }
      idx = i;
    }
    var band = ZJ_GRADE_BANDS[idx];
    // 该区间内的相对位置（0 → 区间顶端，1 → 区间底端）
    var prevCum = idx === 0 ? 0 : ZJ_GRADE_BANDS[idx - 1].cum;
    var span = band.cum - prevCum;
    var t = span > 0 ? (cumPct - prevCum) / span : 0;
    t = Math.max(0, Math.min(1, t));
    // 等比例：区间内线性插值（官方是卷面分等比例，这里用位次近似，标注为假设）
    var score = band.t2 - (band.t2 - band.t1) * t;
    return {
      score: Math.round(Math.max(40, Math.min(100, score))),
      exact: score,
      band: band,
      bandIndex: idx + 1,
      rank: idx + 1,
    };
  }

  /**
   * 赋分区间：给定"位次估计 ± 不确定度"，给出赋分的下限/上限。
   * 这是 P4「区间输出」在选考上的落地。
   */
  function zjGradeRange(percentileTop, uncertainty) {
    var u = Math.max(0, Number(uncertainty) || 0);
    var lo = Math.max(0, percentileTop - u);
    var hi = Math.min(0.999999, percentileTop + u);
    var a = zjGradeFromPercentile(lo);   // 位次更靠前 → 分更高
    var b = zjGradeFromPercentile(hi);
    if (!a || !b) return null;
    return {
      low: Math.min(a.score, b.score),
      high: Math.max(a.score, b.score),
      mid: Math.round((a.score + b.score) / 2),
      from: a, to: b,
    };
  }

  /** 把成绩说成人话（给界面用） */
  function zjGradeNote(g) {
    if (!g) return '';
    return '等级赋分 ' + g.score + ' 分（第 ' + g.rank + '/20 区间，' +
      g.band.t1 + '~' + g.band.t2 + ' 分档）';
  }

  /**
   * 浙江是不是等级赋分（语数外按原始分，选考按等级分）
   *
   * ★ 注意：省市信息存在 goal.city（如"浙江杭州"），不是 province。
   *   这里两种都认，避免调用方传错字段就静默失效（这类"字段名不对导致
   *   功能静默不生效"的坑本项目踩过多次）。
   */
  function isGradeAssigned(subject, provinceOrCity) {
    var p = String(provinceOrCity || '');
    if (p.indexOf('浙江') < 0) return false;
    return CORE_SUBJECTS.indexOf(subject) < 0;   // 选考才赋分
  }

  /** 从 goal 里解析出"是不是浙江考生" */
  function isZhejiang(goal) {
    if (!goal) return false;
    var s = String(goal.province || '') + ' ' + String(goal.city || '');
    return s.indexOf('浙江') >= 0;
  }

  /** 该省份允许选考哪些科目 */
  function selectableFor(goal) {
    return isZhejiang(goal) ? PROVINCE_SELECTABLE['浙江'] : PROVINCE_SELECTABLE['default'];
  }

  // ══ 教材覆盖率（没学的章节在高考里就是 0 分） ══
  // 问卷里每科填了「教材学到哪」，把它折成"学过的章节占高考全部章节的比例"。
  // 学过的按实际水平算分，没学的章节按 0 分——这是"现在去高考能考多少"的诚实答案。
  function normChapterText(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/\s+/g, '')
      .replace(/选择性必修第?([一二三四五六])册?/g, '选必$1')   // 先归选择性必修，避免被"必修"规则截断
      .replace(/选修第?([一二三四五六])册?/g, '选必$1')
      .replace(/必修第?([一二三四五六])册?/g, '必修$1');
  }

  /**
   * 该科的高考考点覆盖率。
   * 返回 null 表示"教材进度没填/认不出来"，这种情况不扣分（并在界面上说明），
   * 绝不瞎猜一个覆盖率——那等于编造。
   * 返回 { ratio, learned, total, matched, exact }：
   *   ratio   = 已学章节数 / 总章节数
   *   matched = 认成的章节名（给用户看）
   *   exact   = 是否精确匹配到某一章（false = 只认到"某册"，按该册之前算，宁少勿多）
   */
  function coverageOf(subject, unitText) {
    var list = TEXTBOOK_HINTS[subject];
    if (!list || !list.length) return null;
    var u = normChapterText(unitText);
    if (!u) return null;

    // 册名（必修一/选必二…）：只有当填的内容比册名长（真写到了章/单元）才算精确匹配，
    // 否则走册级回退——"必修二"三个字不该被认成"必修二第六章"。
    var bookTok = (u.match(/(选必[一二三四五六]|必修[一二三四五六])/) || [null, null])[1];
    var bookLen = bookTok ? bookTok.length : 0;

    var best = -1, bestLen = 0;
    if (u.length > bookLen) {
      list.forEach(function(h, i) {
        var n = normChapterText(h);
        if ((n.indexOf(u) >= 0 || u.indexOf(n) >= 0) && n.length > bestLen) { best = i; bestLen = n.length; }
      });
    }
    if (best >= 0) {
      return { ratio: (best + 1) / list.length, learned: best + 1, total: list.length,
               matched: list[best], exact: true };
    }
    // 只认得出"学到某册"：按该册第一章之前算（前面几册学完了），宁可低估不高估；
    // 如果那本来就是第一册，按"刚开册"记 1 章，别把整科扣成 0。
    if (bookTok) {
      for (var i = 0; i < list.length; i++) {
        if (normChapterText(list[i]).indexOf(bookTok) >= 0) {
          var learned = (i === 0) ? 1 : i;
          return { ratio: learned / list.length, learned: learned, total: list.length,
                   matched: bookTok + '（按学完前 ' + learned + ' 章估）', exact: false };
        }
      }
    }
    return null;
  }

  /**
   * 取某科的高考折算系数。两个信号：
   *   ① 学科基准 EXAM_DIFFICULTY —— "校内卷比高考容易多少"（10 年真题对比得出）
   *   ② 本卷难度档 level(1~5) —— 模型看过题之后对"这份卷子有多难"的直接测量
   *
   * ★ 关键：难度档是**直接测量**，学科基准只是**先验**。所以当难度判到 3 档
   *   （=与高考平均相当）或更高时，"校内卷打折"这笔就不该再打——否则把高考真题
   *   当成校内卷，白扣 12~28%。
   *   实测（_calib.js）：10 份高考卷、卷面 70%、来源标成"学校考试"、难度判 3 档，
   *   旧逻辑估出总分 427.7（真值 525），低估 97.3 分；现在系数 1.0，估出 530。
   *   level 省略/判不出来时保持旧行为（完全用学科基准 × 来源），绝不凭空乐观。
   */
  function difficultyFactor(subject, source, level, baseOverride) {
    var d = EXAM_DIFFICULTY[subject];
    var base = (baseOverride != null && isFinite(Number(baseOverride)))
      ? Number(baseOverride)
      : (d ? d.factor : 0.85);
    var sl = SOURCE_LEVELS[source] || SOURCE_LEVELS.unknown;
    var da = difficultyAdj(level);
    if (sl.absolute) return Math.round(da * 10000) / 10000;      // 真题：只留难度微调

    /**
     * ★ 联考/模考不打学科折扣（2026-10-17）
     *   学科基准（数学 0.72、物理 0.70）是拿"校内模拟卷"和高考对比得出的。
     *   联考的命题水平本来就贴近高考，再乘这个系数等于重复惩罚 ——
     *   实测会让同一份成绩低 19 分。
     */
    if (sl.noSubjectDiscount) {
      var eff = 1 * sl.mul;                                      // 来源自身的系数（联考=1）
      var lv2 = Number(level);
      var w2 = 1;
      if (level != null && isFinite(lv2)) w2 = Math.max(0, Math.min(1, (3 - lv2) / 1));
      // 难度判到"高考平均"及以上时 → 不再有折扣
      var blended2 = 1 - (1 - eff) * w2;
      return Math.round(blended2 * da * 10000) / 10000;
    }

    var prior = base * sl.mul;                                   // 学科基准 × 来源档
    var lv = Number(level);
    var w = 1;                                                   // 难度未知 → 完全信先验
    if (level != null && isFinite(lv)) w = Math.max(0, Math.min(1, (3 - lv) / 1));
    var blended = 1 - (1 - prior) * w;                           // 判到高考平均及以上 → 不再打折
    return Math.round(blended * da * 10000) / 10000;
  }

  return {
    CORE_SUBJECTS: CORE_SUBJECTS,
    SELECTABLE_SUBJECTS: SELECTABLE_SUBJECTS,
    ALL_SUBJECTS: ALL_SUBJECTS,
    MAX_SCORES: MAX_SCORES,
    KNOWLEDGE_BY_GRADE: KNOWLEDGE_BY_GRADE,
    getKnowledge: getKnowledge,
    getFallback: getFallback,
    TEXTBOOK_HINTS: TEXTBOOK_HINTS,
    TEXTBOOK_EDITIONS: TEXTBOOK_EDITIONS,
    EDITION_UNIFIED: EDITION_UNIFIED,
    REGION_EDITIONS: REGION_EDITIONS,
    EXAM_DIFFICULTY: EXAM_DIFFICULTY,
    SOURCE_DIFFICULTY_ADJ: SOURCE_DIFFICULTY_ADJ,
    SOURCE_LEVELS: SOURCE_LEVELS,
    DIFF_ANCHORS: DIFF_ANCHORS,
    difficultyFactor: difficultyFactor,
    SCORE_TAPER: SCORE_TAPER,
    scoreTaper: scoreTaper,
    scoreTaperNote: scoreTaperNote,
    // ★ P3：浙江等级赋分
    PROVINCE_SELECTABLE: PROVINCE_SELECTABLE,
    ZJ_GRADE_BANDS: ZJ_GRADE_BANDS,
    zjGradeFromPercentile: zjGradeFromPercentile,
    zjGradeRange: zjGradeRange,
    zjGradeNote: zjGradeNote,
    isGradeAssigned: isGradeAssigned,
    isZhejiang: isZhejiang,
    selectableFor: selectableFor,
    normDifficulty: normDifficulty,
    questionDifficulty: questionDifficulty,
    paperDifficulty: paperDifficulty,
    difficultyAdj: difficultyAdj,
    difficultyNote: difficultyNote,
    coverageOf: coverageOf,
    normChapterText: normChapterText,
    normalizeRegion: normalizeRegion,
    detectEdition: detectEdition,
    detectEditions: detectEditions
  };
})();
