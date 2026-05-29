import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const alt = 'HomeHive — Off-Campus Housing Near ASU Tempe'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #8C1D40 0%, #6b1530 50%, #4a0f22 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
        {/* Subtle grid pattern */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.06) 1px, transparent 0)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Honeycomb accent top-right */}
        <div
          style={{
            position: 'absolute',
            top: -60,
            right: -60,
            width: 320,
            height: 320,
            borderRadius: '50%',
            background: 'rgba(255, 198, 39, 0.12)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: -40,
            left: -40,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background: 'rgba(255, 198, 39, 0.08)',
          }}
        />

        {/* Logo + name row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            marginBottom: '28px',
          }}
        >
          {/* Hexagon icon */}
          <div
            style={{
              width: 72,
              height: 72,
              background: '#FFC627',
              borderRadius: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '38px',
            }}
          >
            🏠
          </div>
          <span
            style={{
              fontSize: '52px',
              fontWeight: '800',
              color: '#ffffff',
              letterSpacing: '-1px',
            }}
          >
            HomeHive
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: '28px',
            fontWeight: '500',
            color: 'rgba(255, 255, 255, 0.88)',
            textAlign: 'center',
            maxWidth: '760px',
            lineHeight: 1.3,
            marginBottom: '36px',
          }}
        >
          #1 Off-Campus Housing for ASU Students in Tempe
        </div>

        {/* Pill badges */}
        <div style={{ display: 'flex', gap: '14px' }}>
          {['Verified Listings', 'No Broker Fees', 'Free for Students'].map((label) => (
            <div
              key={label}
              style={{
                padding: '10px 22px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.25)',
                fontSize: '18px',
                fontWeight: '600',
                color: '#ffffff',
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {/* Bottom URL */}
        <div
          style={{
            position: 'absolute',
            bottom: '28px',
            fontSize: '16px',
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.5px',
          }}
        >
          homehive.live
        </div>
      </div>
    ),
    size
  )
}
