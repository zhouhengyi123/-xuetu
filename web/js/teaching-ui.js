/**
 * 教学资料 UI（2026-11-01）
 *
 * 只负责页面渲染和事件绑定，数据与检索全在 shared/teaching.js。
 * 与既有页面的约定保持一致：
 *   · 通过 window.TeachingUI.mount() 由 app.js 在导航到 teach 页时调用
 *   · 用 T$ / TON 两个局部助手，避免和 app.js 里的 $ / on 重名
 */
const TeachingUI = (() => {

  const T$ = (id) => document.getElementById(id);
  const TON = (id, ev, fn) => { const el = T$(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let bound = false;

  // ────────────────────────────────────────────
  //  科目下拉
  // ────────────────────────────────────────────
  function subjects() {
    try {
      if (typeof ALL_SUBJECTS !== 'undefined' && Array.isArray(ALL_SUBJECTS)) return ALL_SUBJECTS;
    } catch (e) {}
    return ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理'];
  }

  function fillSubjectSelects() {
    const subs = subjects();
    ['teach-subject', 'teach-probe-subject', 'teach-builtin-filter'].forEach(id => {
      const sel = T$(id);
      if (!sel) return;
      const keep = sel.value;
      // 保留第一个 option（「通用」/「不限」/「全部」）
      while (sel.options.length > 1) sel.remove(1);
      subs.forEach(s => {
        const o = document.createElement('option');
        o.value = s; o.textContent = s;
        sel.appendChild(o);
      });
      if (keep) sel.value = keep;
    });
  }

  // ────────────────────────────────────────────
  //  顶部摘要
  // ────────────────────────────────────────────
  function renderSummary() {
    if (typeof Teaching === 'undefined') return;
    let st = null;
    try { st = Teaching.stats(); } catch (e) { return; }

    const sum = T$('teach-summary');
    if (sum) {
      sum.textContent = '我的 ' + st.total + ' 条 · 内置 ' + st.builtin.total + ' 条 · 题库 ' + st.bank.total + ' 题';
    }
    const bc = T$('teach-builtin-count');
    if (bc) bc.textContent = st.builtin.total;
    const qc = T$('teach-bank-count');
    if (qc) qc.textContent = st.bank.total;

    const sub = T$('teach-bank-sub');
    if (sub) sub.textContent = st.bank.total + ' 题，覆盖 ' + Object.keys(st.bank.bySubject).length + ' 科';
    const tot = T$('teach-bank-total');
    if (tot) tot.textContent = st.bank.total;

    // 侧栏徽标
    const badge = T$('badge-teach');
    if (badge) {
      if (st.total > 0) { badge.textContent = st.total; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');
    }
  }

  // ────────────────────────────────────────────
  //  用户资料列表
  // ────────────────────────────────────────────
  function renderList() {
    const box = T$('teach-list');
    if (!box || typeof Teaching === 'undefined') return;
    const list = Teaching.all();

    if (!list.length) {
      box.innerHTML = '<div class="empty" style="padding:20px">还没有导入自己的资料。' +
        '上面拖入文件，或点「导入示例资料」先看看效果。</div>';
      return;
    }

    box.innerHTML = list.slice().reverse().map(n => {
      const tags = (n.tags || []).map(t => '<span class="tag">' + esc(t) + '</span>').join('');
      const kind = (Teaching.KINDS[n.kind] || n.kind || '经验');
      return '<div class="memory-item" style="align-items:flex-start">' +
        '<span class="memory-role ai">' + esc(n.subject || '通用') + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;margin-bottom:2px">' + esc(n.title) + '</div>' +
          '<div class="hint" style="font-size:11.5px;margin-bottom:4px">' +
            esc(kind) + ' · 重要度 ' + n.importance +
            (n.usedCount ? ' · 已被引用 ' + n.usedCount + ' 次' : '') +
            (n.source ? ' · 来源 ' + esc(String(n.source).slice(0, 40)) : '') +
          '</div>' +
          '<div class="memory-text">' + esc(String(n.content).slice(0, 220)) +
            (String(n.content).length > 220 ? '…' : '') + '</div>' +
          (tags ? '<div style="margin-top:6px">' + tags + '</div>' : '') +
        '</div>' +
        '<button class="btn btn-sm btn-ghost" data-tdel="' + esc(n.id) + '" title="删除">✕</button>' +
      '</div>';
    }).join('');

    box.querySelectorAll('[data-tdel]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tdel');
        if (!confirm('删除这条资料？')) return;
        Teaching.remove(id);
        renderList();
        renderSummary();
        if (typeof toast === 'function') toast('已删除', 'success');
      });
    });
  }

  // ────────────────────────────────────────────
  //  内置经验列表
  // ────────────────────────────────────────────
  function renderBuiltin() {
    const box = T$('teach-builtin-list');
    if (!box || typeof Teaching === 'undefined') return;

    const filter = (T$('teach-builtin-filter') || {}).value || '';
    let all = [];
    try { all = Teaching.builtinNotes(); } catch (e) { return; }
    if (filter) all = all.filter(n => n.subject === filter);

    if (!all.length) {
      box.innerHTML = '<div class="empty" style="padding:16px">这个科目暂无内置经验。</div>';
      return;
    }

    box.innerHTML = '<div class="hint" style="margin-bottom:8px">共 ' + all.length + ' 条' +
      (filter ? '（' + esc(filter) + '）' : '') + '</div>' +
      all.map(n => {
        return '<div style="padding:8px 0;border-bottom:1px solid rgba(127,127,127,.12)">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span class="tag">' + esc(n.subject || '通用') + '</span>' +
            '<span class="tag">' + esc(Teaching.KINDS[n.kind] || n.kind) + '</span>' +
            '<b style="flex:1;font-size:13px">' + esc(n.title) + '</b>' +
            '<button class="btn btn-sm btn-ghost" data-bi-off="' + esc(n.id) + '" title="停用这条">停用</button>' +
          '</div>' +
          '<div class="hint" style="font-size:11.5px;margin-top:4px">' +
            esc(String(n.content).slice(0, 180)) + (String(n.content).length > 180 ? '…' : '') + '</div>' +
        '</div>';
      }).join('');

    box.querySelectorAll('[data-bi-off]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-bi-off');
        Teaching.setBuiltinDisabled(id, true);
        renderBuiltin();
        renderSummary();
        if (typeof toast === 'function') toast('已停用这条内置经验', 'success');
      });
    });
  }

  // ────────────────────────────────────────────
  //  内置题库预览
  // ────────────────────────────────────────────
  function renderBank() {
    const box = T$('teach-bank-list');
    if (!box || typeof Teaching === 'undefined') return;

    let st = null;
    try { st = Teaching.bankStats(); } catch (e) { return; }

    const rows = Object.keys(st.bySubject).map(sub => {
      const sample = Teaching.bankQuestions({ subject: sub, count: 2 });
      const items = sample.map(q =>
        '<div style="margin:4px 0;font-size:12.5px">' +
          '<span class="tag">' + esc(q.knowledge) + '</span> ' + esc(q.text) +
        '</div>'
      ).join('');
      return '<div style="padding:8px 0;border-bottom:1px solid rgba(127,127,127,.12)">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<b>' + esc(sub) + '</b>' +
          '<span class="hint" style="font-size:11.5px">' + st.bySubject[sub] + ' 题</span>' +
        '</div>' + items +
      '</div>';
    }).join('');

    box.innerHTML = rows;
  }

  // ────────────────────────────────────────────
  //  检索试验台
  // ────────────────────────────────────────────
  function runProbe() {
    const box = T$('teach-probe-result');
    if (!box || typeof Teaching === 'undefined') return;

    const q = ((T$('teach-probe-q') || {}).value || '').trim();
    const sub = ((T$('teach-probe-subject') || {}).value || '');

    if (!q) {
      box.innerHTML = '<div class="hint">先输入一个问题，比如「楞次定律怎么判断方向」。</div>';
      return;
    }

    const block = Teaching.promptBlock(q, { subject: sub });
    const hits = Teaching.search(q, { subject: sub, limit: 3 });

    if (!block || !hits.length) {
      box.innerHTML = '<div class="orange-block">' +
        '<b>没有检索到相关内容</b><br>' +
        '<span class="hint">这正说明「按需提取」在生效：库里有 ' +
        Teaching.stats().builtin.total + ' 条内置经验，但这个问题一条都不沾边，' +
        '所以 AI 什么都不会读到——不会硬塞无关内容。</span></div>';
      return;
    }

    box.innerHTML =
      '<div class="green-block" style="margin-bottom:10px">' +
        '<b>会注入 ' + hits.length + ' 条，共 ' + block.length + ' 字</b>' +
        '<span class="hint">（这一整段就是模型实际读到的内容）</span>' +
      '</div>' +
      '<pre style="white-space:pre-wrap;font-size:12px;line-height:1.6;padding:12px;' +
        'background:rgba(127,127,127,.10);border-radius:8px;margin:0">' +
        esc(block) + '</pre>' +
      '<div class="hint" style="margin-top:8px">库中共 ' +
        Teaching.stats().builtin.total + ' 条内置 + ' + Teaching.stats().total +
        ' 条自建，只取了这 ' + hits.length + ' 条。</div>';
  }

  // ────────────────────────────────────────────
  //  导入
  // ────────────────────────────────────────────
  function importOpts() {
    return {
      subject: (T$('teach-subject') || {}).value || '',
      kind: (T$('teach-kind') || {}).value || 'experience',
      importance: Number((T$('teach-importance') || {}).value || 3),
    };
  }

  function reportImport(r, target) {
    const box = T$(target || 'teach-import-log');
    if (!box) return;
    const parts = [];
    parts.push('<div class="green-block"><b>成功导入 ' + r.added + ' 条</b>' +
      (r.skipped ? '，跳过 ' + r.skipped + ' 条' : '') + '</div>');
    if (r.files && r.files.length) {
      parts.push('<div class="hint" style="margin-top:6px">' +
        r.files.map(f => esc(f.name) + '：' + (f.added || 0) + ' 条').join('<br>') + '</div>');
    }
    if (r.errors && r.errors.length) {
      parts.push('<div class="orange-block" style="margin-top:8px">' +
        r.errors.map(e => esc(e)).join('<br>') + '</div>');
    }
    box.innerHTML = parts.join('');
  }

  async function handleFiles(files) {
    if (!files || !files.length) return;
    const logBox = T$('teach-import-log');
    if (logBox) logBox.innerHTML = '<div class="hint">正在解析 ' + files.length + ' 个文件…</div>';
    try {
      const r = await Teaching.importFiles(files, importOpts());
      reportImport(r);
      renderList(); renderSummary();
      if (r.added > 0 && typeof toast === 'function') toast('已导入 ' + r.added + ' 条教学资料', 'success');
    } catch (e) {
      if (logBox) logBox.innerHTML = '<div class="orange-block">导入失败：' + esc(e.message) + '</div>';
    }
  }

  function importPaste() {
    const ta = T$('teach-paste');
    const box = T$('teach-paste-log');
    const text = (ta && ta.value || '').trim();
    if (!text) {
      if (box) box.innerHTML = '<div class="hint">先粘贴一些内容。</div>';
      return;
    }
    const r = Teaching.importText(text, Object.assign({ format: 'auto', source: 'paste' }, importOpts()));
    reportImport(r, 'teach-paste-log');
    if (r.added > 0) {
      if (ta) ta.value = '';
      renderList(); renderSummary();
      if (typeof toast === 'function') toast('已导入 ' + r.added + ' 条', 'success');
    }
  }

  /** 示例资料：让用户一眼看懂格式与效果 */
  function importDemo() {
    const demo = `## 导数含参讨论的固定顺序

学生最常漏的一支是「参数让导函数零点落在定义域外」。
固定顺序：求导 → 解出含参根 → 先判断根是否在定义域内 → 再比较端点。
要求每道题开头写一句「根在定义域内吗」。

## 电磁感应方向判断

先右手定则定方向，再用楞次定律检查是否「阻碍变化」。
学生常把「阻碍磁通量变化」读成「阻碍磁通量」，方向就反了。

## 完形填空别边读边填

第一遍通读抓主题与情感线（约 90 秒），第二遍逐空选择。
犹豫的先跳过，靠后文线索回填，正确率通常提高一成。

## 错题本只记三样

① 出处 ② 卡在哪一步（一句话）③ 正确思路的关键转折点。
一周后遮答案重做，做对才划掉。`;
    const r = Teaching.importText(demo, { format: 'auto', source: 'demo', importance: 4 });
    reportImport(r, 'teach-import-log');
    renderList(); renderSummary();
    if (typeof toast === 'function') toast('已导入 ' + r.added + ' 条示例资料', 'success');
  }

  // ────────────────────────────────────────────
  //  导出
  // ────────────────────────────────────────────
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ────────────────────────────────────────────
  //  绑定（只绑一次）
  // ────────────────────────────────────────────
  function bind() {
    if (bound) return;
    if (typeof Teaching === 'undefined') return;
    bound = true;

    TON('teach-files', 'change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    TON('teach-folder', 'change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
    TON('btn-teach-paste', 'click', importPaste);
    TON('btn-teach-demo', 'click', importDemo);
    TON('btn-teach-probe', 'click', runProbe);
    TON('teach-builtin-filter', 'change', renderBuiltin);

    // 拖拽
    const drop = T$('teach-drop');
    if (drop) {
      ['dragenter', 'dragover'].forEach(ev =>
        drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev =>
        drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', (e) => {
        if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files);
      });
      drop.addEventListener('click', (e) => {
        if (e.target.closest('label')) return;
        const fi = T$('teach-files'); if (fi) fi.click();
      });
    }

    TON('btn-teach-export-json', 'click', () => {
      download('教学资料_' + new Date().toISOString().slice(0, 10) + '.json', Teaching.exportJSON());
      if (typeof toast === 'function') toast('已导出 JSON', 'success');
    });
    TON('btn-teach-export-md', 'click', () => {
      download('教学资料_' + new Date().toISOString().slice(0, 10) + '.md',
        Teaching.exportMarkdown(), 'text/markdown;charset=utf-8');
      if (typeof toast === 'function') toast('已导出 Markdown', 'success');
    });
    TON('btn-teach-clear', 'click', () => {
      if (!Teaching.all().length) { if (typeof toast === 'function') toast('本来就是空的'); return; }
      if (!confirm('清空所有「自己导入」的教学资料？（内置经验和题库不受影响）')) return;
      Teaching.clear();
      renderList(); renderSummary();
      if (typeof toast === 'function') toast('已清空自建资料', 'success');
    });

    // 回车直接检索
    TON('teach-probe-q', 'keydown', (e) => { if (e.key === 'Enter') runProbe(); });
  }

  // ────────────────────────────────────────────
  //  入口
  // ────────────────────────────────────────────
  function mount() {
    if (typeof Teaching === 'undefined') {
      const box = T$('teach-list');
      if (box) box.innerHTML = '<div class="orange-block">教学资料模块未加载（shared/teaching.js 缺失）</div>';
      return;
    }
    fillSubjectSelects();
    bind();
    renderSummary();
    renderList();
    renderBuiltin();
    renderBank();
  }

  return { mount, subjects };
})();

if (typeof window !== 'undefined') window.TeachingUI = TeachingUI;
