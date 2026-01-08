import type { MetadataRoute } from 'next'

import { NEXT_PUBLIC_SITE_ORIGIN } from '@/src/constant/env'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: NEXT_PUBLIC_SITE_ORIGIN,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ]
}
