import type { MetadataRoute } from 'next'

import { SITE_NAME, SITE_SHORT_NAME } from '@/src/constant/site'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_SHORT_NAME,
    icons: [
      {
        src: '/web-app-manifest-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/web-app-manifest-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    theme_color: '#ffffff',
    background_color: '#ffffff',
    display: 'standalone',
  }
}
