import { useEffect, useState } from "react";
import "./landing.css";
import { BrandMark } from "../components/ui/BrandMark";
import { usePublicTheme } from "../styles/publicTheme";

// Matches the landing's narrow breakpoint in landing.css.
const NARROW_MEDIA = "(max-width: 639px)";

const HERO_DESKTOP = "/images/landing/hero-desktop.png";
const HERO_MOBILE_LIGHT = "/images/landing/hero-mobile-light.png";
const HERO_MOBILE_DARK = "/images/landing/hero-mobile-dark.png";
const MOBILE_SHOT_WIDTH = 390;
const MOBILE_SHOT_HEIGHT = 844;

/**
 * Tracks NARROW_MEDIA so alt text describes whichever screenshot the
 * <picture> actually shows (desktop dashboard vs. mobile Today view).
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(NARROW_MEDIA).matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_MEDIA);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return narrow;
}

// ─── Icons ───────────────────────────────────────────────────────────

function IconLightning() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" />
    </svg>
  );
}

function IconCapture() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </svg>
  );
}

function IconReview() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconAI() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function IconProjects() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconFocus() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function IconDesk() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}

function IconKeyboard() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M6 8h.001" />
      <path d="M10 8h.001" />
      <path d="M14 8h.001" />
      <path d="M18 8h.001" />
      <path d="M8 12h.001" />
      <path d="M12 12h.001" />
      <path d="M16 12h.001" />
      <path d="M7 16h10" />
    </svg>
  );
}

function IconDarkMode() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────

function LandingNav() {
  return (
    <header className="landing-nav">
      <nav className="landing-nav__inner" aria-label="Primary">
        <a href="/" className="landing-nav__logo" aria-label="Planwren home">
          <BrandMark size={28} />
          <span className="landing-nav__wordmark">Planwren</span>
        </a>
        <div className="landing-nav__links">
          <a
            href="#landing-features"
            className="landing-nav__link landing-nav__link--features"
          >
            Features
          </a>
          <a href="/auth?next=%2Fapp&tab=login" className="landing-nav__link">
            Log in
          </a>
          <a href="/auth?next=%2Fapp&tab=register" className="landing-nav__cta">
            Start for free
          </a>
        </div>
      </nav>
    </header>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────

interface ArtProps {
  dark: boolean;
  narrow: boolean;
}

function HeroSection({ dark, narrow }: ArtProps) {
  return (
    <section className="landing-hero" aria-labelledby="landing-hero-title">
      <div className="landing-section__inner">
        <div className="landing-hero__intro">
          <div className="landing-hero__lede">
            <p className="landing-eyebrow">Planning workspace</p>
            <h1 id="landing-hero-title" className="landing-hero__title">
              Plan your days. Review your&nbsp;weeks.{" "}
              <span className="landing-hero__title-accent">
                Focus on what&nbsp;matters.
              </span>
            </h1>
          </div>
          <div className="landing-hero__aside">
            <p className="landing-hero__sub">
              Capture anything, let AI organize it, and wake up to a plan that
              fits your energy, your calendar, and your goals. A calm workspace,
              not another dashboard.
            </p>
            <div className="landing-hero__ctas">
              <a
                href="/auth?next=%2Fapp&tab=register"
                className="landing-btn landing-btn--primary"
              >
                Start for free
              </a>
              <a
                href="#landing-features"
                className="landing-btn landing-btn--secondary"
              >
                See features
              </a>
            </div>
          </div>
        </div>
        <figure className="landing-hero__screenshot">
          <picture className="landing-hero__picture">
            {/* Mobile art follows the effective public theme, not just
                prefers-color-scheme, so a saved preference wins. */}
            <source
              media={NARROW_MEDIA}
              srcSet={dark ? HERO_MOBILE_DARK : HERO_MOBILE_LIGHT}
              width={MOBILE_SHOT_WIDTH}
              height={MOBILE_SHOT_HEIGHT}
            />
            <img
              src={HERO_DESKTOP}
              alt={
                narrow
                  ? "Mobile Today view with a list of tasks"
                  : "Planning workspace with home dashboard, projects, and AI-curated focus"
              }
              className="landing-hero__img"
              loading="eager"
            />
          </picture>
        </figure>
      </div>
    </section>
  );
}

// ─── Features ────────────────────────────────────────────────────────

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <li className="landing-feature-card">
      <div className="landing-feature-card__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </li>
  );
}

function FeaturesSection() {
  return (
    <section
      id="landing-features"
      className="landing-features"
      aria-labelledby="landing-features-title"
    >
      <div className="landing-section__inner">
        <div className="landing-section__header">
          <p className="landing-eyebrow">Features</p>
          <h2 id="landing-features-title" className="landing-section__heading">
            A planning workspace that works the way you think
          </h2>
        </div>
        <ul className="landing-features-grid">
          <FeatureCard
            icon={<IconLightning />}
            title="A daily plan that balances priorities and deadlines"
            description="AI generates a time-boxed daily plan based on your priorities, energy level, and deadlines. Review it, adjust it, and start working — no busywork."
          />
          <FeatureCard
            icon={<IconCapture />}
            title="Capture anything, organize later"
            description='Drop tasks, ideas, and notes onto your desk. Organize them when you&apos;re ready, or type naturally — "Call dentist tomorrow 2pm" — and the date is set automatically.'
          />
          <FeatureCard
            icon={<IconReview />}
            title="Review your week, stay honest"
            description="A structured weekly review surfaces stale tasks, missing next actions, and forgotten commitments. One click to clean up and re-prioritize."
          />
          <FeatureCard
            icon={<IconAI />}
            title="Your AI assistant already knows your tasks"
            description='Connect Claude or ChatGPT and manage tasks through conversation. "What should I work on?" or "Plan my day" — your assistant has full context.'
          />
        </ul>
      </div>
    </section>
  );
}

// ─── Capabilities ────────────────────────────────────────────────────

interface CapabilityCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  wide?: boolean;
  image?: string;
  imageAlt?: string;
  /** Portrait phone screenshot shown below NARROW_MEDIA instead of `image`. */
  mobileImage?: string;
  mobileImageAlt?: string;
  narrow?: boolean;
}

function CapabilityCard({
  icon,
  title,
  description,
  wide,
  image,
  imageAlt,
  mobileImage,
  mobileImageAlt,
  narrow,
}: CapabilityCardProps) {
  const desktopAlt = imageAlt ?? title;
  const img = image ? (
    <img
      src={image}
      alt={mobileImage && narrow ? (mobileImageAlt ?? desktopAlt) : desktopAlt}
      className="landing-card__img"
      loading="lazy"
    />
  ) : null;

  return (
    <li className={`landing-card${wide ? " landing-card--wide" : ""}`}>
      <div className="landing-card__body">
        <div className="landing-card__icon">{icon}</div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {img && mobileImage ? (
        <picture className="landing-card__picture">
          <source
            media={NARROW_MEDIA}
            srcSet={mobileImage}
            width={MOBILE_SHOT_WIDTH}
            height={MOBILE_SHOT_HEIGHT}
          />
          {img}
        </picture>
      ) : (
        img
      )}
    </li>
  );
}

function CapabilitiesSection({ narrow }: Pick<ArtProps, "narrow">) {
  return (
    <section
      className="landing-capabilities"
      aria-labelledby="landing-capabilities-title"
    >
      <div className="landing-section__inner">
        <div className="landing-section__header">
          <p className="landing-eyebrow">Capabilities</p>
          <h2
            id="landing-capabilities-title"
            className="landing-section__heading"
          >
            Built for real workflows
          </h2>
        </div>
        <ul className="landing-grid">
          <CapabilityCard
            icon={<IconProjects />}
            title="Projects & Areas"
            description="Organize tasks into projects with headings. Group projects by area for life/work balance."
          />
          <CapabilityCard
            icon={<IconSearch />}
            title="Filters & Views"
            description="Today, Upcoming, Completed views. Filter by project, priority, and status. Command palette for instant navigation."
          />
          <CapabilityCard
            icon={<IconFocus />}
            title="Focus Dashboard"
            description="AI-powered focus suggestions, due soon alerts, quick wins, and projects that need attention."
          />
          <CapabilityCard
            icon={<IconDesk />}
            title="Desk"
            description="Capture ideas fast. New items land on your desk until you're ready to organize them."
          />
          <CapabilityCard
            icon={<IconKeyboard />}
            title="Keyboard First"
            description="Command palette (Ctrl+K), keyboard shortcuts for every action, and quick entry without touching the mouse."
          />
          <CapabilityCard
            icon={<IconDarkMode />}
            title="Dark Mode"
            description="Full dark mode support. Automatic theme detection or manual toggle. Easy on the eyes, day or night."
            wide
            image="/images/landing/dark-mode.png"
            imageAlt="Planning workspace in dark mode"
            mobileImage={HERO_MOBILE_DARK}
            mobileImageAlt="Mobile Today view in dark mode"
            narrow={narrow}
          />
        </ul>
      </div>
    </section>
  );
}

// ─── Final CTA ───────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section
      className="landing-cta-section"
      aria-labelledby="landing-cta-title"
    >
      <div className="landing-section__inner">
        <div className="landing-cta-panel">
          <BrandMark size={40} className="landing-cta-panel__mark" />
          <h2 id="landing-cta-title" className="landing-section__heading">
            Get started — it&apos;s&nbsp;free
          </h2>
          <p className="landing-cta-section__sub">
            No credit card required. Start planning in seconds.
          </p>
          <a
            href="/auth?next=%2Fapp&tab=register"
            className="landing-btn landing-btn--primary"
          >
            Create free account
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-section__inner landing-footer__inner">
        <BrandMark size={20} />
        <span className="landing-footer__copy">
          © {new Date().getFullYear()} Planwren. Built for focused work.
        </span>
      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export function LandingPage() {
  const dark = usePublicTheme();
  const narrow = useNarrowViewport();

  return (
    <div className="landing-page">
      <a href="#landing-main" className="pw-skip-link">
        Skip to content
      </a>
      <LandingNav />
      <main id="landing-main">
        <HeroSection dark={dark} narrow={narrow} />
        <FeaturesSection />
        <CapabilitiesSection narrow={narrow} />
        <CtaSection />
      </main>
      <LandingFooter />
    </div>
  );
}
