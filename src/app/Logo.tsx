/**
 * Logo-ul PROVENDI: pătrat cu săgeata care „sparge" rama — creșterea care
 * iese din cutie — în culorile brandului: cerneală + portocaliu incendiar.
 * Vectorial: perfect clar la orice mărime, pe fundal deschis sau închis.
 */

const INK = "#161412";
const HOT = "#ff4d00";
const PAPER = "#f5efe4";

export function LogoIcon({
  size = 44,
  variant = "color",
}: {
  size?: number;
  /** color = pe fundal deschis (hârtie) · dark = pe sidebar închis */
  variant?: "color" | "dark";
}) {
  const ink = variant === "dark" ? PAPER : INK;
  // „Halo"-ul șterge rama pătratului pe unde iese săgeata — are culoarea
  // fundalului pe care stă logo-ul.
  const halo = variant === "dark" ? "#0f172a" : PAPER;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
    >
      {/* pătratul */}
      <rect x="30" y="14" width="78" height="78" rx="16" stroke={ink} strokeWidth="11" fill="none" />
      {/* halo — rupe rama în colțul de jos-stânga */}
      <path d="M10 112 L64 58" stroke={halo} strokeWidth="30" strokeLinecap="round" />
      {/* săgeata */}
      <path d="M14 108 L62 60" stroke={HOT} strokeWidth="14" strokeLinecap="round" />
      <path d="M52 38 L88 34 L84 70 Z" fill={HOT} />
    </svg>
  );
}

/** PRO cerneală + VENDI portocaliu — ca în logo. */
export function LogoWordmark({
  className = "",
  variant = "color",
}: {
  className?: string;
  variant?: "color" | "dark";
}) {
  const base = variant === "dark" ? PAPER : INK;
  return (
    <span
      className={`font-extrabold tracking-tight ${className}`}
      style={{ fontFamily: "var(--font-display), sans-serif" }}
    >
      <span style={{ color: base }}>PRO</span>
      <span style={{ color: HOT }}>VENDI</span>
    </span>
  );
}

export default function Logo({
  iconSize = 48,
  textClassName = "text-2xl",
  variant = "color",
}: {
  iconSize?: number;
  textClassName?: string;
  variant?: "color" | "dark";
}) {
  return (
    // Pe telefon mic cu fontul mărit de sistem, sigla ajungea la 355px pe
    // un ecran de 320 și ieșea pe amândouă părțile. Acum se micșorează în
    // loc să iasă: iconița se strânge, iar textul are voie să se rupă.
    <span className="inline-flex max-w-full shrink items-center gap-2 sm:gap-3">
      <span className="shrink-0" style={{ maxWidth: iconSize }}>
        <LogoIcon size={iconSize} variant={variant} />
      </span>
      <LogoWordmark
        className={`min-w-0 break-words ${textClassName}`}
        variant={variant}
      />
    </span>
  );
}
