import { useId } from "react";

type Variant = "colour" | "mono" | "reverse";

const PALETTES: Record<Variant, Record<string, string>> = {
  colour: { band: "#1E4D3A", line: "#C99A3E", field: "#FBF8F1", bandText: "#FBF8F1", motto: "#E4C77E", coin: "#D3A548", coinEdge: "#8A6420", leaf: "#1E4D3A", leafLight: "#3C8A62", mono: "#1E4D3A" },
  mono: { band: "#1C1F1D", line: "#1C1F1D", field: "#FFFFFF", bandText: "#FFFFFF", motto: "#FFFFFF", coin: "#FFFFFF", coinEdge: "#1C1F1D", leaf: "#1C1F1D", leafLight: "#1C1F1D", mono: "#1C1F1D" },
  reverse: { band: "#FBF8F1", line: "#C99A3E", field: "#1E4D3A", bandText: "#1E4D3A", motto: "#8A6420", coin: "#D3A548", coinEdge: "#8A6420", leaf: "#FBF8F1", leafLight: "#B9D9C4", mono: "#FBF8F1" },
};

/** The Iyobor Progressive Union seal, from the approved brand kit. */
export function Seal({ size = 96, variant = "colour", className }: { size?: number; variant?: Variant; className?: string }) {
  const c = PALETTES[variant];
  const id = useId().replace(/:/g, "");
  const top = `ipu-top-${id}`;
  const bottom = `ipu-bottom-${id}`;
  const font = "var(--font-marcellus), 'Times New Roman', serif";
  return (
    <svg viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="Iyobor Progressive Union seal" className={className}>
      <defs>
        <path id={top} d="M 20,100 A 80,80 0 0 1 180,100" />
        <path id={bottom} d="M 10,100 A 90,90 0 0 0 190,100" />
      </defs>
      <circle cx="100" cy="100" r="98" fill={c.band} />
      <circle cx="100" cy="100" r="94" fill="none" stroke={c.line} strokeWidth="1.5" />
      <circle cx="100" cy="100" r="70" fill={c.field} stroke={c.line} strokeWidth="2" />
      <text fontFamily={font} fontSize="12.5" letterSpacing="1.6" fill={c.bandText}>
        <textPath href={`#${top}`} startOffset="50%" textAnchor="middle">IYOBOR PROGRESSIVE UNION</textPath>
      </text>
      <text fontFamily={font} fontSize="9.5" letterSpacing="2.2" fill={c.motto}>
        <textPath href={`#${bottom}`} startOffset="50%" textAnchor="middle">UNITY · THRIFT · PROGRESS</textPath>
      </text>
      <path d="M18 95 L22 100 L18 105 L14 100 Z" fill={c.line} />
      <path d="M182 95 L186 100 L182 105 L178 100 Z" fill={c.line} />
      <rect x="72" y="126" width="56" height="11" rx="5.5" fill={c.coin} stroke={c.coinEdge} />
      <rect x="74" y="115" width="52" height="11" rx="5.5" fill={c.coin} stroke={c.coinEdge} />
      <rect x="72" y="104" width="56" height="11" rx="5.5" fill={c.coin} stroke={c.coinEdge} />
      <path d="M100 104 C100 94 99 84 100 70" fill="none" stroke={c.leaf} strokeWidth="3" strokeLinecap="round" />
      <path d="M100 90 C90 90 80 84 76 71 C89 71 98 77 100 90 Z" fill={c.leaf} />
      <path d="M100 80 C109 78 119 70 122 56 C109 57 101 65 100 80 Z" fill={c.leafLight} />
      <text x="100" y="157" textAnchor="middle" fontFamily={font} fontSize="14" letterSpacing="4" fill={c.mono}>IPU</text>
    </svg>
  );
}
