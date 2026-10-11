import { Seal } from "./Seal";

/** Union letterhead for printed statements and reports (brand kit). */
export function Letterhead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6 border-b-4 border-gold pb-4">
      <div className="flex items-center gap-4">
        <Seal size={72} />
        <div className="min-w-0">
          <p className="font-display text-2xl text-forest">Iyobor Progressive Union</p>
          <p className="text-xs text-muted">198, Old Sapele Road, Benin City, Edo State · +234 907 672 9480 · iyoborpu@gmail.com</p>
          <p className="text-xs text-muted">GT Bank 0033550876</p>
        </div>
      </div>
      <h1 className="mt-4 font-display text-2xl text-ink">{title}</h1>
      {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}
