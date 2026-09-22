/* AI 面试学习站 Service Worker
 * 策略:
 *  - 导航请求(index.html):网络优先,失败回退缓存 —— 保证入口最新;
 *  - 静态资源(css/js/图标):缓存优先,后台更新 —— 秒开;
 *  - data.js 与 data/manifest.json:网络优先,失败回退缓存 —— 题库入口更新及时生效,断网也能学;
 *  - data/topics/*.json(题库分片):缓存优先、不回源刷新 —— 文件名带内容哈希,
 *    内容一变文件名就变,旧文件不可能被错误复用(不可变资产按内容寻址)。
 *    分片不进预缓存(20 片 10MB 会让 SW 安装变慢、流量翻倍):首次在线访问时由
 *    应用按需拉取并写入运行时缓存,之后断网照常可用。
 * CACHE_VERSION 由 tools/build.py 按内容哈希自动盖章,数据一变缓存名即变。
 */
'use strict';
const CACHE_VERSION = 'shell-c367b9ab254e';
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
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
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
  const isData = url.pathname.endsWith('/data.js') || url.pathname.endsWith('/data/manifest.json');
  const isTopicFile = url.pathname.includes('/data/topics/');

  if (isNavigate) {
    e.respondWith(networkFirst(req, './index.html'));
  } else if (isTopicFile) {
    /* 分片不可变:命中即返回,不发起后台刷新 —— 省流量,也避免老 SW 缓存
       缺分片时每片都打出一次注定失败的回源请求。 */
    e.respondWith(cacheFirstImmutable(req));
  } else if (isData) {
    e.respondWith(networkFirst(req));
  } else {
    e.respondWith(cacheFirst(req));
  }
});

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

/* 不可变资产专用:与 cacheFirst 的差别是不做后台刷新(哈希文件名已保证新鲜度) */
async function cacheFirstImmutable(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}
