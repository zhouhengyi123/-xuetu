/**
 * WorkBuddy 账号池 + 模型目录 + 冷却切换
 *
 * 学 xdpool 的做法：
 *   ① 记住每个账号的冷却状态（429/403 → 冷却，到点自动恢复）
 *   ② 请求时挑"健康的、积分多的"账号
 *   ③ 全池冷却才排队
 *   ④ 模型目录带倍率，让用户知道哪个贵
 */
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════
//  状态持久化（存到 userData，重启也记得）
// ══════════════════════════════════════════════════════════
let stateFile = null;
function initState(userDataDir) {
  stateFile = path.join(userDataDir, 'workbuddy-pool.json');
  return stateFile;
}

let state = {
  /** { [accountId]: { cooldownUntil: ms, reason: string, hits: number } } */
  cooldowns: {},
  /** 用户选的模型 */
  model: 'auto',
  /** 分配策略：priority | round-robin | balanced */
  strategy: 'priority',
  /** 每个账号最近一次成功时间（balanced 用） */
  lastUsed: {},
};

function loadState() {
  if (!stateFile) return;
  try {
    const j = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    state = Object.assign(state, j || {});
  } catch (e) { /* 首次没有文件 */ }
}

function saveState() {
  if (!stateFile) return;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 1), 'utf8');
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════
//  冷却管理
// ══════════════════════════════════════════════════════════
const COOLDOWN_MS = 5 * 60 * 1000;      // 默认冷却 5 分钟

function markCooldown(accountId, reason, ms) {
  state.cooldowns[accountId] = {
    cooldownUntil: Date.now() + (ms || COOLDOWN_MS),
    reason: String(reason || '').slice(0, 120),
    hits: ((state.cooldowns[accountId] || {}).hits || 0) + 1,
  };
  saveState();
}

function clearCooldown(accountId) {
  if (accountId) delete state.cooldowns[accountId];
  else state.cooldowns = {};
  saveState();
}

function isCooling(accountId) {
  const c = state.cooldowns[accountId];
  if (!c) return false;
  if (Date.now() >= c.cooldownUntil) {
    delete state.cooldowns[accountId];     // 到点自动恢复
    saveState();
    return false;
  }
  return true;
}

function cooldownInfo() {
  const out = [];
  Object.keys(state.cooldowns).forEach(id => {
    const c = state.cooldowns[id];
    const left = c.cooldownUntil - Date.now();
    if (left > 0) out.push({ id, reason: c.reason, secondsLeft: Math.ceil(left / 1000), hits: c.hits });
    else delete state.cooldowns[id];
  });
  return out;
}

// ══════════════════════════════════════════════════════════
//  账号挑选
// ══════════════════════════════════════════════════════════
function pickAccounts(accounts, opts) {
  opts = opts || {};
  const available = accounts.filter(a => !isCooling(a.id));
  if (!available.length) return [];

  const strategy = opts.strategy || state.strategy || 'priority';

  if (strategy === 'round-robin') {
    // 按 lastUsed 最久没用的排前面
    return available.slice().sort((a, b) => (state.lastUsed[a.id] || 0) - (state.lastUsed[b.id] || 0));
  }
  if (strategy === 'balanced') {
    // 随机但偏向久未使用的
    const now = Date.now();
    return available.slice().sort(() => Math.random() - 0.5)
      .sort((a, b) => (state.lastUsed[a.id] || 0) - (state.lastUsed[b.id] || 0));
  }
  // priority：按原顺序（第一个先用完）
  return available;
}

function touchAccount(accountId) {
  state.lastUsed[accountId] = Date.now();
  saveState();
}

// ══════════════════════════════════════════════════════════
//  模型目录（从插件抄的 fallback 列表，够用）
// ══════════════════════════════════════════════════════════
const MODELS = [
  { id: 'auto', name: 'Auto（自动挑最合适的）', images: true, mult: null, note: '推荐' },
  { id: 'hy3', name: 'Hy3（免费）', images: true, mult: 0, note: '积分倍率 0 = 不扣积分' },
  { id: 'hy3-x', name: 'Hy3-X', images: true, mult: 0.05, note: '很便宜' },
  { id: 'hy4-preview', name: 'Hy4 Preview', images: true, mult: 0.29, note: '' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', images: true, mult: 0.06, note: '便宜快速' },
  { id: 'glm-5.3', name: 'GLM-5.3', images: true, mult: 0.79, note: '能力强' },
  { id: 'glm-5v-turbo', name: 'GLM-5V-Turbo', images: true, mult: 0.71, note: '多模态' },
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', images: true, mult: 0.11, note: '便宜' },
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', images: true, mult: null, note: '' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', images: true, mult: 0.51, note: '能力强' },
  { id: 'kimi-k2.7', name: 'Kimi-K2.7-Code', images: true, mult: null, note: '' },
  { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', images: true, mult: 0.77, note: '' },
  { id: 'kimi-k3-1', name: 'Kimi-K3', images: true, mult: 1.62, note: '贵' },
];

function listModels() {
  return MODELS.slice();
}

function setModel(id) {
  state.model = id || 'auto';
  saveState();
  return state.model;
}
function currentModel() {
  return state.model || 'auto';
}

module.exports = {
  initState, loadState, saveState,
  markCooldown, clearCooldown, isCooling, cooldownInfo,
  pickAccounts, touchAccount,
  listModels, setModel, currentModel,
  getState: () => state,
  COOLDOWN_MS,
};
