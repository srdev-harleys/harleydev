import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import './order.css';

const description = 'Custom cakes and bulk orders, confirmed by our team.';

// Its own root layout: the rest of the site is static files under public/.
// metadataBase follows the host the link was opened on, so the WhatsApp preview image resolves on any domain.
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  return {
    metadataBase: new URL(`${h.get('x-forwarded-proto') ?? 'https'}://${host}`),
    title: "Order from Harley's",
    description,
    openGraph: {
      title: "Order a custom cake from Harley's", description, siteName: "Harley's", type: 'website', locale: 'en_IN',
      images: [{ url: '/api/order/card', width: 1200, height: 630, alt: "Order a custom cake from Harley's" }],
    },
    referrer: 'no-referrer', // links out (WhatsApp, harleys.com) don't reveal this site
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#CBEBF2' };

export default function OrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;800&family=Inter:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
