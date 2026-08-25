/**
 * PORNIREA TREBURILOR DE FUNDAL la ridicarea serverului (Next.js
 * instrumentation — rulează O dată per proces, doar pe Node).
 *
 * Deocamdată una singură: MĂTURAREA ANAF — la 2 minute după pornire și
 * apoi din 6 în 6 ore, verifică incremental firmele din județele lucrate
 * (SV+BT) la ANAF; radiatele/inactivele fiscal dispar din liste. Fiecare
 * firmă e reverificată lunar. Lock în Postgres — mai multe instanțe nu
 * dublează cererile. Se oprește cu ANAF_SWEEP=0 în env.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.ANAF_SWEEP === "0") return;
  if (!process.env.DATABASE_URL) return;

  const ruleaza = async () => {
    try {
      const { getDB } = await import("@/lib/db");
      const { ensureSchema } = await import("@/lib/db");
      const db = getDB();
      if (!db) return;
      await ensureSchema();
      const { anafSweepTick } = await import("@/modules/prospects/anaf-sweep");
      const r = await anafSweepTick(db, 10);
      if (r && r.verificate > 0) {
        console.log(
          `[anaf-sweep] ${r.verificate} firme verificate, ${r.inactive} inactive/radiate, ${r.ramase} rămase la rând`,
        );
      }
    } catch (e) {
      // Nu dărâmăm serverul pentru o măturare picată — reîncercăm la
      // următorul interval.
      console.warn("[anaf-sweep] tic eșuat:", e instanceof Error ? e.message : e);
    }
  };

  setTimeout(ruleaza, 2 * 60_000);
  setInterval(ruleaza, 6 * 60 * 60_000);
}
