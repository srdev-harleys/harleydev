import type { Metadata, Viewport } from 'next';
import './site.css';

const description =
  "Harley's Fine Baking — the ultimate luxury destination for gourmet cakes, speciality coffee and premium confectionery. Home of the Guinness World Record Medovik.";

// The corporate site's own root layout (like app/order): the Odoo portal and docs stay static files under public/.
// Vercel sets VERCEL_PROJECT_PRODUCTION_URL; locally the dev server's port is close enough for previews.
const origin = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : `http://localhost:${process.env.PORT ?? 3000}`;

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "Harley's Fine Baking | Artisan Cakes & Exotic Coffee",
  description,
  icons: { icon: '/assets/favicon.png', apple: '/assets/favicon.png' },
  openGraph: {
    title: "Harley's Fine Baking | Artisan Cakes & Exotic Coffee",
    description,
    siteName: "Harley's Fine Baking",
    type: 'website',
    locale: 'en_IN',
    images: [{ url: '/assets/site/medovik.webp', width: 1200, height: 901, alt: "Harley's Medovik cake" }],
  },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FEFEFA' };

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Montserrat:wght@400;500;600;700&family=Imperial+Script&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
