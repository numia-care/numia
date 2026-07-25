import type { MetadataRoute } from 'next'

// PWA manifest. Next.js отдаёт его на /manifest.webmanifest.
//
// Описание (description) видно в системном install-prompt — должно быть
// нейтральным, без упоминания ЗГТ/трансперехода (модель угроз: устройство
// может быть в чужих руках, install-prompt видит кто угодно).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Numia',
    short_name: 'Numia',
    description: 'Личный компаньон ✦ для заботы о себе',
    lang: 'ru',
    dir: 'ltr',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F5F6F0',
    theme_color: '#F5F6F0',
    categories: ['health', 'lifestyle'],
    // TODO: добавить screenshots после готового UI трекера (этап 1+)
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
