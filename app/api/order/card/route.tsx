import { ImageResponse } from 'next/og';

// GET /api/order/card: the picture WhatsApp, Instagram and SMS show when the /order link is shared.
const size = { width: 1200, height: 630 };

export function GET() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        padding: 72, background: 'linear-gradient(135deg, #cbebf2 0%, #f2f9fb 55%, #f5d1d8 100%)', color: '#0a0a0a' }}>
        <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 14 }}>HARLEY&apos;S</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.05 }}>Custom cakes &amp; bulk orders</div>
          <div style={{ fontSize: 36, color: '#1b5b6a', marginTop: 24 }}>Pick your cake, your day and your outlet. We call you to confirm.</div>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#a83a52', fontWeight: 700 }}>Order online · track every step</div>
      </div>
    ),
    { ...size, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
