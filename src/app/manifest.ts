import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HomeHive — ASU Off-Campus Housing',
    short_name: 'HomeHive',
    description: 'The off-campus housing platform built for ASU students. Verified homes, transparent pricing, zero broker fees.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f4f0',
    theme_color: '#8C1D40',
    icons: [
      {
        src: '/icon.png',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: '/apple-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
    categories: ['real estate', 'housing', 'education'],
    lang: 'en-US',
    dir: 'ltr',
    orientation: 'portrait-primary',
  }
}
