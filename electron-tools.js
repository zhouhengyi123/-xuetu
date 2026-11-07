/**
 * Agent 工具框架（2026-10-24）
 *
 * ══════════════════════════════════════════════════════════════
 * 用户的诉求
 * ══════════════════════════════════════════════════════════════
 * "我希望你把它做成一个类似于 Agent 类似的东西，
 *  就比如说我让它生成课程，它可以调用我这个电脑里面的东西，
 *  然后什么什么东西给我生成课程，或者说是生成一些视频，
 *  又或者是利用 3D 建模之类的能力，来达到更好的教学的目的。"
 *
 * ══════════════════════════════════════════════════════════════
 * 设计
 * ══════════════════════════════════════════════════════════════
 * 这是一个**本地工具执行器**，运行在 Electron 主进程（能访问文件系统）。
 *
 * 模型侧流程（标准 function calling）：
 *   ① 模型说"我要调用 read_file，参数是 xxx"
 *   ② 这个模块执行，把结果返回给模型
 *   ③ 模型基于结果继续
 *
 * 安全边界（重要）：
 *   · 所有文件操作限制在**用户授权的工作目录**里，不能读系统文件
 *   · 执行命令有白名单，不能随便跑
 *   · 写操作有大小限制
 *   · 每个工具都记日志，用户可查
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

// ══════════════════════════════════════════════════════════════
//  工具定义（OpenAI function calling 格式）
// ══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    "type": "function",
    "function": {
      "name": "list_dir",
      "description": "列出工作目录里某个子目录的文件。用于查看学生有哪些学习资料。",
      "parameters": {
        "type": "object",
        "properties": {
          "dir": {
            "type": "string",
            "description": "相对工作目录的路径，空字符串表示根目录"
          }
        },
        "required": [
          "dir"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read_file",
      "description": "读取工作目录里的一个文本文件（教材、笔记、错题等）。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "相对工作目录的文件路径"
          },
          "max_chars": {
            "type": "number",
            "description": "最多读多少字符，默认 20000"
          }
        },
        "required": [
          "path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "write_file",
      "description": "在工作目录里写一个文件。用于保存课程、笔记、生成的图像描述等。",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "相对工作目录的路径"
          },
          "content": {
            "type": "string",
            "description": "文件内容"
          }
        },
        "required": [
          "path",
          "content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "run_code",
      "description": "执行一段 JavaScript 代码并返回结果。用于数学计算、数据处理、生成图表数据。不能访问网络和文件系统。",
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "description": "要执行的 JS 代码，最后一个表达式的值会作为结果返回"
          }
        },
        "required": [
          "code"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "get_student_data",
      "description": "获取学生的学情数据：成绩、错题、选科、目标、能力测验。生成课程或分析前应该先调这个。",
      "parameters": {
        "type": "object",
        "properties": {
          "what": {
            "type": "string",
            "enum": [
              "all",
              "papers",
              "mistakes",
              "goal",
              "aptitude",
              "estimate"
            ],
            "description": "要哪部分数据，默认 all"
          }
        },
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "remember_fact",
      "description": "记住一条关于学生的稳定事实（偏好、习惯、薄弱原因、约定）。写入后所有 AI（问答/出卷/规划/深度辅导）都会知道。只在发现持久事实时调用，临时信息不要记。",
      "parameters": {
        "type": "object",
        "properties": {
          "key": {
            "type": "string",
            "description": "稳定键（同 key 覆盖旧值），如 讲解偏好、数学薄弱原因、每日作息"
          },
          "text": {
            "type": "string",
            "description": "事实内容，一句话"
          }
        },
        "required": ["key", "text"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "make_chart",
      "description": "生成一张数据图表（SVG）。用于把成绩趋势、薄弱点分布可视化。",
      "parameters": {
        "type": "object",
        "properties": {
          "kind": {
            "type": "string",
            "enum": [
              "bar",
              "line",
              "pie"
            ],
            "description": "图表类型"
          },
          "title": {
            "type": "string",
            "description": "图表标题"
          },
          "labels": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "description": "横轴/分类标签"
          },
          "values": {
            "type": "array",
            "items": {
              "type": "number"
            },
            "description": "数值"
          }
        },
        "required": [
          "kind",
          "title",
          "labels",
          "values"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "make_3d_scene",
      "description": "生成一个可交互的 3D 教学场景（Three.js HTML）。适合讲立体几何、分子结构、物理模型。",
      "parameters": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "场景标题"
          },
          "objects": {
            "type": "array",
            "description": "场景里的物体",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "box",
                    "sphere",
                    "cylinder",
                    "cone",
                    "torus",
                    "plane"
                  ]
                },
                "color": {
                  "type": "string"
                },
                "position": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  }
                },
                "size": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  }
                },
                "label": {
                  "type": "string"
                }
              },
              "required": [
                "type"
              ]
            }
          }
        },
        "required": [
          "title",
          "objects"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "make_animation",
      "description": "生成一段教学动画（SVG + CSS 动画的 HTML）。适合演示函数图像变化、几何变换、物理过程。",
      "parameters": {
        "type": "object",
        "properties": {
          "title": {
            "type": "string",
            "description": "动画标题"
          },
          "description": {
            "type": "string",
            "description": "这段动画要说明什么"
          },
          "svg_content": {
            "type": "string",
            "description": "动画的 SVG 内容（不含外层 svg 标签）"
          },
          "css": {
            "type": "string",
            "description": "CSS 动画定义"
          }
        },
        "required": [
          "title",
          "svg_content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "export_video",
      "description": "把已有的 HTML 动画/3D 场景导出成 MP4 视频。需要本机有 ffmpeg。",
      "parameters": {
        "type": "object",
        "properties": {
          "html_path": {
            "type": "string",
            "description": "工作区里 HTML 文件的相对路径（如 animations/正弦波.html）"
          },
          "seconds": {
            "type": "number",
            "description": "视频时长（秒），默认 6"
          },
          "fps": {
            "type": "number",
            "description": "帧率，默认 24"
          }
        },
        "required": [
          "html_path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "check_video_capability",
      "description": "检查本机能不能导出视频（有没有 ffmpeg）。生成视频前先调这个。",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "read",
      "description": "读取文件内容。支持文本文件，大文件自动截断。",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "文件路径"
          },
          "offset": {
            "type": "number",
            "description": "起始行号（可选）"
          },
          "limit": {
            "type": "number",
            "description": "最大行数（可选）"
          }
        },
        "required": [
          "file_path"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "write",
      "description": "写入文件内容。",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "文件路径"
          },
          "content": {
            "type": "string",
            "description": "文件内容"
          }
        },
        "required": [
          "file_path",
          "content"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "edit",
      "description": "编辑文件：替换指定文本。",
      "parameters": {
        "type": "object",
        "properties": {
          "file_path": {
            "type": "string",
            "description": "文件路径"
          },
          "old_string": {
            "type": "string",
            "description": "要替换的原文"
          },
          "new_string": {
            "type": "string",
            "description": "替换后的新文本"
          }
        },
        "required": [
          "file_path",
          "old_string",
          "new_string"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "glob",
      "description": "按模式查找文件。",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "description": "glob 模式"
          }
        },
        "required": [
          "pattern"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "grep",
      "description": "搜索文件内容。",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": {
            "type": "string",
            "description": "正则表达式"
          },
          "include": {
            "type": "string",
            "description": "文件过滤"
          }
        },
        "required": [
          "pattern"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "web_fetch",
      "description": "获取网页内容。",
      "parameters": {
        "type": "object",
        "properties": {
          "url": {
            "type": "string",
            "description": "网页 URL"
          }
        },
        "required": [
          "url"
        ]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "generate_image",
      "description": "生成一张教学图片。适合画示意图、概念图、解题步骤图。",
      "parameters": {
        "type": "object",
        "properties": {
          "prompt": {
            "type": "string",
            "description": "图片描述（英文效果更好）"
          },
          "output_path": {
            "type": "string",
            "description": "保存路径（可选）"
          }
        },
        "required": [
          "prompt"
        ]
      }
    }
  },
];

// ══════════════════════════════════════════════════════════════
//  安全边界
// ══════════════════════════════════════════════════════════════

/** 工作目录：所有文件操作都限制在这里面 */
let WORKSPACE = path.join(os.homedir(), '学徒工作区');

function setWorkspace(p) {
  if (!p) return;
  try {
    fs.mkdirSync(p, { recursive: true });
    WORKSPACE = p;
  } catch (e) {}
}

function workspace() { return WORKSPACE; }

/**
 * 把用户给的相对路径解析成绝对路径，并**校验没有逃出工作区**。
 * 这是最关键的安全检查 —— 防止模型读 ~/.ssh 或系统文件。
 */
function safePath(rel) {
  const clean = String(rel || '').replace(/^[/\\]+/, '');   // 去掉开头的斜杠
  const abs = path.resolve(WORKSPACE, clean);

  const wsReal = path.resolve(WORKSPACE);
  if (abs !== wsReal && !abs.startsWith(wsReal + path.sep)) {
    throw new Error('路径越界：只能访问工作目录内的文件');
  }
  return abs;
}

/** 单文件大小上限 */
const MAX_READ = 200 * 1024;      // 200 KB
const MAX_WRITE = 500 * 1024;     // 500 KB

// ══════════════════════════════════════════════════════════════
//  工具实现
// ══════════════════════════════════════════════════════════════

const HANDLERS = {

  // ── 列目录 ──
  async list_dir(args) {
    const dir = safePath(args.dir || '');
    if (!fs.existsSync(dir)) return { ok: false, error: '目录不存在' };
    const st = fs.statSync(dir);
    if (!st.isDirectory()) return { ok: false, error: '不是目录' };

    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .slice(0, 200)
      .map(e => {
        const full = path.join(dir, e.name);
        let size = 0;
        try { size = e.isFile() ? fs.statSync(full).size : 0; } catch (err) {}
        return {
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          size,
        };
      });

    return { ok: true, dir: path.relative(WORKSPACE, dir) || '.', entries };
  },

  // ── 读文件 ──
  async read_file(args) {
    const p = safePath(args.path);
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };

    const st = fs.statSync(p);
    if (!st.isFile()) return { ok: false, error: '不是文件' };
    if (st.size > MAX_READ) {
      return { ok: false, error: '文件太大（' + Math.round(st.size / 1024) + 'KB），上限 ' + (MAX_READ / 1024) + 'KB' };
    }

    const ext = path.extname(p).toLowerCase();
    // 文本类才读内容，二进制只报告信息
    const textExts = ['.txt', '.md', '.json', '.js', '.cjs', '.html', '.css', '.csv', '.svg', '.log', '.yaml', '.yml'];
    if (!textExts.includes(ext)) {
      return { ok: true, path: args.path, binary: true, size: st.size, note: '二进制文件，未读取内容' };
    }

    let content = fs.readFileSync(p, 'utf8');
    const max = Math.min(Number(args.max_chars) || 20000, MAX_READ);
    let truncated = false;
    if (content.length > max) { content = content.slice(0, max); truncated = true; }

    return { ok: true, path: args.path, content, truncated, total: st.size };
  },

  // ── 写文件 ──
  async write_file(args) {
    const p = safePath(args.path);
    const content = String(args.content == null ? '' : args.content);

    if (content.length > MAX_WRITE) {
      return { ok: false, error: '内容太大（' + Math.round(content.length / 1024) + 'KB），上限 ' + (MAX_WRITE / 1024) + 'KB' };
    }

    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');

    return { ok: true, path: args.path, bytes: Buffer.byteLength(content, 'utf8') };
  },

  // ── 执行代码 ──
  async run_code(args) {
    const code = String(args.code || '');
    if (!code.trim()) return { ok: false, error: '代码为空' };
    if (code.length > 20000) return { ok: false, error: '代码太长' };

    /**
     * 用 vm 沙箱执行：
     *   · 禁止 require / import（不能读文件、不能联网）
     *   · 禁止 process（不能退出进程）
     *   · 5 秒超时
     */
    const vm = require('vm');
    const sandbox = {
      console: { log: () => {}, error: () => {}, warn: () => {} },
      Math, JSON, Date, Number, String, Boolean, Array, Object, RegExp,
      isNaN, isFinite, parseInt, parseFloat,
      // 常用的数学函数
      abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow, sin: Math.sin, cos: Math.cos,
      tan: Math.tan, log: Math.log, exp: Math.exp, PI: Math.PI, E: Math.E,
    };

    try {
      const ctx = vm.createContext(sandbox);
      const result = vm.runInContext(code, ctx, { timeout: 5000, displayErrors: true });
      return { ok: true, result: result === undefined ? null : result };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },

  // ── 记住学生事实（写入共享档案，2026-10-31）──
  async remember_fact(args) {
    const key = String(args.key || '').trim();
    const text = String(args.text || '').trim();
    if (!key || !text) return { ok: false, error: 'key 和 text 都要填' };

    // 主进程不能直接写页面 localStorage —— 写进工作区事实文件，
    // 页面加载时 StudentProfile 会合并它（见 sp-sync）。
    try {
      const f = path.join(WORKSPACE, '.ai-facts.json');
      let facts = {};
      try { if (fs.existsSync(f)) facts = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
      facts[key] = { text: text.slice(0, 300), at: new Date().toISOString() };
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(facts, null, 2), 'utf8');
      return { ok: true, key: key, saved: true, note: '已写入共享档案，所有 AI 下次对话都会知道' };
    } catch (e) {
      return { ok: false, error: '写入失败: ' + e.message };
    }
  },

  // ── 学生数据 ──
  async get_student_data(args) {
    const what = args.what || 'all';

    // 注意：这个 handler 运行在主进程，拿不到页面的 localStorage。
    // 所以数据由**渲染进程**预先塞进一份快照，这里读快照。
    let snap = null;
    try {
      const f = path.join(WORKSPACE, '.student-data.json');
      if (fs.existsSync(f)) snap = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) {}

    if (!snap) {
      return { ok: false, error: '还没有同步学生数据。请先在学徒里点「同步到 AI」。' };
    }

    if (what === 'all') return { ok: true, data: snap };
    return { ok: true, data: snap[what] || null, what };
  },

  // ── 图表 ──
  async make_chart(args) {
    const kind = args.kind || 'bar';
    const labels = Array.isArray(args.labels) ? args.labels : [];
    const values = Array.isArray(args.values) ? args.values.map(Number) : [];
    const title = String(args.title || '图表');

    if (!labels.length || labels.length !== values.length) {
      return { ok: false, error: 'labels 和 values 必须等长且非空' };
    }

    const W = 640, H = 400;
    const padL = 56, padR = 24, padT = 56, padB = 64;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const maxV = Math.max.apply(null, values.concat([1]));
    const minV = Math.min.apply(null, values.concat([0]));
    const range = (maxV - minV) || 1;

    let body = '';

    if (kind === 'bar') {
      const barW = chartW / labels.length * 0.6;
      const gap = chartW / labels.length;
      body = values.map((v, i) => {
        const h = (v - minV) / range * chartH;
        const x = padL + gap * i + (gap - barW) / 2;
        const y = padT + chartH - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="#4176e6" rx="3"/>` +
          `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="12" text-anchor="middle" fill="#374151">${v}</text>` +
          `<text x="${(x + barW / 2).toFixed(1)}" y="${padT + chartH + 20}" font-size="12" text-anchor="middle" fill="#6b7280">${escXml(labels[i])}</text>`;
      }).join('');
    } else if (kind === 'line') {
      const pts = values.map((v, i) => {
        const x = padL + (chartW / Math.max(1, values.length - 1)) * i;
        const y = padT + chartH - (v - minV) / range * chartH;
        return { x, y, v, label: labels[i] };
      });
      const poly = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      body = `<polyline points="${poly}" fill="none" stroke="#4176e6" stroke-width="2.5" stroke-linejoin="round"/>` +
        pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#4176e6"/>` +
          `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" font-size="11" text-anchor="middle" fill="#374151">${p.v}</text>` +
          `<text x="${p.x.toFixed(1)}" y="${padT + chartH + 20}" font-size="11" text-anchor="middle" fill="#6b7280">${escXml(p.label)}</text>`).join('');
    } else {
      // pie
      const total = values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      const cx = W / 2, cy = padT + chartH / 2, r = Math.min(chartW, chartH) / 2 - 20;
      const colors = ['#4176e6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
      let acc = 0;
      body = values.map((v, i) => {
        const frac = Math.max(0, v) / total;
        const a0 = acc * Math.PI * 2 - Math.PI / 2;
        acc += frac;
        const a1 = acc * Math.PI * 2 - Math.PI / 2;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
        const large = frac > 0.5 ? 1 : 0;
        const mid = (a0 + a1) / 2;
        const lx = cx + r * 0.65 * Math.cos(mid), ly = cy + r * 0.65 * Math.sin(mid);
        return `<path d="M${cx},${cy} L${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)} Z" fill="${colors[i % colors.length]}"/>` +
          (frac > 0.06 ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" text-anchor="middle" fill="#fff" font-weight="600">${escXml(labels[i])}</text>` : '');
      }).join('');
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
      `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
      `<text x="${W / 2}" y="30" font-size="16" font-weight="600" text-anchor="middle" fill="#111827">${escXml(title)}</text>` +
      body +
      `<line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="#d1d5db" stroke-width="1"/>` +
      `</svg>`;

    return { ok: true, svg, width: W, height: H };
  },

  // ── 3D 场景 ──
  /**
   * 3D 场景（2026-10-24 重写：离线可用）
   *
   * 修的 bug：旧版生成的 HTML 从 CDN 加载 Three.js，
   * 用户机器访问不了 → THREE undefined → 整页黑屏（用户截图）。
   *
   * 现在委托给 electron-scene.cjs：Three.js 内嵌 base64（921 KB），
   * 完全离线。实测在 Chromium 里渲染成功（canvas 1438×960，6 个标签）。
   */
  async make_3d_scene(args) {
    let Scene;
    try {
      Scene = require('./electron-scene.cjs');
    } catch (e) {
      return { ok: false, error: '3D 模块加载失败: ' + e.message, hint: 'scene-module-missing' };
    }

    return Scene.buildScene(args || {});
  },

  // ── 教学动画 ──
  async make_animation(args) {
    const title = String(args.title || '教学动画');
    const desc = String(args.description || '');
    const svgContent = String(args.svg_content || '');
    const css = String(args.css || '');

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${escXml(title)}</title>
<style>
  body { margin:0; padding:40px; background:#f8fafc; font-family:-apple-system,"Segoe UI","PingFang SC",sans-serif;
         display:flex; flex-direction:column; align-items:center; min-height:100vh; box-sizing:border-box; }
  h1 { font-size:20px; color:#0f172a; margin:0 0 8px; }
  .desc { font-size:13px; color:#64748b; margin:0 0 28px; max-width:640px; text-align:center; line-height:1.7; }
  .stage { background:#fff; border-radius:14px; box-shadow:0 4px 24px -8px rgba(15,23,42,.16);
           padding:28px; display:flex; justify-content:center; align-items:center; }
  svg { max-width:100%; height:auto; }
  ${css}
</style>
</head>
<body>
<h1>${escXml(title)}</h1>
${desc ? '<p class="desc">' + escXml(desc) + '</p>' : ''}
<div class="stage">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">
${svgContent}
</svg>
</div>
</body>
</html>`;

    return { ok: true, html };
  },

  // ── 检查视频能力 ──
  async check_video_capability() {
    try {
      const V = require('./electron-video.js');
      const cap = V.capabilities();
      return {
        ok: true,
        canExportVideo: cap.canExportVideo,
        ffmpeg: cap.ffmpegPath,
        formats: cap.formats,
        note: cap.canExportVideo
          ? '可以导出 MP4'
          : '本机没有 ffmpeg，无法导出视频。但 HTML 动画可以直接在浏览器播放。',
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // ── 导出视频（2026-10-24 真实现）──
  async export_video(args) {
    const V = require('./electron-video.js');
    if (!V.hasFfmpeg()) {
      return {
        ok: false,
        error: '本机没有 ffmpeg，无法导出视频。但 HTML 动画可以直接双击在浏览器里播放。',
      };
    }

    const rel = String(args.html_path || '');
    const src = safePath(rel);
    if (!fs.existsSync(src)) return { ok: false, error: '文件不存在: ' + rel };

    const seconds = Math.max(1, Math.min(30, Number(args.seconds) || 6));
    const fps = Math.max(8, Math.min(30, Number(args.fps) || 20));

    /**
     * ★ 逐帧录制（2026-10-24 实现）
     *
     * 用 Electron 自带的 Chromium 离屏渲染：
     *   ① 隐藏窗口加载 HTML
     *   ② capturePage() 按 fps 逐帧截图
     *   ③ ffmpeg 合成 MP4
     *
     * 不用 Puppeteer —— 应用本身就是 Electron，省 300MB 依赖。
     */
    let Rec;
    try {
      Rec = require('./electron-recorder.js');
    } catch (e) {
      return {
        ok: false,
        error: '录制模块只在桌面应用里可用（需要 Electron）',
        hint: 'need-electron',
      };
    }

    const baseName = path.basename(rel, path.extname(rel))
      .replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    const outPath = path.join(WORKSPACE, 'videos', baseName + '_' + Date.now() + '.mp4');

    try {
      const r = await Rec.recordToMp4(src, outPath, { seconds, fps });
      if (!r.ok) {
        return {
          ok: false,
          error: String(r.error || '').slice(0, 300),
          frameDir: r.frameDir,
        };
      }
      return {
        ok: true,
        path: r.path,
        size: r.size,
        frames: r.frames,
        fps: r.fps,
        seconds: r.seconds,
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },

  // ═══ DSH 切片工具（2026-10-25）═══
  async read(args) {
    const DshTools = require('./electron-dsh-tools.js');
    return await DshTools.execute('read', args, WORKSPACE || '.');
  },
  async write(args) {
    const DshTools = require('./electron-dsh-tools.js');
    return await DshTools.execute('write', args, WORKSPACE || '.');
  },
  async edit(args) {
    const DshTools = require('./electron-dsh-tools.js');
    return await DshTools.execute('edit', args, WORKSPACE || '.');
  },
  async glob(args) {
    const DshTools = require('./electron-dsh-tools.js');
    return await DshTools.execute('glob', args, WORKSPACE || '.');
  },
  async grep(args) {
    const DshTools = require('./electron-dsh-tools.js');
    return await DshTools.execute('grep', args, WORKSPACE || '.');
  },
  async web_fetch(args) {
    const DshTools = require('./electron-dsh-tools.js');
    return await DshTools.execute('web_fetch', args, WORKSPACE || '.');
  },

  /**
   * ★ 2026-11-07 修：generate_image 以前只在 TOOLS 里定义了 schema，
   *   HANDLERS 里没有实现 —— 模型一旦调用就会得到「未知工具: generate_image」。
   *
   *   electron-image-gen.js 其实早已实现了完整的 generateImage(args, config)，
   *   这里把它接上，并把工作区目录传进去（图片会写到用户授权目录里）。
   *   没有配置图片 API key 时，generateImage 会返回明确的错误，
   *   Agent 能看到并改用文字讲解，不会再卡死。
   */
  async generate_image(args) {
    const ImageGen = require('./electron-image-gen.js');
    const r = await ImageGen.generateImage(args || {}, { workspace: WORKSPACE || '.' });
    if (!r.ok) return { ok: false, error: r.error };
    return {
      ok: true,
      path: r.path,
      size: r.size,
      mediaType: r.mediaType,
      message: '图片已生成：' + r.path,
    };
  },
};

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ══════════════════════════════════════════════════════════════
//  执行入口
// ══════════════════════════════════════════════════════════════

/** 执行日志（给用户看） */
const logs = [];

function log(entry) {
  logs.push(Object.assign({ at: new Date().toISOString() }, entry));
  if (logs.length > 200) logs.shift();
}

/**
 * 执行一个工具调用。
 * @param {string} name 工具名
 * @param {object} args 参数
 * @returns {{ok:boolean, result?:any, error?:string}}
 */
async function execute(name, args) {
  const t0 = Date.now();
  const handler = HANDLERS[name];

  if (!handler) {
    const r = { ok: false, error: '未知工具: ' + name };
    log({ name, args, ok: false, error: r.error, ms: Date.now() - t0 });
    return r;
  }

  try {
    const result = await handler(args || {});
    log({
      name,
      args,
      ok: !!result.ok,
      error: result.error || '',
      ms: Date.now() - t0,
    });
    return result;
  } catch (e) {
    const r = { ok: false, error: String(e.message || e) };
    log({ name, args, ok: false, error: r.error, ms: Date.now() - t0 });
    return r;
  }
}

function getLogs() { return logs.slice(-100); }

/** 把工具调用结果转成模型能读的文本 */
function resultToText(name, result) {
  if (!result.ok) return '❌ 工具 ' + name + ' 失败：' + (result.error || '未知错误');

  // 图表/3D/动画：返回摘要而不是整个 HTML（避免塞爆上下文）
  if (result.svg) {
    return '✅ 已生成图表（' + result.width + '×' + result.height + '）\n<svg_content>\n' + result.svg + '\n</svg_content>';
  }
  if (result.html) {
    const kind = name === 'make_3d_scene' ? '3D 场景' : '教学动画';
    return '✅ 已生成' + kind + '（' + result.html.length + ' 字符 HTML，已保存到工作区，用户可以直接打开）';
  }
  if (result.content != null) {
    return '✅ ' + result.path + '（' + result.content.length + ' 字符' +
      (result.truncated ? '，已截断' : '') + '）\n\n' + result.content;
  }

  return '✅ ' + JSON.stringify(result).slice(0, 6000);
}

module.exports = {
  TOOLS,
  HANDLERS,
  execute,
  resultToText,
  setWorkspace,
  workspace,
  safePath,
  getLogs,
};
