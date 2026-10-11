import type { Metadata } from "next";
import Link from "next/link";
import { Seal } from "@/components/Seal";

export const metadata: Metadata = { title: "Contact us" };

const card = "rounded-xl border border-line bg-white p-5";

/** Public page (no sign-in needed): how to reach the union and its officers. */
export default function ContactPage() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="bg-forest text-ivory">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-4">
          <Seal size={44} variant="reverse" />
          <Link href="/" className="font-display text-lg">Iyobor Progressive Union</Link>
        </div>
        <div className="h-1 bg-gold" />
      </div>
      <div className="mx-auto w-full max-w-5xl px-5 py-10">
        <p className="text-sm tracking-[0.2em] text-gold-dark uppercase">Get in touch</p>
        <h1 className="mt-1 font-display text-3xl text-ink">Contact us</h1>
        <p className="mt-2 max-w-prose text-sm text-muted">
          For questions about your contributions, loans or account, contact the union office or the officer listed below.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <section className={card}>
            <h2 className="font-display text-xl text-forest">Office</h2>
            <address className="mt-2 text-sm not-italic leading-relaxed">198, Old Sapele Road,<br />Benin City, Edo State, Nigeria</address>
          </section>
          <section className={card}>
            <h2 className="font-display text-xl text-forest">Phone</h2>
            <a href="tel:+2349076729480" className="mt-2 block text-sm font-semibold text-forest underline-offset-2 hover:underline">+234 907 672 9480</a>
            <p className="mt-1 text-xs text-muted">Tap to call from your phone.</p>
          </section>
          <section className={card}>
            <h2 className="font-display text-xl text-forest">Email</h2>
            <a href="mailto:iyoborpu@gmail.com" className="mt-2 block text-sm font-semibold text-forest underline-offset-2 hover:underline">iyoborpu@gmail.com</a>
            <p className="mt-1 text-xs text-muted">We reply as soon as we can.</p>
          </section>
        </div>

        <section className={`${card} mt-4`}>
          <h2 className="font-display text-xl text-forest">Officers</h2>
          <ul className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <li><span className="block font-semibold">Madam F. U. Idahosa</span><span className="text-muted">President</span></li>
            <li><span className="block font-semibold">Mr O. Egbenehikhuere</span><span className="text-muted">Secretary · membership and accounts</span></li>
            <li><span className="block font-semibold">Mrs Felicia Imade</span><span className="text-muted">Treasurer · payments and loans</span></li>
          </ul>
        </section>

        <section className={`${card} mt-4`}>
          <h2 className="font-display text-xl text-forest">Making a payment</h2>
          <p className="mt-2 text-sm">Pay into <span className="font-semibold">GT Bank, account 0033550876</span> (Iyobor Progressive Union), then upload the receipt in the app or send it to the Treasurer.</p>
        </section>

        <p className="mt-8 text-sm"><Link href="/" className="font-semibold text-forest underline underline-offset-2">← Back to the app</Link></p>
      </div>
    </main>
  );
}
