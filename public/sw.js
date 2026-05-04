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
