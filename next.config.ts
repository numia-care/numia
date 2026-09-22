import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  // Самодостаточная сборка для Docker: next build кладёт в .next/standalone
  // минимальный server.js со всеми нужными файлами, без полного node_modules.
  // Запуск — `node server.js`, порт и хост через PORT / HOSTNAME.
  // (docs: 01-app/03-api-reference/05-config/01-next-config-js/output.md)
  // На Vercel игнорируется, там своя упаковка — веб-деплой не меняется.
  output: 'standalone',

  // Swagger UI (/api/docs) читает файлы пакета swagger-ui-dist с диска в
  // рантайме. Трассировка их не видит — путь собирается строкой, — и без этой
  // строки в standalone-образ они не попадут. Ключ — путь маршрута.
  outputFileTracingIncludes: {
    '/api/docs/*': [
      './node_modules/swagger-ui-dist/swagger-ui.css',
      './node_modules/swagger-ui-dist/swagger-ui-bundle.js',
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
