/* AI 面试学习站 Service Worker
 * 策略:
 *  - 导航请求(index.html):网络优先,失败回退缓存 —— 保证入口最新;
 *  - 带内容版本的 css/js(含 data.js):缓存优先、不后台替换,与 HTML 版本保持一致;
 *  - 旧的无版本静态资源/图标:缓存优先,后台更新;
 *  - 无版本 data.js 与 data/manifest.json:网络优先,失败回退缓存;
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
const CACHE_VERSION = 'shell-6fe1654d9545';
/* 分片专用缓存:不参与 shell 版本盖章,清理只按 manifest 名单增量做。
   命名带 -v1 是留给「分片路径/命名规则大改」时的兜底 —— 那种时候一次性换名重下。 */
const TOPIC_CACHE = 'topics-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/manifest.json',
  './css/style.css?v=e4fa97a46a50',
  './data.js?v=28608ed3a749',
  './js/util.js?v=7e2401382653',
  './js/srs.js?v=e53733a9209a',
  './js/store.js?v=55f3929b4466',
  './js/markdown.js?v=3d63a2f8723c',
  './js/highlight.js?v=2423120f5915',
  './js/search.js?v=637d63925134',
  './js/common.js?v=6f4e61bec521',
  './js/express.js?v=b1edafef6133',
  './js/views-practice.js?v=c1460c8218a2',
  './js/views-resume.js?v=6fa716cb4719',
  './js/views-stats.js?v=9dee46f66ae5',
  './js/views-guides.js?v=6049bce6acfa',
  './js/views-knowledge.js?v=e6f86698973b',
  './js/views-review.js?v=1c250a0740f5',
  './js/app.js?v=b117b71201ea',
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
    caches.open(CACHE_VERSION).then(c => c.match('./data/manifest.json'))
      .then(r => r ? r.json().then(pruneTopicCache) : null)
      .then(() => caches.keys())
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
  const isVersionedShell = /^[0-9a-f]{12}$/.test(url.searchParams.get('v') || '') && /\.(js|css)$/.test(url.pathname);
  const isManifest = url.pathname.endsWith('/data/manifest.json');
  const isData = url.pathname.endsWith('/data.js') || isManifest;
  const isTopicFile = url.pathname.includes('/data/topics/') || url.pathname.includes('/data/assets/');

  if (isNavigate) {
    e.respondWith(networkFirst(req, './index.html'));
  } else if (isVersionedShell) {
    // In particular, never replace a cached versioned data.js with another release.
    e.respondWith(cacheFirst(req, true));
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
    [...Object.values((manifest && manifest.topics) || {}), ...Object.values((manifest && manifest.assets) || {})]
      .map((t) => t && t.file).filter(Boolean));
  if (!live.size) return;
  const cache = await caches.open(TOPIC_CACHE);
  // Retain the previous manifest too: tabs open during an update still use those hashes.
  const manifestKey = new URL('data/cached-manifests.json', self.registration.scope).href;
  const previous = await cache.match(manifestKey);
  let history = [];
  try { if (previous) history = await previous.json(); } catch (_) {}
  if (!history.length) {
    // Upgrade from the old worker, which had no manifest history metadata.
    const shells = (await caches.keys()).filter(k => k.startsWith('shell-') && k !== CACHE_VERSION);
    const previousShell = shells[shells.length - 1];
    if (previousShell) {
      const old = await (await caches.open(previousShell)).match('./data/manifest.json');
      try { if (old) { const mf = await old.json(); history = [[...Object.values(mf.topics || {}), ...Object.values(mf.assets || {})].map(x => x.file)]; } } catch (_) {}
    }
  }
  const current = [...live];
  if (JSON.stringify(history[0]) !== JSON.stringify(current)) history = [current, ...history].slice(0, 2);
  history.flat().forEach(name => live.add(name));
  await cache.put(manifestKey, new Response(JSON.stringify(history), { headers: { 'Content-Type': 'application/json' } }));
  const keys = await cache.keys();
  await Promise.all(keys.map((r) => {
    const name = new URL(r.url).pathname.split('/').pop();
    return name === 'cached-manifests.json' || live.has(name) ? null : cache.delete(r);
  }));
}

async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const fresh = await fetch(req);
    if (!fresh || !fresh.ok) throw Error('HTTP ' + (fresh && fresh.status));
    await cache.put(req, fresh.clone());
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

async function cacheFirst(req, immutable = false) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) {
    if (!immutable) fetch(req).then((fresh) => { if (fresh && fresh.ok) cache.put(req, fresh.clone()); }).catch(() => {});
    return hit;
  }
  const fresh = await fetch(req);
  if (fresh && fresh.ok) await cache.put(req, fresh.clone());
  return fresh;
}

/* 不可变资产专用:与 cacheFirst 的差别是不做后台刷新(哈希文件名已保证新鲜度),
   并且写进独立的 TOPIC_CACHE —— 分片不随 shell 版本整包失效 */
async function cacheFirstImmutable(req) {
  const cache = await caches.open(TOPIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) await cache.put(req, fresh.clone());
  return fresh;
}
