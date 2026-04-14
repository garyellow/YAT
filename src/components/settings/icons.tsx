import appTitleImageSrc from "../../../src-tauri/icons/128x128.png";
import type { SettingsTab } from "./tabs";

interface IconProps {
  className?: string;
}

export function AppTitleImage({ className = "h-12 w-12" }: IconProps) {
  return (
    <img
      src={appTitleImageSrc}
      alt=""
      aria-hidden="true"
      width="48"
      height="48"
      className={className}
      loading="eager"
      decoding="async"
    />
  );
}

export function SettingsTabIcon({
  name,
  className = "h-4 w-4",
}: IconProps & { name: SettingsTab }) {
  switch (name) {
    case "overview":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 5.5h16M4 12h16M4 18.5h10" strokeLinecap="round" />
        </svg>
      );
    case "general":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            d="M12 3.75v2.5m0 11.5v2.5m8.25-8.25h-2.5M6.25 12h-2.5m12.1-5.85-1.77 1.77M7.92 16.08l-1.77 1.77m9.7 0-1.77-1.77M7.92 7.92 6.15 6.15"
            strokeLinecap="round"
          />
          <circle cx="12" cy="12" r="3.35" />
        </svg>
      );
    case "stt":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <rect x="9" y="3.25" width="6" height="10.5" rx="3" />
          <path
            d="M6.25 11.25v1a5.75 5.75 0 0 0 11.5 0v-1M12 18v2.5M8.75 20.5h6.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "llm":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M12 3.5 14 8l4.5 2-4.5 2-2 4.5-2-4.5L5.5 10 10 8 12 3.5Z" />
        </svg>
      );
    case "prompt":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M5.25 6.5h13.5v9.5H9.5l-4.25 3.5V6.5Z" strokeLinejoin="round" />
          <path d="M8.25 10h7.5M8.25 13h5.5" strokeLinecap="round" />
        </svg>
      );
    case "vocabulary":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path
            d="M6 5.5h8.75a3.25 3.25 0 0 1 3.25 3.25V18.5H9.25A3.25 3.25 0 0 0 6 21.75V5.5Z"
            strokeLinejoin="round"
          />
          <path d="M6 5.5v13A3.25 3.25 0 0 1 9.25 15.25H18" strokeLinecap="round" />
        </svg>
      );
    case "history":
      return (
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 24 24"
          className={className}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M12 6.25v6l3.75 2.25" strokeLinecap="round" />
          <path d="M4.75 12a7.25 7.25 0 1 0 2.12-5.13" strokeLinecap="round" />
          <path d="M4.75 4.75v3.5h3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}
