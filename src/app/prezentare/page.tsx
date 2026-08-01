import Link from "next/link";
import Logo from "@/app/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Provendi — prezentarea platformei",
  description:
    "Platforma completă pentru firmele de distribuție: agenți pe teren, vânzări live, hartă, AI. Prezentare cu capturi reale.",
};

/**
 * PREZENTAREA pentru patroni: Bogdan trimite linkul ăsta pe WhatsApp și
 * patronul vede în 3 minute ce face platforma — cu capturi REALE din demo.
 * La final: butonul de demo (intră singur să pipăie).
 */

function Slide({
  img,
  title,
  kicker,
  flip,
  children,
}: {
  img: string;
  title: string;
  kicker: string;
  flip?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`flex flex-col items-center gap-6 md:gap-10 ${flip ? "md:flex-row-reverse" : "md:flex-row"}`}
    >
      <div className="w-full max-w-[280px] shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/prezentare/${img}.jpg`}
          alt={title}
          loading="lazy"
          className="w-full rounded-[1.6rem] border-2 border-[#161412] bg-white"
          style={{ boxShadow: "8px 8px 0 rgba(22,20,18,0.9)" }}
        />
      </div>
      <div className="max-w-md">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#ff4d00]">
          {kicker}
        </p>
        <h2
          className="mt-1 text-2xl font-extrabold text-[#161412]"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          {title}
        </h2>
        <div className="mt-3 space-y-2 text-[15px] font-medium leading-relaxed text-[#161412]/75">
          {children}
        </div>
      </div>
    </section>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-[#161412]">{children}</strong>;
}

export default function PrezentarePage() {
  return (
    <main
      className="min-h-screen px-4 py-12"
      style={{
        background: "#f5efe4",
        backgroundImage: "radial-gradient(#16141208 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        fontFamily: "var(--font-body), system-ui, sans-serif",
      }}
    >
      <div className="mx-auto max-w-4xl space-y-16 md:space-y-24">
        {/* HERO */}
        <header className="text-center">
          <div className="inline-flex items-center gap-2.5">
            <Logo />
          </div>
          <h1
            className="mx-auto mt-6 max-w-2xl text-3xl font-extrabold leading-tight text-[#161412] md:text-4xl"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            Toată firma ta de distribuție,{" "}
            <span className="text-[#ff4d00]">într-o singură aplicație.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] font-medium text-[#161412]/65">
            Agenții pe teren cu telefonul. Tu, cu tot controlul: vânzări live,
            hartă, comenzi, bani, rapoarte. Mai jos — capturi reale din
            platformă, apoi intri singur în demo.
          </p>
          <a
            href="/api/agentie/demo-login?rol=patron"
            className="mt-6 inline-block rounded-xl border-2 border-[#161412] bg-[#ffd23f] px-6 py-3 text-[16px] font-black text-[#161412] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
            style={{ boxShadow: "4px 4px 0 #161412" }}
          >
            🎬 Sari direct în DEMO
          </a>
        </header>

        <Slide img="agent-ziua" kicker="Panoul agentului" title="Dimineața, agentul știe exact ce are de făcut">
          <p>
            <B>„Ziua mea"</B>: ruta de azi cu un buton care deschide Google
            Maps cu toate opririle, clienții scadenți la vizita săptămânală,
            targetul la zi și <B>marfa din dubă</B> pentru van sales.
          </p>
          <p>
            Vânzarea la client se bate în 30 de secunde — sau deloc:{" "}
            <B>fotografiază factura și AI-ul o citește singur</B>, produs cu
            produs. Stocul dubei scade automat, seara vede câți bani predă.
          </p>
        </Slide>

        <Slide img="agent-harta" kicker="Harta pieței" title="Vede toată piața: clienții lui și firmele pe care nu le are nimeni" flip>
          <p>
            Pe baza celor <B>1,3 milioane de firme active din România</B>:
            bulele verzi = unde are clienți; cele portocalii = <B>pete albe</B> —
            magazine și baruri fără acoperire. Filtrează pe domeniu, apasă pe
            localitate, vede firmele cu telefon și buton de navigare.
          </p>
          <p>Prospectarea nu mai e pe pile și memorie — e pe hartă.</p>
        </Slide>

        <Slide img="firma-dashboard" kicker="Panoul patronului" title="Pulsul firmei, live, de oriunde">
          <p>
            Vizitele echipei azi, clienți, conversii, scadenți — și{" "}
            <B>Briefingul AI</B>: toate cifrele firmei comprimate în 5 fraze +
            3 acțiuni concrete pentru azi.
          </p>
        </Slide>

        <Slide img="firma-vanzari" kicker="Vânzări" title="Cine vinde, cine scade, pe ce brand — automat" flip>
          <p>
            Tragi raportul din <B>SAGA</B> (Excel/CSV — coloanele se detectează
            singure) și primești: evoluția lunară a fiecărui agent, matricea
            agent × brand, top clienți.
          </p>
          <p>
            Separat, <B>vânzările prin aplicație</B> — ce bat agenții pe
            telefon se vede LIVE, fără să aștepți exportul contabil.
          </p>
        </Slide>

        <Slide img="firma-comenzi" kicker="Comenzi & bani" title="Fiecare comandă, fiecare leu din teren">
          <p>
            Comenzile agenților ajung instant la depozit: nouă → pregătită →
            livrată. <B>„Dubele azi"</B> îți arată stocul fiecărei mașini și{" "}
            <B>câți bani are fiecare agent de predat</B> seara.
          </p>
          <p>
            Facturile fotografiate sunt atașate ca dovadă, iar exportul CSV
            intră direct în SAGA/Excel.
          </p>
        </Slide>

        <Slide img="firma-clienti" kicker="Clienți" title="Aduci toți clienții tăi în 5 minute" flip>
          <p>
            Tragi fișierul tău de clienți — <B>orice format</B>, cu sau fără
            CUI — și platforma îi potrivește cu firmele oficiale (adresă,
            telefon, hartă) și <B>îi distribuie automat pe agenți</B>. Agenții
            noi din fișier primesc singuri cont și link.
          </p>
          <p>
            Plus <B>soldurile</B>: agentul e avertizat înainte să ia comandă de
            la un client cu restanțe.
          </p>
        </Slide>

        <Slide img="firma-agenti" kicker="Echipa" title="Fiecare agent, cu evaluarea lui AI">
          <p>
            Linkuri de acces dintr-un click, concedii cu detectarea
            suprapunerilor, salarii (doar patronul), <B>evaluare AI</B> per
            agent — profil, puncte slabe, prognoză, cu cine să lucrezi.
          </p>
          <p>
            Agent plecat? <B>Îl blochezi instant</B> și îi muți tot
            portofoliul la altcineva dintr-un click.
          </p>
        </Slide>

        <Slide img="firma-raport" kicker="Raportul săptămânal" title="Lunea dimineața, toată săptămâna pe o pagină" flip>
          <p>
            Vizite, conversii, comenzi, target, restanțe + <B>rezumatul AI</B>{" "}
            — generat automat și trimis pe email. Îl deschizi la cafea și știi
            tot ce s-a întâmplat.
          </p>
        </Slide>

        <Slide img="login" kicker="Securitate" title="Datele tale, blindate ca la bancă">
          <p>
            Fiecare firmă e <B>izolată criptografic</B> — nimeni din afara ei
            nu vede nimic. Facturile sunt <B>criptate AES-256</B>,
            autentificarea are <B>2FA</B> (cod pe telefon), primești{" "}
            <B>alertă pe email</B> la orice conectare de pe un dispozitiv nou,
            iar linkurile agenților sunt legate de telefonul fiecăruia, cu PIN.
          </p>
          <p>Totul verificat cu peste 440 de teste automate, inclusiv simulări de atac.</p>
        </Slide>

        {/* CE URCI */}
        <section
          className="rounded-2xl border-2 border-[#161412] bg-white p-6 md:p-8"
          style={{ boxShadow: "6px 6px 0 rgba(22,20,18,0.9)" }}
        >
          <h2
            className="text-2xl font-extrabold text-[#161412]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            📂 Ce fișiere urci — și unde
          </h2>
          <div className="mt-4 grid gap-3 text-[15px] font-medium text-[#161412]/75 md:grid-cols-2">
            <p>📈 <B>Raportul de vânzări</B> (Excel/CSV din SAGA) → pagina Vânzări — intră automat în toate analizele.</p>
            <p>🏪 <B>Lista ta de clienți</B> (orice format) → pagina Clienți — potrivire + distribuție pe agenți.</p>
            <p>💰 <B>Soldurile/restanțele</B> → pagina Solduri — avertizări la clienții datornici.</p>
            <p>📷 <B>Facturile din teren</B> → nu se urcă: agentul le fotografiază și AI-ul le citește.</p>
          </div>
          <p className="mt-4 text-sm font-semibold text-[#161412]/50">
            Toate merg cu diacritice, orice encoding, cu sau fără antet — le-am
            testat pe fișiere românești reale.
          </p>
        </section>

        {/* CTA FINAL */}
        <section className="pb-8 text-center">
          <h2
            className="text-2xl font-extrabold text-[#161412]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            Convinge-te singur — în 3 minute
          </h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] font-medium text-[#161412]/65">
            Demo-ul e platforma adevărată, cu date de probă. Fără cont, fără
            instalare, fără niciun risc.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <a
              href="/api/agentie/demo-login?rol=patron"
              className="rounded-xl border-2 border-[#161412] bg-[#ff4d00] px-6 py-3 text-[16px] font-black text-white transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              style={{ boxShadow: "4px 4px 0 #161412" }}
            >
              Intră ca PATRON →
            </a>
            <a
              href="/api/agentie/demo-login?rol=agent"
              className="rounded-xl border-2 border-[#161412] bg-white px-6 py-3 text-[16px] font-black text-[#161412] transition hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none"
              style={{ boxShadow: "4px 4px 0 #161412" }}
            >
              Intră ca AGENT →
            </a>
          </div>
          <p className="mt-6 text-sm font-semibold text-[#161412]/45">
            <Link href="/ghid" className="underline">
              Ghidul complet al funcțiilor
            </Link>{" "}
            ·{" "}
            <Link href="/" className="underline">
              Prima pagină
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
