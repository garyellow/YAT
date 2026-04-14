import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { HintTip } from "../ui/Tooltip";

type Tone = "default" | "accent" | "success" | "warning" | "danger";

/* ─── Page Intro ─── */

interface PageIntroProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}

export function PageIntro({
  title,
  description,
  eyebrow,
  badge,
  actions,
}: PageIntroProps) {
  return (
    <div className="page-intro">
      <div className="page-intro-main">
        <div className="page-intro-meta">
          {eyebrow ? <div className="page-intro-eyebrow">{eyebrow}</div> : null}
          <h1 className="page-intro-title">{title}</h1>
          {description ? <p className="page-intro-desc">{description}</p> : null}
        </div>
      </div>

      {badge || actions ? (
        <div className="page-intro-side flex shrink-0 flex-wrap items-center gap-2">
          {badge}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Section ─── */

interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function Section({
  title,
  description,
  aside,
  children,
  className = "",
  ...props
}: SectionProps) {
  return (
    <section className={`section-card ${className}`.trim()} {...props}>
      {title ? (
        <div className="section-header">
          <div className="min-w-0">
            <h2 className="section-title">{title}</h2>
            {description ? (
              <p className="section-desc">{description}</p>
            ) : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
      ) : null}

      <div className="section-body">{children}</div>
    </section>
  );
}

/* ─── Settings List / Row ─── */

interface SettingListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function SettingList({
  children,
  className = "",
  ...props
}: SettingListProps) {
  return (
    <div className={`settings-list ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

interface SettingRowProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
  inset?: boolean;
  labelId?: string;
  hint?: ReactNode;
  hintSide?: "top" | "bottom";
}

export function SettingRow({
  label,
  description,
  control,
  children,
  inset = false,
  labelId,
  hint,
  hintSide = "top",
  className = "",
  ...props
}: SettingRowProps) {
  return (
    <div
      className={`setting-row ${className}`.trim()}
      data-inset={inset ? "true" : undefined}
      {...props}
    >
      <div className="setting-row-head">
        <div className="setting-row-main">
          <div id={labelId} className="setting-row-label">
            {hint ? (
              <span className="inline-flex items-center gap-1.5 align-middle">
                <span>{label}</span>
                <HintTip text={hint} side={hintSide} />
              </span>
            ) : label}
          </div>
          {description ? <div className="setting-row-desc">{description}</div> : null}
        </div>

        {control ? <div className="setting-row-control">{control}</div> : null}
      </div>

      {children ? <div className="setting-row-detail">{children}</div> : null}
    </div>
  );
}

/* ─── Status / Summary ─── */

export function StatusDot({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
      <span className="dot" data-tone={tone} />
      {children}
    </span>
  );
}

interface SummaryPillProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: Tone;
}

export function SummaryPill({
  children,
  tone = "default",
  className = "",
  ...props
}: SummaryPillProps) {
  return (
    <span className={`summary-pill ${className}`.trim()} data-tone={tone} {...props}>
      {children}
    </span>
  );
}

interface RangeFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  formatValue?: (value: number) => ReactNode;
  className?: string;
}

export function RangeField({
  value,
  onChange,
  min,
  max,
  step = 1,
  formatValue,
  className = "",
  ...props
}: RangeFieldProps) {
  const rawPercent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  const bubblePercent = Math.min(96, Math.max(4, rawPercent));
  const style = {
    "--range-position": `${bubblePercent}%`,
  } as CSSProperties;

  return (
    <div className={`range-field ${className}`.trim()} style={style}>
      <span className="range-value" aria-hidden="true">
        {formatValue ? formatValue(value) : value}
      </span>

      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range-input"
        {...props}
      />
    </div>
  );
}

/* ─── Notice ─── */

interface NoticeProps {
  title: string;
  tone?: Tone;
  children?: ReactNode;
}

export function Notice({ title, tone = "default", children }: NoticeProps) {
  return (
    <div className="callout" data-tone={tone}>
      <p className="callout-title">{title}</p>
      {children ? (
        <div className="callout-body">{children}</div>
      ) : null}
    </div>
  );
}

/* ─── Option Card ─── */

interface OptionCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description: string;
  selected?: boolean;
}

export function OptionCard({
  title,
  description,
  selected,
  children,
  type = "button",
  ...props
}: OptionCardProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className="option-btn"
      data-selected={selected ? "true" : "false"}
      {...props}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
            selected
              ? "border-[var(--accent)] bg-[var(--accent)]"
              : "border-[var(--border-strong)] bg-[var(--bg-elevated)]"
          }`}
        >
          {selected ? (
            <span className="block h-1.5 w-1.5 rounded-full bg-[var(--accent-fg)]" />
          ) : null}
        </span>

        <div className="min-w-0">
          <span className="text-[13px] font-semibold text-[var(--text)] text-pretty">
            {title}
          </span>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)] text-pretty">
            {description}
          </p>
          {children ? <div className="pt-2">{children}</div> : null}
        </div>
      </div>
    </button>
  );
}

/* ─── Empty State ─── */

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg)] px-5 py-7 text-center">
      <p className="text-[13px] font-semibold text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)] text-pretty">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
