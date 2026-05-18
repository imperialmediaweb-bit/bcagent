import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">BC Agent</h1>
      <p className="mt-4 text-neutral-600">
        Platformă de rapoarte de vânzări și eficiență pentru agenți, cu insights
        AI. Accesul se face pe bază de link semnat (token) emis de administrator.
      </p>

      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium">Cum funcționează?</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-neutral-700">
          <li>Primești un link unic de la administrator.</li>
          <li>Deschizi linkul — intri direct în panoul tău, fără parolă.</li>
          <li>
            Încarci fișierul XLS cu vânzări — sistemul detectează automat
            coloanele.
          </li>
          <li>
            Analizezi: volume, clienți, evoluție, eficiență per agent /
            producător / perioadă + insights AI.
          </li>
        </ol>
      </div>

      <div className="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-6">
        <h2 className="text-lg font-medium text-indigo-900">
          Ești administrator?
        </h2>
        <p className="mt-2 text-sm text-indigo-800">
          Mergi în panoul de admin ca să emiți linkuri pentru agenții tăi.
        </p>
        <Link
          href="/admin"
          className="mt-4 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700"
        >
          Deschide panoul admin →
        </Link>
      </div>

      <p className="mt-6 text-xs text-neutral-500">
        Datele sunt procesate exclusiv în browser — fișierul XLS nu este urcat
        pe server. Doar date agregate (totaluri, top-uri) ajung la AI provider
        când ceri insights.
      </p>
    </main>
  );
}
