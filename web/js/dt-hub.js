/**
 * 数据打通中心 UI（2026-10-24）
 *
 * 挂到设置页的 #dt-hub-card
 */
const DTHub = (() => {

  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function fmtAgo(iso) {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const h = Math.floor(min / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  }

  async function refresh() {
    const st = $('dt-hub-status');
    const info = $('dt-hub-info');

    if (typeof DTSync === 'undefined') {
      if (st) { st.textContent = '模块未加载'; st.style.color = 'var(--label-tertiary)'; }
      return;
    }

    let online = false;
    try { online = await DTSync.available(); } catch (e) {}

    if (st) {
      st.textContent = online ? '已连接' : '未连接';
      st.style.color = online ? 'var(--green)' : 'var(--amber)';
    }

    // 统计
    const papers = (Storage.getPapers && Storage.getPapers()) || [];
    const mistakes = (Storage.getMistakes && Storage.getMistakes()) || [];
    const courses = (typeof CourseEngine !== 'undefined' && CourseEngine.list) ? CourseEngine.list() : [];
    const lessons = (Storage.getLessons && Storage.getLessons()) || [];
    const apt = (Storage.getAptitude && Storage.getAptitude()) || null;
    const last = DTSync.lastSync ? DTSync.lastSync() : null;

    if (info) {
      info.innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px">' +
        statBox('卷子', papers.length) +
        statBox('错题', mistakes.length) +
        statBox('课程', courses.length) +
        statBox('上课记录', lessons.length) +
        statBox('能力测验', apt ? '已测' : '未测') +
        '</div>' +
        '<div class="hint" style="margin-top:8px">' +
        (last
          ? '上次同步：' + fmtAgo(last.at) + ' · ' + (last.ok ? '成功' : '有失败') +
            (last.ms ? ' · 耗时 ' + last.ms + 'ms' : '')
          : '还没同步过') +
        '</div>';
    }
  }

  function statBox(label, value) {
    return '<div style="background:var(--bg-layer-2);border-radius:8px;padding:10px 12px;text-align:center">' +
      '<div style="font-size:18px;font-weight:650;font-variant-numeric:tabular-nums">' + esc(value) + '</div>' +
      '<div style="font-size:11px;color:var(--label-tertiary);margin-top:2px">' + esc(label) + '</div>' +
      '</div>';
  }

  async function syncAll() {
    const btn = $('btn-dt-sync-all');
    const log = $('dt-hub-log');
    if (btn) { btn.disabled = true; btn.textContent = '同步中…'; }
    if (log) log.innerHTML = '<div class="hint"><span class="spinner"></span> 正在同步…</div>';

    try {
      if (typeof DTSync === 'undefined') throw new Error('DTSync 未加载');

      const r = await DTSync.syncAll();

      if (log) {
        if (!r.ok && r.reason) {
          log.innerHTML = '<div class="note warn">' + esc(r.reason) + '</div>';
        } else {
          log.innerHTML =
            '<div class="note ' + (r.ok ? 'ok' : 'warn') + '">' +
            (r.ok ? '✓ 同步完成' : '⚠ 部分失败') + ' · 耗时 ' + r.ms + 'ms' +
            '<div style="margin-top:6px;font-size:12px">' +
            (r.steps || []).map(s =>
              '<div>' + (s.ok ? '✓' : '✗') + ' ' + esc(s.name) + '：' + esc(s.detail) + '</div>'
            ).join('') +
            '</div></div>';
        }
      }

      if (r.ok) {
        try { Shell.toast('数据已同步到 DeepTutor', 'success'); } catch (e) {}
      }
      refresh();
    } catch (e) {
      if (log) log.innerHTML = '<div class="note bad">同步失败：' + esc(e.message) + '</div>';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '立即全量同步'; }
    }
  }

  async function checkConn() {
    const log = $('dt-hub-log');
    if (log) log.innerHTML = '<div class="hint"><span class="spinner"></span> 检查中…</div>';

    try {
      const ok = await DTSync.available();
      if (log) {
        log.innerHTML = ok
          ? '<div class="note ok">✓ DeepTutor 后端（:8001）可用</div>'
          : '<div class="note warn">DeepTutor 未启动。深度辅导功能需要它，' +
            '但其他功能不受影响。启动方法：<code>node deeptutor-runtime.cjs</code></div>';
      }
      refresh();
    } catch (e) {
      if (log) log.innerHTML = '<div class="note bad">检查失败：' + esc(e.message) + '</div>';
    }
  }

  async function openWorkspace() {
    try {
      if (window.agentBridge && window.agentBridge.workspace) {
        const ws = await window.agentBridge.workspace();
        // 用系统文件管理器打开
        if (window.agentBridge.open) {
          // 得找个能打开目录的方式
          try {
            const r = await window.agentBridge.open(ws);
            if (!r.ok) {
              Shell.toast('工作区路径：' + ws, 'success');
            }
          } catch (e) {
            Shell.toast('工作区路径：' + ws, 'success');
          }
        }
      } else {
        Shell.toast('只在桌面应用里可用', 'warning');
      }
    } catch (e) {
      Shell.toast('打开失败：' + e.message, 'error');
    }
  }

  /**
   * 从 DeepTutor 拉回数据（反向同步，2026-10-24）
   * 拉课程列表 + 会话记录，存进学徒本地。
   */
  async function pullFromDT() {
    const btn = $('btn-dt-pull');
    const log = $('dt-hub-log');
    if (btn) { btn.disabled = true; btn.textContent = '拉取中…'; }
    if (log) log.innerHTML = '<div class="hint"><span class="spinner"></span> 正在从 DeepTutor 拉取…</div>';

    try {
      if (typeof DTSync === 'undefined' || !DTSync.pullAll) {
        throw new Error('DTSync.pullAll 不可用');
      }

      const r = await DTSync.pullAll();

      if (log) {
        if (!r.ok && r.reason) {
          log.innerHTML = '<div class="note warn">' + esc(r.reason) + '</div>';
        } else {
          log.innerHTML =
            '<div class="note ' + (r.ok ? 'ok' : 'warn') + '">' +
            (r.ok ? '✓ 拉取完成' : '⚠ 部分失败') + ' · 耗时 ' + r.ms + 'ms' +
            '<div style="margin-top:6px;font-size:12px">' +
            '课程：' + r.courses + ' 门<br>' +
            '会话：' + r.sessions + ' 条' +
            (r.errors && r.errors.length ? '<br>错误：' + esc(r.errors.join('；')) : '') +
            '</div></div>';
        }
      }

      if (r.ok) {
        try { Shell.toast('已从 DeepTutor 拉取 ' + r.courses + ' 门课程', 'success'); } catch (e) {}
      }
      refresh();
    } catch (e) {
      if (log) log.innerHTML = '<div class="note bad">拉取失败：' + esc(e.message) + '</div>';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '从 DeepTutor 拉回'; }
    }
  }

  function init() {
    on('btn-dt-sync-all', 'click', syncAll);
    on('btn-dt-pull', 'click', pullFromDT);
    on('btn-dt-check', 'click', checkConn);
    on('btn-dt-open-workspace', 'click', openWorkspace);
    refresh();
  }

  return { init, refresh, syncAll, pullFromDT };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = DTHub;
