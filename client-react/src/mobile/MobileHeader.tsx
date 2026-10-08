import type { User } from "../types";

interface Props {
  title: string;
  subtitle?: string;
  user: User | null;
  onAvatarClick: () => void;
  animated?: boolean;
  onSearch?: () => void;
}

export function MobileHeader({
  title,
  subtitle,
  user,
  onAvatarClick,
  animated,
  onSearch,
}: Props) {
  const initial =
    user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?";
  return (
    <header className="m-header">
      <div className="m-header__text">
        <h1
          className={`m-header__title${animated ? " m-header__title--animate" : ""}`}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={`m-header__subtitle${animated ? " m-header__subtitle--animate" : ""}`}
          >
            {subtitle}
          </p>
        )}
      </div>
      {onSearch && (
        <button
          type="button"
          className="m-header__search"
          aria-label="Search tasks"
          onClick={onSearch}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
        </button>
      )}
      <button
        className="m-header__avatar"
        aria-label="Profile and settings"
        onClick={onAvatarClick}
      >
        {initial}
      </button>
    </header>
  );
}
