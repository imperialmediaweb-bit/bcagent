import { ensureSchema, getDB, isDBEnabled } from "@/lib/db";
import { audit, listOrgAgents, requireAdmin } from "@/modules/platform";
import {
  citesteKMLRaport,
  linkDinNetworkLink,
  linkKML,
  midDinLink,
} from "@/modules/prospects/kml";
import { cheieMagazin, neted, potriveștePuncte } from "@/modules/prospects/potrivire";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ADMINUL PLATFORMEI ADUCE LOCAȚIILE PENTRU O FIRMĂ.
 *
 * Același import ca în panoul firmei, dar făcut de la locul potrivit.
 * Alternativa era să intri în contul personal al clientului — ceea ce
 * i-ar declanșa alerta de „dispozitiv nou", i-ar apărea în jurnal ca
 * făcut de EL, iar dacă iese ceva strâmb nu se mai știe cine a apăsat.
 * Aici rămâne scris negru pe alb: adminul platformei, pentru firma X.
 */

interface ClientRand {
  cui: string;
  denumire: string;
  localitate: string;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isDBEnabled()) {
    return Response.json({ error: "DATABASE_URL lipsește" }, { status: 503 });
  }
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id: orgId } = await ctx.params;

  let body: {
    link?: string;
    kml?: string;
    anuleaza?: boolean;
    /** A doua jumătate a aceluiași buton: magazinele din OpenStreetMap. */
    osm?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = getDB();
  if (!db) return Response.json({ error: "DB indisponibil" }, { status: 503 });

  try {
    await ensureSchema();
    const agenti = (await listOrgAgents(orgId)).map((a) => a.name);
    const numeAg = agenti.length ? agenti : [""];

    // ── anulare: ștergem doar ce a adus importul ──
    if (body.anuleaza === true) {
      const sters = await db`
        DELETE FROM geo_firme g
        USING prospects p
        WHERE p.cui = g.cui
          AND g.sursa = 'import'
          AND (COALESCE(p.assigned_agent, '') = ''
               OR p.assigned_agent = ANY(${numeAg}))
      `;
      await audit(auth.session.email, "harta.anuleaza", orgId, {
        sterse: sters.count,
      });
      return Response.json({ ok: true, sterse: sters.count });
    }

    // ── MAGAZINELE DIN OPENSTREETMAP ──
    // Aceeași unealtă ca în panoul firmei, chemată din același buton.
    // Rămâne scris în jurnal cine a apăsat și pentru cine.
    if (body.osm === true) {
      const { planificaOSM, ramaseOSM, starePlanOSM, unJudetOSM } = await import(
        "@/modules/prospects/osm-import"
      );
      await planificaOSM(db, orgId);
      const facut = await unJudetOSM(db, orgId, agenti);
      if (facut) {
        await audit(auth.session.email, "harta.osm", orgId, {
          judet: facut.judet,
          locuriPuse: facut.locuriPuse,
          magazineNoi: facut.magazineNoi,
          eroare: facut.eroare ?? "",
        });
      }
      return Response.json({
        ok: true,
        osm: {
          facut,
          ramase: await ramaseOSM(db, orgId),
          plan: await starePlanOSM(db, orgId),
        },
      });
    }

    // ── aducem harta ──
    let kml = String(body.kml ?? "").slice(0, 12_000_000);
    const mid = midDinLink(String(body.link ?? ""));
    if (kml.trim() === "" && mid === "") {
      return Response.json(
        { error: "Dă linkul hărții (cu mid=…) sau conținutul fișierului KML." },
        { status: 400 },
      );
    }
    const descarca = async (adresa: string): Promise<string> => {
      const r = await fetch(adresa, {
        headers: { "User-Agent": "bcagent-saas/1.0 (import My Maps)" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!r.ok) throw new Error(String(r.status));
      return r.text();
    };
    if (kml === "") {
      try {
        kml = await descarca(linkKML(mid));
      } catch {
        return Response.json(
          { error: "N-am putut descărca harta de la Google. Verifică dacă e publică." },
          { status: 502 },
        );
      }
    }
    let raport = citesteKMLRaport(kml);
    if (raport.puncte.length === 0) {
      const catre = linkDinNetworkLink(kml);
      if (catre !== "") {
        try {
          kml = await descarca(catre);
          raport = citesteKMLRaport(kml);
        } catch {
          /* rămâne gol — se raportează mai jos */
        }
      }
    }
    if (raport.puncte.length === 0) {
      return Response.json(
        { error: "Harta n-are niciun magazin pe care să-l pot citi." },
        { status: 422 },
      );
    }

    // ACEEAȘI FUNCȚIE CA ÎN PANOUL FIRMEI (modules/prospects/harta-aplica).
    // Logica era copiată aici, iar când reparam ceva în panoul firmei,
    // panoul ăsta rămânea în urmă: n-a primit niciodată nici potrivirea pe
    // CUI, nici adresa cu număr din pin. Acum e o singură treabă, cu un
    // singur set de reguli, folosită de amândouă.
    const { aplicaHarta } = await import("@/modules/prospects/harta-aplica");
    const r = await aplicaHarta(db, orgId, agenti, raport.puncte);
    if (r.totalClienti === 0 && r.totalDinRegistru === 0) {
      return Response.json(
        { error: "Firma n-are clienți alocați pe agenți — n-am cu ce potrivi." },
        { status: 422 },
      );
    }
    const scrise = r.scrise;
    const magazineSalvate = r.magazineSalvate;
    const clientiCuLoc = r.clientiCuLoc;
    const potriviri = r.potriviri;

    const nesigure = potriviri.filter((p) => !p.client || p.scor < 0.9).length;
    await audit(auth.session.email, "harta.import", orgId, {
      scrise,
      magazine: raport.puncte.length,
      nesigure,
      pinuriCuCui: r.pinuriCuCui,
    });
    return Response.json({
      ok: true,
      scrise,
      totalPuncte: raport.puncte.length,
      totalClienti: r.totalClienti,
      totalDinRegistru: r.totalDinRegistru,
      nesigure,
      clientiCuLoc,
      magazineSalvate,
      // Aceleași cifre ca în panoul firmei: se vede dacă harta are tabel.
      pinuriCuCui: r.pinuriCuCui,
      adreseCuNumar: r.adreseCuNumar,
      adreseScrise: r.adreseScrise,
      neatinse: r.neatinse,
      faraLocPeHarta: raport.faraLocPeHarta,
      inafara: raport.inafara,
    });
  } catch (e) {
    console.error("[platform harta import]", e);
    // Mesajul REAL, nu „eroare". Altfel omul se uită la un dreptunghi roșu
    // și n-are ce să-mi spună, iar eu n-am ce repara.
    const detaliu = e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200);
    return Response.json(
      { error: `Eroare la importul hărții: ${detaliu}` },
      { status: 500 },
    );
  }
}
