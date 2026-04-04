import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "default" | "accent" | "success" | "warning" | "danger";

interface PageLeadProps {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PageLead({ eyebrow, title, description, meta, actions }: PageLeadProps) {
  return (
    <header className="space-y-3">
      {eyebrow ? <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/80">{eyebrow}</p> : null}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2 min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">{title}</h1>
          {description ? <p className="max-w-3xl text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p> : null}
          {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

interface SectionCardProps extends HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  aside?: ReactNode;
  tone?: Tone;
  children: ReactNode;
}

export function SectionCard({
  title,
  description,
  aside,
  tone = "default",
  children,
  className = "",
  ...props
}: SectionCardProps) {
  return (
    <section className={`app-card ${className}`.trim()} data-tone={tone} {...props}>
      <div className="flex flex-col gap-3 border-b border-black/5 px-5 py-5 dark:border-white/8 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

export function StatusPill({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className="app-status-pill" data-tone={tone}>
      {children}
    </span>
  );
}

interface NoticeProps {
  title: string;
  tone?: Tone;
  children: ReactNode;
}

export function Notice({ title, tone = "default", children }: NoticeProps) {
  return (
    <div className="app-callout" data-tone={tone}>
      <div className="space-y-1">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        <div className="text-sm leading-6 text-gray-700 dark:text-gray-200">{children}</div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
}

export function StatCard({ label, value, hint, tone = "default" }: StatCardProps) {
  return (
    <div className="app-metric-card" data-tone={tone}>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{hint}</p> : null}
    </div>
  );
}

interface OptionCardProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description: string;
  selected?: boolean;
  icon?: ReactNode;
}

export function OptionCard({
  title,
  description,
  selected,
  icon,
  className = "",
  children,
  type = "button",
  ...props
}: OptionCardProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={`app-option-card text-left ${className}`.trim()}
      data-selected={selected ? "true" : "false"}
      {...props}
    >
      <div className="flex items-start gap-3">
        {icon ? <span className="mt-0.5 shrink-0 text-base text-primary">{icon}</span> : null}
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">{title}</span>
            {selected ? <StatusPill tone="accent">✓</StatusPill> : null}
          </div>
          <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p>
          {children ? <div className="pt-2">{children}</div> : null}
        </div>
      </div>
    </button>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="app-empty-state">
      {icon ? <div className="text-2xl text-primary/80">{icon}</div> : null}
      <div className="space-y-2">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        <p className="max-w-xl text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p>
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
