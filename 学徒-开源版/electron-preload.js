/**
 * Preload —— 把主进程的能力安全地暴露给页面
 *
 * 只暴露 workbuddyBridge 这一组接口，不开 nodeIntegration。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('workbuddyBridge', {
  /** 探测：本机有没有可用的 WorkBuddy 账号（只读本地文件，不测网络） */
  probe: () => ipcRenderer.invoke('workbuddy:probe'),

  /** ★ 真实连通性测试：真发一次请求，能发现 token 过期 */
  verify: () => ipcRenderer.invoke('workbuddy:verify'),

  /** 发一次对话（返回完整文本） */
  chat: (payload) => ipcRenderer.invoke('workbuddy:chat', payload),

  /** 读图（识别试卷） */
  vision: (payload) => ipcRenderer.invoke('workbuddy:vision', payload),

  /** 模型目录 */
  models: () => ipcRenderer.invoke('workbuddy:models'),

  /** 选模型 */
  setModel: (id) => ipcRenderer.invoke('workbuddy:set-model', id),

  /** 账号池状态（含冷却） */
  poolStatus: () => ipcRenderer.invoke('workbuddy:pool-status'),

  /** 清冷却 */
  clearCooldown: (id) => ipcRenderer.invoke('workbuddy:clear-cooldown', id),

  /** 是否是桌面应用（页面用来决定要不要显示这个选项） */
  isDesktop: true,
});

/**
 * ★ 配置持久化桥（2026-10-24）
 *
 * 用户抱怨"每次都要重新输密钥"。
 * localStorage 会因清缓存、换 Electron 版本、换 userData 目录而丢失。
 *
 * 这个桥把关键配置（API Key、目标、setup 状态）额外写到
 * userData/config-mirror.json —— 重装只要 userData 还在就能恢复。
 */
contextBridge.exposeInMainWorld('appDataBridge', {
  /** 保存一份配置快照 */
  save: (snap) => ipcRenderer.invoke('appdata:save', snap),

  /** 读取上次保存的快照 */
  load: () => ipcRenderer.invoke('appdata:load'),

  /** 配置文件在哪（给用户看） */
  path: () => ipcRenderer.invoke('appdata:path'),
});

/**
 * ★ Agent 桥（2026-10-24）
 *
 * 让 AI 能调用本机能力：读写文件、跑代码、生成图表/3D/动画。
 * 工作区固定在 userData/workspace，所有操作限制在里面。
 */
contextBridge.exposeInMainWorld('agentBridge', {
  /** 跑一次 Agent（带工具调用） */
  run: (payload) => ipcRenderer.invoke('agent:run', payload),

  /** 工具清单 */
  tools: () => ipcRenderer.invoke('agent:tools'),

  /** 工具执行日志 */
  logs: () => ipcRenderer.invoke('agent:logs'),

  /** 工作区路径 */
  workspace: () => ipcRenderer.invoke('agent:workspace'),

  /** 打开生成的文件 */
  open: (p) => ipcRenderer.invoke('agent:open', p),

  /** 列出生成的文件 */
  listOutputs: () => ipcRenderer.invoke('agent:list-outputs'),

  /** 订阅工具调用进度（返回取消函数） */
  onTool: (cb) => {
    const handler = (evt, info) => { try { cb(info); } catch (e) {} };
    ipcRenderer.on('agent:tool', handler);
    return () => ipcRenderer.removeListener('agent:tool', handler);
  },

  isDesktop: true,
});
