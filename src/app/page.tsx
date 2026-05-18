export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">BC Agent</h1>
      <p className="mt-4 text-neutral-600">
        Platformă de rapoarte de vânzări și eficiență pentru agenți. Accesul se
        face pe bază de link semnat (token) emis de administrator.
      </p>
      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6">
        <h2 className="text-lg font-medium">Cum funcționează?</h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-neutral-700">
          <li>Primești un link unic de la administrator.</li>
          <li>Deschizi linkul — intri direct în panoul tău.</li>
          <li>Încarci fișierul XLS cu vânzări — sistemul detectează automat coloanele.</li>
          <li>Analizezi: volume, clienți, evoluție, eficiență per agent / producător / perioadă.</li>
        </ol>
      </div>
      <p className="mt-6 text-xs text-neutral-500">
        Datele sunt procesate exclusiv în browser — fișierul XLS nu este urcat pe server.
      </p>
    </main>
  );
}
