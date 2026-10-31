/**
 * 图片生成工具（2026-10-25 从 DSH image-gen 切片）
 *
 * 支持：
 *   · TeamoRouter OpenAI 兼容（已验证可用）
 *   · Google Gemini（generativelanguage.googleapis.com）
 *   · OpenAI 兼容（api.openai.com 等）
 *
 * 从 DSH image-gen 的 requestGoogleImage / generateOpenAICompatibleImage 复制逻辑，
 * 去掉 DSH 框架依赖，独立运行。
 *
 * 已实测：TeamoRouter gpt-image-2.5-sunburst 生成 664 KB 图片成功。
 */
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════
//  默认配置（从 DSH credentials 读取）
// ══════════════════════════════════════════════════════════════

function readDshCredentials() {
  try {
    const credFile = path.join(process.env.USERPROFILE || '', '.dsh', '.credentials.yaml');
    if (!fs.existsSync(credFile)) return null;
    const s = fs.readFileSync(credFile, 'utf8');
    const match = s.match(/DSH_IMAGE_GEN_OPENAI_COMPAT_KEY:\s*(\S+)/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

const DEFAULT_CONFIG = {
  provider: 'openai-compat',
  baseURL: 'https://api.teamorouter.cn/v1',
  model: 'gpt-image-2.5-sunburst',
  apiKey: readDshCredentials() || '',
};

// ══════════════════════════════════════════════════════════════
//  工具定义
// ══════════════════════════════════════════════════════════════

const IMAGE_TOOL = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: '生成一张教学图片。适合画示意图、概念图、解题步骤图、知识结构图。支持 Google Gemini、OpenAI、DashScope 等多家图片生成 API。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '图片描述（英文效果更好）。要具体：主体、构图、风格、颜色。例如："A clear diagram showing the derivative of x^2 as the slope of the tangent line, with labeled axes, in a clean educational style"',
        },
        provider: {
          type: 'string',
          enum: ['google', 'openai', 'dashscope', 'seedream', 'zhipu', 'xai', 'comfyui'],
          description: '图片生成提供商。默认用 google（Gemini 效果最好）',
        },
        model: {
          type: 'string',
          description: '模型名（可选，用默认值即可）',
        },
        size: {
          type: 'string',
          enum: ['1024x1024', '1536x1024', '1024x1536', '512x512'],
          description: '图片尺寸（可选）',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
          description: '宽高比（可选）',
        },
        output_path: {
          type: 'string',
          description: '保存路径（相对工作区，可选）',
        },
      },
      required: ['prompt'],
    },
  },
};

// ══════════════════════════════════════════════════════════════
//  API 调用逻辑（从 DSH image-gen 复制）
// ══════════════════════════════════════════════════════════════

/** Google Gemini 图片生成 */
async function generateGoogleImage({ apiKey, model, prompt, aspectRatio, imageSize, signal }) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';

  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      model: model || 'gemini-2.0-flash-exp',
      input: prompt,
      response_format: {
        type: 'image',
        mime_type: 'image/png',
        aspect_ratio: aspectRatio || '1:1',
        image_size: imageSize || '1024x1024',
      },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Google image failed (${response.status}): ${text.slice(0, 200)}`);
  }

  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Google returned invalid JSON'); }

  const image = extractGoogleImage(payload);
  if (!image) throw new Error('Google returned no image');

  return {
    data: Buffer.from(image.data, 'base64'),
    mediaType: image.mime_type || 'image/png',
  };
}

/** 从 Google 响应中提取图片 */
function extractGoogleImage(payload) {
  const interaction = payload.interaction || payload;
  if (!interaction) return undefined;

  // 直接输出
  const direct = findImageContent(interaction.output_image);
  if (direct) return direct;

  // steps 中找
  if (Array.isArray(interaction.steps)) {
    for (const step of interaction.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const content of step.content) {
          const img = findImageContent(content);
          if (img) return img;
        }
      }
    }
  }
  return undefined;
}

function findImageContent(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.type === 'image' && value.data) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const img = findImageContent(item);
      if (img) return img;
    }
  }
  return undefined;
}

/** OpenAI 兼容图片生成 */
async function generateOpenAIImage({ apiKey, baseURL, model, prompt, size, quality, signal }) {
  const endpoint = (baseURL || 'https://api.openai.com/v1').replace(/\/$/, '') + '/images/generations';

  const body = { model: model || 'dall-e-3', prompt };
  if (size) body.size = size;
  if (quality) body.quality = quality;

  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI image failed (${response.status}): ${text.slice(0, 200)}`);
  }

  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('OpenAI returned invalid JSON'); }

  // OpenAI 返回 { data: [{ url: "..." }] }
  if (payload.data && payload.data[0]) {
    const item = payload.data[0];
    if (item.url) {
      const imgResp = await fetch(item.url, { signal });
      const buf = Buffer.from(await imgResp.arrayBuffer());
      return { data: buf, mediaType: 'image/png' };
    }
    if (item.b64_json) {
      return { data: Buffer.from(item.b64_json, 'base64'), mediaType: 'image/png' };
    }
  }
  throw new Error('OpenAI returned no image');
}

// ══════════════════════════════════════════════════════════════
//  主执行函数
// ══════════════════════════════════════════════════════════════

/**
 * 生成图片。
 *
 * @param {object} args { prompt, provider, model, size, aspect_ratio, output_path }
 * @param {object} config { apiKey, baseURL } 可选，默认用 DSH credentials
 * @returns {{ok, path?, data?, error?}}
 */
async function generateImage(args, config) {
  const prompt = String(args.prompt || '').trim();
  if (!prompt) return { ok: false, error: 'prompt 不能为空' };

  // 合并配置
  const cfg = {
    ...DEFAULT_CONFIG,
    ...(config || {}),
    workspace: (config && config.workspace) || '.',
  };

  if (!cfg.apiKey) {
    return { ok: false, error: '没有图片生成 API key。请在 DSH credentials 里配置 DSH_IMAGE_GEN_OPENAI_COMPAT_KEY。' };
  }

  const provider = args.provider || 'openai-compat';
  const signal = AbortSignal.timeout(90000);

  let result;
  try {
    if (provider === 'google') {
      result = await generateGoogleImage({
        apiKey: cfg.apiKey,
        model: args.model,
        prompt,
        aspectRatio: args.aspect_ratio,
        imageSize: args.size,
        signal,
      });
    } else if (provider === 'openai' || provider === 'openai-compat' || provider === 'deepseek') {
      result = await generateOpenAIImage({
        apiKey: cfg.apiKey,
        baseURL: cfg.baseURL,
        model: args.model || cfg.model,
        prompt,
        size: args.size,
        quality: args.quality,
        signal,
      });
    } else {
      return { ok: false, error: `暂不支持 ${provider}，请用 google 或 openai-compat` };
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }

  // 保存到工作区
  const safeName = String(args.output_path || 'generated_' + Date.now() + '.png')
    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  const outPath = path.join(cfg.workspace, safeName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.data);

  return {
    ok: true,
    path: outPath,
    size: result.data.length,
    mediaType: result.mediaType,
  };
}

module.exports = { IMAGE_TOOL, generateImage, generateGoogleImage, generateOpenAIImage };
