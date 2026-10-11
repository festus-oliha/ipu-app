import Link from "next/link";
import { Seal } from "./Seal";

/** Site footer on every page: union seal and contacts, developer credit, copyright. */
export function Footer() {
  return (
    <footer className="mt-auto border-t-4 border-gold bg-forest text-ivory print:hidden">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <Seal size={56} variant="reverse" />
          <div>
            <p className="font-display text-lg leading-tight">Iyobor Progressive Union</p>
            <p className="text-xs tracking-[0.25em] text-gold-light uppercase">Unity · Thrift · Progress</p>
          </div>
        </div>
        <address className="flex flex-col gap-1 text-sm not-italic text-ivory/85">
          <span>198, Old Sapele Road, Benin City, Edo State</span>
          <a href="mailto:iyoborpu@gmail.com" className="hover:text-ivory hover:underline">iyoborpu@gmail.com</a>
          <a href="tel:+2349076729480" className="hover:text-ivory hover:underline">+234 907 672 9480</a>
          <Link href="/contact" className="mt-1 font-semibold text-gold-light hover:underline">Contact us →</Link>
        </address>
      </div>
      <div className="border-t border-ivory/15">
        <p className="mx-auto flex max-w-5xl flex-wrap justify-between gap-2 px-5 py-4 text-xs text-ivory/70">
          <span>© 2026 Iyobor Progressive Union. All rights reserved.</span>
          <span>Application built by JVeeSoft-IT · Copyright 2026</span>
        </p>
      </div>
    </footer>
  );
}
