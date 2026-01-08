import './globals.css'

import { NEXT_PUBLIC_GA_ID } from '@/src/constant/env'
import { GoogleAnalytics } from '@next/third-parties/google'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://raceball.vercel.app'),
  title: {
    default: '구슬 레이스',
    template: '%s | 구슬 레이스',
  },
  description: '최대 1,000명이 달리는 구슬 레이스예요. 참가자를 설정하고 바로 시작해 보세요.',
  applicationName: '구슬 레이스',
  keywords: [
    '구슬 레이스',
    '마블 레이스',
    'Raceball',
    '레이스 게임',
    '시뮬레이션 게임',
    '브라우저 게임',
    'marble race',
  ],
  alternates: { canonical: 'https://raceball.vercel.app' },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    title: '구슬 레이스',
    description: '최대 1,000명이 달리는 구슬 레이스예요. 참가자를 설정하고 바로 시작해 보세요.',
    url: 'https://raceball.vercel.app',
    siteName: '구슬 레이스',
    locale: 'ko_KR',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: '구슬 레이스 - Raceball',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: '구슬 레이스',
    description: '최대 1,000명이 달리는 구슬 레이스예요. 참가자를 설정하고 바로 시작해 보세요.',
    images: [
      {
        url: '/twitter-image',
        width: 1200,
        height: 630,
        alt: '구슬 레이스 - Raceball',
      },
    ],
  },
  verification: { google: 'JZ0kbF0WToXlhZAnN5ICMCZrtCfSL5EfekX8-NpeU3A' },
}

interface RootLayoutProps {
  children: React.ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        {NEXT_PUBLIC_GA_ID && <GoogleAnalytics gaId={NEXT_PUBLIC_GA_ID} />}
      </body>
    </html>
  )
}
