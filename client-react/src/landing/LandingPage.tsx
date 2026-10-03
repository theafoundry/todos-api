import "./landing.css";
import { BrandMark } from "../components/ui/BrandMark";

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
    <nav className="landing-nav">
      <div className="landing-nav__inner">
        <a href="/" className="landing-nav__logo">
          <BrandMark size={28} />
          <span>Planwren</span>
        </a>
        <div className="landing-nav__links">
          <a href="#landing-features" className="landing-nav__link">
            Features
          </a>
          <a href="/auth?next=%2Fapp&tab=login" className="landing-nav__link">
            Log in
          </a>
          <a href="/auth?next=%2Fapp&tab=register" className="landing-nav__cta">
            Start for free
          </a>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="landing-hero">
      <div className="landing-section__inner">
        <h1 className="landing-hero__title">
          Plan your days. Review your&nbsp;weeks. Focus on what&nbsp;matters.
        </h1>
        <p className="landing-hero__sub">
          Capture anything, let AI organize it, and wake up to a plan that fits
          your energy, your calendar, and your goals. A calm workspace, not
          another dashboard.
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
        <div className="landing-hero__screenshot">
          <img
            src="/images/landing/hero-desktop.png"
            alt="Planning workspace with home dashboard, projects, and AI-curated focus"
            className="landing-hero__img"
            loading="eager"
          />
        </div>
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
    <div className="landing-feature-card">
      <div className="landing-feature-card__icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function FeaturesSection() {
  return (
    <section id="landing-features" className="landing-features">
      <div className="landing-section__inner">
        <h2 className="landing-section__heading">
          A planning workspace that works the way you think
        </h2>
        <div className="landing-features-grid">
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
        </div>
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
}

function CapabilityCard({
  icon,
  title,
  description,
  wide,
  image,
  imageAlt,
}: CapabilityCardProps) {
  return (
    <div className={`landing-card${wide ? " landing-card--wide" : ""}`}>
      <div className="landing-card__icon">{icon}</div>
      <h4>{title}</h4>
      <p>{description}</p>
      {image && (
        <img
          src={image}
          alt={imageAlt ?? title}
          className="landing-card__img"
          loading="lazy"
        />
      )}
    </div>
  );
}

function CapabilitiesSection() {
  return (
    <section className="landing-capabilities">
      <div className="landing-section__inner">
        <h2 className="landing-section__heading">Built for real workflows</h2>
        <div className="landing-grid">
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
          />
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ───────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="landing-cta-section">
      <div className="landing-section__inner">
        <h2 className="landing-section__heading">
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
    </section>
  );
}

// ─── Footer ──────────────────────────────────────────────────────────

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-section__inner">
        <span className="landing-footer__copy">
          © {new Date().getFullYear()} Planwren. Built for focused work.
        </span>
      </div>
    </footer>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="landing-page">
      <LandingNav />
      <HeroSection />
      <FeaturesSection />
      <CapabilitiesSection />
      <CtaSection />
      <LandingFooter />
    </div>
  );
}
