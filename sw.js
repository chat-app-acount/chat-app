importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDq8dDcnA2JHC3Xi7seXFIkidwmHoI7Ihg",
  authDomain: "chat-app-44d95.firebaseapp.com",
  projectId: "chat-app-44d95",
  storageBucket: "chat-app-44d95.firebasestorage.app",
  messagingSenderId: "689926338538",
  appId: "1:689926338538:web:33281528795be00371a493"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const data = payload.data || payload.notification || {};
  self.registration.showNotification(data.title || 'ChatSpace', {
    body: data.body || '新しいメッセージがあります',
    icon: '/chat-app/icon-192.png',
    badge: '/chat-app/icon-192.png',
    data: { url: '/chat-app/' + (data.roomId ? '?room=' + data.roomId : '') },
    vibrate: [200, 100, 200],
    tag: data.roomId || 'chatspace',
    renotify: true
  });
});

// v4: 古いキャッシュを必ず消し、ページは常にネットワーク優先で取得する
const CACHE = 'chatspace-v4';
const SHELL = ['/chat-app/', '/chat-app/index.html', '/chat-app/manifest.json', '/chat-app/icon-192.png', '/chat-app/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase など外部通信には触れない
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/chat-app/index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/chat-app/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/chat-app/') && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', url });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
