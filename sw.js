const CACHE_NAME = 'chatspace-v1';
const urlsToCache = [
  '/chat-app/',
  '/chat-app/index.html'
];

// インストール
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// アクティベート
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ（オフライン対応）
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// プッシュ通知受信
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'ChatSpace';
  const options = {
    body: data.body || '新しいメッセージがあります',
    icon: '/chat-app/icon-192.png',
    badge: '/chat-app/icon-192.png',
    data: { url: data.url || '/chat-app/' },
    vibrate: [200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知クリック
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/chat-app/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for(const client of clientList) {
        if(client.url === url && 'focus' in client) return client.focus();
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});
