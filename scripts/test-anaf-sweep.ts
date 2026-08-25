/**
 * MĂTURAREA ANAF — logică verificată FĂRĂ rețea (ANAF nu e accesibil din
 * mediul de test; fabricăm răspunsurile și verificăm ce contează):
 *   1. selecția: întâi firmele neverificate, apoi cele mai vechi de 30
 *      de zile; cele proaspăt verificate NU intră; alt județ NU intră;
 *   2. aplicarea: negăsit la ANAF → inactiv; inactiv fiscal → inactiv;
 *      activ la ANAF → activ;
 *   3. REGULA DE AUR: firma închisă din TEREN rămâne închisă chiar dacă
 *      ANAF o vede legal activă;
 *   4. toate primesc anaf_checked_at (nu se reverifică la următorul tic).
 *
 * Rulare: DATABASE_URL=... npx tsx scripts/test-anaf-sweep.ts
 */
import postgres from "postgres";
import {
  aplicaRezultateAnaf,
  firmeDeVerificat,
} from "../src/modules/prospects/anaf-sweep";
import type { AnafFirmInfo } from "../src/modules/prospects/anaf";

const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@127.0.0.1:5433/postgres",
);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function main() {
  const RUN = Date.now().toString().slice(-7);
  const cui = (i: number) => `77${RUN}${i}`;

  // 1 = neverificată; 2 = verificată demult; 3 = verificată IERI;
  // 4 = alt județ; 5 = închisă din teren; 6 = inactivă fiscal la ANAF;
  // 7 = negăsită la ANAF (radiată); 8 = LIPSĂ din răspuns (nici found,
  // nici notFound — răspuns parțial: nu ne atingem de ea).
  await sql`INSERT INTO prospects (cui, denumire, localitate, judet, status, assigned_agent, activ, inchis_teren, anaf_checked_at)
    VALUES
    (${cui(1)}, ${"SWEEP NEVERIFICATA " + RUN}, 'SAT X', 'SV', 'nou', '', TRUE, FALSE, NULL),
    (${cui(2)}, ${"SWEEP VECHE " + RUN}, 'SAT X', 'SV', 'nou', '', TRUE, FALSE, NOW() - INTERVAL '45 days'),
    (${cui(3)}, ${"SWEEP PROASPATA " + RUN}, 'SAT X', 'SV', 'nou', '', TRUE, FALSE, NOW() - INTERVAL '1 day'),
    (${cui(4)}, ${"SWEEP ALT JUDET " + RUN}, 'SAT Y', 'CJ', 'nou', '', TRUE, FALSE, NULL),
    (${cui(5)}, ${"SWEEP INCHISA TEREN " + RUN}, 'SAT X', 'SV', 'nou', '', FALSE, TRUE, NULL),
    (${cui(6)}, ${"SWEEP INACTIVA FISCAL " + RUN}, 'SAT X', 'SV', 'nou', '', TRUE, FALSE, NULL),
    (${cui(7)}, ${"SWEEP RADIATA " + RUN}, 'SAT X', 'SV', 'nou', '', TRUE, FALSE, NULL),
    (${cui(8)}, ${"SWEEP LIPSA RASPUNS " + RUN}, 'SAT X', 'SV', 'nou', '', TRUE, FALSE, NULL)`;

  console.log("\n══ Selecția firmelor scadente ══");
  const toate = await firmeDeVerificat(sql, ["SV", "BT"], 100000);
  const aleNoastre = toate.filter((c) => c.startsWith(`77${RUN}`));
  check("neverificata intră", aleNoastre.includes(cui(1)));
  check("cea veche (45 zile) intră", aleNoastre.includes(cui(2)));
  check("cea verificată IERI nu intră", !aleNoastre.includes(cui(3)));
  check("alt județ (CJ) nu intră", !aleNoastre.includes(cui(4)));
  check("închisa din teren intră (o reverificăm, dar n-o reînviem)", aleNoastre.includes(cui(5)));
  const pozitiiNeverificate = [cui(1), cui(5), cui(6), cui(7)].map((c) => toate.indexOf(c));
  const pozVeche = toate.indexOf(cui(2));
  check(
    "neverificatele vin ÎNAINTEA celor vechi",
    pozitiiNeverificate.every((p) => p !== -1 && p < pozVeche),
  );

  console.log("\n══ Aplicarea răspunsului ANAF ══");
  const info = new Map<string, AnafFirmInfo>([
    [cui(1), { cui: cui(1), activ: true, tva: true, radiata: false }],
    [cui(2), { cui: cui(2), activ: true, tva: false, radiata: false }],
    // cui(5): ANAF zice ACTIVĂ — dar terenul a închis-o!
    [cui(5), { cui: cui(5), activ: true, tva: true, radiata: false }],
    [cui(6), { cui: cui(6), activ: false, tva: false, radiata: false }],
    // cui(7) e declarată EXPLICIT negăsită de ANAF (radiată);
    // cui(8) lipsește și din found și din notFound (răspuns parțial).
  ]);
  const lot = [cui(1), cui(2), cui(5), cui(6), cui(7), cui(8)];
  const r = await aplicaRezultateAnaf(sql, lot, info, new Set([cui(7)]));
  check("numărătoarea inactivelor e corectă (radiată + inactivă fiscal)", r.inactive === 2, String(r.inactive));
  check("firma lipsă din răspuns e SĂRITĂ, nu marcată", r.sarite === 1, String(r.sarite));

  const stare = new Map(
    (
      await sql<Array<{ cui: string; activ: boolean | null; verificata: boolean }>>`
        SELECT cui, activ, anaf_checked_at IS NOT NULL AS verificata
        FROM prospects WHERE cui = ANY(${lot})
      `
    ).map((x) => [x.cui, x]),
  );
  check("firma activă la ANAF rămâne activă", stare.get(cui(1))?.activ === true);
  check("firma inactivă FISCAL devine inactivă", stare.get(cui(6))?.activ === false);
  check("firma DECLARATĂ negăsită de ANAF (radiată) devine inactivă", stare.get(cui(7))?.activ === false);
  check(
    "firma LIPSĂ din răspuns rămâne NEATINSĂ (activă, fără anaf_checked_at)",
    stare.get(cui(8))?.activ === true && stare.get(cui(8))?.verificata === false,
    JSON.stringify(stare.get(cui(8))),
  );
  check(
    "REGULA DE AUR: închisă din teren RĂMÂNE închisă deși ANAF o vede activă",
    stare.get(cui(5))?.activ === false,
    JSON.stringify(stare.get(cui(5))),
  );
  const cuRaspuns = lot.filter((c) => c !== cui(8));
  check(
    "cele CU răspuns au primit anaf_checked_at (nu se reiau la următorul tic)",
    cuRaspuns.every((c) => stare.get(c)?.verificata === true),
  );
  const scadenteDupa = await firmeDeVerificat(sql, ["SV"], 100000);
  check(
    "după aplicare, cele cu răspuns nu mai sunt scadente",
    cuRaspuns.every((c) => !scadenteDupa.includes(c)),
  );
  check(
    "firma lipsă din răspuns RĂMÂNE scadentă (se reia data viitoare)",
    scadenteDupa.includes(cui(8)),
  );

  console.log("\n══ Curățenie ══");
  await sql`DELETE FROM prospects WHERE cui LIKE ${"77" + RUN + "%"}`;
  console.log("  · datele de test șterse");

  await sql.end();
  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} verificări trecute, ${fail} eșuate`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
