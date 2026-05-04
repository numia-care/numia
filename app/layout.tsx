import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SwRegister } from '@/components/sw-register'

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
  // appleWebApp — управляет тем как PWA выглядит на iOS:
  // capable=true → standalone-режим без браузерных контролов,
  // statusBarStyle 'default' → системный status bar поверх нашего фона.
  appleWebApp: {
    capable: true,
    title: 'Numia',
    statusBarStyle: 'default',
  },
  // Манифест Next.js подключает автоматически из app/manifest.ts.
  // Иконки тут — для favicon и apple-touch-icon (manifest.json иконки тоже работают,
  // но Apple читает только из <link rel="apple-touch-icon">).
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon-180.png',
  },
}

// themeColor в Next.js 14+ переехал из metadata в отдельный viewport export.
// Управляет цветом status bar в установленной PWA (Android).
export const viewport: Viewport = {
  themeColor: '#5A6B4A',
  colorScheme: 'light',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SwRegister />
      </body>
    </html>
  )
}
