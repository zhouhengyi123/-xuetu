/**
 * DSH 工具切片（2026-10-25）
 *
 * 从 DeepSeek Harness 的 dsh-tool-fs / dsh-tool-web / dsh-tool-skill 复制核心工具，
 * 去掉 DSH 框架依赖，独立运行在学徒的 Agent 里。
 *
 * 来源：@deepseek-ai/dsh-tool-fs、@deepseek-ai/dsh-tool-web、@deepseek-ai/dsh-tool-skill
 */

// ══════════════════════════════════════════════════════════════
//  文件系统工具（从 dsh-tool-fs 切片）
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

/**
 * read 工具：读取文件内容
 */
const READ_TOOL = {
  type: 'function',
  function: {
    name: 'read',
    description: '读取文件内容。支持文本文件，大文件自动截断。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径（绝对或相对工作区）' },
        offset: { type: 'number', description: '起始行号（可选，默认 1）' },
        limit: { type: 'number', description: '最大行数（可选，默认 2000）' },
      },
      required: ['file_path'],
    },
  },
};

/**
 * write 工具：写入文件
 */
const WRITE_TOOL = {
  type: 'function',
  function: {
    name: 'write',
    description: '写入文件内容。会自动创建父目录。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        content: { type: 'string', description: '文件内容（UTF-8）' },
      },
      required: ['file_path', 'content'],
    },
  },
};

/**
 * edit 工具：编辑文件（替换文本）
 */
const EDIT_TOOL = {
  type: 'function',
  function: {
    name: 'edit',
    description: '编辑文件：替换指定文本。适合修改代码、配置文件。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径' },
        old_string: { type: 'string', description: '要替换的原文（必须精确匹配）' },
        new_string: { type: 'string', description: '替换后的新文本' },
        replace_all: { type: 'boolean', description: '是否替换所有匹配（默认 false）' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

/**
 * glob 工具：查找文件
 */
const GLOB_TOOL = {
  type: 'function',
  function: {
    name: 'glob',
    description: '按模式查找文件。支持 ** 通配符。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'glob 模式，如 **/*.js、src/**/*.ts' },
        path: { type: 'string', description: '搜索根目录（可选，默认工作区）' },
      },
      required: ['pattern'],
    },
  },
};

/**
 * grep 工具：搜索文件内容
 */
const GREP_TOOL = {
  type: 'function',
  function: {
    name: 'grep',
    description: '在文件内容中搜索正则表达式。返回匹配的文件和行。',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式' },
        path: { type: 'string', description: '搜索目录（可选）' },
        include: { type: 'string', description: '文件过滤，如 *.js' },
      },
      required: ['pattern'],
    },
  },
};

// ══════════════════════════════════════════════════════════════
//  Web 工具（从 dsh-tool-web 切片）
// ══════════════════════════════════════════════════════════════

/**
 * web_search 工具：搜索网页
 */
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索网页。返回搜索结果标题、URL、摘要。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        max_results: { type: 'number', description: '最大结果数（默认 5）' },
      },
      required: ['query'],
    },
  },
};

/**
 * web_fetch 工具：获取网页内容
 */
const WEB_FETCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_fetch',
    description: '获取网页内容。返回 HTML 或文本。',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '网页 URL' },
        format: { type: 'string', enum: ['text', 'html'], description: '返回格式（默认 text）' },
      },
      required: ['url'],
    },
  },
};

// ══════════════════════════════════════════════════════════════
//  技能工具（从 dsh-tool-skill 切片）
// ══════════════════════════════════════════════════════════════

/**
 * skill 工具：加载技能
 */
const SKILL_TOOL = {
  type: 'function',
  function: {
    name: 'skill',
    description: '加载技能定义。技能是预定义的工作流程，如"生成视频"、"制作图表"。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '技能名' },
      },
      required: ['name'],
    },
  },
};

// ══════════════════════════════════════════════════════════════
//  执行逻辑
// ══════════════════════════════════════════════════════════════

const HANDLERS = {
  async read(args, workspace) {
    const filePath = path.resolve(workspace || '.', args.file_path);
    if (!fs.existsSync(filePath)) return { ok: false, error: '文件不存在: ' + args.file_path };

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const offset = Math.max(0, (args.offset || 1) - 1);
    const limit = Math.min(args.limit || 2000, 10000);
    const slice = lines.slice(offset, offset + limit);

    return {
      ok: true,
      content: slice.join('\n'),
      total_lines: lines.length,
      showing: slice.length,
      truncated: lines.length > offset + limit,
    };
  },

  async write(args, workspace) {
    const filePath = path.resolve(workspace || '.', args.file_path);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, args.content, 'utf8');
    return { ok: true, path: filePath, bytes: Buffer.byteLength(args.content, 'utf8') };
  },

  async edit(args, workspace) {
    const filePath = path.resolve(workspace || '.', args.file_path);
    if (!fs.existsSync(filePath)) return { ok: false, error: '文件不存在' };

    let content = fs.readFileSync(filePath, 'utf8');
    const occurrences = content.split(args.old_string).length - 1;

    if (occurrences === 0) return { ok: false, error: '未找到匹配文本' };
    if (occurrences > 1 && !args.replace_all) {
      return { ok: false, error: `找到 ${occurrences} 处匹配，请用 replace_all 或提供更精确的 old_string` };
    }

    if (args.replace_all) {
      content = content.split(args.old_string).join(args.new_string);
    } else {
      content = content.replace(args.old_string, args.new_string);
    }

    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true, path: filePath, replaced: occurrences };
  },

  async glob(args, workspace) {
    const root = path.resolve(workspace || '.', args.path || '.');
    const results = [];
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else if (e.name.includes(args.pattern.replace(/\*\*/g, '').replace(/\*/g, ''))) {
          results.push(path.relative(root, full));
        }
      });
    };
    walk(root);
    return { ok: true, files: results.slice(0, 100), total: results.length };
  },

  async grep(args, workspace) {
    const root = path.resolve(workspace || '.', args.path || '.');
    const results = [];
    const re = new RegExp(args.pattern, 'gi');

    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      entries.forEach(e => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else if (!args.include || e.name.includes(args.include.replace(/\*/g, ''))) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, i) => {
              if (re.test(line)) {
                results.push({ file: path.relative(root, full), line: i + 1, text: line.trim().slice(0, 120) });
              }
            });
          } catch (e) {}
        }
      });
    };
    walk(root);
    return { ok: true, matches: results.slice(0, 50), total: results.length };
  },

  async web_search(args, workspace) {
    // 用 DuckDuckGo API（免费）
    try {
      const resp = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(args.query)}&format=json&no_html=1&skip_disambig=1`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json();
      const results = (data.RelatedTopics || []).slice(0, args.max_results || 5).map(t => ({
        title: t.Text?.split(' - ')[0] || t.Text,
        url: t.FirstURL,
        snippet: t.Text,
      }));
      return { ok: true, results, query: args.query };
    } catch (e) {
      return { ok: false, error: '搜索失败: ' + e.message };
    }
  },

  async web_fetch(args, workspace) {
    try {
      const resp = await fetch(args.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      const text = await resp.text();

      if (args.format === 'html') return { ok: true, content: text.slice(0, 50000) };

      // 简单提取文本
      const clean = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { ok: true, content: clean.slice(0, 20000) };
    } catch (e) {
      return { ok: false, error: '获取失败: ' + e.message };
    }
  },

  async skill(args, workspace) {
    return { ok: false, error: '技能系统暂未接入，请直接用其他工具' };
  },
};

// ══════════════════════════════════════════════════════════════
//  导出
// ══════════════════════════════════════════════════════════════

module.exports = {
  // 工具定义
  TOOLS: [READ_TOOL, WRITE_TOOL, EDIT_TOOL, GLOB_TOOL, GREP_TOOL, WEB_SEARCH_TOOL, WEB_FETCH_TOOL, SKILL_TOOL],
  // 执行函数
  execute: async (name, args, workspace) => {
    const handler = HANDLERS[name];
    if (!handler) return { ok: false, error: '未知工具: ' + name };
    try {
      return await handler(args, workspace);
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },
};
