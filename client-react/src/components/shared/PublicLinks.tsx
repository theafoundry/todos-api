import "./public-links.css";

export function PublicLinks() {
  return (
    <nav className="pw-public-links" aria-label="Help and policies">
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/support">Support</a>
    </nav>
  );
}
