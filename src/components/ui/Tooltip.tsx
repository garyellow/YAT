import { useState, useRef, useEffect, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Side to prefer. Defaults to "top". */
  side?: "top" | "bottom";
}

export default function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!visible || !tipRef.current) return;
    const rect = tipRef.current.getBoundingClientRect();
    if (side === "top" && rect.top < 4) setFlipped(true);
    else if (side === "bottom" && rect.bottom > window.innerHeight - 4) setFlipped(true);
    else setFlipped(false);
  }, [visible, side]);

  const placement = flipped ? (side === "top" ? "bottom" : "top") : side;

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          ref={tipRef}
          role="tooltip"
          className={`tooltip-bubble ${placement === "top" ? "tooltip-top" : "tooltip-bottom"}`}
        >
          {content}
        </div>
      )}
    </span>
  );
}

/** Small info icon that wraps text in a Tooltip. */
export function HintTip({ text }: { text: string }) {
  return (
    <Tooltip content={text} side="bottom">
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        aria-label={text}
        tabIndex={0}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 11V7.5M8 5.5v-.01" strokeLinecap="round" />
        </svg>
      </button>
    </Tooltip>
  );
}
