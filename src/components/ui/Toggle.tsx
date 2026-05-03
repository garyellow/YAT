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
    ? "border-(--accent) bg-(--accent)"
    : "border-(--border-strong) bg-(--bg-elevated)";
  const hoverClass = disabled
    ? ""
    : checked
      ? "hover:opacity-90"
      : "hover:border-(--text-muted) hover:bg-(--bg-muted)";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5.5 w-10 shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${stateClass} ${hoverClass}`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full transition-transform duration-150 ${
          checked
            ? "translate-x-5 bg-(--accent-fg)"
            : "translate-x-0.75 bg-(--text-secondary)"
        }`}
        aria-hidden="true"
      />
    </button>
  );
}
