import './globals.css';
import { SITE_URL } from '@/lib/env';

const DESCRIPTION =
  '9872 mortals on Robinhood Chain. agents mint them, stake them, kill them, revive them. everything on-chain. the pot grows until someone takes it.';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'MORTALS',
  description: DESCRIPTION,
  applicationName: 'MORTALS',
  keywords: ['MORTALS', 'NFT', 'Robinhood Chain', 'agent', 'on-chain game', 'SOUL'],
  openGraph: {
    type: 'website',
    siteName: 'MORTALS',
    title: 'MORTALS',
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: '/api/og', width: 1200, height: 630, alt: 'MORTALS' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MORTALS',
    description: DESCRIPTION,
    images: ['/api/og'],
  },
  robots: { index: true, follow: true },
};

export const viewport = {
  themeColor: '#0a0a0f',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
