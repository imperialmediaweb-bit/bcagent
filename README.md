# BC Agent — Sales Analytics

Platformă self-service de rapoarte de vânzări și eficiență pentru agenți, cu insights AI (OpenAI / Anthropic Claude). Accesul se face pe bază de token semnat (magic link). Agentul deschide linkul, încarcă XLS-ul cu vânzări, iar sistemul detectează automat coloanele, generează rapoarte și oferă analiză AI conversatională.

## Stack

Next.js 15 (App Router) · TypeScript strict · Tailwind v4 · recharts · SheetJS (xlsx) · HMAC signed tokens · OpenAI SDK / Anthropic SDK pentru AI insights.

## Quick start local

```bash
pnpm install
cp .env.example .env.local
# editează TOKEN_SECRET, ADMIN_SECRET, OPENAI_API_KEY
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

## Deploy pe Railway

1. **New Project** → **Deploy from GitHub repo** → selectează `imperialmediaweb-bit/bcagent` → branch-ul `claude/add-sales-analytics-n1L6w`.
2. Railway auto-detectează Next.js + pnpm (via `packageManager` field). `railway.json` din repo setează build și start commands.
3. **Variables** — adaugă obligatoriu:
   ```
   TOKEN_SECRET       = <string random lung, 32+ chars>
   ADMIN_SECRET       = <alt random pentru emitere tokenuri>
   OPENAI_API_KEY     = sk-...
   ```
   Opțional:
   ```
   OPENAI_MODEL       = gpt-4o     # sau gpt-4o-mini, gpt-4.1
   ANTHROPIC_API_KEY  = sk-ant-... # dacă vrei și Claude
   AI_PROVIDER        = openai     # forțează unul anume
   ```
4. **Settings → Networking → Generate Domain** — primești un URL `*.up.railway.app`. Pentru domeniu propriu, add Custom Domain și setează CNAME.
5. **Deploy.** Primul build durează 2-4 min (pnpm install + next build).

### Generare secret-uri rapide

```bash
openssl rand -hex 32   # rulează de 2 ori pentru TOKEN_SECRET și ADMIN_SECRET
```

### Emite primul token în producție

```bash
curl -X POST https://YOUR-APP.up.railway.app/api/issue-token \
  -H 'Content-Type: application/json' \
  -H 'x-admin-secret: ADMIN_SECRET_DE_LA_RAILWAY' \
  -d '{"agentId":"a-001","agentName":"Ion Popescu","ttlDays":30}'
```

Răspunsul îți dă linkul pe care îl dai agentului.

## Auto-detect coloane XLS

Headerele primului rând sunt normalizate (lowercase, fără diacritice) și mapate la **Data**, **Agent**, **Producător**, **Client**, **Cantitate**, **Valoare** printr-un dicționar de aliasuri RO + EN. UI-ul arată ce s-a detectat după upload.

## Rapoarte

- **Volume** pe producător / agent / perioadă și total
- **Clienți unici** pe producător / agent / perioadă și total
- **Evoluție vânzări** pe producător / agent / perioadă (line chart cu pivot)
- **Evoluție număr clienți** pe perioadă
- **Matrice Agent × Producător** — heatmap cine vinde ce brand
- **Calculator comisioane** — rate configurabile per agent + preț mediu
- **Eficiență per agent**: valoare, volum, clienți unici, val./client, avg tranzacție, perioade active
- **Top 10 clienți** cu pondere
- **Anomalii**: storno (cantitate negativă), "- IMPLICIT -", outlier-i
- **AI Insights** — analiză automată și chat conversațional pe baza datelor

## Privacy

XLS-ul nu pleacă pe server. Doar **date agregate** (totals, top-uri, time series, matrice) sunt trimise la AI provider când cere insights. Numele de clienți/agenți/branduri apar în acel sumar.
