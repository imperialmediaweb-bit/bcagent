import postgres from "postgres";

let sql: ReturnType<typeof postgres> | null = null;
let schemaReady = false;

export function isDBEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getDB() {
  if (!process.env.DATABASE_URL) return null;
  if (!sql) {
    const url = process.env.DATABASE_URL;
    sql = postgres(url, {
      ssl:
        url.includes("localhost") || url.includes("127.0.0.1")
          ? false
          : "require",
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
      // Schema idempotentă (CREATE ... IF NOT EXISTS) scuipă la fiecare
      // pornire zeci de NOTICE „already exists, skipping" care ÎNGROAPĂ
      // erorile reale în logurile de producție. Tăcem DOAR nivelul
      // NOTICE — avertismentele (WARNING) rămân vizibile.
      onnotice: (n) => {
        if (n.severity !== "NOTICE") console.warn("[pg]", n.severity, n.message);
      },
    });
  }
  return sql;
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const db = getDB();
  if (!db) return;
  await db.unsafe(`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      row_count INTEGER NOT NULL,
      date_min DATE NOT NULL,
      date_max DATE NOT NULL,
      rows JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS batches_agent_id ON batches(agent_id);
    -- Amprenta conținutului: același raport încărcat de două ori NU mai
    -- dublează cifrele (se întâmplă des — „nu știu dacă a mers, mai încarc").
    ALTER TABLE batches ADD COLUMN IF NOT EXISTS content_hash TEXT;
    -- UNIC pe (agent, amprentă): două tab-uri sau două retrimiteri cu
    -- exact același fișier nu mai pot trece amândouă de verificare.
    -- Migrarea (curățare duplicate + index unic) rulează O SINGURĂ DATĂ —
    -- gardată de existența indexului unic. După ce el există, blocul de mai
    -- jos devine doar o verificare ieftină în catalog, nu mai atinge datele.
    -- Fără gardă, DELETE-ul greu ar rula la fiecare pornire pe bazele mari.
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'batches_hash' AND indexdef ILIKE '%UNIQUE%'
      ) THEN
        DELETE FROM batches WHERE content_hash IS NOT NULL AND id NOT IN (
          SELECT MIN(id) FROM batches
          WHERE content_hash IS NOT NULL
          GROUP BY agent_id, content_hash
        );
        DROP INDEX IF EXISTS batches_hash;
        CREATE UNIQUE INDEX batches_hash
          ON batches(agent_id, content_hash) WHERE content_hash IS NOT NULL;
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS agent_settings (
      agent_id TEXT PRIMARY KEY,
      default_rate REAL DEFAULT 5,
      avg_price REAL DEFAULT 1,
      agent_rates JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Prospecți: firmele potențial-client din județele țintă.
    -- org_id e nullable acum (F1); devine NOT NULL la multi-tenant (F2).
    CREATE TABLE IF NOT EXISTS prospects (
      cui TEXT PRIMARY KEY,
      org_id TEXT,
      denumire TEXT NOT NULL,
      adresa TEXT DEFAULT '',
      localitate TEXT DEFAULT '',
      judet TEXT DEFAULT '',
      caen TEXT DEFAULT '',
      caen_desc TEXT DEFAULT '',
      tva BOOLEAN,
      activ BOOLEAN,
      status TEXT NOT NULL DEFAULT 'nou',
      note TEXT DEFAULT '',
      assigned_agent TEXT DEFAULT '',
      telefon TEXT DEFAULT '',
      email TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Coloane de contact adăugate ulterior (baze existente)
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS telefon TEXT DEFAULT '';
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS contact TEXT DEFAULT '';
    -- ADRESA DE LIVRARE: unde se duce marfa, adică UNDE E MAGAZINUL.
    -- Coloana adresa e sediul social, de la Finanțe — la un PFA, casa lui;
    -- de-aia „Navighează" îl lăsa rece pe Costin la Andronache. Asta e
    -- scrisă de firmă și verificată de fiecare livrare din ultimii ani.
    -- Stă pe COLOANA EI: nu ștergem sediul social, doar îl întrecem.
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS adresa_livrare TEXT NOT NULL DEFAULT '';
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS localitate_livrare TEXT NOT NULL DEFAULT '';
    -- DE UNDE A VENIT FIRMA ASTA ÎN REGISTRU.
    -- Gol = din registrul Finanțelor, ca toate celelalte. Altfel, id-ul
    -- firmei a cărei hartă a adus-o: 1073 de CUI-uri din harta lui Bogdan
    -- nu existau la Finanțe (PFA-uri, firme din alte județe), dar sunt
    -- firme adevărate, cu cod fiscal verificat și adresă cu număr.
    --
    -- Fără coloana asta nu se putea răspunde la două întrebări cinstite:
    -- „ce anume a adus butonul meu?" și „de ce firma asta n-are CAEN?".
    -- Rămâne pusă doar la INSERT — dacă firma apare mai târziu și la
    -- Finanțe, tot din hartă a intrat prima dată.
    -- A CUI E CLIENTUL ĂSTA — nu „cum îl cheamă pe agent", ci CARE FIRMĂ
    -- l-a alocat.
    --
    -- Toată despărțirea dintre firmele de pe platformă se sprijinea pe
    -- coloana assigned_agent, care e un NUME scris cu litere. „Popescu
    -- Ion" e cel mai obișnuit nume din țară. Dacă două firme de
    -- distribuție au fiecare câte un Popescu Ion — și vor avea — atunci
    -- întrebarea „ai cui sunt clienții alocați lui Popescu Ion?" n-are
    -- răspuns, iar agentul uneia vedea și SCRIA pe clienții celeilalte:
    -- stare, notă, sold. Nu e o închipuire: se arată în două rânduri.
    --
    -- Coloana asta dă răspunsul. Gol = alocare veche, dinainte de ea:
    -- atunci se poartă exact ca înainte, ca să nu rămână nimeni fără
    -- clienți peste noapte.
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS assigned_org TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS prospects_assigned_org
      ON prospects(assigned_org) WHERE assigned_org <> '';
    -- „CLIENȚII MEI" se caută de patruzeci de ori în platformă, peste 1,3
    -- milioane de firme, și n-avea niciun index: fiecare deschidere de
    -- panou citea registrul întreg. Indexul e parțial — firmele nealocate
    -- sunt marea majoritate și n-au ce căuta în el.
    CREATE INDEX IF NOT EXISTS prospects_assigned_agent
      ON prospects(assigned_agent) WHERE COALESCE(assigned_agent,'') <> '';
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS adus_de_org TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS prospects_adus_de_org
      ON prospects(adus_de_org) WHERE adus_de_org <> '';
    CREATE INDEX IF NOT EXISTS prospects_judet ON prospects(judet);
    CREATE INDEX IF NOT EXISTS prospects_status ON prospects(status);
    CREATE INDEX IF NOT EXISTS prospects_caen ON prospects(caen);
    CREATE INDEX IF NOT EXISTS prospects_localitate ON prospects(localitate);
    -- Index compus pentru filtrarea uzuală (județ + domeniu) la 1M+ rânduri
    CREATE INDEX IF NOT EXISTS prospects_judet_caen ON prospects(judet, caen);
    -- Coada de verificare ANAF (activ IS NULL) — index parțial, foarte mic
    CREATE INDEX IF NOT EXISTS prospects_pending_anaf ON prospects(cui)
      WHERE activ IS NULL;
    -- CINE A ALOCAT CLIENȚII DE PÂNĂ ACUM.
    -- Alocările vechi n-au firmă scrisă pe ele. O completăm din tabelul
    -- de agenți, dar DOAR unde numele duce la o singură firmă: acolo unde
    -- două firme au agenți cu același nume, nu se poate ști cine pe cine
    -- a alocat, iar o ghiceală ar muta clienți dintr-o firmă în alta.
    -- Alea rămân goale și se poartă ca înainte, până le atinge cineva.
    -- Pe o instalare NOUĂ tabelul agenților încă nu există (îl face
    -- schema platformei, care rulează după asta) — iar fără paza de aici,
    -- prima pornire a unui client proaspăt crăpa înainte să apuce să facă
    -- orice. Testul de ecran a prins-o pe o bază goală.
    DO $$
    BEGIN
      IF to_regclass('org_agents') IS NOT NULL THEN
        UPDATE prospects p
        SET assigned_org = x.org_id
        FROM (
          SELECT name, MIN(org_id) AS org_id
          FROM org_agents
          GROUP BY name
          HAVING COUNT(DISTINCT org_id) = 1
        ) x
        WHERE p.assigned_org = ''
          AND COALESCE(p.assigned_agent,'') <> ''
          AND p.assigned_agent = x.name;
      END IF;
    END $$;
    -- Problemele raportate din platformă (de agenți/manageri sau automat),
    -- cu diagnosticul AI atașat — adminul le vede în /platform/probleme.
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'user',
      reporter TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      page TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      ai_diagnosis TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'noua',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS issues_status ON issues(status, created_at DESC);
    -- Firma raportorului: administratorul/managerul firmei își vede
    -- rapoartele propriilor agenți în panoul lui, nu doar platforma.
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT '';
    -- ÎNTREBARE sau PROBLEMĂ?
    -- „Nu știu unde e butonul" și un bug adevărat ajungeau amestecate în
    -- aceeași listă — iar bugul se pierdea între ele. Acum se deosebesc:
    -- întrebarea se lămurește pe loc, problema ajunge la echipa
    -- platformei.
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS fel TEXT NOT NULL DEFAULT '';
    -- POZA. „Nu-mi apare cum trebuie" e greu de explicat în scris, în
    -- mașină. O poză a ecranului spune tot dintr-o privire. Criptată, ca
    -- pozele de facturi: poate prinde nume de clienți și cifre.
    ALTER TABLE issues ADD COLUMN IF NOT EXISTS foto TEXT;
    CREATE INDEX IF NOT EXISTS issues_org ON issues(org_id, created_at DESC);
    -- Rutele agenților: șabloane pe zile (Luni — Rădăuți) cu opriri ordonate.
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      day TEXT NOT NULL DEFAULT '',
      stops JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS routes_agent ON routes(agent_id);
    -- Jurnalul vizitelor din teren: cine, când, la ce firmă, cu ce rezultat.
    CREATE TABLE IF NOT EXISTS visits (
      id BIGSERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      cui TEXT NOT NULL,
      denumire TEXT NOT NULL DEFAULT '',
      result TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS visits_agent ON visits(agent_id, visited_at DESC);
    CREATE INDEX IF NOT EXISTS visits_cui ON visits(cui, visited_at DESC);
    -- LA CARE MAGAZIN A FOST, nu doar la ce firmă.
    -- Ovi Tacomax are șase magazine. Gavrileț intra în cel din Cernești,
    -- bifa „Am fost", și firma apărea vizitată — celelalte cinci păreau
    -- făcute. Magazinele le-am făcut vizibile azi; vizitele rămăseseră pe
    -- firmă. Fără coloana asta, cifrele mint în favoarea noastră, ceea ce
    -- e cel mai rău fel de a minți.
    ALTER TABLE visits ADD COLUMN IF NOT EXISTS magazin_id TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS visits_magazin
      ON visits(magazin_id, visited_at DESC) WHERE magazin_id <> '';
    -- Targeturi lunare per agent (setate de agenție; realizatul se
    -- calculează din vânzările încărcate).
    CREATE TABLE IF NOT EXISTS targets (
      org_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      month TEXT NOT NULL,
      target_value REAL NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, agent_name, month)
    );
    -- Decontul agenților: motorină, diurnă etc. — aprobat de manager.
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      spent_on DATE NOT NULL,
      category TEXT NOT NULL DEFAULT 'alte',
      amount_cents INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'in_asteptare',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS expenses_agent ON expenses(agent_id, spent_on DESC);
    -- Solduri/restanțe clienți (importate din SAGA) — direct pe firmă.
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS sold_cents BIGINT;
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS sold_updated_at TIMESTAMPTZ;
    -- Igiena listei de firme, din două direcții care NU se calcă:
    --   inchis_teren = agentul a văzut cu ochii lui că nu mai există
    --     (verificarea ANAF lunară n-are voie s-o reînvie — legal poate
    --     fi activă, dar magazinul e mort);
    --   anaf_checked_at = ultima verificare la ANAF (radiat/inactiv
    --     fiscal), ca măturarea lunară să știe ce e vechi.
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS inchis_teren BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE prospects ADD COLUMN IF NOT EXISTS anaf_checked_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS prospects_anaf_sweep ON prospects(judet, anaf_checked_at);
    -- „Închis" pe o firmă care NU e clientul nostru privește DOAR firma
    -- care a închis-o: registrul e comun tuturor agențiilor, iar un
    -- apăsat greșit n-are voie să șteargă un prospect de pe harta
    -- altcuiva. Clienții PROPRII se sting global (inchis_teren) — acolo
    -- chiar știm că magazinul nu mai există.
    CREATE TABLE IF NOT EXISTS prospect_inchis (
      cui TEXT NOT NULL,
      org_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (cui, org_id)
    );
    CREATE INDEX IF NOT EXISTS prospect_inchis_org ON prospect_inchis(org_id);
    -- ZONELE AGENȚILOR: ce localități are fiecare și în ce zi trece pe
    -- acolo. Managerul le lipește ca text din WhatsApp; de aici ies
    -- rutele zilei și „ce clienți din zona mea n-am vizitat".
    CREATE TABLE IF NOT EXISTS agent_zone (
      org_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      localitate TEXT NOT NULL,
      zi TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, agent_name, localitate, zi)
    );
    -- Ordinea satelor e ORDINEA DRUMULUI, nu alfabetul: omul le scrie
    -- cum le străbate. Fără ea, ruta zilei trimitea agentul în zigzag.
    ALTER TABLE agent_zone ADD COLUMN IF NOT EXISTS pozitie INT NOT NULL DEFAULT 0;
    -- Cine a scris-o ultima dată: agentul de pe teren sau managerul din
    -- panou. Salvarea ÎNLOCUIEȘTE tot, deci fără numele ăsta doi oameni
    -- se suprascriau fără să afle vreodată.
    ALTER TABLE agent_zone ADD COLUMN IF NOT EXISTS pus_de TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS agent_zone_org ON agent_zone(org_id, agent_name);
    -- CUM ZICE OMUL ↔ CE E ÎN REGISTRU, ÎNVĂȚAT DE LA EL.
    --
    -- Agentul scrie „Burdujeni", „Cn-lung", „Centru", „Țara Dornelor".
    -- Niciunul nu e sat în registru. Am fost tentat să țin în cod o listă
    -- cu ele — și am și ținut o vreme. E greșit din două motive: e scrisă
    -- de mine (deci ghicit), și e bună doar pentru Suceava. Pentru un
    -- distribuitor din Timișoara nu înseamnă nimic, iar platforma nu e a
    -- unei singure firme.
    --
    -- Acum se învață: prima dată omul caută și alege, iar alegerea LUI se
    -- ține minte pentru firma lui. A doua oară e automat. Merge pentru
    -- orice oraș din țară, fără ca eu să scriu vreo listă.
    CREATE TABLE IF NOT EXISTS zona_alias (
      org_id TEXT NOT NULL,
      -- cum a scris omul, curățat (fără diacritice, litere mici)
      scris TEXT NOT NULL,
      -- ce a ales din lista lui
      localitate TEXT NOT NULL,
      pus_de TEXT NOT NULL DEFAULT '',
      folosit INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (org_id, scris, localitate)
    );
    CREATE INDEX IF NOT EXISTS zona_alias_org ON zona_alias(org_id, scris);
    -- Comenzile luate din teren: agentul le bate pe telefon la client,
    -- depozitul le vede instant, contabila le exportă pentru SAGA.
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      agent_name TEXT NOT NULL DEFAULT '',
      cui TEXT NOT NULL DEFAULT '',
      denumire TEXT NOT NULL DEFAULT '',
      localitate TEXT NOT NULL DEFAULT '',
      lines JSONB NOT NULL DEFAULT '[]'::jsonb,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'noua',
      total_value REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS orders_agent ON orders(agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_status ON orders(status, created_at DESC);
    -- VAN SALES: agentul vinde marfa pe loc, din mașină (tip='van',
    -- status direct 'livrata') și încasează (plata: numerar/card/termen).
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip TEXT NOT NULL DEFAULT 'comanda';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS plata TEXT NOT NULL DEFAULT '';
    -- Poza facturii/bonului (JPEG mic, data-URL) — dovada vânzării pe loc.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS foto TEXT NOT NULL DEFAULT '';
    -- IDEMPOTENȚĂ: telefonul generează un id o singură dată per comandă.
    -- Dacă pică semnalul și se retrimite (sau agentul apasă de două ori),
    -- comanda NU se dublează în depozit și stocul din dubă NU scade de 2 ori.
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_id TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS orders_client_id
      ON orders(agent_id, client_id) WHERE client_id IS NOT NULL;
    -- O comandă poate avea MAI MULTE facturi: prima rămâne în orders.foto,
    -- restul aici (criptate identic, AES-256-GCM prin DATA_KEY).
    CREATE TABLE IF NOT EXISTS order_fotos (
      id BIGSERIAL PRIMARY KEY,
      order_id TEXT NOT NULL,
      foto TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS order_fotos_order ON order_fotos(order_id, created_at);
    -- Stocul din mașina fiecărui agent: se încarcă dimineața, scade la
    -- fiecare vânzare van, se descarcă la retur.
    -- PIN-ul linkului de agent: linkul singur nu mai e de ajuns pe un
    -- dispozitiv străin — se cere PIN-ul setat de agent la prima deschidere.
    CREATE TABLE IF NOT EXISTS agent_pin (
      agent_id TEXT PRIMARY KEY,
      pin_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS van_stock (
      agent_id TEXT NOT NULL,
      produs TEXT NOT NULL,
      um TEXT NOT NULL DEFAULT 'buc',
      cantitate REAL NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (agent_id, produs)
    );
    -- Cache de geocodare per localitate (Nominatim, 1 req/s) — o localitate
    -- se geocodează O dată, apoi harta o citește instant de aici.
    -- COORDONATELE FIECĂREI FIRME (pentru pinii de pe hartă). Agentul
    -- trebuie să vadă dacă doi clienți sunt vecini, altfel umblă degeaba pe
    -- drum. „aprox" = n-am găsit adresa exactă și am pus firma în centrul
    -- localității (cu o mică împrăștiere, ca să nu se suprapună toate).
    CREATE TABLE IF NOT EXISTS geo_firme (
      cui TEXT PRIMARY KEY,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      aprox BOOLEAN NOT NULL DEFAULT FALSE,
      failed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- De unde vine locul: „deget"/„gps" = pus de om pe teren, „import" =
    -- adus dintr-o hartă. Fără asta, un import făcut din greșeală nu se
    -- putea da înapoi fără să ștergi și munca agenților.
    ALTER TABLE geo_firme ADD COLUMN IF NOT EXISTS sursa TEXT NOT NULL DEFAULT '';
    -- CINE A PUS PINUL. Fără nume, munca de teren a agenților nu se vedea
    -- nicăieri: patronul nu avea ce arăta, iar omul care a bătut satul nu
    -- avea cu ce se lăuda. Se completează de-acum înainte; ce e mai vechi
    -- rămâne fără nume, nu se inventează.
    ALTER TABLE geo_firme ADD COLUMN IF NOT EXISTS pus_de TEXT NOT NULL DEFAULT '';

    -- MAGAZINELE DIN HARTA VECHE care nu s-au potrivit cu nicio firmă din
    -- registru. Sunt magazine ADEVĂRATE, cu locul pus de mână, dar fără
    -- CUI — deci n-au ce căuta în registrul comun, unde ar apărea la toate
    -- agențiile. Stau aici, ale firmei care le-a adus, și se văd doar pe
    -- harta agenților ei.
    CREATE TABLE IF NOT EXISTS magazin_harta (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      nume TEXT NOT NULL,
      adresa TEXT NOT NULL DEFAULT '',
      localitate TEXT NOT NULL DEFAULT '',
      judet TEXT NOT NULL DEFAULT '',
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      strat TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- CE A VĂZUT AGENTUL CU OCHII LUI. Harta veche poate fi de acum trei
    -- ani: unele magazine s-au închis, altele s-au mutat. Agentul care
    -- trece pe-acolo confirmă sau taie — și de-atunci nu mai pierde nimeni
    -- drumul degeaba.
    -- CINE E, când pinul o spune. Harta lui Bogdan are pe fiecare pin un
    -- tabel întreg: Cod Fiscal, Nume Legal, Adresa cu număr. Dintre cele
    -- 2450 de pinuri, 1634 au CUI-uri care nu-s în registrul nostru —
    -- firme adevărate, doar că necunoscute nouă. Fără coloanele astea,
    -- agentul vedea un punct mov fără nume și fără adresă; cu ele, vede
    -- „OVI-TACOMAX SRL · CUI 18584450 · Str. Principală 183A".
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS cui TEXT NOT NULL DEFAULT '';
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS nume_legal TEXT NOT NULL DEFAULT '';
    -- UN CLIENT = UN MAGAZIN, nu o firmă.
    -- „Da, așa ar trebui. Magazinele." (Bogdan, 26.08, 19:28)
    -- Ovi Tacomax e o firmă, dar sunt ȘASE magazine: Cernești, Iurești,
    -- două în Zlatunoaia, magazinul din Lunca și barul din Lunca. Agentul
    -- vedea UN punct și avea de intrat în șase. Iar cele 30 „UVERTURA -…"
    -- sunt SIS-urile lui — standurile lui, cu casele lui de marcat, în
    -- magazinele altora: acolo agentul verifică stocul, nu vinde.
    --
    -- Magazinele stau tot aici, lângă cele de prospectat: sunt același
    -- fel de lucru — un loc pe hartă unde intri. Ce le deosebește e
    -- coloana FEL și faptul că au CUI-ul firmei lor.
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS fel TEXT NOT NULL DEFAULT '';
    -- Cine trece pe la el. Gol = oricine din firmă.
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS agent TEXT NOT NULL DEFAULT '';
    -- Cine l-a pus. Fișierul n-o să fie complet niciodată — Bogdan știa pe
    -- de rost „Lunca magazin" și „Lunca bar", dar în fișier nu erau.
    -- Agentul e acolo: apasă pe hartă, scrie numele, gata.
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS adaugat_de TEXT NOT NULL DEFAULT '';
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS telefon TEXT NOT NULL DEFAULT '';
    CREATE INDEX IF NOT EXISTS magazin_harta_cui ON magazin_harta(org_id, cui);
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS stare TEXT NOT NULL DEFAULT '';
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS confirmat_de TEXT NOT NULL DEFAULT '';
    ALTER TABLE magazin_harta ADD COLUMN IF NOT EXISTS confirmat_la TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS magazin_harta_org ON magazin_harta(org_id);
    CREATE INDEX IF NOT EXISTS magazin_harta_loc
      ON magazin_harta(org_id, localitate);

    -- COADA DE LUCRU PENTRU OPENSTREETMAP.
    -- Un județ întreg de magazine se ia în zeci de secunde de la un
    -- serviciu public, gratuit și adesea ocupat. Fără coadă, prima
    -- încercare mânca tot timpul cererii, iar ce rămânea la coadă
    -- (Botoșani, Iași) primea „am depășit timpul" și arăta pe ecran ca
    -- „județul n-are magazine" — minciună.
    -- Cu coada: fiecare județ e o treabă cu starea ei. O ia ori omul,
    -- când apasă butonul, ori cronul, noaptea, când nu așteaptă nimeni.
    -- Amândoi iau din același loc, deci nu se calcă și nu se dublează.
    CREATE TABLE IF NOT EXISTS osm_sweep (
      org_id TEXT NOT NULL,
      judet TEXT NOT NULL,
      -- de_facut | gata | picat
      stare TEXT NOT NULL DEFAULT 'de_facut',
      -- de ce e în listă: 'clienti' (are clienți acolo) sau 'vecin'
      motiv TEXT NOT NULL DEFAULT 'vecin',
      -- cu cât e mai mic, cu atât se ia mai devreme
      rang INT NOT NULL DEFAULT 100,
      magazine INT NOT NULL DEFAULT 0,
      locuri INT NOT NULL DEFAULT 0,
      noi INT NOT NULL DEFAULT 0,
      incercari INT NOT NULL DEFAULT 0,
      eroare TEXT NOT NULL DEFAULT '',
      facut_la TIMESTAMPTZ,
      PRIMARY KEY (org_id, judet)
    );
    CREATE INDEX IF NOT EXISTS osm_sweep_coada
      ON osm_sweep(org_id, stare, rang);

    CREATE TABLE IF NOT EXISTS geo_localitati (
      judet TEXT NOT NULL,
      localitate TEXT NOT NULL,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      failed BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (judet, localitate)
    );
    -- Potrivire nume client (XLS) ↔ denumire firmă (MF): ambele părți se
    -- normalizează identic, iar indexul face egalitatea instantă la 1,3M rânduri.
    CREATE INDEX IF NOT EXISTS prospects_denumire_norm ON prospects (
      btrim(upper(regexp_replace(denumire, '[^a-zA-Z0-9]+', ' ', 'g')))
    );
    -- Progres procesare incrementală a fișierelor mari din R2 (dataset MF).
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      byte_offset BIGINT NOT NULL DEFAULT 0,
      total_size BIGINT NOT NULL DEFAULT 0,
      carry TEXT NOT NULL DEFAULT '',
      delimiter TEXT,
      column_map JSONB,
      header_done BOOLEAN NOT NULL DEFAULT FALSE,
      processed BIGINT NOT NULL DEFAULT 0,
      matched BIGINT NOT NULL DEFAULT 0,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Căutare rapidă după nume la 1M+ rânduri (ILIKE '%x%' fără index e lent).
  // pg_trgm poate lipsi pe unele instanțe — eșecul nu blochează aplicația.
  try {
    await db.unsafe(`
      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS prospects_denumire_trgm
        ON prospects USING gin (denumire gin_trgm_ops);
      CREATE INDEX IF NOT EXISTS prospects_localitate_trgm
        ON prospects USING gin (localitate gin_trgm_ops);
    `);
    // Căutarea FĂRĂ DIACRITICE (agenții scriu „magazinul", registrul are
    // „MĂGĂZINUL") are nevoie de index pe forma îndoită. Se construiește
    // CONCURENT și în FUNDAL: pe 1,3M de firme durează, iar aplicația
    // n-are voie să stea. Până e gata, căutarea merge oricum (mai lent).
    void db
      .unsafe(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS prospects_denumire_neted_trgm
           ON prospects USING gin (translate(lower(denumire), 'ăâîșțşţ', 'aaistst') gin_trgm_ops)`,
      )
      .catch((e: unknown) =>
        console.warn(
          "[db] indexul de căutare fără diacritice nu s-a construit:",
          e instanceof Error ? e.message : e,
        ),
      );
  } catch (e) {
    console.warn(
      "[db] pg_trgm indisponibil — căutarea după nume va fi mai lentă:",
      e instanceof Error ? e.message : e,
    );
  }

  schemaReady = true;
}
