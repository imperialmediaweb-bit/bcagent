import Link from "next/link";
import Logo from "@/app/Logo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ghidul Provendi — ce face fiecare funcție",
  description:
    "Ghid complet: agentul de teren și panoul firmei (manager/administrator). Fiecare funcție explicată pe scurt, pas cu pas.",
};

/**
 * GHIDUL PLATFORMEI: fiecare funcție din fiecare panou, explicată pe
 * limba utilizatorului. Pagină publică — se trimite ca link oricui.
 */

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-[#161412]">{children}</strong>;
}

function Row({ icon, name, children }: { icon: string; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-[#161412]/10 py-3 last:border-0">
      <span className="w-7 shrink-0 text-center text-lg">{icon}</span>
      <div className="min-w-0">
        <p className="font-bold text-[#161412]">{name}</p>
        <p className="break-words text-sm text-[#161412]/70">{children}</p>
      </div>
    </div>
  );
}

/** Un pas numerotat din training — scris ca pentru cineva care n-a mai
 *  folosit niciodată o aplicație de teren. */
function Pas({ n, titlu, children }: { n: number | string; titlu: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-[#161412] bg-[#ffd23f] text-sm font-black text-[#161412]">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-bold text-[#161412]">{titlu}</p>
        <p className="break-words text-sm text-[#161412]/75">{children}</p>
      </div>
    </div>
  );
}

/** Bloc de text gata de copiat (mesaj WhatsApp, scenariu de instruire). */
function DeCopiat({ titlu, children }: { titlu: string; children: React.ReactNode }) {
  return (
    <div className="my-3 rounded-xl border-2 border-dashed border-[#161412]/40 bg-[#fdf3d8] p-4">
      <p className="mb-2 text-xs font-black uppercase tracking-widest text-[#161412]/60">
        {titlu}
      </p>
      <p className="whitespace-pre-line break-words text-sm leading-relaxed text-[#161412]">
        {children}
      </p>
    </div>
  );
}

/** Avertisment scurt, de tipul „aici se împiedică toată lumea”. */
function Atentie({ children }: { children: React.ReactNode }) {
  return (
    <p className="my-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
      ⚠️ {children}
    </p>
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
          className="break-words text-xl font-extrabold text-[#161412]"
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
            <Logo />
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
            <a href="#training" className="rounded-full border-2 border-[#161412] bg-[#ff4d00] px-3 py-1 text-white">🎓 Training de la zero</a>
            <a href="#agent" className="rounded-full border-2 border-[#161412] bg-[#ffd23f] px-3 py-1">📱 Agentul</a>
            <a href="#pascupas" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">📖 Pas cu pas</a>
            <a href="#firma" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">🏢 Manager / Administrator</a>
            <a href="#pascupasfirma" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">📖 Pas cu pas firmă</a>
            <a href="#intrare" className="rounded-full border-2 border-[#161412] bg-white px-3 py-1">🔑 Cum intri</a>
          </nav>
        </header>

        <Panel
          id="training"
          title="🎓 TRAINING de la zero"
          subtitle="Citește asta o dată și poți porni firma singur. Nu trebuie să te învețe nimeni, nimic."
        >
          <p className="mb-4 rounded-xl border-2 border-[#161412] bg-[#f5efe4] p-4 text-sm text-[#161412]">
            <B>Ce e Provendi, în 3 fraze.</B> Agenții tăi umblă pe teren cu
            telefonul și bat acolo ce fac: la cine au fost, ce au vândut, ce
            comandă lasă. Tu, la birou, vezi totul în aceeași secundă — fără
            telefoane de seară și fără caiete. În plus, ai pe hartă 1,3
            milioane de firme din România, ca să vezi unde ai clienți și unde
            e piață liberă.
          </p>

          <h3 className="mt-5 text-base font-extrabold text-[#161412]">
            Cine ce face — 3 feluri de oameni, 3 uși
          </h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {[
              {
                cine: "🏢 Administrator",
                intra: "email + parolă",
                face: "tot: agenți, salarii, echipă, fișiere, bani",
              },
              {
                cine: "👔 Manager",
                intra: "email + parolă",
                face: "tot operaționalul; NU vede salarii, NU face conturi",
              },
              {
                cine: "📱 Agent",
                intra: "link pe WhatsApp + PIN propriu",
                face: "doar clienții LUI: vizite, comenzi, rute, dubă",
              },
            ].map((r) => (
              <div
                key={r.cine}
                className="rounded-xl border-2 border-[#161412] bg-[#f5efe4] p-3"
              >
                <p className="font-black text-[#161412]">{r.cine}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wide text-[#161412]/50">
                  cum intră
                </p>
                <p className="text-sm text-[#161412]/80">{r.intra}</p>
                <p className="mt-1.5 text-xs font-bold uppercase tracking-wide text-[#161412]/50">
                  ce face
                </p>
                <p className="text-sm text-[#161412]/80">{r.face}</p>
              </div>
            ))}
          </div>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            LECȚIA 1 · Administratorul — prima oră (7 pași)
          </h3>
          <Pas n={1} titlu="Îți faci contul">
            Intri pe <B>provendi.ro</B> → butonul portocaliu{" "}
            <B>14 zile gratuite</B> → scrii numele firmei, numele tău, un email
            și o parolă de minim 8 caractere → <B>Creează contul</B>. Ești
            înăuntru. Nu trebuie card.
          </Pas>
          <Pas n={2} titlu="Adaugi agenții">
            Din meniul din stânga: <B>Agenți</B> → <B>Adaugă agent</B> → scrii
            numele lui (exact cum apare în rapoartele tale de vânzări!) →
            salvezi.
            <Atentie>
              Scrie numele agentului EXACT cum e în fișierul din SAGA. Dacă în
              fișier scrie „Popescu Ion” și tu pui „Ion Popescu”, platforma nu
              le leagă și agentul apare fără vânzări.
            </Atentie>
          </Pas>
          <Pas n={3} titlu="Le trimiți linkul">
            Pe rândul fiecărui agent ai butonul <B>Copiază linkul</B>. Îl
            lipești în WhatsApp-ul lui, cu mesajul gata scris de mai jos.
          </Pas>
          <Pas n={4} titlu="Aduci clienții">
            <B>Clienți</B> → <B>Adu universul de clienți</B> → tragi fișierul
            tău (Excel sau CSV, orice format). Platforma recunoaște singură
            coloanele, potrivește firmele după CUI sau nume și{" "}
            <B>le împarte pe agenți</B> după coloana de agent din fișier. Dacă
            un agent din fișier n-are cont, i-l face automat.
          </Pas>
          <Pas n={5} titlu="Încarci vânzările">
            <B>Vânzări</B> → tragi raportul din SAGA. De aici se calculează
            singure: evoluția pe luni, agent × brand, top clienți, prognozele.
            Poți încărca oricâte luni.
          </Pas>
          <Pas n={6} titlu="Încarci restanțele">
            <B>Solduri</B> → fișierul cu datorii (ajunge CUI + sumă). De acum,
            agentul vede cu roșu restanța ÎNAINTE să ia comandă nouă de la un
            rău-platnic.
          </Pas>
          <Pas n={7} titlu="Pui targetul lunii">
            <B>Targeturi</B> → alegi luna → scrii suma la fiecare agent. Ei își
            văd procentul în telefon, tu vezi clasamentul.
          </Pas>
          <p className="mt-2 text-sm font-semibold text-[#161412]">
            Gata. De aici totul curge singur din teren, fără să mai faci nimic.
          </p>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            LECȚIA 2 · Managerul — cum arată o zi
          </h3>
          <Pas n="D" titlu="Dimineața, 5 minute">
            Deschizi <B>Dashboard</B> → citești briefingul AI (5 fraze, 3
            acțiuni). Vezi cine e pe teren, cine e în concediu, câți clienți
            sunt scadenți.
          </Pas>
          <Pas n="Z" titlu="Peste zi, când sună telefonul">
            <B>Comenzi</B> stă deschis: comenzile intră singure, pe măsură ce
            agenții le bat la clienți. Le treci prin stări:{" "}
            <B>nouă → pregătită → livrată</B>. Contabila apasă{" "}
            <B>Export CSV</B> și îl bagă în SAGA.
          </Pas>
          <Pas n="S" titlu="Seara, 10 minute">
            În <B>Comenzi</B>, cardul <B>Dubele azi</B> îți arată, pentru
            fiecare agent, <B>câți bani are de predat</B>. Compari cu banii pe
            care ți-i dă în mână. Apoi <B>Decont</B> → aprobi cheltuielile.
          </Pas>
          <Pas n="L" titlu="Lunea">
            Îți vine pe email raportul săptămânal: vizite, conversii, comenzi,
            target, restanțe + rezumat AI. Nu faci nimic ca să-l primești.
          </Pas>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            LECȚIA 3 · Agentul — prima zi pe teren (pe telefon)
          </h3>
          <Pas n={1} titlu="Deschide linkul primit pe WhatsApp">
            Apasă pe link → își alege un <B>PIN de 4 cifre</B> (unul pe care îl
            ține minte) → gata, e înăuntru. Fără parolă, fără cont, fără
            instalare din magazin.
          </Pas>
          <Pas n={2} titlu="Pune aplicația pe ecran">
            Din meniul browserului: <B>Adaugă la ecranul principal</B>. De
            atunci o deschide cu o iconiță, ca pe orice aplicație.
          </Pas>
          <Pas n={3} titlu="Dimineața: ce are de făcut azi">
            Primul ecran, <B>Ziua mea</B>: ruta de azi, clienții de vizitat,
            cât are din target. Apasă <B>Pornește ruta</B> → se deschide Google
            Maps cu toate opririle, în ordine.
          </Pas>
          <Pas n={4} titlu="La client: marchează vizita">
            Pe firmă apasă <B>Am fost</B>. Se deschide dictarea rapidă: apeși
            pe <B>🎤</B> și <B>spui repede tot ce a zis clientul</B> — textul
            se scrie singur, live, cât vorbești (nu trebuie să tastezi nimic).
            Apeși din nou pe microfon când ai terminat. Apoi alegi ce s-a
            întâmplat: <B>client</B> / <B>se mai gândește</B> /{" "}
            <B>ne sună</B> / <B>nu vrea</B> — și nota dictată se salvează cu el.
            <Atentie>
              Asta e SINGURUL lucru pe care agentul trebuie să-l facă
              obligatoriu la fiecare client. Din el ies toate rapoartele. Dacă
              nu bifează, pentru firmă e ca și cum n-a fost acolo.
            </Atentie>
          </Pas>
          <Pas n={5} titlu="Ia comanda sau vinde pe loc">
            Apasă 🛒 pe firmă. Dacă marfa pleacă de la depozit:{" "}
            <B>Comandă la depozit</B>. Dacă vinde din mașină:{" "}
            <B>Vând pe loc</B> → produsele + prețul → cum a încasat
            (numerar/card/termen) → salvează.
          </Pas>
          <Pas n={6} titlu="Are factură scrisă? O fotografiază">
            <B>Poză la factură</B> → AI-ul citește produsele, cantitățile și
            prețurile în 3 secunde. Agentul doar verifică și salvează.
            <Atentie>
              La facturile scrise de mână apare un avertisment galben:
              agentul TREBUIE să compare cifrele cu hârtia. 1 seamănă cu 7, 4
              cu 9. Nu-l sări.
            </Atentie>
          </Pas>
          <Pas n={7} titlu="Seara: retur și bani">
            <B>Marfa din mașină</B> → <B>Retur la depozit</B> pentru ce n-a
            vândut. Aplicația îi spune exact <B>câți bani are de predat</B>.
            Apoi <B>Decont</B> pentru motorină și masă.
          </Pas>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            Cum îți instruiești agenții — scenariu de 15 minute
          </h3>
          <p className="text-sm text-[#161412]/75">
            Adună agenții, cu telefoanele în mână. Nu le explica ce e platforma
            — pune-i să facă. Ordinea asta funcționează:
          </p>
          <Pas n={1} titlu="Minutul 1–3: intră toți">
            Le trimiți linkurile pe WhatsApp în fața ta. Fiecare îl deschide și
            își pune PIN-ul. Aștepți până confirmă TOȚI că au intrat.
          </Pas>
          <Pas n={2} titlu="Minutul 4–5: pun aplicația pe ecran">
            Toți fac <B>Adaugă la ecranul principal</B>. Cine sare pasul ăsta o
            să-ți ceară linkul din nou peste două zile.
          </Pas>
          <Pas n={3} titlu="Minutul 6–10: fac o vizită FALSĂ, în fața ta">
            Pe orice firmă de pe hartă: <B>Am fost</B> → aleg un rezultat →
            dictează o notă cu microfonul. Îi pui să facă asta o dată singuri.
            Ăsta e obiceiul care decide totul.
          </Pas>
          <Pas n={4} titlu="Minutul 11–14: fac o comandă de probă">
            Un produs, o cantitate, un preț → trimit. Le arăți pe laptopul tău
            că a apărut instant în <B>Comenzi</B>. Momentul ăsta îi convinge
            mai mult decât orice explicație.
          </Pas>
          <Pas n={5} titlu="Minutul 15: le spui o singură regulă">
            <B>„La fiecare client, apeși Am fost. Atât.”</B> Restul se învață
            de la sine în două zile.
          </Pas>
          <Atentie>
            Nu le arăta tot din prima. Harta, Antrenorul AI, rutele, targetul —
            le descoperă singuri în prima săptămână. Dacă le arăți tot în 15
            minute, nu rețin nimic.
          </Atentie>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            Mesaje gata de copiat
          </h3>
          <DeCopiat titlu="Pentru agent, pe WhatsApp, odată cu linkul">
            {`Salut! De azi lucrăm cu Provendi — tot ce faci pe teren se bate aici, pe telefon. Nu mai trebuie caiet și nu mă mai suni seara cu raportul.

Uite linkul TĂU (e doar al tău, nu-l da nimănui):
<pui aici linkul copiat din Agenți>

Ce faci prima dată, 2 minute:
1. Deschizi linkul → îți alegi un PIN de 4 cifre (ține-l minte)
2. Din meniul browserului: „Adaugă la ecranul principal” → o deschizi ca pe o aplicație
3. Gata

Singurul lucru obligatoriu: la FIECARE client apeși „Am fost” și alegi ce s-a întâmplat. Poți dicta nota cu microfonul, nu trebuie să scrii.

Comenzile le bați tot acolo și ajung instant la depozit. Dacă n-ai semnal, comanda rămâne salvată în telefon și pleacă singură când revine netul.

Dacă ceva nu merge, apeși butonul 💬 din aplicație și scrii — se rezolvă rapid.`}
          </DeCopiat>
          <DeCopiat titlu="Pentru patron, când îi prezinți platforma">
            {`Am pus firma pe Provendi. Pe scurt ce se schimbă:

· Agenții bat comenzile pe telefon la client — ajung la depozit în aceeași secundă, nu seara.
· Vezi live cine unde a fost, ce a vândut, cine e sub target.
· Restanțele apar la agent ÎNAINTE să lase marfă nouă la un rău-platnic.
· Vânzările din SAGA se încarcă într-un fișier și toate analizele se fac singure.
· 1,3 milioane de firme pe hartă: unde avem clienți și unde e piață liberă.
· Pleacă un agent? Un buton: portofoliul trece la altul, linkul lui moare instant.

14 zile gratuit, fără card: provendi.ro
Vrei să vezi înainte cum arată? Intri în demo, fără cont: provendi.ro/prezentare`}
          </DeCopiat>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            Ce te vor întreba agenții — răspunsurile, gata scrise
          </h3>
          <Row icon="❓" name="Îmi vede șeful unde sunt cu telefonul?">
            Nu. Platforma NU urmărește poziția agentului. Se vede doar ce
            bifează el singur: la ce client a fost și ce s-a întâmplat acolo.
          </Row>
          <Row icon="❓" name="Îmi consumă net / date mobile?">
            Foarte puțin — cât o conversație pe WhatsApp. Pozele la facturi se
            micșorează automat înainte de trimitere.
          </Row>
          <Row icon="❓" name="Dacă nu am semnal în sat?">
            Comanda rămâne salvată în telefon și pleacă singură când revine
            netul. Nu se pierde și nu se trimite de două ori.
          </Row>
          <Row icon="❓" name="Am pierdut telefonul / mi l-a luat cineva">
            Fără PIN nu intră nimeni, nici cu linkul. Spui managerului, el
            resetează PIN-ul sau blochează accesul — moare instant.
          </Row>
          <Row icon="❓" name="Trebuie să-mi instalez ceva?">
            Nu. E linkul din WhatsApp. Îl pui pe ecranul telefonului și arată
            ca o aplicație normală.
          </Row>
          <Row icon="❓" name="Dacă greșesc o comandă?">
            Managerul o anulează din panou. Comenzile nu se șterg, ca să rămână
            urma — dar starea se schimbă.
          </Row>

          <h3 className="mt-6 text-base font-extrabold text-[#161412]">
            Cele 5 greșeli pe care le face toată lumea la început
          </h3>
          <Row icon="1️⃣" name="Numele agentului scris altfel decât în SAGA">
            Vânzările nu se leagă de agent. Se rezolvă scriind numele EXACT ca
            în fișier, la <B>Agenți</B>.
          </Row>
          <Row icon="2️⃣" name="Agentul nu apasă Am fost">
            Nu apare nicăieri că a muncit. Rapoartele ies goale, iar el se
            supără pe platformă. Repetă regula asta până se prinde.
          </Row>
          <Row icon="3️⃣" name="Fișierul de vânzări încărcat de două ori">
            Nu mai e o problemă — platforma îl recunoaște și îți spune că e
            deja încărcat, nu dublează cifrele. Dar nu te speria dacă vezi
            mesajul.
          </Row>
          <Row icon="4️⃣" name="Agentul deschide linkul pe alt telefon">
            Îi cere PIN-ul. Dacă l-a uitat, managerul îl resetează din{" "}
            <B>Agenți</B>. Nu trebuie link nou.
          </Row>
          <Row icon="5️⃣" name="Se așteaptă ca AI-ul să fie perfect la facturi de mână">
            Nu e. De aia apare avertismentul galben. Agentul verifică cifrele —
            durează 10 secunde și scapă de greșeli.
          </Row>
        </Panel>

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
            completează singur produsele, cantitățile și prețurile. La scris de
            mână citește cu dublă verificare și te avertizează să compari tu
            fiecare cifră cu factura înainte să salvezi. Ai mai multe facturi
            pe aceeași livrare? Apeși „＋ Încă o factură" și produsele se pun
            unele sub altele. Toate pozele rămân atașate ca dovadă.
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
          id="pascupas"
          title="📖 Pas cu pas — rețetele agentului"
          subtitle="Exact ce apeși, în ordine. Pentru prima săptămână pe platformă."
        >
          <Row icon="🧭" name="Cum îmi fac o RUTĂ din hartă">
            1) Deschide <B>Harta pieței</B> și alege domeniul (alimentare /
            baruri). 2) Apasă pe bula unei localități → se deschide lista
            firmelor de acolo. 3) La fiecare firmă care te interesează apasă{" "}
            <B>„+ Rută"</B> — se adună în coșul de rută (îl vezi jos, cu
            numărul de opriri). 4) Când ai terminat, apasă pe coș →{" "}
            <B>„Salvează ruta"</B> → îi dai un nume și alegi ziua din
            săptămână (ex. „Ruta Rădăuți — marți"). 5) Gata: în ziua aia, ruta
            apare automat sus, în „Ziua mea".
          </Row>
          <Row icon="⚡" name="Cum îmi face AI-ul ruta SINGUR">
            În cardul <B>„De vizitat săptămâna asta"</B> (clienții pe care nu
            i-ai văzut de 7 zile) apasă <B>„Fă-mi ruta din ei"</B> — se
            construiește singură din scadenți. O salvezi pe azi și pornești.
          </Row>
          <Row icon="🚗" name="Cum pornesc NAVIGAREA">
            Din „Ziua mea" apasă <B>„Pornește ruta de azi"</B> → se deschide
            Google Maps cu opririle în ordine; apeși Start și te duce din
            client în client. Pentru o singură firmă: butonul{" "}
            <B>„Navighează"</B> de pe firmă.
          </Row>
          <Row icon="🌗" name="Dacă ruta NU încape într-o zi">
            Google Maps ia maximum 10 opriri într-un drum, așa că ruta lungă
            se împarte singură în <B>etape</B>: „Etapa 1 (10 opriri)", „Etapa
            2 (…)" — le pornești pe rând, nu se pierde niciun client. Iar dacă
            te prinde seara la jumătate: fiecare client la care ai apăsat{" "}
            <B>„Am fost"</B> iese din rută, iar butonul devine{" "}
            <B>„Continuă ruta (X rămase)"</B> — a doua zi pleci exact de unde
            ai rămas. Când termini tot, ruta se marchează <B>gata ✓</B>.
          </Row>
          <Row icon="🏳️" name="Cum sar din zonele neacoperite direct pe firme">
            Sub hartă ai <B>„Cele mai mari zone neacoperite"</B> — apeși pe o
            localitate și ecranul urcă singur la hartă, cu lista firmelor de
            acolo deschisă în dreapta: telefon, navigare, fișă, comandă,
            „+ Rută".
          </Row>
          <Row icon="✍️" name="Cum marchez VIZITA (obligatoriu la fiecare client)">
            Pe firma la care ai fost apasă <B>„Am fost"</B> și alege:{" "}
            <B>client</B> (a cumpărat) / <B>se mai gândește</B> /{" "}
            <B>ne sună</B> / <B>nu vrea</B>. Poți adăuga o notă — apasă
            microfonul și <B>dictează</B>, se scrie singură. Din asta se
            calculează scadenții și rapoartele șefului.
          </Row>
          <Row icon="🚐" name="Cum VÂND PE LOC din dubă (van)">
            Dimineața: cardul „Marfa din mașină" → <B>„Încarc marfă"</B> →
            scrii ce ai luat în dubă. La client: 🛒 pe firmă → alege{" "}
            <B>„🚐 Vând pe loc"</B> → produsele + prețul → alege cum ai
            încasat (numerar/card/termen) → <B>„Încasează și salvează"</B>.
            Stocul scade singur. Seara: „Retur la depozit" pentru ce n-ai
            vândut — și vezi câți bani ai de predat.
          </Row>
          <Row icon="📷" name="Cum citesc FACTURA cu poza">
            În fereastra de comandă apasă <B>„📷 Poză la factură"</B> →
            fotografiază factura (merge și scrisă de mână) → în 3 secunde
            AI-ul completează singur produsele, cantitățile și prețurile → tu
            doar verifici și salvezi. <B>Important la scrisul de mână:</B>{" "}
            aplicația te avertizează cu galben — compară TU fiecare cifră cu
            factura din mână (1 seamănă cu 7, 4 cu 9) înainte să salvezi.
            Mai ai o factură pentru aceeași livrare? <B>„＋ Încă o factură"</B>{" "}
            — produsele se adaugă dedesubt și toate pozele rămân atașate.
          </Row>
          <Row icon="📦" name="Cum trimit COMANDĂ la depozit">
            La fel ca vânzarea pe loc, dar lași selectat{" "}
            <B>„📦 Comandă la depozit"</B> — comanda pleacă instant la firmă
            pentru pregătire și livrare. Fără semnal? Rămâne salvată pe
            telefon și o retrimiți când ai net.
          </Row>
          <Row icon="👥" name="Cum îmi aduc CLIENȚII mei în aplicație">
            Secțiunea Clienți → <B>„Sau fișierul tău de clienți"</B> → tragi
            Excel-ul/CSV-ul tău (orice format) → clienții se potrivesc cu
            firmele oficiale și intră în portofoliul tău, cu telefon și
            adresă pe hartă.
          </Row>
          <Row icon="🎓" name="Cum folosesc ANTRENORUL">
            Scrie-i sau <B>dictează-i</B> orice: „ce clienți să vizitez azi?",
            „cum răspund când zice că e scump?". Știe cifrele TALE. Trimite-i{" "}
            <B>poza raftului</B> din magazin — îți spune ce să aranjezi și ce
            lipsește.
          </Row>
          <Row icon="🎯" name="Cum îmi văd TARGETUL și clasamentul">
            Secțiunea <B>„Targetul meu"</B>: cât ai de făcut luna asta, cât ai
            făcut deja și procentul — plus clasamentul echipei, să vezi unde
            ești față de colegi. Dacă ești sub ritmul lunii, apare cu roșu în
            „Ziua mea".
          </Row>
          <Row icon="🧾" name="Cum îmi bag CHELTUIELILE (decont)">
            Secțiunea <B>Decont</B> → „Adaugă cheltuială" → alegi categoria
            (combustibil, masă, altele), suma și o notă → trimiți. Managerul
            o aprobă din panoul lui și vezi statusul la fiecare: în așteptare
            / aprobat / respins.
          </Row>
          <Row icon="🔐" name="Ce fac dacă am UITAT PIN-ul">
            Suni managerul: el intră la <B>Agenți</B> → rândul tău →
            „Resetează PIN". La următoarea deschidere a linkului îți setezi un
            PIN nou. Linkul rămâne același.
          </Row>
          <Row icon="📲" name="Cum îmi pun aplicația pe telefon">
            Deschide linkul tău în Chrome/Safari → meniul browserului →{" "}
            <B>„Adaugă la ecranul principal"</B>. Apare ca aplicație normală,
            cu iconiță — o deschizi cu un singur apas, fără link.
          </Row>
        </Panel>

        <Panel
          id="firma"
          title="🏢 Panoul FIRMEI — manager și administrator"
          subtitle="Se intră cu email + parolă pe /agentie/login. Managerul vede tot; salariile și echipa sunt doar ale administratorului."
        >
          <Row icon="🚀" name="Prima zi — de la cont la firmă funcțională">
            1) Îți faci contul pe{" "}
            <Link href="/agentie/inregistrare" className="font-bold underline">
              /agentie/inregistrare
            </Link>{" "}
            (30 de secunde, 14 zile gratuit). 2) <B>Clienți</B> → tragi
            fișierul tău de clienți — agenții din fișier primesc automat cont
            și link. N-ai fișier? Îi adaugi din <B>Agenți</B>, cu mâna. 3)
            Trimiți fiecărui agent linkul lui pe WhatsApp. 4) <B>Vânzări</B> →
            încarci raportul din SAGA ca să ai istoricul și analizele. 5){" "}
            <B>Solduri</B> → încarci restanțele. 6) <B>Targeturi</B> → pui
            targetul lunii. De aici totul curge singur din teren.
          </Row>
          <Row icon="🎁" name="Perioada de probă">
            14 zile cu tot inclus, fără card. Vezi permanent în panou câte
            zile mai ai. Nu ai apucat să testezi? Scrie-ne din butonul 💬 și
            o prelungim — nimic nu se șterge și nimeni nu e blocat automat.
          </Row>
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
            pregătită → livrată), vezi vânzările van cu badge, deschizi pozele
            facturilor și mai poți atașa oricâte facturi pe aceeași comandă
            (buton „＋ încă una"), iar „Dubele azi" îți arată stocul fiecărei
            mașini și{" "}
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
            administratorul — salariile.
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
          <Row icon="👔" name="Echipa (doar administratorul)">
            Administratorul adaugă conturi de manageri/supervizori — fiecare cu emailul
            și parola lui.
          </Row>
          <Row icon="🔒" name="Setări & securitate">
            Schimbi parola, activezi 2FA (cod Google Authenticator la login),
            vezi istoricul conectărilor și dispozitivele cunoscute. La login de
            pe un aparat nou primești alertă pe email.
          </Row>
          <Row icon="💬" name="Sugestii & erori">
            Butonul 💬 din colțul panoului: ai găsit o problemă, ai o idee sau
            vrei o funcție? Scrii două rânduri și ajunge direct la noi —
            platforma e în BETA și construim după ce ne cer firmele.
          </Row>
        </Panel>

        <Panel
          id="pascupasfirma"
          title="📖 Pas cu pas — administrator & manager"
          subtitle="Exact ce apeși, în ordine, pentru fiecare treabă din birou. Ce e marcat (doar administratorul) nu apare la manageri."
        >
          <Row icon="👥" name="Cum ADAUG un agent și îi dau linkul">
            <B>Agenți</B> → „Adaugă agent" → scrii numele → apare pe listă cu
            butonul <B>„Copiază linkul"</B> → îl lipești în WhatsApp-ul lui.
            Atât. La prima deschidere agentul își setează singur PIN-ul, iar
            linkul lui nu se mai deschide pe alt telefon fără PIN.
          </Row>
          <Row icon="📥" name="Cum IMPORT tot universul de clienți deodată">
            <B>Clienți</B> → „Adu universul de clienți" → tragi fișierul tău
            (Excel/CSV, orice format — coloanele se detectează singure, merg
            și diacriticele). Platforma potrivește clienții cu firmele
            oficiale după CUI sau nume, îi <B>împarte singură pe agenți</B>{" "}
            după coloana de agent din fișier, iar agenții care nu există încă{" "}
            <B>primesc automat cont și link</B>. La final vezi exact: câți au
            intrat, câți nu s-au potrivit și de ce.
          </Row>
          <Row icon="📈" name="Cum ÎNCARC vânzările din SAGA">
            Scoți din SAGA raportul de vânzări (XLS/CSV) → <B>Vânzări</B> →
            tragi fișierul în chenar → analizele se calculează singure:
            evoluție lunară, agent × brand, top clienți, prognoze. Încarci
            câte luni vrei — se adună, nu se suprascriu.
          </Row>
          <Row icon="💰" name="Cum ÎNCARC soldurile (restanțele)">
            <B>Solduri</B> → tragi fișierul cu restanțe (CUI + sumă e
            de-ajuns) → restanța apare pe fiecare client, iar agentul e
            avertizat cu roșu ÎNAINTE să ia comandă nouă de la rău-platnic.
          </Row>
          <Row icon="📦" name="Cum lucrez cu COMENZILE din teren">
            <B>Comenzi</B>: fiecare comandă nouă apare singură (pagina se
            reîmprospătează la minut). Depozitul apasă <B>„Pregătește"</B> →{" "}
            <B>„Livrează"</B> pe măsură ce lucrează. Vânzările van au badge
            mov 🚐 și în „Dubele azi" vezi <B>câți bani are fiecare agent de
            predat</B>. Contabila apasă „Export CSV" și îl bagă în
            SAGA/Excel.
          </Row>
          <Row icon="📎" name="Cum ATAȘEZ facturi la o comandă">
            Pe orice comandă: <B>„📎 atașează factura"</B> → fotografiezi sau
            alegi poza. Mai ai una? <B>„＋ încă una"</B> — oricâte facturi pe
            aceeași comandă (max 10). „📎 vezi facturile (2)" le deschide pe
            toate. Pozele se țin criptate.
          </Row>
          <Row icon="🎯" name="Cum SETEZ targeturile lunii">
            <B>Targeturi</B> → alegi luna → scrii suma la fiecare agent →
            salvezi. Progresul se calculează singur din vânzări, agentul își
            vede procentul în telefon, iar tu vezi clasamentul întregii
            echipe.
          </Row>
          <Row icon="🧾" name="Cum APROB deconturile">
            <B>Decont</B> → vezi fiecare cheltuială trimisă de agenți, cu
            categorie și notă → Aprobi sau Respingi → totalurile pe lună se
            fac singure.
          </Row>
          <Row icon="🏖️" name="Cum dau CONCEDIU fără să rămână zona goală">
            <B>Agenți</B> → rândul agentului → „Concediu" → pui perioada.
            Dacă se suprapune cu a altui coleg, platforma te{" "}
            <B>avertizează</B>. Agentul în concediu apare marcat peste tot.
          </Row>
          <Row icon="🔁" name="Cum PREDAU portofoliul când pleacă un agent">
            <B>Agenți</B> → „Transferă portofoliul" → alegi de la cine la
            cine → bifezi „dezactivează agentul" → toți clienții, notele și
            istoricul trec la înlocuitor, iar <B>linkul celui plecat moare pe
            loc</B>. Nimic nu pleacă cu omul.
          </Row>
          <Row icon="🔐" name="Cum RESETEZ PIN-ul unui agent">
            Agentul a uitat PIN-ul sau și-a schimbat telefonul: <B>Agenți</B>{" "}
            → rândul lui → „Resetează PIN" → la următoarea deschidere a
            linkului își pune PIN nou. Nu trebuie link nou.
          </Row>
          <Row icon="👔" name="Cum ADAUG un manager (doar administratorul)">
            <B>Echipa</B> → „Adaugă utilizator" → email + parolă temporară +
            rol <B>manager</B> → îi trimiți datele; își schimbă parola din
            Setări la prima intrare. Managerul vede tot operaționalul, dar NU
            vede salariile și NU poate umbla la Echipa.
          </Row>
          <Row icon="🛡️" name="Cum îmi BLINDEZ contul (recomandat în ziua 1)">
            <B>Setări</B> → „Schimbă parola" (dacă ai primit-o de la
            altcineva) → „Activează 2FA": scanezi codul QR cu Google
            Authenticator și de atunci la login se cere și codul din
            aplicație. Tot acolo: istoricul conectărilor și dispozitivele
            cunoscute — la orice login de pe aparat nou primești email de
            alertă, ca la Facebook.
          </Row>
          <Row icon="📬" name="Cum primesc RAPORTUL săptămânal">
            Nu faci nimic: lunea dimineața îți vine pe email toată săptămâna
            în o pagină — vizite, conversii, comenzi, target, restanțe +
            rezumatul AI. Îl vezi oricând și în panou, la „Raportul săpt.".
          </Row>
        </Panel>

<Panel id="intrare" title="🔑 Cum intri" subtitle="Trei uși, trei feluri de oameni.">
          <Row icon="📱" name="Agent">
            Fără parolă: primești un link personal de la manager. Prima
            deschidere → îți setezi PIN-ul. Salvează pagina pe ecranul
            telefonului (Adaugă la ecranul principal) și o folosești ca pe o
            aplicație.
          </Row>
          <Row icon="🏢" name="Administrator / Manager">
            Firma nu are cont încă? Ți-l faci singur în 30 de secunde pe{" "}
            <Link href="/agentie/inregistrare" className="font-bold underline">
              /agentie/inregistrare
            </Link>{" "}
            — 14 zile de probă cu tot inclus. Ai deja cont? Intri pe{" "}
            <Link href="/agentie/login" className="font-bold underline">
              /agentie/login
            </Link>{" "}
            cu email + parolă. Vrei doar să vezi cum arată? Butonul galben
            „Vezi DEMO" te bagă într-o firmă de probă, pe orice rol.
          </Row>
          </Panel>

        <footer className="pb-6 text-center text-sm font-semibold text-[#161412]/45">
          <Link href="/" className="underline">← Înapoi la prima pagină</Link>
        </footer>
      </div>
    </main>
  );
}
