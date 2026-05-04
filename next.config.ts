import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Глобальные security headers на все роуты.
        // Обоснованы моделью угроз для уязвимой аудитории (см. CLAUDE.md).
        source: '/(.*)',
        headers: [
          // Запрещаем браузеру угадывать MIME-тип.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Запрещаем встраивать Numia в чужие <iframe>.
          { key: 'X-Frame-Options', value: 'DENY' },
          // При переходах на внешние сайты передаём только origin, не полный URL
          // (URL мог бы содержать ID записи или токен — лишняя утечка).
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // /sw.js специально: всегда свежий, строгий CSP.
        source: '/sw.js',
        headers: [
          // Гарантируем правильный MIME — SW API строго проверяет тип.
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          // Главное: запрещаем кешировать сам SW. Иначе после деплоя
          // юзер с старым SW в кеше не получит обновления.
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          // Жёсткий CSP персонально для SW: запрещаем подгружать внешние скрипты.
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
