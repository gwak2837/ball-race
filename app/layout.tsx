import './globals.css'

import { NEXT_PUBLIC_GA_ID, NEXT_PUBLIC_SITE_ORIGIN } from '@/src/constant/env'
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE_TEMPLATE, SOCIAL_IMAGE } from '@/src/constant/site'
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
  metadataBase: new URL(NEXT_PUBLIC_SITE_ORIGIN),
  title: {
    default: SITE_NAME,
    template: SITE_TITLE_TEMPLATE,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  alternates: { canonical: NEXT_PUBLIC_SITE_ORIGIN },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: NEXT_PUBLIC_SITE_ORIGIN,
    siteName: SITE_NAME,
    locale: 'ko_KR',
    type: 'website',
    images: [
      {
        url: SOCIAL_IMAGE.ogPath,
        width: SOCIAL_IMAGE.size.width,
        height: SOCIAL_IMAGE.size.height,
        alt: SOCIAL_IMAGE.alt,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: SOCIAL_IMAGE.twitterPath,
        width: SOCIAL_IMAGE.size.width,
        height: SOCIAL_IMAGE.size.height,
        alt: SOCIAL_IMAGE.alt,
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
      <head>
        <meta name="apple-mobile-web-app-title" content="구슬 레이스" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        {NEXT_PUBLIC_GA_ID && <GoogleAnalytics gaId={NEXT_PUBLIC_GA_ID} />}
      </body>
    </html>
  )
}
