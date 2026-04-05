import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "default" | "accent" | "success" | "warning" | "danger";

/* ─── Section ─── */

interface SectionProps extends HTMLAttributes<HTMLElement> {
  title: string;
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
    <section className={className} {...props}>
      <div className="flex items-start justify-between gap-4 pb-3 mb-4 border-b border-[var(--border)]">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

/* ─── StatusDot ─── */

export function StatusDot({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
      <span className="dot" data-tone={tone} />
      {children}
    </span>
  );
}

/* ─── Notice ─── */

interface NoticeProps {
  title: string;
  tone?: Tone;
  children: ReactNode;
}

export function Notice({ title, tone = "default", children }: NoticeProps) {
  return (
    <div className="callout" data-tone={tone}>
      <p className="text-[13px] font-medium text-[var(--text)]">{title}</p>
      <div className="mt-1 text-xs">{children}</div>
    </div>
  );
}

/* ─── OptionCard ─── */

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
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
            selected
              ? "border-[var(--accent)] bg-[var(--accent)]"
              : "border-[var(--border)]"
          }`}
        >
          {selected ? (
            <span className="block h-1.5 w-1.5 rounded-sm bg-[var(--accent-fg)]" />
          ) : null}
        </span>
        <div className="min-w-0">
          <span className="text-[13px] font-medium">{title}</span>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
          {children ? <div className="pt-2">{children}</div> : null}
        </div>
      </div>
    </button>
  );
}

/* ─── EmptyState ─── */

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="py-8 text-center">
      <p className="text-[13px] font-medium text-[var(--text-secondary)]">{title}</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ─── Backwards compat aliases (used in Settings.tsx sidebar) ─── */

export const SectionCard = Section;
export const StatusPill = StatusDot;
