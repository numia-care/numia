import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Geist, Geist_Mono } from 'next/font/google'

import { KeyboardScrollAssist } from '@/components/keyboard-scroll-assist'
import { SwRegister } from '@/components/sw-register'
import { Toaster } from '@/components/ui/sonner'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
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
  themeColor: '#5A6B4A',
  colorScheme: 'light',
  // Клавиатура сжимает layout, а не перекрывает его (Android/Chrome; iOS
  // Safari директиву игнорирует — там смягчаем через KeyboardScrollAssist
  // и font-size ≥16px на инпутах, чтобы не было автозума).
  interactiveWidget: 'resizes-content',
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
