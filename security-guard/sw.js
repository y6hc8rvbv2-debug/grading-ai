// 守りダッシュボード サービスワーカー
// 「共有」で届いた内容は、ここでURLの # 以降に移し替える。
// # 以降はサーバーに送られないので、届いたメッセージの中身が外に出ない。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin && url.pathname === '/share') {
    const p = new URLSearchParams();
    for (const k of ['title', 'text', 'url']) { const v = url.searchParams.get(k); if (v) p.set(k, v); }
    e.respondWith(Response.redirect('/#' + p.toString(), 303));
  }
});

// 通知をタップしたらアプリを前面に出す
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('/'))));
});
