/**
 * 基础工具层（从 app.js 抽出的第一批）
 *
 * 为什么抽：app.js 原来 5300+ 行，11 个页面的渲染和工具函数全混在一起，
 * 改任何一处都要在 5000 行里翻。这些工具函数**不依赖 App 内部状态**，
 * 是最安全的拆分起点。
 *
 * 拆分原则（很重要）：
 *   · 只搬**纯函数**（输入→输出，不碰 DOM 之外的全局状态）
 *   · 通过 window.U 暴露，app.js 里用 `U.esc(...)`，**不必改 5000 处的调用点**
 *   · 在 app.js 顶部做一次本地别名（const esc = U.esc 之类），
 *     这样原有代码一行都不用动
 */
const U = (() => {

  const round5 = (x) => Math.round((Number(x) || 0) * 100000) / 100000;
  /**
   * ★ 显示格式化（2026-10-31 修，与 js/util-core.js 保持一致）
   *
   * 页面实际引用的是本文件（index.html → ../shared/util-core.js）。
   * 之前只改了 js/ 那份，所以「距目标 100.00000 分」一直没变。
   *
   * 内部计算精度由 round5 保证不变，这里只管显示：
   *   ≥10 → 1 位小数（105.4），<10 → 2 位（3.46）
   */
  const fx5 = (x) => {
    const n = (Type(x) === 'number') ? x : (Number(x) || 0);
    return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
  };
  function Type(v) { return typeof v === 'number' && isFinite(v) ? 'number' : 'other'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  function fmtDate(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    if (isNaN(d)) return '--';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtAgo(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '';
    const m = Math.floor(ms / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    const d = Math.floor(h / 24);
    if (d < 30) return d + ' 天前';
    return fmtDate(iso);
  }

  function srcLabel(s) {
    return {
      school: '学校考试', homework: '日常作业', mock: '模拟考试/联考', quiz: 'AI出卷',
      upload: '上传试卷', photo: '拍照读题', manual: '手动录入',
      real: '高考真题', exam: '学校考试', unknown: '未标注',
    }[s] || s || '--';
  }

  /**
   * 数字滚动：让总览的关键数字动起来（不做纯装饰——它把"变化了多少"表达出来）。
   * 尊重 prefers-reduced-motion：那种情况下直接写结果，不播动画。
   */
  function prefersStill() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function countTo(el, value, opt) {
    if (!el) return;
    opt = opt || {};
    const to = Number(value);
    if (!isFinite(to)) { el.textContent = opt.fallback != null ? opt.fallback : '--'; return; }
    const dec = opt.decimals || 0, dur = opt.duration || 620;
    const txt = (v) => (opt.prefix || '') + v.toFixed(dec) + (opt.suffix || '');
    if (prefersStill()) { el.textContent = txt(to); return; }
    const from = Number(el._countVal);
    const start = isFinite(from) ? from : 0;
    el._countVal = to;
    if (start === to) { el.textContent = txt(to); return; }
    cancelAnimationFrame(el._countRaf);
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = txt(start + (to - start) * eased);
      if (p < 1) el._countRaf = requestAnimationFrame(step);
      else el.textContent = txt(to);
    };
    el._countRaf = requestAnimationFrame(step);
  }

  /** 从模型返回里稳健地抠出 JSON（复用 llm.js 的容错实现，失败时带上原文） */
  function parseJSON(text) {
    try {
      return LLM.parseLooseJSON(text);
    } catch (e) {
      console.warn('[学徒] JSON 解析失败，模型原文如下：\n' + String(text || ''));
      const err = new Error(e.message || 'AI 返回的不是有效 JSON');
      err.raw = String(text || '');
      throw err;
    }
  }

  /**
   * 规范化一个题目框（归一化 [x1,y1,x2,y2]）。
   * 模型给的框经常有问题，宁可不要框（退化成页边标记）也不要画错：
   * · 坐标写反（x1>x2）→ 交换；
   * · 越界 → clamp 到 [0,1]；
   * · 太小（宽<3% 或 高<2%）→ 定位失败，丢弃；
   * · 几乎整页（宽高都>97%）→ 没定位，丢弃。
   */
  function cleanBox(box) {
    if (!Array.isArray(box) || box.length !== 4) return null;
    let n = box.map(Number);
    if (!n.every(v => isFinite(v))) return null;
    let x1 = n[0], y1 = n[1], x2 = n[2], y2 = n[3];
    if (x1 > x2) { const t = x1; x1 = x2; x2 = t; }
    if (y1 > y2) { const t = y1; y1 = y2; y2 = t; }
    x1 = Math.max(0, Math.min(1, x1)); y1 = Math.max(0, Math.min(1, y1));
    x2 = Math.max(0, Math.min(1, x2)); y2 = Math.max(0, Math.min(1, y2));
    const w = x2 - x1, h = y2 - y1;
    if (w < 0.03 || h < 0.02) return null;
    if (w > 0.97 && h > 0.97) return null;
    return [x1, y1, x2, y2];
  }

  /** 两个框的交并比，用于判重复识别 */
  function boxIoU(a, b) {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
    const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const uni = areaA + areaB - inter;
    return uni > 0 ? inter / uni : 0;
  }

  /**
   * 清洗读图返回的题目列表：
   * · 题干为空**且**没有有效框 → 是模型把空白处也列成了题，剔除（用户反馈的"识别出一片空白"）；
   * · box 一律过 cleanBox（治"框时大时小/框错位置"）；
   * · 同一页题干相同且框高度重叠 → 重复识别，合并。
   * 如果全被过滤掉（模型压根没给题干），退回原列表，避免整卷被清空。
   */
  function cleanQuestions(list) {
    const src = (list || []).filter(q => q && typeof q === 'object');
    if (!src.length) return [];
    const out = [], seen = [];
    for (const q of src) {
      const text = String(q.text == null ? '' : q.text).replace(/\s+/g, ' ').trim();
      const page = Math.max(1, parseInt(q.page, 10) || 1);
      const box = cleanBox(q.box);
      if (!text && !box) continue;                     // 空白噪声
      if (text && box) {
        const dup = seen.find(s => s.page === page && s.text === text && boxIoU(s.box, box) > 0.6);
        if (dup) continue;                             // 重复识别
        seen.push({ page, text, box });
      }
      q.text = text; q.page = page; q.box = box;
      out.push(q);
    }
    return out.length ? out : src;
  }

  /**
   * 归一化读图结果。
   * 模型有时会直接把顶层写成数组（而不是我要求的对象），
   * 那样 r.score 全是 undefined，会静默变成 0 分——必须收拢成对象。
   */
  function normalizeVision(r) {
    if (Array.isArray(r)) {
      r = { questions: r, wrongQuestions: r, mistakes: [], summary: '', _wasArray: true };
    }
    if (!r || typeof r !== 'object') return { questions: [], wrongQuestions: [], mistakes: [], summary: '' };
    if (!Array.isArray(r.questions)) r.questions = [];
    if (!Array.isArray(r.mistakes)) r.mistakes = [];
    const before = r.questions.length;
    r.questions = cleanQuestions(r.questions);
    if (before > r.questions.length) r._filtered = (r._filtered || 0) + (before - r.questions.length);
    if (!Array.isArray(r.wrongQuestions)) r.wrongQuestions = r.questions;
    return r;
  }

  /** 解析失败时给用户看的可操作提示（含原文片段） */
  function jsonFailHTML(e, retryLabel) {
    const raw = (e && e.raw) || '';
    return '<div class="empty" style="text-align:left">'
      + '读题失败：' + esc(e.message) + '<br><br>'
      + '<strong>模型实际返回了这些内容</strong>（前面 600 字，完整内容已打印到浏览器控制台 F12）：<br>'
      + '<div class="ai-box" style="margin-top:8px;max-height:260px;overflow:auto;white-space:pre-wrap">'
      + esc(raw.slice(0, 600) || '（空）') + '</div>'
      + (raw.length > 600 ? '<div class="hint">……共 ' + raw.length + ' 字</div>' : '')
      + '<div class="hint" style="margin-top:10px">常见原因：①题目太多，模型输出被字数上限截断；'
      + '②模型没按 JSON 格式回答。' + (retryLabel || '') + '</div>'
      + '</div>';
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('读取图片失败'));
      r.readAsDataURL(file);
    });
  }

  /**
   * 手机照片动辄 5-10MB，直接转 base64 会超接口限制、也白烧 token。
   * 统一压到长边 maxDim、JPEG quality，实测 8MB → 200KB 左右，题目数字仍清晰。
   */
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1600;
    quality = quality === undefined ? 0.86 : quality;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const scale = Math.min(1, maxDim / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext('2d');
          // 白底，避免 PNG 透明区域在 JPEG 里变黑
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = cv.toDataURL('image/jpeg', quality);
          resolve({
            dataUrl: dataUrl,
            b64: dataUrl.split(',')[1] || '',
            mime: 'image/jpeg',
            width: w,
            height: h,
            name: file.name || 'photo.jpg',
            kb: Math.round(dataUrl.length * 0.75 / 1024),
          });
        } catch (e) {
          reject(new Error('图片处理失败：' + e.message));
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法解码图片：' + (file.name || ''))); };
      img.src = url;
    });
  }

  return {
    round5, fx5, Type,
    esc, $, on,
    fmtDate, fmtAgo, srcLabel,
    prefersStill, countTo,
    parseJSON,
    cleanBox, boxIoU, cleanQuestions, normalizeVision, jsonFailHTML,
    fileToDataURL, compressImage,
  };
})();
