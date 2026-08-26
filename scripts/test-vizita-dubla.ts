/**
 * O APĂSARE NERVOASĂ NU E DOUĂ VIZITE.
 *
 * Din teren, 26.08: COLER COM S.R.L. apare de două ori la 13:26, cu
 * aceeași notă, de la Robert. N-a intrat de două ori în magazin — a apăsat
 * a doua oară fiindcă telefonul mergea greu și nu se întâmpla nimic pe
 * ecran. Pe raportul lui Bogdan ieșeau două vizite din una.
 *
 * Aici lovim API-ul adevărat, ca telefonul: aceeași vizită de trei ori la
 * rând, apoi cazurile în care CHIAR sunt vizite diferite și trebuie să
 * intre toate.
 */

import { signToken } from "../src/lib/signed-token";
import { ensureSchema, getDB } from "../src/lib/db";

const BAZA = process.env.BASE_URL ?? "http://127.0.0.1:3131";
const SECRET = process.env.TOKEN_SECRET ?? "test-secret-0123456789";

let treceri = 0;
let caderi = 0;
function ok(nume: string, conditie: boolean, detaliu = "") {
  if (conditie) {
    treceri++;
    console.log(`  ✓ ${nume}`);
  } else {
    caderi++;
    console.log(`  ✗ ${nume}${detaliu ? ` — ${detaliu}` : ""}`);
  }
}

const db = getDB();
if (!db) {
  console.log("DATABASE_URL lipsește — nu pot rula.");
  process.exit(1);
}

const AG = "test-viz-dubla-ag";
const NUME = "Robert Proba";
const CUI = "992000001";
const CUI2 = "992000002";

const curata = async () => {
  await db!`DELETE FROM visits WHERE agent_id = ${AG}`;
  await db!`DELETE FROM prospects WHERE cui IN (${CUI}, ${CUI2})`;
};

async function trimite(cui: string, result: string, note: string, token: string) {
  const r = await fetch(`${BAZA}/api/visits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, cui, denumire: "COLER COM S.R.L.", result, note }),
  });
  return r.status;
}

async function cate(cui: string): Promise<number> {
  const [r] = await db!<[{ n: string }]>`
    SELECT COUNT(*)::text AS n FROM visits WHERE agent_id = ${AG} AND cui = ${cui}
  `;
  return parseInt(r.n, 10);
}

async function main() {
  await ensureSchema();
  await curata();
  await db!`
    INSERT INTO prospects (cui, denumire, judet, assigned_agent, status)
    VALUES (${CUI}, 'COLER COM S.R.L.', 'SV', ${NUME}, 'client'),
           (${CUI2}, 'ALT MAGAZIN SRL', 'SV', ${NUME}, 'client')
    ON CONFLICT (cui) DO UPDATE SET assigned_agent = ${NUME}
  `;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = await signToken({ agentId: AG, agentName: NUME, exp }, SECRET);

  console.log("\n══ Apasă de trei ori pe același buton ══");
  const nota = "lucrează la facturare cu producătorii";
  const s1 = await trimite(CUI, "gandeste", nota, token);
  const s2 = await trimite(CUI, "gandeste", nota, token);
  const s3 = await trimite(CUI, "gandeste", nota, token);
  ok("toate trei răspund bine (agentul nu vede eroare)", s1 < 300 && s2 < 300 && s3 < 300, `${s1}/${s2}/${s3}`);
  ok("dar în jurnal e O SINGURĂ vizită", (await cate(CUI)) === 1, `sunt ${await cate(CUI)}`);

  console.log("\n══ Ce TREBUIE să intre, intră ══");
  await trimite(CUI, "gandeste", "a doua oară azi, altă vorbă", token);
  ok("altă notă la același client = altă vizită", (await cate(CUI)) === 2, `sunt ${await cate(CUI)}`);

  await trimite(CUI, "nu_vrea", nota, token);
  ok("alt rezultat, aceeași notă = altă vizită", (await cate(CUI)) === 3, `sunt ${await cate(CUI)}`);

  await trimite(CUI2, "gandeste", nota, token);
  ok("alt client, aceeași notă = altă vizită", (await cate(CUI2)) === 1);

  console.log("\n══ Peste două minute e o vizită adevărată ══");
  // Dăm ceasul înapoi pe cea veche, ca și cum ar fi fost acum trei minute.
  await db!`
    UPDATE visits SET visited_at = NOW() - INTERVAL '3 minutes'
    WHERE agent_id = ${AG} AND cui = ${CUI2}
  `;
  await trimite(CUI2, "gandeste", nota, token);
  ok(
    "aceeași vizită, dar peste trei minute, se scrie",
    (await cate(CUI2)) === 2,
    `sunt ${await cate(CUI2)}`,
  );

  console.log("\n══ Nota goală (agentul doar bifează, fără să scrie) ══");
  await db!`DELETE FROM visits WHERE agent_id = ${AG} AND cui = ${CUI2}`;
  await trimite(CUI2, "client", "", token);
  await trimite(CUI2, "client", "", token);
  ok("două bife identice = o vizită", (await cate(CUI2)) === 1, `sunt ${await cate(CUI2)}`);

  console.log("\n══ Curățenie ══");
  await curata();
  console.log("  · datele de test șterse");
  console.log(`\n${caderi === 0 ? "✅" : "❌"} ${treceri} verificări trecute, ${caderi} eșuate\n`);
  await db!.end();
  process.exit(caderi === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await curata().catch(() => {});
  await db!.end();
  process.exit(1);
});
