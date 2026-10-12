import { MemberPhoto } from "../MemberPhoto";
import { Seal } from "../Seal";

export type IdCardData = {
  memberId: string;
  memberNo: string;
  name: string;
  office: string;
  photoVersion: string | null;
  validTo: string;
  verifyUrl: string;
  qrSvg: string;
  secretary: string;
};

const card = "@container relative aspect-[85.6/54] w-full overflow-hidden rounded-[3cqw] bg-white shadow-sm ring-1 ring-line print:aspect-auto print:h-[54mm] print:w-[85.6mm] print:rounded-[3mm] print:shadow-none print:ring-[0.2mm] print:ring-ink/30 break-inside-avoid";

/** Front of the card (ID-1 / bank-card size, 85.6 × 54 mm). */
export function IdCardFront({ d }: { d: IdCardData }) {
  return (
    <div className={card}>
      <div className="flex h-[22cqw] items-center gap-[2.5cqw] bg-forest px-[4cqw] text-ivory">
        <Seal size={60} variant="reverse" className="h-[15cqw] w-[15cqw] shrink-0" />
        <div className="min-w-0 leading-tight">
          <p className="font-display text-[5.4cqw]">Iyobor Progressive Union</p>
          <p className="text-[2.6cqw] tracking-[0.25em] text-gold-light uppercase">Unity · Thrift · Progress</p>
        </div>
      </div>
      <div className="h-[1.2cqw] bg-gold" />
      <div className="flex gap-[4cqw] px-[4cqw] pt-[3.5cqw]">
        <MemberPhoto memberId={d.memberId} name={d.name} version={d.photoVersion} className="h-[30cqw] w-[24cqw] shrink-0 rounded-[1.5cqw] ring-[0.4cqw] ring-gold" />
        <div className="flex min-w-0 flex-1 flex-col gap-[1cqw]">
          <p className="text-[2.6cqw] tracking-[0.2em] text-gold-dark uppercase">Member identity card</p>
          <p className={`font-display leading-tight text-ink ${d.name.length > 30 ? "text-[3.9cqw]" : d.name.length > 20 ? "text-[4.6cqw]" : "text-[5.6cqw]"}`}>{d.name}</p>
          <dl className="mt-[0.8cqw] grid grid-cols-[auto_1fr] gap-x-[2.5cqw] gap-y-[0.6cqw] text-[3.1cqw]">
            <dt className="text-muted">Member no.</dt><dd className="font-semibold tabular-nums">{d.memberNo}</dd>
            <dt className="text-muted">Status</dt><dd className="font-semibold">{d.office}</dd>
            <dt className="text-muted">Valid to</dt><dd className="font-semibold">{d.validTo}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}

/** Back of the card: QR code to check the card, return address, Secretary's signature. */
export function IdCardBack({ d }: { d: IdCardData }) {
  return (
    <div className={card}>
      <div className="flex h-full flex-col justify-between p-[4.5cqw]">
        <div className="flex gap-[4cqw]">
          <div className="h-[30cqw] w-[30cqw] shrink-0 rounded-[1cqw] bg-white p-[1cqw] ring-[0.3cqw] ring-line [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: d.qrSvg }} />
          <div className="flex min-w-0 flex-col gap-[1.2cqw] text-[2.9cqw] leading-snug text-ink">
            <p className="font-semibold text-forest">Scan to check this card is valid.</p>
            <p>This card is the property of the Iyobor Progressive Union. If found, please return it to the address below.</p>
          </div>
        </div>
        <div className="flex items-end justify-between gap-[3cqw]">
          <div className="text-[2.6cqw] leading-snug text-muted">
            <p>198, Old Sapele Road, Benin City</p>
            <p>+234 907 672 9480 · iyoborpu@gmail.com</p>
          </div>
          <div className="w-[30cqw] shrink-0 text-center">
            <div className="h-[6cqw] border-b border-ink/60" />
            <p className="mt-[0.5cqw] text-[2.4cqw] leading-tight">{d.secretary || " "}</p>
            <p className="text-[2.2cqw] tracking-[0.15em] text-gold-dark uppercase">Secretary</p>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[1.2cqw] bg-gold" />
    </div>
  );
}
