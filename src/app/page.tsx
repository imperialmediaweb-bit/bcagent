"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

/**
 * Landing „foaie de parcurs": hârtie caldă + cerneală + portocaliu incendiar,
 * etichete de raft, traseu desenat animat, telefon 3D. Identitate proprie —
 * zero șablon. Totul desenat în cod: nicio imagine externă.
 */

/* ────────────────────────── micro-unelte de motion ─────────────────── */

/** Apare la scroll (IntersectionObserver → clasa .in). */
function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Plasă de siguranță: conținutul NU are voie să rămână invizibil,
    // orice s-ar întâmpla cu IntersectionObserver.
    const failsafe = setTimeout(() => el.classList.add("in"), 1200);
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("in");
      return () => clearTimeout(failsafe);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
    return () => {
      clearTimeout(failsafe);
      io.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className={`rv ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Numărătoare animată când intră în ecran. */
function CountUp({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [val, setVal] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const start = performance.now();
      const dur = 1400;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        setVal(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    // Fallback: cifra finală apare oricum, chiar dacă animația nu rulează.
    const failsafe = setTimeout(() => {
      if (!started) setVal(to);
      started = true;
    }, 2500);
    if (typeof IntersectionObserver === "undefined") {
      run();
      return () => clearTimeout(failsafe);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        run();
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      clearTimeout(failsafe);
      io.disconnect();
    };
  }, [to]);
  return (
    <span ref={ref}>
      {new Intl.NumberFormat("ro-RO").format(val)}
      {suffix}
    </span>
  );
}

/** Card 3D care se înclină după mouse. */
function Tilt({ children, max = 10 }: { children: ReactNode; max?: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const onMove = useCallback(
    (e: React.MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${x * max}deg) rotateX(${-y * max}deg)`;
    },
    [max],
  );
  const onLeave = useCallback(() => {
    const el = ref.current;
    if (el) el.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg)";
  }, []);
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transition: "transform .25s ease", willChange: "transform" }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────────── conținut ──────────────────────────── */

const TICKER =
  "1.300.000 FIRME PE HARTĂ ✦ COMENZI DIN TEREN ✦ ANTRENOR AI ✦ RUTE PE ZILE ✦ FIȘA CLIENTULUI ✦ TARGETURI & PROGNOZE ✦ RESTANȚE LA VEDERE ✦ VOCE → SCRIS ✦ ";

const FEATURES = [
  {
    tag: "HARTA",
    color: "#0b5d3b",
    bg: "#e7f2ec",
    title: "1,3 milioane de firme. Ale tale.",
    text: "Verde unde ai clienți. Galben unde e piață liberă. Tap pe sat → firmele, cu telefon și buton de navigare. Concurența nici nu știe că există harta asta.",
    chip: "pete albe",
  },
  {
    tag: "COMENZI",
    color: "#c2410c",
    bg: "#fdeee3",
    title: "De la ușa clientului la depozit. 30 sec.",
    text: "Agentul o bate pe telefon, depozitul o vede instant, contabila o exportă în SAGA. Merge și fără semnal — comanda așteaptă cuminte și pleacă singură.",
    chip: "export SAGA",
  },
  {
    tag: "ANTRENOR",
    color: "#92400e",
    bg: "#fdf3d8",
    title: "Un coach care îți știe cifrele.",
    text: "Zice că-i scump? Primești replica exactă, cuvânt cu cuvânt. Poza raftului îți spune ce lipsește și cum așezi marfa. Simulare de client dificil, cu notă la final.",
    chip: "voce + poze",
  },
  {
    tag: "MEMORIE",
    color: "#1e40af",
    bg: "#e5edfb",
    title: "Nimeni nu mai uită nimic. Niciodată.",
    text: "Note dictate din mașină, vizite dintr-un tap. Data viitoare, AI-ul îi dă agentului fișa: ce a zis clientul, ce cumpără, cu ce frază să deschidă.",
    chip: "fișa clientului",
  },
  {
    tag: "PROGNOZE",
    color: "#9f1239",
    bg: "#fbe7ec",
    title: "Știi luna înainte să se termine.",
    text: "Cine își face targetul, cine îl ratează și cu cât — calculat pe ritmul real. Plus: cu ce agent să lucrezi săptămâna asta și de ce.",
    chip: "briefing AI",
  },
  {
    tag: "BANII",
    color: "#3f3f46",
    bg: "#ececee",
    title: "Restanțele, la poarta clientului.",
    text: "Paste din SAGA → restanța apare pe firmă, pe hartă și la comandă. Nu se mai livrează marfă nouă peste datorii vechi, din neatenție.",
    chip: "solduri live",
  },
];

const ROLES = [
  {
    tag: "PATRONUL",
    color: "#ff4d00",
    lines: [
      "Briefingul de dimineață: 5 fraze, 3 acțiuni, zero timp pierdut",
      "Prognoza lunii pe cifre reale, nu pe promisiuni",
      "Vânzări pe agent și brand, restanțe, deconturi — totul live",
      "Pleacă un agent? Un buton: portofoliul se predă, linkul moare",
    ],
  },
  {
    tag: "MANAGERUL",
    color: "#0b5d3b",
    lines: [
      "Vizitele și comenzile fiecărui agent, în timp real",
      "Evaluare AI per om: unde pierde firma bani cu el",
      "Concedii fără suprapuneri — platforma te avertizează",
      "Targeturi, clasament, jurnal complet de teren",
    ],
  },
  {
    tag: "AGENTUL",
    color: "#1e40af",
    lines: [
      "Ziua mea — ruta, scadenții, targetul dintr-o privire",
      "Comandă + vizită din 2 tap-uri, note dictate cu vocea",
      "Fișa clientului AI, citită în mașină în 30 de secunde",
      "Fără instalare: linkul de pe WhatsApp e toată aplicația",
    ],
  },
];

const PLANS = [
  {
    name: "START",
    price: "199",
    agents: "3 agenți",
    rot: "-rotate-2",
    features: ["Harta 1,3M + pete albe", "Comenzi · rute · vizite", "Targeturi · solduri · decont", "Rapoarte de vânzări"],
    hot: false,
  },
  {
    name: "PRO",
    price: "499",
    agents: "10 agenți",
    rot: "rotate-1",
    features: ["Tot din Start", "Analize & briefing AI", "Antrenor AI + fișe client", "Prognoze lunare"],
    hot: true,
  },
  {
    name: "BUSINESS",
    price: "999",
    agents: "40 agenți",
    rot: "-rotate-1",
    features: ["Tot din Pro", "Poze la raft analizate AI", "Evaluări AI ale agenților", "Suport dedicat"],
    hot: false,
  },
];

/* ─────────────────────────────── pagina ───────────────────────────── */

export default function HomePage() {
  // PWA instalat: sare direct în panoul agentului vizitat ultima dată.
  useEffect(() => {
    try {
      const last = localStorage.getItem("bcagent:lastLink");
      if (last && last.startsWith("/a/")) window.location.replace(last);
    } catch {
      // fără localStorage — rămânem pe landing
    }
  }, []);

  const [role, setRole] = useState(0);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const scrollDeck = (dir: number) => {
    const el = deckRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <div className="paper min-h-screen text-[#161412]">
      <style>{`
        .paper { background: #f5efe4; background-image: radial-gradient(#16141208 1.1px, transparent 1.1px); background-size: 22px 22px; font-family: var(--font-body), system-ui, sans-serif; }
        .display { font-family: var(--font-display), var(--font-body), system-ui, sans-serif; }
        .hard { box-shadow: 6px 6px 0 #161412; }
        .hard-sm { box-shadow: 4px 4px 0 #161412; }
        .hard-orange { box-shadow: 6px 6px 0 #ff4d00; }
        .rv { opacity: 0; transform: translateY(26px); transition: opacity .7s ease, transform .7s ease; }
        .rv.in { opacity: 1; transform: none; }
        @keyframes marquee { to { transform: translateX(-50%); } }
        .marquee { animation: marquee 28s linear infinite; }
        @keyframes dashmove { to { stroke-dashoffset: -240; } }
        .route-anim { stroke-dasharray: 14 10; animation: dashmove 6s linear infinite; }
        @keyframes drive { 0% { offset-distance: 0%; } 100% { offset-distance: 100%; } }
        .truck { offset-path: path('M 20 150 C 120 40, 240 240, 360 120 S 560 60, 660 160'); animation: drive 9s ease-in-out infinite alternate; }
        @keyframes inkshift { 0%,100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        .inkshift { background: linear-gradient(90deg, #ff4d00, #ffb800, #0b5d3b, #ff4d00); background-size: 300% 100%; animation: inkshift 7s ease infinite; -webkit-background-clip: text; background-clip: text; color: transparent; }
        @keyframes wobble { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(2deg); } }
        .wobble { animation: wobble 5s ease-in-out infinite; transform-origin: top center; }
        @keyframes floaty2 { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }
        .floaty2 { animation: floaty2 6s ease-in-out infinite; }
        .deck { scroll-snap-type: x mandatory; scrollbar-width: none; }
        .deck::-webkit-scrollbar { display: none; }
        .deck > * { scroll-snap-align: center; }
        .underline-ink { background-image: linear-gradient(120deg, #ffd23f 0%, #ffd23f 100%); background-repeat: no-repeat; background-size: 100% 38%; background-position: 0 82%; }
      `}</style>

      {/* BANDĂ SUS — ca banda de preț de la raft */}
      <div className="overflow-hidden border-b-2 border-[#161412] bg-[#161412] py-2">
        <div className="marquee flex w-max whitespace-nowrap text-xs font-bold tracking-[0.2em] text-[#ffd23f]">
          <span>{TICKER}</span>
          <span>{TICKER}</span>
        </div>
      </div>

      {/* NAV */}
      <header className="sticky top-0 z-40 border-b-2 border-[#161412] bg-[#f5efe4]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="hard-sm flex h-10 w-10 items-center justify-center rounded-lg border-2 border-[#161412] bg-[#ff4d00] text-lg font-black text-white">
              B
            </div>
            <span className="display text-xl font-extrabold tracking-tight">
              BC AGENT
            </span>
          </div>
          <nav className="hidden items-center gap-7 text-sm font-semibold md:flex">
            <a href="#functii" className="hover:text-[#ff4d00]">Funcții</a>
            <a href="#roluri" className="hover:text-[#ff4d00]">Pentru cine</a>
            <a href="#preturi" className="hover:text-[#ff4d00]">Prețuri</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/agentie/login" className="hidden text-sm font-semibold hover:text-[#ff4d00] sm:block">
              Intră în cont
            </Link>
            <a
              href="#preturi"
              className="hard-sm rounded-lg border-2 border-[#161412] bg-[#ffd23f] px-4 py-2 text-sm font-bold transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
            >
              Începe acum
            </a>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden">
        {/* traseul animat pe fundal */}
        <svg
          className="pointer-events-none absolute inset-x-0 top-24 mx-auto hidden w-full max-w-5xl opacity-60 lg:block"
          viewBox="0 0 680 260"
          fill="none"
          aria-hidden
        >
          <path
            d="M 20 150 C 120 40, 240 240, 360 120 S 560 60, 660 160"
            stroke="#ff4d00"
            strokeWidth="3"
            className="route-anim"
          />
          {[
            [20, 150],
            [360, 120],
            [660, 160],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="9" fill="#161412" />
              <circle cx={x} cy={y} r="4" fill="#ffd23f" />
            </g>
          ))}
          <g className="truck">
            <rect x="-11" y="-8" width="22" height="16" rx="4" fill="#161412" />
            <text x="-7" y="5" fontSize="11">🚚</text>
          </g>
        </svg>

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-24">
          <div>
            <Reveal>
              <div className="wobble hard-sm inline-block rounded-md border-2 border-[#161412] bg-white px-3 py-1 text-xs font-bold tracking-wide">
                🇷🇴 FĂCUT PENTRU DISTRIBUȚIA DIN ROMÂNIA
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="display mt-6 text-5xl font-extrabold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
                TEREN.
                <br />
                <span className="underline-ink">COMENZI.</span>
                <br />
                <span className="inkshift">CONTROL.</span>
              </h1>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-6 max-w-lg text-lg leading-relaxed text-[#161412]/75">
                Harta cu <strong>1,3 milioane de firme</strong>, comenzi care
                zboară din teren la depozit și un <strong>antrenor AI</strong>{" "}
                pentru fiecare agent. Caietele, Drive-ul și telefoanele date —
                înlocuite de un singur link.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <a
                  href="#preturi"
                  className="hard group inline-flex items-center gap-2 rounded-xl border-2 border-[#161412] bg-[#ff4d00] px-7 py-4 text-lg font-bold text-white transition hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-none"
                >
                  14 zile gratuite
                  <ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" />
                </a>
                <Link
                  href="/agentie/login"
                  className="inline-flex items-center gap-1.5 font-bold underline decoration-[#ff4d00] decoration-4 underline-offset-4 hover:text-[#ff4d00]"
                >
                  Am deja cont <ArrowUpRight className="h-4 w-4" />
                </Link>
              </div>
            </Reveal>
          </div>

          {/* TELEFON 3D + etichete */}
          <Reveal delay={250}>
            <div className="relative mx-auto w-72">
              <div className="hard-sm absolute -left-14 top-8 z-10 hidden -rotate-6 rounded-md border-2 border-[#161412] bg-[#ffd23f] px-3 py-1.5 text-xs font-black sm:block">
                1,3M FIRME
              </div>
              <div className="hard-sm absolute -right-12 top-36 z-10 hidden rotate-6 rounded-md border-2 border-[#161412] bg-[#0b5d3b] px-3 py-1.5 text-xs font-black text-white sm:block">
                +38% VIZITE
              </div>
              <div className="hard-sm floaty2 absolute -right-8 bottom-10 z-10 hidden -rotate-3 rounded-md border-2 border-[#161412] bg-white px-3 py-1.5 text-xs font-black sm:block">
                🎯 TARGET 104%
              </div>

              <Tilt max={9}>
                <div className="hard rounded-[2.4rem] border-2 border-[#161412] bg-[#161412] p-2.5">
                  <div className="rounded-[2rem] bg-[#f5efe4] p-3">
                    <p className="text-[10px] font-black tracking-widest text-[#161412]/50">
                      ☀️ ZIUA MEA — MIERCURI
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {[
                        ["🗺 Ruta de azi", "12 opriri", ""],
                        ["⏰ De vizitat", "5 clienți", "text-[#ff4d00]"],
                        ["✅ Vizite", "8", ""],
                        ["🛒 Comenzi", "6", ""],
                      ].map(([l, v, cls]) => (
                        <div key={l as string} className="rounded-lg border-2 border-[#161412] bg-white p-2">
                          <p className="text-[8px] font-bold text-[#161412]/50">{l}</p>
                          <p className={`text-sm font-black ${cls}`}>{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-1.5 rounded-lg border-2 border-[#161412] bg-white p-2">
                      <div className="flex justify-between text-[9px] font-bold">
                        <span>🎯 Target: 78%</span>
                        <span className="text-[#161412]/40">azi: 71% din lună</span>
                      </div>
                      <div className="mt-1 h-2.5 rounded-full border border-[#161412] bg-[#f5efe4]">
                        <div className="h-full w-[78%] rounded-full bg-[#0b5d3b]" />
                      </div>
                    </div>
                    <div className="mt-1.5 rounded-lg border-2 border-[#161412] bg-[#fdf3d8] p-2">
                      <p className="text-[9px] leading-snug">
                        <strong>🎓 Antrenorul:</strong> „La MARA COM cere
                        factură la termen — deschide cu asta. Vrei replica?"
                      </p>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center text-[8px] font-black">
                      <div className="rounded-md border-2 border-[#161412] bg-white py-1.5">📋 FIȘĂ</div>
                      <div className="rounded-md border-2 border-[#161412] bg-[#ff4d00] py-1.5 text-white">🛒 COMANDĂ</div>
                      <div className="rounded-md border-2 border-[#161412] bg-white py-1.5">🧭 GPS</div>
                    </div>
                  </div>
                </div>
              </Tilt>
            </div>
          </Reveal>
        </div>
      </section>

      {/* STATS pe negru */}
      <section className="border-y-2 border-[#161412] bg-[#161412] py-10 text-[#f5efe4]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-4 text-center sm:px-6 lg:grid-cols-4">
          {[
            [1300000, "", "firme active pe hartă"],
            [3, "", "AI-uri, fiecare cu treaba lui"],
            [30, " sec", "de la client la depozit"],
            [0, "", "instalări — merge din link"],
          ].map(([n, s, label]) => (
            <div key={label as string}>
              <p className="display text-4xl font-extrabold text-[#ffd23f] sm:text-5xl">
                <CountUp to={n as number} suffix={s as string} />
              </p>
              <p className="mt-1 text-sm text-[#f5efe4]/60">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PACHETUL DE CARDURI — slider orizontal */}
      <section id="functii" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="display max-w-xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
                Tot ce făceai în <span className="underline-ink">7 locuri</span>,
                într-unul singur.
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Înapoi"
                  onClick={() => scrollDeck(-1)}
                  className="hard-sm rounded-lg border-2 border-[#161412] bg-white p-2.5 transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  aria-label="Înainte"
                  onClick={() => scrollDeck(1)}
                  className="hard-sm rounded-lg border-2 border-[#161412] bg-[#ffd23f] p-2.5 transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </Reveal>

          <div ref={deckRef} className="deck -mx-4 mt-10 flex gap-5 overflow-x-auto px-4 pb-4">
            {FEATURES.map((f, i) => (
              <div key={f.tag} className="w-[85%] shrink-0 sm:w-[46%] lg:w-[31%]">
                <Tilt max={6}>
                  <div
                    className="hard flex h-full min-h-[280px] flex-col rounded-2xl border-2 border-[#161412] p-6"
                    style={{ background: f.bg, transform: `rotate(${i % 2 === 0 ? "-0.6deg" : "0.6deg"})` }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="rounded-md border-2 border-[#161412] px-2 py-0.5 text-[11px] font-black tracking-widest text-white"
                        style={{ background: f.color }}
                      >
                        {f.tag}
                      </span>
                      <span className="text-xs font-bold text-[#161412]/40">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="display mt-4 text-2xl font-extrabold leading-tight">
                      {f.title}
                    </h3>
                    <p className="mt-3 flex-1 text-[15px] leading-relaxed text-[#161412]/70">
                      {f.text}
                    </p>
                    <span className="mt-4 inline-block w-max rounded-full border-2 border-[#161412] bg-white px-3 py-1 text-xs font-bold">
                      ✦ {f.chip}
                    </span>
                  </div>
                </Tilt>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ROLURI — etichete de dosar */}
      <section id="roluri" className="border-t-2 border-[#161412] bg-[#ebe3d2] py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <Reveal>
            <h2 className="display text-center text-4xl font-extrabold tracking-tight sm:text-5xl">
              Trei panouri. <span className="inkshift">O firmă.</span>
            </h2>
          </Reveal>
          <Reveal delay={150}>
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              {ROLES.map((r, i) => (
                <button
                  key={r.tag}
                  type="button"
                  onClick={() => setRole(i)}
                  className={`hard-sm rounded-lg border-2 border-[#161412] px-5 py-2.5 text-sm font-black tracking-wide transition ${
                    i === role
                      ? "translate-x-[2px] translate-y-[2px] text-white shadow-none"
                      : "bg-white hover:translate-x-[1px] hover:translate-y-[1px]"
                  }`}
                  style={i === role ? { background: r.color } : undefined}
                >
                  {r.tag}
                </button>
              ))}
            </div>
            <div className="hard mx-auto mt-8 max-w-2xl rounded-2xl border-2 border-[#161412] bg-white p-8">
              <ul className="space-y-4">
                {ROLES[role].lines.map((l) => (
                  <li key={l} className="flex items-start gap-3 text-[17px] font-medium">
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-[#161412] text-white"
                      style={{ background: ROLES[role].color }}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* PREȚURI — etichete de preț */}
      <section id="preturi" className="border-t-2 border-[#161412] py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <h2 className="display text-center text-4xl font-extrabold tracking-tight sm:text-5xl">
              Prețuri de <span className="underline-ink">raft</span>. Nu de
              corporație.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-center text-[#161412]/60">
              14 zile gratuite cu tot inclus. Fără card la înscriere.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-8 lg:grid-cols-3">
            {PLANS.map((p, i) => (
              <Reveal key={p.name} delay={i * 120}>
                <div className={`relative ${p.rot}`}>
                  {/* gaură de etichetă */}
                  <div className="absolute -top-3 left-1/2 z-10 h-6 w-6 -translate-x-1/2 rounded-full border-2 border-[#161412] bg-[#f5efe4]" />
                  <div
                    className={`hard rounded-2xl border-2 border-[#161412] p-8 pt-10 transition hover:-translate-y-1 ${
                      p.hot ? "bg-[#ffd23f]" : "bg-white"
                    }`}
                  >
                    {p.hot && (
                      <span className="absolute -right-3 top-6 rotate-12 rounded-md border-2 border-[#161412] bg-[#ff4d00] px-2.5 py-1 text-[11px] font-black text-white">
                        CEL MAI ALES
                      </span>
                    )}
                    <p className="display text-lg font-extrabold tracking-widest">{p.name}</p>
                    <p className="text-sm font-bold text-[#161412]/50">{p.agents}</p>
                    <p className="mt-4">
                      <span className="display text-6xl font-extrabold">{p.price}</span>
                      <span className="font-bold text-[#161412]/50"> lei/lună</span>
                    </p>
                    <ul className="mt-6 space-y-2.5">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[15px] font-medium">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0b5d3b]" strokeWidth={3} />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Link
                      href="/agentie/login"
                      className={`hard-sm mt-8 block rounded-xl border-2 border-[#161412] py-3.5 text-center font-black transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none ${
                        p.hot ? "bg-[#161412] text-[#ffd23f]" : "bg-white"
                      }`}
                    >
                      ÎNCEPE GRATUIT
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-10 text-center text-sm font-medium text-[#161412]/50">
            Toate planurile includ harta cu 1,3M firme, comenzi, rute, vizite,
            targeturi, solduri și decont.
          </p>
        </div>
      </section>

      {/* FINAL */}
      <section className="border-t-2 border-[#161412] bg-[#161412] py-24 text-center text-[#f5efe4]">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Reveal>
            <h2 className="display text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
              ÎNCHIDE CAIETUL.
              <br />
              <span className="inkshift">DESCHIDE BC AGENT.</span>
            </h2>
            <a
              href="#preturi"
              className="hard-orange mt-10 inline-flex items-center gap-3 rounded-xl border-2 border-[#ff4d00] bg-[#f5efe4] px-8 py-4 text-lg font-black text-[#161412] transition hover:translate-x-[3px] hover:translate-y-[3px] hover:shadow-none"
            >
              ÎNCEPE CU 14 ZILE GRATUITE
              <ArrowRight className="h-5 w-5" />
            </a>
          </Reveal>
        </div>
      </section>

      <footer className="bg-[#161412] pb-10 text-[#f5efe4]/50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 border-t border-[#f5efe4]/10 px-4 pt-8 text-sm sm:flex-row sm:px-6">
          <span className="display font-extrabold text-[#f5efe4]">BC AGENT</span>
          <p>Date: surse publice MF/ANAF · Fișierele tale rămân ale tale.</p>
          <Link href="/agentie/login" className="hover:text-[#f5efe4]">
            Intră în cont →
          </Link>
        </div>
      </footer>
    </div>
  );
}
