import type { MetadataRoute } from 'next'

import { NEXT_PUBLIC_SITE_ORIGIN } from '@/src/constant/env'

export default function robots(): MetadataRoute.Robots {
  const isProd = process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === 'production'
    : process.env.NODE_ENV === 'production'

  return {
    rules: isProd ? [{ userAgent: '*', allow: '/' }] : [{ userAgent: '*', disallow: '/' }],
    sitemap: `${NEXT_PUBLIC_SITE_ORIGIN}/sitemap.xml`,
  }
}
