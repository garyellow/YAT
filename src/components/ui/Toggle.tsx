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
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[40px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 ${
        checked
          ? "border-[var(--accent)] bg-[var(--accent)]"
          : "border-[var(--border)] bg-[var(--bg-subtle)]"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-[14px] w-[14px] rounded-full shadow-sm transition-transform duration-150 ${
          checked
            ? "translate-x-[20px] bg-[var(--accent-fg)]"
            : "translate-x-[3px] bg-[var(--text-muted)]"
        }`}
      />
    </button>
  );
}
