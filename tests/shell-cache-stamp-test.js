/* Service Worker 缓存戳一致性(App shell 改了却忘记重新盖章的常驻门禁)

   背景:app/sw.js 的 CACHE_VERSION 是对整套 app shell 做内容哈希盖出来的章
   (`tools/build.py`)。改完 app/js/*、app/css/style.css、app/index.html 之后
   如果不重跑 build.py,戳不会变 —— 后果不是「CI 红一下」,而是**已经装过 PWA 的
   用户缓存名不变,会一直拿旧版 JS/CSS,界面修复对老用户永远不生效**。
   2026-09-12 阶段11 推送时 CI 就是这么红的,根因正在此。

   所以这里不只断言「CI 那一步能过」,而是把「戳必须等于按 build.py 规则重算的哈希」
   做成可本地运行的断言——改完 shell 忘了构建,跑 node tests 就会立刻发现。

   运行:node tests/shell-cache-stamp-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail === undefined ? '' : '\n    → ' + detail); }
}

/* ---- 1. 从 build.py 里取出它实际盖章用的文件清单(单一事实来源,不复制一份) ---- */
const buildSrc = fs.readFileSync(path.join(ROOT, 'tools', 'build.py'), 'utf8');
const listMatch = buildSrc.match(/shell_files\s*=\s*\[([\s\S]*?)\]/);
let shellFiles = listMatch ? (listMatch[1].match(/"([^"]+)"/g) || []).map(s => s.slice(1, -1)) : [];

console.log('== 1. 解析 build.py 的盖章清单 ==');
/* 解析失败必须报失败,不能静默变成空清单后「全绿」——否则 build.py 一重构,
   这个门禁就变成恒真断言,正是本轮要防的那种假绿。 */
ok('能从 build.py 解析出 shell_files 清单', shellFiles.length > 0,
   '正则没匹配到 shell_files = [...] —— build.py 结构变了,门禁已失效,必须同步修这里');
ok('清单规模合理(≥10 个 shell 文件)', shellFiles.length >= 10, '解析到 ' + shellFiles.length + ' 个');
ok('清单包含 app/data.js', shellFiles.includes('app/data.js'));
ok('清单不含 sw.js 自身(自引用会导致两次构建互相追尾)', !shellFiles.some(f => f.endsWith('sw.js')),
   '含 ' + shellFiles.filter(f => f.endsWith('sw.js')).join(', '));

/* ---- 2. 按 build.py 的完全相同规则重算哈希 ---- */
function normalizeLf(buf) {   // 与 build.py 的 buf.replace(b"\r\n", b"\n") 等价(纯字节级)
  const out = Buffer.allocUnsafe(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[j++] = buf[i];
  }
  return out.subarray(0, j);
}
function computeStamp(files, overrides) {
  const h = crypto.createHash('md5');
  for (const rel of files) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;              // 与 build.py 一致:文件不存在则跳过
    const raw = (overrides && overrides[rel] !== undefined)
      ? Buffer.from(overrides[rel], 'utf8')
      : fs.readFileSync(p);
    h.update(rel.replace(/\//g, '_'), 'utf8');
    h.update(normalizeLf(raw));
  }
  return h.digest('hex').slice(0, 12);
}
const expected = computeStamp(shellFiles);

/* ---- 3. 读出 sw.js 里实际写的戳 ---- */
const swSrc = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
const verMatch = swSrc.match(/const CACHE_VERSION = '([^']*)';/);
const actual = verMatch ? verMatch[1] : null;

console.log('\n== 2. 缓存戳一致性 ==');
ok('sw.js 里能读到 CACHE_VERSION', actual !== null);
ok('CACHE_VERSION 形如 shell-<12位十六进制>', /^shell-[0-9a-f]{12}$/.test(String(actual)), '实际:' + actual);
ok('CACHE_VERSION 等于按当前 app shell 内容重算的哈希',
   actual === 'shell-' + expected,
   '仓库内是 ' + actual + ',按当前源码应为 shell-' + expected
   + '\n      → 改了 app/ 下的 shell 文件但没重跑 `python tools/build.py`;'
   + '\n        影响:老用户 SW 缓存名不变,会一直拿旧版 JS/CSS');

console.log('\n== 3. 哈希本身可信(自检) ==');
/* 证明哈希真的对内容敏感,而不是一个恰好相等的常量 */
const mutated = computeStamp(shellFiles, { 'app/data.js': 'window.APP_DATA = 1;\n' });
ok('改动任一 shell 文件内容后哈希必须变化(哈希不是常量)',
   mutated !== expected, '改 app/data.js 后哈希仍是 ' + mutated);
const reordered = computeStamp(shellFiles.slice().reverse());
ok('清单顺序变化后哈希应变化(说明是顺序敏感的累积哈希,而非集合)',
   shellFiles.length < 2 || reordered !== expected, '顺序调换后仍是 ' + reordered);
ok('重算两次结果稳定(不含时间戳等易变因素)', computeStamp(shellFiles) === expected);

console.log('\n== 4. 预缓存清单覆盖完整 ==');
/* 新增一个 app/js 模块却忘了加进盖章清单时,它既不会被预缓存(离线打不开)、
   也不会参与缓存戳计算(改了它老用户不刷新)——这是本轮真实踩过的坑,必须常驻拦住。 */
const jsOnDisk = fs.readdirSync(path.join(ROOT, 'app', 'js'))
  .filter(f => f.endsWith('.js')).map(f => 'app/js/' + f);
const jsMissing = jsOnDisk.filter(f => !shellFiles.includes(f));
ok('app/js 下每个 js 文件都在 build.py 的盖章清单里(新模块不能漏)',
   jsMissing.length === 0,
   '漏了:' + jsMissing.join(', ') + '\n      → 漏掉的模块不会被预缓存(离线打开会报错),也不参与缓存戳');
/* 戳变了但 APP_SHELL 漏了某个文件,同样会让老用户拿到旧资源 */
const shellArr = (swSrc.match(/const APP_SHELL = \[([\s\S]*?)\]/) || [, ''])[1];
const cacheEntries = (shellArr.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)).filter(s => s !== './');
/* APP_SHELL 里的路径是相对 app/ 的('./js/app.js'),build.py 清单是相对仓库根的 */
const cacheSet = new Set(cacheEntries.map(e => 'app/' + e.replace(/^\.\//, '')));
const missing = shellFiles.filter(f => !cacheSet.has(f));
ok('build.py 盖章的每个文件都在 sw.js 的 APP_SHELL 预缓存里', missing.length === 0,
   '缺失:' + missing.join(', '));
const notOnDisk = cacheEntries.filter(e => !fs.existsSync(path.join(ROOT, 'app', e.replace(/^\.\//, ''))));
ok('APP_SHELL 里每个条目在磁盘上都存在(否则 SW 安装时 c.addAll 会整体失败)',
   notOnDisk.length === 0, '不存在:' + notOnDisk.join(', '));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed) console.log('失败项:\n  - ' + failures.join('\n  - '));
process.exit(failed ? 1 : 0);
