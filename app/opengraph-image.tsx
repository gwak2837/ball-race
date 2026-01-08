import { ImageResponse } from 'next/og'

import { NEXT_PUBLIC_SITE_ORIGIN } from '@/src/constant/env'
import { SOCIAL_IMAGE } from '@/src/constant/site'

export const runtime = 'edge'
export const alt = SOCIAL_IMAGE.alt
export const size = SOCIAL_IMAGE.size
export const contentType = 'image/png'

export default function OpenGraphImage() {
  const siteHost = new URL(NEXT_PUBLIC_SITE_ORIGIN).host

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#09090b',
        color: '#fafafa',
      }}
    >
      <div
        style={{
          width: 1040,
          height: 470,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 56,
          borderRadius: 48,
          background: 'rgba(255, 255, 255, 0.04)',
          border: '1px solid rgba(255, 255, 255, 0.10)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -1.2 }}>{SOCIAL_IMAGE.title}</div>
          <div style={{ fontSize: 28, color: 'rgba(250,250,250,0.75)', lineHeight: 1.35 }}>{SOCIAL_IMAGE.subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 22, color: 'rgba(250,250,250,0.6)' }}>{siteHost}</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'rgba(250,250,250,0.9)' }}>{SOCIAL_IMAGE.brand}</div>
        </div>
      </div>
    </div>,
    size,
  )
}
