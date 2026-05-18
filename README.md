# BC Agent — Sales Analytics

Platformă self-service de rapoarte de vânzări și eficiență pentru agenți. Accesul se face pe bază de token semnat (magic link). Agentul deschide linkul, încarcă XLS-ul cu vânzări, iar sistemul detectează automat coloanele și generează rapoarte: volume, clienți, evoluții, eficiență per agent — toate filtrabile pe producător/agent/perioadă.

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · recharts · SheetJS (xlsx) · HMAC signed tokens (Web Crypto).

## Quick start

```bash
pnpm install
cp .env.example .env.local
# editează TOKEN_SECRET și ADMIN_SECRET cu valori random lungi
pnpm dev
```

Deschide http://localhost:3000.

## Emite un link pentru un agent

```bash
curl -X POST http://localhost:3000/api/issue-token \
  -H 'Content-Type: application/json' \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"agentId":"a-001","agentName":"Ion Popescu","ttlDays":30}'
```

Răspunsul conține `url` — trimite-l agentului. Linkul are forma `/a/<token>` și e validat HMAC-SHA256.

## Auto-detect coloane XLS

Headerele primului rând sunt normalizate (lowercase, fără diacritice) și mapate la **Data**, **Agent**, **Producător**, **Client**, **Volum**, **Valoare** printr-un dicționar de aliasuri RO + EN. UI-ul arată ce s-a detectat după upload.

## Rapoarte

- **Volume** pe producător / agent / perioadă și total
- **Clienți unici** pe producător / agent / perioadă și total
- **Evoluție vânzări** pe producător / agent / perioadă (line chart cu pivot)
- **Evoluție număr clienți** pe perioadă
- **Eficiență per agent**: valoare, volum, clienți unici, val./client, avg tranzacție, perioade active

Toate datele sunt procesate **client-side** — XLS-ul nu pleacă niciodată pe server.
