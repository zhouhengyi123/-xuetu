#!/usr/bin/env node
/**
 * 一键跑全部回归测试
 *
 * 用法：node 跑测试.cjs
 *
 * 这些是**真正的回归基线** —— 每次改代码后跑一遍，全绿才算没搞坏东西。
 * 一次性排查脚本已归档到 _archive/，不参与回归。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');

const TESTS = [
  { file: '_p0_verify.js', desc: 'P0 数据链（去重/来源/校正/汇总）' },
  { file: '_p1_property_test.js', desc: 'P1 属性测试（幂等/单调/边界/收缩）' },
  { file: '_p3p4_verify.js', desc: 'P3/P4 浙江赋分 + 预测区间' },
  { file: '_p1p2p5_verify.js', desc: 'P1/P2/P5 证据层+充分度+回溯' },
  { file: '_test_backup_e2e.cjs', desc: '数据备份与恢复（端到端）' },
  { file: '_testclean.js', desc: '读图结果清洗' },
  { file: '_testbatch.js', desc: '批量上传提示词' },
  { file: '_testxhr.js', desc: 'XHR 兜底序列化' },
  { file: '_testfoldergroup.js', desc: '文件夹分组' },
  { file: '_testcourse.js', desc: '课程引擎' },
  { file: '_testcourse_view.js', desc: '课程渲染（含朗读栏）' },
  { file: '_check.js', desc: '估分链路综合检查' },
];

let pass = 0, fail = 0;
const failed = [];

console.log('════════════════════════════════════════════════════════');
console.log('  学徒 · 回归测试');
console.log('════════════════════════════════════════════════════════');
console.log('');

for (const t of TESTS) {
  if (!fs.existsSync(t.file)) {
    console.log('  ⚠ 跳过（文件不存在）: ' + t.file);
    continue;
  }
  process.stdout.write('  ' + t.file.padEnd(28));
  try {
    const out = execFileSync(process.execPath, [t.file], {
      encoding: 'utf8',
      timeout: 120000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // 从输出里抓 "N 通过 / M 失败" 或 "全部通过"
    const m = out.match(/(\d+)\s*通过\s*\/\s*(\d+)\s*失败/);
    if (m) {
      const p = Number(m[1]), f = Number(m[2]);
      pass += p; fail += f;
      if (f > 0) { failed.push(t.file); console.log('✗  ' + p + ' 通过 / ' + f + ' 失败  ' + t.desc); }
      else console.log('✓  ' + p + ' 项  ' + t.desc);
    } else {
      pass++;
      console.log('✓  ' + t.desc);
    }
  } catch (e) {
    fail++;
    failed.push(t.file);
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    const errLine = msg.split('\n').find(l => l.includes('Error') || l.includes('✗')) || msg.slice(0, 120);
    console.log('✗  ' + t.desc);
    console.log('     ' + errLine.trim().slice(0, 150));
  }
}

console.log('');
console.log('════════════════════════════════════════════════════════');
if (fail === 0) {
  console.log('  ✓ 全部通过（共 ' + pass + ' 项断言）');
} else {
  console.log('  ✗ 有 ' + fail + ' 处失败：' + failed.join(', '));
}
console.log('════════════════════════════════════════════════════════');
process.exit(fail ? 1 : 0);
