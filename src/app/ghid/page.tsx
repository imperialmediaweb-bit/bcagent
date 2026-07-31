import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ghidul BC Agent — ce face fiecare funcție",
  description:
    "Ghid complet pe panouri: agent de teren, manager/patron, administrator. Fiecare funcție explicată pe scurt.",
};

/**
 * GHIDUL PLATFORMEI: fiecare funcție din fiecare panou, explicată pe
 * limba utilizatorului. Pagină publică — se trimite ca link oricui.
 */

function Row({ icon, name, children }: { icon: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-[#161412]/10 py-3 last:border-0">
      <span className="w-7 shrink-0 text-center text-lg">{icon}</span>
      <div>
        <p className="font-bold text-[#161412]">{name}</p>
        <p className="text-sm text-[#161412]/70">{children}</p>
      </div>
    </div>
  );
}

function Panel({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div
        className="rounded-2xl border-2 border-[#161412] bg-white p-6"
        style={{ boxShadow: "6px 6px 0 rgba(22,20,18,0.9)" }}
      >
        <h2
          className="text-xl font-extrabold text-[#161412]"
          style={{ fontFamily: "var(--font-display), sans-serif" }}
        >
          {title}
        </h2>
        <p className="mt-0.5 text-sm font-medium text-[#161412]/60">{subtitle}</p>
        <div className="mt-3">{children}</div>
      </div>
    </section>
  );
}

export default function GhidPage() {
  return (
    <main
      className="min-h-screen px-4 py-10"
      style={{
        background: "#f5efe4",
        backgroundImage: "radial-gradient(#16141208 1.1px, transparent 1.1px)",
        backgroundSize: "22px 22px",
        fontFamily: "var(--font-body), system-ui, sans-serif",
      }}
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="text-center">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-[#161412] bg-[#ff4d00] text-xl font-black text-white"
              style={{ boxShadow: "4px 4px 0 #161412" }}
            >
              B
            </span>
            <span
              className="text-2xl font-extrabold tracking-tight text-[#161412]"
              style={{ fontFamily: "var(--font-display), sans-serif" }}
            >
              BC AGENT
            </span>
          </Link>
          <h1
            className="mt-5 text-3xl font-extrabold text-[#161412]"
            style={{ fontFamily: "var(--font-display), sans-serif" }}
          >
            Ghidul platformei
          </h1>
          <p className="mt-1 font-medium text-[#161412]/60">
            Ce face fiecare funcție, pe fiecare panou — pe scurt și pe românește.
          </p>
          <nav className="mt-4 flex flex-wrap justify-center gap-2 text-sm font-bold">
            <a href="#agent" className="rounded-full border-2 border-[#161412] bg-[#ffd23f] px-3 py-1">📱 Agentul</a>
            <a href="#firma" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">🏢 Manager / Patron</a>
            <a href="#admin" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">⚙️ Administrator</a>
            <a href="#intrare" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">🔑 Cum intri</a>
          </nav>
        </header>

        <Panel
          id="agent"
          title="📱 Panoul AGENTULUI de teren"
          subtitle="Se deschide din linkul primit de la manager — pe telefon, fără parolă (doar PIN-ul propriu)."
        >
          <Row icon="🌅" name="Ziua mea">
            Primul lucru de dimineață: ruta de azi, clienții de vizitat săptămâna
            asta, vizitele și comenzile de azi, cât ai făcut din target. Butonul
            „Pornește ruta" deschide Google Maps cu toate opririle în ordine.
          </Row>
          <Row icon="🚐" name="Marfa din mașină (van)">
            Dimineața bagi ce ai încărcat în dubă. Fiecare vânzare „pe loc" scade
            stocul singură. Seara dai retur ce n-ai vândut și vezi câți bani ai
            de predat (numerarul zilei).
          </Row>
          <Row icon="🗺️" name="Harta pieței">
            Toate firmele din zona ta pe hartă: bulele verzi = ai clienți acolo,
            portocalii = „pete albe" (firme fără acoperire — potențial). Filtrezi
            pe domeniu (alimentare / baruri / ce vrei), apeși pe o localitate și
            vezi firmele: telefon, navigare, fișă, comandă.
          </Row>
          <Row icon="📋" name="Am fost (jurnalul de vizite)">
            La fiecare client apeși ce s-a întâmplat: „client" / „se mai
            gândește" / „ne sună" / „nu vrea" + o notă (o poți dicta cu
            microfonul). Din asta se calculează cine e scadent la vizita
            săptămânală.
          </Row>
          <Row icon="🧭" name="Rute">
            Îți construiești rute din firme (coșul de rută) sau apeși „Fă-mi ruta
            din ei" pe clienții scadenți. Rutele se salvează pe zile — cea de azi
            apare automat în „Ziua mea".
          </Row>
          <Row icon="🛒" name="Comandă / Vânzare pe loc">
            La client: 📦 „Comandă la depozit" (pleacă la depozit pentru livrare)
            sau 🚐 „Vând pe loc" (marfa din dubă, încasezi numerar/card/termen).
            Fără semnal? Comanda rămâne salvată local și o retrimiți.
          </Row>
          <Row icon="📷" name="Poză la factură">
            Fotografiezi factura (tipărită sau de mână) și AI-ul o citește:
            completează singur produsele, cantitățile și prețurile. Tu doar
            verifici și salvezi. Poza rămâne atașată ca dovadă.
          </Row>
          <Row icon="📂" name="Încarcă fișier de vânzări">
            Tragi XLS/CSV-ul cu vânzările tale și toate analizele se calculează
            singure: evoluție, top clienți, top produse, comparații.
          </Row>
          <Row icon="🧠" name="Analiza AI + Antrenorul">
            Analiza îți spune ce mișcă în cifrele tale. Antrenorul e un coach de
            vânzări care ȘTIE cifrele tale: îl întrebi orice (și pe voce), îi
            trimiți poze de la raft și îți spune ce să aranjezi, simulezi
            obiecțiile clienților, îți face plan de dezvoltare.
          </Row>
          <Row icon="👤" name="Fișă de client">
            Apeși 📋 pe orice firmă și AI-ul îți face fișa: istoric, restanțe,
            vizite, ce să-i propui data viitoare.
          </Row>
          <Row icon="🎯" name="Targetul meu">
            Cât ai de făcut luna asta, cât ai făcut, și clasamentul echipei —
            vezi unde ești față de colegi.
          </Row>
          <Row icon="🧾" name="Decont">
            Bagi cheltuielile de pe teren (combustibil, masă) cu bonul — ajung
            la manager pentru aprobare.
          </Row>
          <Row icon="🔐" name="PIN-ul tău">
            La prima deschidere a linkului îți setezi un PIN de 4-6 cifre.
            Linkul tău NU se deschide pe alt telefon fără PIN. L-ai uitat? Îl
            resetează managerul.
          </Row>
          <Row icon="🐛" name="Raportează o problemă">
            Ceva nu merge? Apeși butonul de problemă, scrii ce s-a întâmplat și
            AI-ul îți dă pe loc o soluție; problema ajunge și la administrator.
          </Row>
        </Panel>

        <Panel
          id="firma"
          title="🏢 Panoul FIRMEI — manager și patron"
          subtitle="Se intră cu email + parolă pe /agentie/login. Managerul vede tot; salariile și echipa sunt doar ale patronului."
        >
          <Row icon="📊" name="Dashboard">
            Pulsul firmei: vizite azi/săptămână, clienți, scadenți, conversii.
            „Briefingul AI" comprimă totul în 5 fraze + 3 acțiuni concrete.
          </Row>
          <Row icon="📈" name="Vânzări">
            Încarci raportul din SAGA (XLS/CSV — coloanele se detectează
            singure) și primești: evoluția lunară pe fiecare agent, matricea
            agent × brand, top clienți. Separat, „Vânzări prin aplicație" —
            ce au bătut agenții pe telefon (facturi, van), LIVE.
          </Row>
          <Row icon="📦" name="Comenzi">
            Tot ce trimit agenții din teren, live: le treci prin stări (nouă →
            pregătită → livrată), vezi vânzările van cu badge, deschizi poza
            facturii, iar „Dubele azi" îți arată stocul fiecărei mașini și{" "}
            <strong>câți bani are fiecare agent de predat</strong>. Export CSV
            gata de SAGA/Excel.
          </Row>
          <Row icon="🎯" name="Targeturi">
            Setezi targetul lunar al fiecărui agent; progresul se calculează
            singur din vânzări și îl vede și agentul.
          </Row>
          <Row icon="👥" name="Agenți">
            Adaugi agenți și le generezi linkul de panou (îl trimiți pe
            WhatsApp). Tot de aici: concedii (cu detectarea suprapunerilor!),
            blocarea INSTANT a unui agent plecat, resetarea PIN-ului, evaluarea
            AI a fiecărui agent (profil, puncte slabe, prognoză) și — doar
            patronul — salariile.
          </Row>
          <Row icon="🔁" name="Transfer portofoliu">
            Când un agent pleacă: toți clienții lui trec la alt agent dintr-un
            click, iar accesul lui moare pe loc.
          </Row>
          <Row icon="🏪" name="Clienți">
            Toți clienții firmei, cu agent și ultima vizită. „Adu universul de
            clienți": tragi fișierul tău (orice format) și clienții se
            potrivesc cu firmele oficiale și{" "}
            <strong>se distribuie singuri pe agenți</strong> — agenții noi din
            fișier primesc automat cont și link. Realoci orice client din
            dropdown-ul de pe rând.
          </Row>
          <Row icon="💰" name="Solduri">
            Încarci fișierul de solduri și restanțele apar la fiecare client —
            agentul e avertizat înainte să ia comandă nouă de la un rău-platnic.
          </Row>
          <Row icon="🧾" name="Decont">
            Cheltuielile trimise de agenți: aprobi sau respingi, cu totaluri pe
            lună.
          </Row>
          <Row icon="📅" name="Vizite">
            Jurnalul complet al echipei pe teren: cine, unde, când, cu ce
            rezultat.
          </Row>
          <Row icon="📬" name="Raportul săptămânal">
            Toată săptămâna în o pagină: vizite, conversii, comenzi, target,
            scadenți, restanțe + rezumat AI. Îl primești și pe email, lunea
            dimineața.
          </Row>
          <Row icon="👔" name="Echipa (doar patronul)">
            Patronul adaugă conturi de manageri/supervizori — fiecare cu emailul
            și parola lui.
          </Row>
          <Row icon="🔒" name="Setări & securitate">
            Schimbi parola, activezi 2FA (cod Google Authenticator la login),
            vezi istoricul conectărilor și dispozitivele cunoscute. La login de
            pe un aparat nou primești alertă pe email.
          </Row>
        </Panel>

        <Panel
          id="admin"
          title="⚙️ Panoul ADMINISTRATORULUI platformei"
          subtitle="Pentru proprietarul BC Agent — /platform/login."
        >
          <Row icon="🏢" name="Organizații">
            Toate firmele-client: le creezi, le suspendezi, le setezi planul și
            limita de agenți, le faci conturile de patron.
          </Row>
          <Row icon="💳" name="Planuri & Facturi">
            Prețurile abonamentelor (pe agenți + funcții AI) și facturile
            emise; se conectează la Stripe pentru încasare automată.
          </Row>
          <Row icon="🐛" name="Probleme">
            Tot ce raportează utilizatorii, cu diagnosticul AI atașat — le
            treci prin stări până la rezolvat.
          </Row>
          <Row icon="🎬" name="Firma DEMO">
            Un buton reface oricând firma demo cu date vii — pentru prezentări.
            Butoanele „Vezi DEMO" de pe login intră direct în ea.
          </Row>
          <Row icon="🗃️" name="Import firme (/admin)">
            Unealta cu care se încarcă baza celor 1,3M de firme din România
            (fișierul MF) și verificarea ANAF — sursa hărții și a prospecților.
          </Row>
        </Panel>

        <Panel id="intrare" title="🔑 Cum intri" subtitle="Trei uși, trei feluri de oameni.">
          <Row icon="📱" name="Agent">
            Fără parolă: primești un link personal de la manager. Prima
            deschidere → îți setezi PIN-ul. Salvează pagina pe ecranul
            telefonului (Adaugă la ecranul principal) și o folosești ca pe o
            aplicație.
          </Row>
          <Row icon="🏢" name="Patron / Manager">
            <Link href="/agentie/login" className="font-bold underline">
              /agentie/login
            </Link>{" "}
            cu email + parola primită. Vrei doar să vezi cum arată? Butonul
            galben „Vezi DEMO" te bagă într-o firmă de probă, pe orice rol.
          </Row>
          <Row icon="⚙️" name="Administrator">
            <Link href="/platform/login" className="font-bold underline">
              /platform/login
            </Link>{" "}
            — contul proprietarului platformei.
          </Row>
        </Panel>

        <footer className="pb-6 text-center text-sm font-semibold text-[#161412]/45">
          <Link href="/" className="underline">← Înapoi la prima pagină</Link>
        </footer>
      </div>
    </main>
  );
}
