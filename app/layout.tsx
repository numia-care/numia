import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import {
  Bitcount_Grid_Single,
  Boldonse,
  Instrument_Sans,
  Inter,
} from 'next/font/google'

import { KeyboardScrollAssist } from '@/components/keyboard-scroll-assist'
import { SwRegister } from '@/components/sw-register'
import { Toaster } from '@/components/ui/sonner'

import './globals.css'

// Шрифты концепции Кая (шаг сведения дизайна, 2026-07-09). Всё через
// next/font — скачиваются на билде и раздаются с нашего origin (требование
// безопасности: никаких сторонних CDN). Cormorant/DM Sans похоронены решением.
//
// Inter — весь UI (в макете SF/Google Sans — «шрифты мака Кая», сведено к
// Inter как основному шрифту самого проработанного экрана «сегодня»).
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'cyrillic'],
})

// Boldonse — display-акцент, ТОЛЬКО «welcome!» на онбординге.
const boldonse = Boldonse({
  variable: '--font-boldonse',
  weight: '400',
  subsets: ['latin'],
})

// Bitcount Grid Single — крупная дата (точный шрифт Кая для дата-пилюли).
const bitcount = Bitcount_Grid_Single({
  variable: '--font-bitcount',
  weight: '400',
  subsets: ['latin'],
})

// Instrument Sans — логотип-леттеринг «✦ numia» на auth-экранах.
const instrument = Instrument_Sans({
  variable: '--font-instrument',
  weight: ['400', '500'],
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Numia',
  description: 'Личный компаньон ✦ для заботы о себе',
  applicationName: 'Numia',
  appleWebApp: {
    capable: true,
    title: 'Numia',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon-180.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#F5F6F0',
  colorScheme: 'light',
  // Клавиатура сжимает layout, а не перекрывает его (Android/Chrome; iOS
  // Safari директиву игнорирует — там смягчаем через KeyboardScrollAssist
  // и font-size ≥16px на инпутах, чтобы не было автозума).
  interactiveWidget: 'resizes-content',
  // viewport-fit=cover — БЕЗ него iOS отдаёт env(safe-area-inset-*) нулями,
  // и все calc() с ними молча схлопываются до константной части. Именно из-за
  // этого нижний бар навигации ложился на home-indicator, хотя
  // env(safe-area-inset-bottom) в нём уже был (bottom-nav.tsx, (app)/layout.tsx).
  viewportFit: 'cover',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${boldonse.variable} ${bitcount.variable} ${instrument.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider messages={messages}>
          {children}
          {/* Внутри intl-провайдера: баннер обновления использует переводы. */}
          <SwRegister />
        </NextIntlClientProvider>
        <KeyboardScrollAssist />
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
