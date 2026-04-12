interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
}

export default function Toggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
  ariaLabelledBy,
}: ToggleProps) {
  const stateClass = checked
    ? "border-[var(--accent)] bg-[var(--accent)]"
    : "border-[var(--border)] bg-[var(--bg-subtle)]";
  const hoverClass = disabled
    ? ""
    : checked
      ? "hover:opacity-90"
      : "hover:border-[var(--text-muted)] hover:bg-[var(--bg)]";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${stateClass} ${hoverClass}`}
    >
      <span
        className={`pointer-events-none inline-block h-[14px] w-[14px] rounded-full shadow-sm transition-transform duration-150 ${
          checked
            ? "translate-x-[20px] bg-[var(--accent-fg)]"
            : "translate-x-[3px] bg-[var(--text-secondary)]"
        }`}
      />
    </button>
  );
}
