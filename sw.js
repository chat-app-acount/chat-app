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

const CACHE = 'chatspace-v3';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチはキャッシュしない（Firestoreの接続問題を避けるため）
self.addEventListener('fetch', e => {
  // chrome-extensionやFirestoreのリクエストは無視
  if(e.request.url.startsWith('chrome-extension://')) return;
  if(e.request.url.includes('firestore.googleapis.com')) return;
  if(e.request.url.includes('firebase')) return;
  // 通常のページのみフォールバック
  if(e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() =>
        caches.match('/chat-app/index.html')
      )
    );
  }
});

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
