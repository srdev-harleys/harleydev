import { getCities } from '@/lib/site-data';
import { CITIES } from '@/lib/outlets';
import { Parcel, SiteNav } from './site-nav';

// The public landing page: custom & bulk ordering plus the cities Harley's is in (outlet details
// live on harleys.com). Rebuilt at most hourly; the Odoo outlet list is cached for the same hour.
export const revalidate = 3600;

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="arrow">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export default async function HomePage() {
  // cities with a walk-in outlet in Odoo; the full list if Odoo can't be reached
  const live = await getCities();
  const cities = live.length > 0 ? live : CITIES;
  const year = new Date().getFullYear();

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteNav />

      <main id="main">
        {/* ---------- HERO ---------- */}
        <section className="hero" id="top">
          <div className="hero__copy">
            <span className="eyebrow">Since 1983 · Artisan Cakes &amp; Cacao Atelier</span>
            <h1>
              The ultimate luxury destination for <em>gourmet cakes</em>, speciality coffee and premium confectionery.
            </h1>
            <p className="lede">
              Harley&apos;s is where indulgence meets innovation. Proudly crafted in India, poised to captivate the world.
            </p>

            <div className="order-card">
              <div className="order-card__text">
                <span className="order-card__tag">Order online</span>
                <strong>Custom cakes &amp; bulk orders</strong>
                <p>Birthdays, weddings, office celebrations and gifting — our team confirms every detail before we bake.</p>
              </div>
              <a href="/order" className="btn btn--rose btn--lg">
                Order custom / bulk <Arrow />
              </a>
            </div>
            <p className="order-note">
              Online ordering is only for custom cakes and bulk orders. For everyday treats, visit a Harley's outlet near you.
            </p>

            <div className="hero__actions">
              <a href="/order/track" className="btn btn--ghost btn--track">
                <Parcel /> Track your order
              </a>
              <a href="#locations" className="btn btn--ghost">
                Our cities
              </a>
            </div>
          </div>
          <div className="hero__media">
            <img src="/assets/site/medovik.webp" alt="Harley's signature Medovik cake with a macaron" width={1200} height={901} />
            <div className="hero__badge">
              <span className="script">Guinness</span>
              World Record Holder
            </div>
          </div>
        </section>

        {/* ---------- CITIES ---------- */}
        <section className="section cities" id="locations">
          <div className="head">
            <span className="eyebrow">Find us</span>
            <h2>Harley&apos;s in your city</h2>
            <p className="lede">Visit a Harley&apos;s Ivory Lounge or Express Outlet in any of these cities.</p>
          </div>
          <ul className="cities__grid">
            {cities.map((c) => (
              <li key={c.key} className="city">
                <img src={c.image} alt="" loading="lazy" />
                <span>{c.name}</span>
              </li>
            ))}
          </ul>
          <a href="https://harleys.com" className="btn btn--dark cities__more" target="_blank" rel="noopener noreferrer">
            See all outlets on harleys.com <Arrow />
          </a>
        </section>
      </main>

      {/* ---------- FOOTER ---------- */}
      <footer className="footer">
        <div className="footer__row">
          <div className="footer__brand">
            <img src="/assets/site/logo-white.png" alt="Harley's Fine Baking" width={88} height={80} />
            <p>Artisan cakes &amp; exotic coffee. Harley&apos;s is Happiness.</p>
          </div>
          <div className="footer__main">
            <a href="https://harleys.com" className="btn btn--light" target="_blank" rel="noopener noreferrer">
              Visit harleys.com <Arrow />
            </a>
          </div>
        </div>
        <div className="footer__base">
          <span>© {year} Harley&apos;s Fine Baking. All rights reserved.</span>
          <a href="https://harleys.com" target="_blank" rel="noopener noreferrer">
            harleys.com
          </a>
        </div>
      </footer>
    </>
  );
}
