/* AI 面试学习站 Service Worker
 * 策略:
 *  - 导航请求(index.html):网络优先,失败回退缓存 —— 保证入口最新;
 *  - 静态资源(css/js/图标):缓存优先,后台更新 —— 秒开;
 *  - data.js:网络优先,失败回退缓存 —— 题库更新及时生效,断网也能学。
 * CACHE_VERSION 由 tools/build.py 按内容哈希自动盖章,数据一变缓存名即变。
 */
'use strict';
const CACHE_VERSION = 'shell-0d53ae8e5644';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './data.js',
  './js/util.js',
  './js/store.js',
  './js/markdown.js',
  './js/search.js',
  './js/common.js',
  './js/views-practice.js',
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
  if (url.origin !== self.location.origin) return; // 只管同源

  const isNavigate = req.mode === 'navigate';
  const isData = url.pathname.endsWith('/data.js');

  if (isNavigate) {
    e.respondWith(networkFirst(req, './index.html'));
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
    // 后台静默更新,不阻塞响应
    fetch(req).then((fresh) => { if (fresh && fresh.ok) cache.put(req, fresh.clone()); }).catch(() => {});
    return hit;
  }
  const fresh = await fetch(req);
  if (fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}
