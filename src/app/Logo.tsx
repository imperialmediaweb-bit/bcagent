/**
 * Logo-ul PROVENDI — bifă cu gradient + trei linii de „circuit" cu puncte
 * colorate, reconstruit vectorial (SVG) ca să fie perfect clar la orice
 * mărime. Wordmark-ul: PRO negru + VENDI în culorile brandului.
 */

const INK = "#161412";

export function LogoIcon({
  size = 44,
  variant = "color",
}: {
  size?: number;
  variant?: "color" | "dark";
}) {
  const ink = variant === "dark" ? "#f5efe4" : INK;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="pv-check" x1="30" y1="105" x2="112" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffb300" />
          <stop offset="0.35" stopColor="#38bdf8" />
          <stop offset="0.7" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>
      {/* liniile de circuit */}
      <path d="M14 28 h16 c12 0 16 8 24 16" stroke={ink} strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M10 58 h20 c12 0 18 6 26 14" stroke={ink} strokeWidth="9" strokeLinecap="round" fill="none" />
      <path d="M14 88 h14 c14 0 20 -4 28 -10" stroke={ink} strokeWidth="9" strokeLinecap="round" fill="none" />
      <circle cx="14" cy="28" r="8" fill="#ff7a00" stroke={ink} strokeWidth="4" />
      <circle cx="10" cy="58" r="8" fill="#38bdf8" stroke={ink} strokeWidth="4" />
      <circle cx="14" cy="88" r="8" fill="#ec4899" stroke={ink} strokeWidth="4" />
      {/* bifa */}
      <path d="M52 68 L68 92" stroke={ink} strokeWidth="14" strokeLinecap="round" />
      <path d="M68 92 L108 22" stroke="url(#pv-check)" strokeWidth="14" strokeLinecap="round" />
    </svg>
  );
}

/** PRO negru + VENDI colorat — literă cu literă, ca în logo. */
export function LogoWordmark({
  className = "",
  variant = "color",
}: {
  className?: string;
  variant?: "color" | "dark";
}) {
  const base = variant === "dark" ? "#f5efe4" : INK;
  const colors: Array<[string, string]> = [
    ["P", base],
    ["R", base],
    ["O", base],
    ["V", "#ffb300"],
    ["E", "#38bdf8"],
    ["N", "#6d6bf8"],
    ["D", "#8b5cf6"],
    ["I", "#ec4899"],
  ];
  return (
    <span
      className={`font-extrabold tracking-tight ${className}`}
      style={{ fontFamily: "var(--font-display), sans-serif" }}
    >
      {colors.map(([ch, c], i) => (
        <span key={i} style={{ color: c }}>
          {ch}
        </span>
      ))}
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
    <span className="inline-flex items-center gap-3">
      <LogoIcon size={iconSize} variant={variant} />
      <LogoWordmark className={textClassName} variant={variant} />
    </span>
  );
}
