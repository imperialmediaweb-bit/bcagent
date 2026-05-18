export default function TokenNotFound() {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold">Link invalid sau expirat</h1>
      <p className="mt-3 text-sm text-neutral-600">
        Tokenul de acces nu este valid sau a expirat. Solicită un link nou administratorului.
      </p>
    </div>
  );
}
