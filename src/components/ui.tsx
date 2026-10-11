import Link from "next/link";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="text-sm tracking-[0.2em] text-gold-dark uppercase">{eyebrow}</p> : null}
        <h1 className="mt-1 font-display text-3xl text-ink">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-white p-5 sm:p-6 ${className}`}>
      {title ? <h2 className="mb-4 font-display text-xl text-forest">{title}</h2> : null}
      {children}
    </section>
  );
}

const buttonBase = "inline-flex h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold transition";
export const buttonStyles = {
  primary: `${buttonBase} bg-forest text-ivory hover:bg-forest-dark`,
  secondary: `${buttonBase} border border-line bg-white text-ink hover:bg-sand`,
  danger: `${buttonBase} border border-danger/40 bg-white text-danger hover:bg-danger/5`,
};

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: keyof typeof buttonStyles }) {
  return (
    <Link href={href} className={buttonStyles[variant]}>
      {children}
    </Link>
  );
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted">{note}</p> : null}
    </div>
  );
}

export function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "success" | "warning" }) {
  const tones = {
    info: "border-line bg-sand text-ink",
    success: "border-forest/30 bg-forest/5 text-forest-dark",
    warning: "border-gold/50 bg-gold/10 text-ink",
  };
  return <div role="status" className={`rounded-lg border p-4 text-sm ${tones[tone]}`}>{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-forest/10 text-forest-dark",
    SUSPENDED: "bg-gold/15 text-gold-dark",
    EXITED: "bg-ink/10 text-muted",
  };
  const label = status.charAt(0) + status.slice(1).toLowerCase();
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status] ?? "bg-sand"}`}>{label}</span>;
}
