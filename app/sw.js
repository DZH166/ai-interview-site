/* AI 面试学习站 Service Worker
 * 策略:
 *  - 导航请求(index.html):网络优先,失败回退缓存 —— 保证入口最新;
 *  - 静态资源(css/js/图标):缓存优先,后台更新 —— 秒开;
 *  - data.js 与 data/manifest.json:网络优先,失败回退缓存 —— 题库入口更新及时生效,断网也能学;
 *  - data/topics/*.json(题库分片):缓存优先、不回源刷新 —— 文件名带内容哈希,
 *    内容一变文件名就变,旧文件不可能被错误复用(不可变资产按内容寻址)。
 *    分片不进预缓存(20 片 10MB 会让 SW 安装变慢、流量翻倍):首次在线访问时由
 *    应用按需拉取并写入运行时缓存,之后断网照常可用。
 *
 * 两个缓存,生命周期不同:
 *  - CACHE_VERSION(shell):由 tools/build.py 按 shell 内容哈希盖章,一变即整包重建。
 *  - TOPIC_CACHE(topics):分片专用,**不随 shell 版本走**。
 *    早先把分片写进 CACHE_VERSION,结果是「改一行 CSS → 缓存名变 → 10MB 分片全量重下」,
 *    内容寻址的收益被整包失效吃掉了。现在分片只在 manifest 变化时按名单增量清理:
 *    只有内容真变的分片会换名字、重新下载,其余原样命中。
 * CACHE_VERSION 由 tools/build.py 按内容哈希自动盖章,数据一变缓存名即变。
 */
'use strict';
const CACHE_VERSION = 'shell-f81811a623d6';
/* 分片专用缓存:不参与 shell 版本盖章,清理只按 manifest 名单增量做。
   命名带 -v1 是留给「分片路径/命名规则大改」时的兜底 —— 那种时候一次性换名重下。 */
const TOPIC_CACHE = 'topics-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './data.js',
  './data/manifest.json',
  './js/util.js',
  './js/srs.js',
  './js/store.js',
  './js/markdown.js',
  './js/highlight.js',
  './js/search.js',
  './js/common.js',
  './js/express.js',
  './js/views-practice.js',
  './js/views-resume.js',
  './js/views-stats.js',
  './js/views-knowledge.js',
  './js/views-review.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        /* TOPIC_CACHE 不在清理范围:分片的失效按 manifest 名单增量做,
           不能因为 shell 换了版本就把 10MB 分片一起丢掉 */
        keys.filter((k) => k !== CACHE_VERSION && k !== TOPIC_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isNavigate = req.mode === 'navigate';
  const isManifest = url.pathname.endsWith('/data/manifest.json');
  const isData = url.pathname.endsWith('/data.js') || isManifest;
  const isTopicFile = url.pathname.includes('/data/topics/');

  if (isNavigate) {
    e.respondWith(networkFirst(req, './index.html'));
  } else if (isTopicFile) {
    /* 分片不可变:命中即返回,不发起后台刷新 —— 省流量,也避免老 SW 缓存
       缺分片时每片都打出一次注定失败的回源请求。 */
    e.respondWith(cacheFirstImmutable(req));
  } else if (isManifest) {
    e.respondWith(networkFirstManifest(req));
  } else if (isData) {
    e.respondWith(networkFirst(req));
  } else {
    e.respondWith(cacheFirst(req));
  }
});

/* manifest 是分片的权威名单:取回新版后顺手做一次增量清理。
   放在这里而不是 activate —— install/activate 阶段可能没网,
   那时拿到的是缓存里那份旧名单,照它删会把刚下载的新分片误删。 */
async function networkFirstManifest(req) {
  const res = await networkFirst(req);
  try {
    await pruneTopicCache(await res.clone().json());
  } catch (_) { /* 取到的是缓存副本或 JSON 坏了:跳过清理,不清比删错好 */ }
  return res;
}

/* 只删「当前 manifest 里已经没有的」分片文件。
   名单为空一律不删 —— 那是坏 manifest 的信号,不是「题库空了」。 */
async function pruneTopicCache(manifest) {
  const live = new Set(
    Object.values((manifest && manifest.topics) || {})
      .map((t) => t && t.file).filter(Boolean));
  if (!live.size) return;
  const cache = await caches.open(TOPIC_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys.map((r) => {
    const name = new URL(r.url).pathname.split('/').pop();
    return live.has(name) ? null : cache.delete(r);
  }));
}

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (fallbackUrl) {
      const fb = await cache.match(fallbackUrl);
      if (fb) return fb;
    }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) {
    fetch(req).then((fresh) => { if (fresh && fresh.ok) cache.put(req, fresh.clone()); }).catch(() => {});
    return hit;
  }
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}

/* 不可变资产专用:与 cacheFirst 的差别是不做后台刷新(哈希文件名已保证新鲜度),
   并且写进独立的 TOPIC_CACHE —— 分片不随 shell 版本整包失效 */
async function cacheFirstImmutable(req) {
  const cache = await caches.open(TOPIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}
