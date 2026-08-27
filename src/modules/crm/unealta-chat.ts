/**
 * UNEALTA CERUTĂ ÎN CHAT → FAPTA, prin ACELEAȘI rute ca butoanele.
 *
 * „Am fost la Danisov, a comandat" zis cu vocea trebuie să facă exact ce
 * face degetul: aceeași vizită, același pin, același magazin — prin
 * CHIAR handler-ele rutelor (visits, pin, magazine-harta), chemate în
 * proces cu tokenul LUI. Nu copiem logica de acolo: dacă am copia-o,
 * s-ar despărți în două variante care se bat cap în cap, iar pazele
 * (izolare, dubluri, GPS prost) ar rămâne doar pe o parte.
 *
 * Ce NU face chatul, dinadins:
 *   · „nu mai există" — singura apăsare care șterge ceva pentru toată
 *     firma. Aia rămâne pe buton, cu confirmarea ei. O vorbă prost
 *     înțeleasă de microfon n-are voie să șteargă un client.
 */

export interface PozitiaTelefonului {
  lat?: number;
  lng?: number;
  /** Precizia în metri — peste ~250 m nu punem pinuri. */
  acc?: number;
}

interface CerereUnealta {
  unealta?: string;
  firma?: string;
  zi?: string;
  text?: string;
  rezultat?: string;
  nota?: string;
  nume?: string;
}

/** Rezultatele permise din chat — FĂRĂ „nu_mai_exista" (vezi mai sus). */
const REZULTATE_CHAT = new Set([
  "client",
  "gandeste",
  "ne_suna",
  "nu_vrea",
  "inchis",
]);

function pozitieBuna(p?: PozitiaTelefonului): p is Required<PozitiaTelefonului> {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Number.isFinite(p.acc) &&
    (p.acc as number) <= 250
  );
}

/** Cheamă un handler de rută în proces, cu corpul dat; întoarce JSON-ul. */
async function cheama(
  handler: (req: Request) => Promise<Response>,
  body: unknown,
  /**
   * Adresa pentru limita de cereri. Rutele își țin limita pe IP, iar o
   * cerere internă n-are IP: fără antetul ăsta, TOȚI agenții de pe
   * platformă ar împărți o singură găleată („unknown") și și-ar bloca
   * unii altora vizitele dictate.
   */
  cine: string,
): Promise<{ status: number; date: Record<string, unknown> }> {
  const res = await handler(
    new Request("http://intern/unealta", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `chat:${cine}`,
      },
      body: JSON.stringify(body),
    }),
  );
  const date = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, date };
}

/**
 * Execută unealta cerută de model — pe contul agentului din TOKEN, nu pe
 * ce pretinde AI-ul. Orice nu se recunoaște sau crapă se întoarce ca
 * text de spus omului, niciodată ca excepție care taie chatul.
 */
export async function ruleazaUnealtaChat(
  brut: string,
  cine: { agentId: string; agentName: string },
  /** Tokenul LUI, verificat deja de rută — cu el semnăm faptele. */
  token: string,
  pozitie?: PozitiaTelefonului,
  /** Poza trimisă cu mesajul — la „am fost" se lipește de vizită. */
  foto?: { data?: string; mime?: string },
): Promise<string> {
  let cerere: CerereUnealta;
  try {
    // Modelul poate împacheta JSON-ul în ```json … ``` — despachetăm.
    cerere = JSON.parse(
      brut.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, ""),
    );
  } catch {
    return "N-am înțeles cererea — mai zi o dată ce vrei să fac.";
  }
  const { getDB, ensureSchema } = await import("@/lib/db");
  const db = getDB();
  if (!db) return "Baza de date nu e disponibilă acum — încearcă mai târziu.";
  await ensureSchema();
  const unelte = await import("@/modules/crm/unelte-agent");

  /** Găsește O firmă din vorbă; la mai multe, întoarce lista de întrebat. */
  const gasesteUna = async (nume: string) => {
    const gasite = await unelte.cautaFirme(db, cine, nume, 5);
    if (gasite.length === 0) {
      return {
        firma: null,
        mesaj: `N-am găsit nicio firmă activă care să semene cu „${nume.slice(0, 80)}". Încearcă 3-4 litere din numele din acte.`,
      };
    }
    const aleLui = gasite.filter((g) => g.aMea);
    const una =
      gasite.length === 1 ? gasite[0] : aleLui.length === 1 ? aleLui[0] : null;
    if (una) return { firma: una, mesaj: "" };
    return {
      firma: null,
      mesaj:
        "Am găsit mai multe — spune-mi care din ele:\n" +
        gasite
          .map(
            (v, i) =>
              `${i + 1}. ${v.denumire} — ${v.localitate}${v.aMea ? " (clientul lui)" : ""}`,
          )
          .join("\n"),
    };
  };

  try {
    switch (cerere.unealta) {
      case "pune_in_ruta": {
        const r = await unelte.puneInRuta(
          db,
          cine,
          String(cerere.firma ?? ""),
          String(cerere.zi ?? "azi"),
        );
        return r.variante?.length
          ? `${r.mesaj}\n${r.variante
              .map(
                (v, i) =>
                  `${i + 1}. ${v.denumire} — ${v.localitate}${v.aMea ? " (clientul lui)" : ""}`,
              )
              .join("\n")}`
          : r.mesaj;
      }

      case "pune_zonele":
        return (await unelte.puneZonele(db, cine, String(cerere.text ?? ""))).mesaj;

      case "cauta_firma": {
        const gasite = await unelte.cautaFirme(db, cine, String(cerere.text ?? ""));
        if (gasite.length === 0)
          return "Nicio firmă activă nu se potrivește. Încearcă 3-4 litere din numele din acte.";
        return gasite
          .map(
            (g) =>
              `${g.denumire} — ${g.localitate}, ${g.judet} · ${g.aMea ? "clientul LUI" : g.status}`,
          )
          .join("\n");
      }

      // „AM FOST LA X, a comandat / se mai gândește / n-a vrut / închis."
      // Vizita se scrie prin CHIAR ruta vizitelor: aceeași pază de
      // apăsat-dublu, aceeași regulă de stare (clientul vechi care refuză
      // azi rămâne client), același învățat de pin din GPS.
      case "am_fost": {
        const rezultat = String(cerere.rezultat ?? "");
        if (!REZULTATE_CHAT.has(rezultat)) {
          return "Ce s-a întâmplat acolo? Zi-mi: a comandat / se mai gândește / ne sună el / nu vrea / era închis.";
        }
        const { firma, mesaj } = await gasesteUna(String(cerere.firma ?? ""));
        if (!firma) return mesaj;
        const { POST } = await import("@/app/api/visits/route");
        // Poza vine ca base64 gol (fără antet) din ecran — o îmbrăcăm în
        // data-URL, cum o cere ruta vizitelor.
        const mime = ["image/jpeg", "image/png", "image/webp"].includes(
          String(foto?.mime),
        )
          ? String(foto?.mime)
          : "image/jpeg";
        const pozaDataUrl =
          foto?.data && foto.data.length > 50
            ? `data:${mime};base64,${String(foto.data).replace(/^data:[^,]+,/, "")}`
            : "";
        const { status, date } = await cheama(POST, {
          token,
          cui: firma.cui,
          denumire: firma.denumire,
          result: rezultat,
          note: String(cerere.nota ?? "").slice(0, 1000),
          ...(pozaDataUrl ? { foto: pozaDataUrl } : {}),
          ...(pozitieBuna(pozitie)
            ? { lat: pozitie.lat, lng: pozitie.lng, acc: pozitie.acc }
            : {}),
        }, cine.agentId);
        if (status !== 200) {
          return `N-am putut salva vizita (${String(date.error ?? "eroare")}). Încearcă din buton.`;
        }
        return (
          `Vizita la „${firma.denumire}" e scrisă în jurnal.` +
          (pozaDataUrl ? " Poza e prinsă de vizită — o vede și șeful." : "") +
          (pozitieBuna(pozitie)
            ? " Am prins și poziția — pinul firmei s-a făcut exact."
            : "")
        );
      }

      // „SUNT ÎN FAȚA LA X" — pinul se pune prin ruta pinului, cu
      // aceleași reguli: izolare între firme, precizie GPS.
      case "sunt_aici": {
        if (!pozitieBuna(pozitie)) {
          return "Telefonul nu mi-a dat o poziție bună (sau n-are voie la locație). Ieși sub cer liber și mai zi o dată — sau apasă «Sunt aici» de pe fișa firmei.";
        }
        const { firma, mesaj } = await gasesteUna(String(cerere.firma ?? ""));
        if (!firma) return mesaj;
        const { POST } = await import("@/app/api/prospects/pin/route");
        const { status, date } = await cheama(POST, {
          token,
          cui: firma.cui,
          lat: pozitie.lat,
          lng: pozitie.lng,
          sursa: "gps",
          acc: pozitie.acc,
        }, cine.agentId);
        if (status !== 200) {
          return `N-am putut pune locul (${String(date.error ?? "eroare")}). Încearcă din buton.`;
        }
        return `Locul lui „${firma.denumire}" e pus unde stai acum — de-aici încolo navigarea duce fix aici.`;
      }

      // „ADAUGĂ MAGAZINUL X AICI" — magazin nou pe poziția LUI, prin
      // aceeași rută ca butonul de pe hartă.
      case "adauga_magazin": {
        if (!pozitieBuna(pozitie)) {
          return "Ca să pun magazinul unde ești, îmi trebuie poziția telefonului — și acum nu vine. Pune-l de pe hartă cu «➕ Adaugă magazin».";
        }
        const nume = String(cerere.nume ?? "").trim();
        if (nume.length < 2) return "Cum se cheamă magazinul? Zi-mi numele și-l pun.";
        const { POST } = await import("@/app/api/prospects/magazine-harta/route");
        const { status, date } = await cheama(POST, {
          token,
          adauga: { nume, lat: pozitie.lat, lng: pozitie.lng },
        }, cine.agentId);
        if (status !== 200) {
          return `N-am putut adăuga magazinul (${String(date.error ?? "eroare")}). Pune-l de pe hartă.`;
        }
        return `Magazinul „${nume}" e pe hartă, unde stai acum — îl văd și colegii.`;
      }

      default:
        return "Unealta aia nu există. Pot: să pun o firmă în rută, să pun zonele pe zile, să caut o firmă, să scriu o vizită (am fost), să pun locul (sunt aici), să adaug un magazin aici.";
    }
  } catch (e) {
    console.error("[unealta-chat]", e);
    return "N-a mers — încearcă din nou sau fă-o din buton.";
  }
}
