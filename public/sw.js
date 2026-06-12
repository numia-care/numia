// Версия кеша. Менять (v1 → v2 → ...) при изменении PRECACHE_URLS или стратегии —
// иначе старый SW продолжит обслуживать старый кеш у уже установивших.
const CACHE_VERSION = 'numia-v1'

// Что прекешим на install. Минимум: главные страницы + manifest + основные иконки.
const PRECACHE_URLS = [
  '/',
  '/login',
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon-180.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE_URLS)),
  )
  // TODO: для прода переделать update flow на вежливый — postMessage клиентам
  // что готов новый SW, показать тост "новая версия, перезагрузить?", и только
  // по подтверждению вызывать skipWaiting(). Сейчас (MVP) активируемся сразу,
  // что норм пока приложение почти не используется. Когда юзеры реально начнут
  // что-то писать в формы — резкий перехват может потерять введённое.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Удаляем все старые версии кеша.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  // См. TODO выше — clients.claim() сразу перехватывает уже открытые вкладки.
  self.clients.claim()
})

// ─── Push ──────────────────────────────────────────────────────────────────
//
// Принципиально нейтральный текст — без названий препаратов, доз, врем.
// Модель угроз CLAUDE.md: «текст пуша никогда не содержит конкретику».
// Юзер видит «напоминание ✦» на залочённом экране → открывает PWA → внутри
// уже видит что именно принять и когда. Защищает от прохожих и случайных
// взглядов на телефон.
//
// payload приходит от сервера и МОЖЕТ содержать данные — но мы их игнорим
// для текста уведомления, используем только для роутинга (data.url) или
// группировки (data.tag) если понадобится.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    if (event.data) data = event.data.json()
  } catch {
    // payload не JSON — продолжаем с дефолтами
  }

  const title = 'напоминание ✦'
  const options = {
    body: 'пора',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    // tag — браузер схлопывает множественные пуши с одним tag в одну плашку.
    // Если пришло несколько напоминалок подряд — не спамим.
    tag: data.tag || 'numia-reminder',
    // url для notificationclick — куда открыть. Default = главная трекера.
    data: { url: data.url || '/tracker' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = event.notification.data?.url || '/tracker'
  // Открываем существующую вкладку PWA если она есть; иначе — новое окно.
  // Без этого тап на пуш открыл бы вторую копию приложения каждый раз.
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          // Если открыта любая страница приложения — фокусим её и редиректим
          if ('focus' in client) {
            client.navigate(targetUrl)
            return client.focus()
          }
        }
        // Не открыто ничего — новое окно
        return self.clients.openWindow(targetUrl)
      }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Только GET. POST/PUT/DELETE пропускаем — кешировать запись бессмысленно.
  if (request.method !== 'GET') return

  // Только same-origin. Запросы к Supabase и другим origin не трогаем —
  // пусть Supabase-клиент сам решает, у него своя retry-логика.
  if (new URL(request.url).origin !== self.location.origin) return

  // Стратегия для HTML-навигаций: network-first.
  // Свежий контент в приоритете; если сети нет — отдаём кеш, потом /offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match('/offline')),
        ),
    )
    return
  }

  // Статика (иконки, manifest, прочие GET same-origin): cache-first.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request)),
  )
})
