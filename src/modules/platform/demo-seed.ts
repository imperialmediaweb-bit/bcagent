import { ensureSchema, getDB } from "@/lib/db";
import { signToken } from "@/lib/signed-token";
import { ensurePlatformSchema } from "./schema";
import { generatePassword } from "./passwords";
import {
  addOrgAgent,
  createOrg,
  createOrgUser,
  deleteOrg,
  listOrgs,
} from "./repo";

/**
 * Firma DEMO „Demo Distribuție SRL" — seed complet, idempotent (șterge și
 * reface tot). Folosită din /platform/setari (buton admin) și AUTOMAT de
 * „Vezi DEMO" de pe login dacă firma nu există încă.
 */

export const DEMO_ORG_NAME = "Demo Distribuție SRL";
export const DEMO_OWNER_EMAIL = "demo@provendi.ro";
export const DEMO_MANAGER_EMAIL = "manager.demo@provendi.ro";

const AGENTS = [
  { id: "demo-a1", name: "Andrei Munteanu" },
  { id: "demo-a2", name: "Elena Ciobanu" },
  { id: "demo-a3", name: "Mihai Rusu" },
];
const BRANDS = ["BAT", "Philip Morris", "JTI"];
const CLIENTS = [
  ["999000101", "MAGAZIN CENTRAL SRL", "RADAUTI"],
  ["999000102", "LA DOI PASI COM SRL", "RADAUTI"],
  ["999000103", "BAR INTIM SRL", "VICOVU DE SUS"],
  ["999000104", "ALIMENTARA NORD SRL", "SUCEAVA"],
  ["999000105", "MINIMARKET ANA SRL", "SUCEAVA"],
  ["999000106", "PROFIL M COM SRL", "GURA HUMORULUI"],
  ["999000107", "BODEGA VECHE SRL", "FALTICENI"],
  ["999000108", "DISTRIB EST SHOP SRL", "BOTOSANI"],
  ["999000109", "COLT DE RAI BAR SRL", "BOTOSANI"],
] as const;

const DAY_KEYS = [
  "duminica",
  "luni",
  "marti",
  "miercuri",
  "joi",
  "vineri",
  "sambata",
];

export interface DemoSeedResult {
  org: { id: string; name: string };
  owner: { email: string; password: string };
  manager: { email: string; password: string };
  agentLinks: Array<{ name: string; url: string }>;
}

export async function seedDemoOrg(origin: string): Promise<DemoSeedResult> {
  const db = getDB();
  if (!db) throw new Error("DATABASE_URL lipsește");
  const secret = process.env.TOKEN_SECRET;
  if (!secret) throw new Error("TOKEN_SECRET lipsește");

  await ensureSchema();
  await ensurePlatformSchema();

  // 1) Curățăm demo-ul vechi complet (idempotent).
  const existing = await listOrgs({ search: DEMO_ORG_NAME, limit: 5 });
  for (const o of existing.orgs) {
    if (o.name === DEMO_ORG_NAME) await deleteOrg(o.id);
  }
  const agentIds = AGENTS.map((a) => a.id);
  await db`DELETE FROM batches WHERE agent_id = ANY(${agentIds})`;
  await db`DELETE FROM visits WHERE agent_id = ANY(${agentIds})`;
  await db`DELETE FROM orders WHERE agent_id = ANY(${agentIds})`;
  await db`DELETE FROM routes WHERE agent_id = ANY(${agentIds})`;
  await db`DELETE FROM expenses WHERE agent_id = ANY(${agentIds})`;
  await db`DELETE FROM van_stock WHERE agent_id = ANY(${agentIds})`;
  await db`DELETE FROM prospects WHERE cui LIKE '999000%'`;

  // 2) Organizația + conturile.
  const org = await createOrg({
    name: DEMO_ORG_NAME,
    cui: "99900000",
    email: DEMO_OWNER_EMAIL,
    planId: "business",
    status: "activ",
    agentLimit: 10,
    note: "Firmă DEMO — se poate șterge/reface oricând din Setări.",
  });
  const ownerPass = generatePassword();
  await createOrgUser(org.id, DEMO_OWNER_EMAIL, ownerPass, "Patron Demo", "owner");
  const managerPass = generatePassword();
  await createOrgUser(
    org.id,
    DEMO_MANAGER_EMAIL,
    managerPass,
    "Bogdan Manager",
    "manager",
  );

  // 3) Agenții + linkurile lor (30 de zile).
  const agentLinks: Array<{ name: string; url: string }> = [];
  for (const a of AGENTS) {
    await addOrgAgent(org.id, a.id, a.name);
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    const token = await signToken(
      { agentId: a.id, agentName: a.name, exp },
      secret,
    );
    agentLinks.push({ name: a.name, url: `${origin}/a/${token}` });
  }

  // 4) Clienții (prospects) — alocați pe agenți, câțiva cu restanțe.
  for (let i = 0; i < CLIENTS.length; i++) {
    const [cui, den, loc] = CLIENTS[i];
    const agent = AGENTS[i % 3].name;
    const sold = i % 4 === 0 ? (1500 + i * 700) * 100 : null;
    await db`
      INSERT INTO prospects (cui, denumire, adresa, localitate, judet, caen,
                             activ, telefon, status, assigned_agent, sold_cents,
                             sold_updated_at)
      VALUES (${cui}, ${den}, ${"Str. Principală " + (i + 1)}, ${loc},
              ${loc === "BOTOSANI" ? "BT" : "SV"}, '4711', TRUE,
              ${"07400000" + (10 + i)}, 'client', ${agent},
              ${sold}, ${sold ? new Date() : null})
      ON CONFLICT (cui) DO NOTHING
    `;
  }

  // 5) Vânzări pe ~90 de zile — câte un batch per agent (panoul lui le vede).
  for (let ai = 0; ai < AGENTS.length; ai++) {
    const a = AGENTS[ai];
    const rows: Array<Record<string, unknown>> = [];
    for (let d = 90; d >= 0; d--) {
      if ((d + ai) % 2 !== 0) continue;
      const date = new Date(Date.now() - d * 86400_000);
      const iso = date.toISOString();
      const n = 1 + ((d + ai) % 3);
      for (let k = 0; k < n; k++) {
        const client = CLIENTS[(d + k + ai * 3) % CLIENTS.length];
        rows.push({
          date: iso,
          agent: a.name,
          producer: BRANDS[(d + k) % 3],
          client: client[1],
          volume: 400 + ((d * 37 + k * 91 + ai * 53) % 900),
          value: 0,
        });
      }
    }
    const dates = rows.map((r) => String(r.date).slice(0, 10)).sort();
    await db`
      INSERT INTO batches (id, agent_id, file_name, row_count, date_min, date_max, rows)
      VALUES (${"demo-b-" + a.id}, ${a.id}, ${"vanzari-demo.xls"},
              ${rows.length}, ${dates[0]}, ${dates[dates.length - 1]},
              ${db.json(rows as unknown as Parameters<typeof db.json>[0])})
    `;
  }

  // 6) Targeturi pe luna curentă (unul peste, unul la limită, unul sub).
  const month = new Date().toISOString().slice(0, 7);
  const targetVals = [28000, 34000, 42000];
  for (let i = 0; i < AGENTS.length; i++) {
    await db`
      INSERT INTO targets (org_id, agent_name, month, target_value)
      VALUES (${org.id}, ${AGENTS[i].name}, ${month}, ${targetVals[i]})
      ON CONFLICT (org_id, agent_name, month)
      DO UPDATE SET target_value = EXCLUDED.target_value
    `;
  }

  // 7) Vizite: azi + săptămâna asta + câteva vechi (scadenți).
  const visitPlan: Array<[number, number, string, string]> = [
    [0, 0, "client", "a semnat, livrare joi"],
    [0, 1, "gandeste", "revin marți cu oferta la JTI"],
    [1, 0, "ne_suna", ""],
    [1, 2, "client", ""],
    [2, 1, "gandeste", "vrea stand nou la casă"],
    [3, 2, "nu_vrea", "lucrează cu concurența"],
    [9, 0, "gandeste", "de reactivat!"],
    [11, 1, "ne_suna", ""],
  ];
  for (const [daysAgo, ai, result, note] of visitPlan) {
    const c = CLIENTS[(ai * 3 + daysAgo) % CLIENTS.length];
    await db`
      INSERT INTO visits (agent_id, agent_name, cui, denumire, result, note, visited_at)
      VALUES (${AGENTS[ai].id}, ${AGENTS[ai].name}, ${c[0]}, ${c[1]},
              ${result}, ${note}, ${new Date(Date.now() - daysAgo * 86400_000 - 3600_000)})
    `;
  }

  // 8) Comenzi: noi (azi), pregătite, livrate + vânzări VAN pe loc.
  const orderPlan: Array<[number, number, string, string, string]> = [
    [0, 0, "noua", "comanda", ""],
    [0, 1, "noua", "comanda", ""],
    [1, 2, "pregatita", "comanda", ""],
    [2, 0, "livrata", "comanda", ""],
    [3, 1, "livrata", "comanda", ""],
    [0, 0, "livrata", "van", "numerar"],
    [0, 1, "livrata", "van", "card"],
    [0, 2, "livrata", "van", "numerar"],
  ];
  for (let i = 0; i < orderPlan.length; i++) {
    const [daysAgo, ai, status, tip, plata] = orderPlan[i];
    const c = CLIENTS[(ai + i * 2) % CLIENTS.length];
    const lines = [
      { produs: "Kent Blue", cantitate: 5 + i, um: "cartus", pret: 262 },
      { produs: "Marlboro Red", cantitate: 3 + i, um: "cartus", pret: 285 },
    ];
    const total = lines.reduce((s, l) => s + l.cantitate * l.pret, 0);
    await db`
      INSERT INTO orders (id, agent_id, agent_name, cui, denumire, localitate,
                          lines, note, status, total_value, created_at, tip, plata)
      VALUES (${"demo-o-" + i}, ${AGENTS[ai].id}, ${AGENTS[ai].name},
              ${c[0]}, ${c[1]}, ${c[2]},
              ${db.json(lines as unknown as Parameters<typeof db.json>[0])},
              ${i === 0 ? "livrare vineri dimineața" : ""}, ${status}, ${total},
              ${new Date(Date.now() - daysAgo * 86400_000 - 7200_000)},
              ${tip}, ${plata})
    `;
  }

  // 8b) Marfa din dube — fiecare agent pleacă încărcat de dimineață.
  const vanStock: Array<[string, string, number]> = [
    ["Kent Blue", "cartus", 24],
    ["Marlboro Red", "cartus", 18],
    ["Camel Yellow", "cartus", 12],
    ["Pall Mall Albastru", "cartus", 15],
  ];
  for (const a of AGENTS) {
    for (const [produs, um, cant] of vanStock) {
      await db`
        INSERT INTO van_stock (agent_id, produs, um, cantitate, updated_at)
        VALUES (${a.id}, ${produs}, ${um}, ${cant}, NOW())
        ON CONFLICT (agent_id, produs)
        DO UPDATE SET cantitate = EXCLUDED.cantitate, updated_at = NOW()
      `;
    }
  }

  // 9) Rute pe ZIUA CURENTĂ (ca „Ziua mea" să arate viu) + deconturi.
  const todayKey = DAY_KEYS[new Date().getDay()];
  for (let ai = 0; ai < AGENTS.length; ai++) {
    const stops = CLIENTS.filter((_, i) => i % 3 === ai).map((c) => ({
      cui: c[0],
      denumire: c[1],
      adresa: "Str. Principală",
      localitate: c[2],
      telefon: "",
    }));
    await db`
      INSERT INTO routes (id, agent_id, name, day, stops)
      VALUES (${"demo-r-" + ai}, ${AGENTS[ai].id},
              ${"Ruta " + stops[0].localitate}, ${todayKey},
              ${db.json(stops as unknown as Parameters<typeof db.json>[0])})
    `;
    await db`
      INSERT INTO expenses (id, agent_id, agent_name, spent_on, category, amount_cents, note, status)
      VALUES (${"demo-e-" + ai}, ${AGENTS[ai].id}, ${AGENTS[ai].name},
              ${new Date().toISOString().slice(0, 10)}, 'combustibil',
              ${(180 + ai * 40) * 100}, 'bon OMV', ${ai === 0 ? "aprobat" : "in_asteptare"})
    `;
  }

  return {
    org: { id: org.id, name: DEMO_ORG_NAME },
    owner: { email: DEMO_OWNER_EMAIL, password: ownerPass },
    manager: { email: DEMO_MANAGER_EMAIL, password: managerPass },
    agentLinks,
  };
}
