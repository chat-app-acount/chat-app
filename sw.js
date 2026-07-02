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

// バックグラウンド通知受信
messaging.onBackgroundMessage(payload => {
  const { title, body, icon, roomId } = payload.data || payload.notification || {};
  self.registration.showNotification(title || 'ChatSpace', {
    body: body || '新しいメッセージがあります',
    icon: icon || '/chat-app/icon-192.png',
    badge: '/chat-app/icon-192.png',
    data: { url: '/chat-app/' + (roomId ? '?room=' + roomId : '') },
    vibrate: [200, 100, 200],
    tag: roomId || 'chatspace',
    renotify: true
  });
});

// インストール
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('chatspace-v2').then(c => c.addAll(['/chat-app/', '/chat-app/index.html']))
  );
  self.skipWaiting();
});

// アクティベート
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== 'chatspace-v2').map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// 通知クリック
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/chat-app/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for(const client of list) {
        if(client.url.includes('/chat-app/') && 'focus' in client) {
          client.postMessage({ type: 'NOTIFICATION_CLICK', url });
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
