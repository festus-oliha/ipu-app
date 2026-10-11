import { Seal } from "./Seal";

/** Branded frame for the sign-in and password screens. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col">
      <div className="h-2 bg-forest" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 py-10">
        <div className="flex flex-col items-center gap-3 text-center">
          <Seal size={112} />
          <p className="font-display text-2xl leading-tight text-forest">Iyobor Progressive Union</p>
          <p className="text-xs uppercase tracking-[0.3em] text-gold-dark">Unity · Thrift · Progress</p>
        </div>
        <section className="mt-8 rounded-xl border border-line bg-white p-6 shadow-sm">
          <h1 className="font-display text-2xl text-ink">{title}</h1>
          <div className="mt-5">{children}</div>
        </section>
        <p className="mt-auto pt-8 text-center text-xs text-muted">
          198, Old Sapele Road, Benin City · +234 907 672 9480
        </p>
      </div>
    </main>
  );
}
