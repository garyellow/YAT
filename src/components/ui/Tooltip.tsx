import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

const TOOLTIP_VIEWPORT_PADDING = 12;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
}

export default function Tooltip({ content, children, side = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!visible || !tipRef.current || !wrapRef.current) return;

    const tooltip = tipRef.current;
    tooltip.style.left = "50%";

    const rect = tooltip.getBoundingClientRect();

    if (side === "top" && rect.top < TOOLTIP_VIEWPORT_PADDING) {
      setFlipped(true);
    } else if (side === "bottom" && rect.bottom > window.innerHeight - TOOLTIP_VIEWPORT_PADDING) {
      setFlipped(true);
    } else {
      setFlipped(false);
    }

    if (rect.left < TOOLTIP_VIEWPORT_PADDING) {
      const shift = TOOLTIP_VIEWPORT_PADDING - rect.left;
      tooltip.style.left = `calc(50% + ${shift}px)`;
    } else if (rect.right > window.innerWidth - TOOLTIP_VIEWPORT_PADDING) {
      const shift = rect.right - window.innerWidth + TOOLTIP_VIEWPORT_PADDING;
      tooltip.style.left = `calc(50% - ${shift}px)`;
    }
  }, [content, side, visible]);

  const placement = flipped ? (side === "top" ? "bottom" : "top") : side;

  return (
    <span
      ref={wrapRef}
      className="tooltip-anchor"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
    >
      {children}
      {visible ? (
        <div
          ref={tipRef}
          role="tooltip"
          className={`tooltip-bubble ${placement === "top" ? "tooltip-top" : "tooltip-bottom"}`}
        >
          {content}
        </div>
      ) : null}
    </span>
  );
}

export function HintTip({
  text,
  side = "top",
  ariaLabel,
}: {
  text: ReactNode;
  side?: "top" | "bottom";
  ariaLabel?: string;
}) {
  const computedLabel = typeof text === "string"
    ? text
    : ariaLabel ?? "More information";

  return (
    <Tooltip content={text} side={side}>
      <button
        type="button"
        className="hint-tip-btn"
        aria-label={computedLabel}
      >
        <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.1V10.2M8 5.35v.02" strokeLinecap="round" />
        </svg>
      </button>
    </Tooltip>
  );
}
