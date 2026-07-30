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
   DATABASE_URL       = <Postgres Railway — persistență + panoul /platform>
   ```
   Opțional:
   ```
   OPENAI_MODEL            = gpt-4o     # sau gpt-4o-mini, gpt-4.1
   ANTHROPIC_API_KEY       = sk-ant-... # Claude — implicit pentru Antrenor (coach)
   GEMINI_API_KEY          = ...        # Gemini — implicit pentru pozele de la raft
   AI_PROVIDER             = openai     # forțează unul anume global
   AI_PROVIDER_ANALIZA     = openai     # sau per sarcină: rapoarte/insights
   AI_PROVIDER_COACH       = anthropic  #   antrenorul de vânzări (logică)
   AI_PROVIDER_VISION      = gemini     #   analiza pozelor de la stand
   SESSION_SECRET          = <random>   # sesiuni super-admin (fallback: TOKEN_SECRET)
   PLATFORM_ADMIN_EMAIL    = adresa@ta.ro       # bootstrap /platform
   PLATFORM_ADMIN_PASSWORD = <parolă lungă>
   STRIPE_SECRET_KEY       = sk_live_...        # plăți
   STRIPE_WEBHOOK_SECRET   = whsec_...
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

## Panoul de super-administrator (`/platform`)

Nivelul 1 din arhitectura SaaS: tu vezi toate firmele de distribuție, abonamentele și facturile.

**Primul login** — pune în variabilele de mediu:

```
PLATFORM_ADMIN_EMAIL    = adresa@ta.ro
PLATFORM_ADMIN_PASSWORD = <parolă lungă>
SESSION_SECRET          = <openssl rand -hex 32>   # opțional; altfel folosește TOKEN_SECRET
```

Deschide `/platform/login` și autentifică-te cu ele — contul se creează la primul
login și se stochează hash-uit (PBKDF2-SHA256, 120k iterații). Variabilele nu mai
contează după aceea; parola se schimbă din **Setări**. Bootstrap-ul funcționează
o singură dată: dacă există deja un admin, credențialele din env sunt ignorate.

Sesiunea e un cookie httpOnly semnat HMAC, valabil 12 ore. Login-ul e limitat la
10 încercări / 5 minute per IP.

### Ce face panoul

| Secțiune | Funcții |
|---|---|
| Dashboard | MRR, organizații pe status, utilizatori/agenți, prospecți, încasat vs. de încasat, evoluție lunară |
| Organizații | listă cu căutare + filtre, creare cu cont de owner (parolă generată), editare, suspendare/reactivare, ștergere, limită de agenți |
| Detaliu organizație | date firmă, conturi (creare/reset parolă/dezactivare/ștergere), agenți + emitere magic link cu respectarea limitei de plan, facturi, acțiuni Stripe |
| Planuri | CRUD planuri, preț, interval, limită agenți, funcționalități incluse, mapare pe Stripe Price ID + verificare live a prețului |
| Facturi | listă cu filtre, schimbare status, factură manuală (transfer bancar), link PDF Stripe, export CSV |
| Jurnal | audit: cine, ce acțiune, pe ce țintă, când |
| Setări | schimbare parolă, starea tuturor integrărilor |

### Stripe (plăți + facturi)

Platforma merge și fără Stripe (facturare manuală). Pentru plăți online:

1. Stripe → **Products**: un produs cu preț **recurent lunar** per plan.
2. Copiază `price_...` în `/platform/planuri` pentru fiecare plan.
3. Stripe → **Developers → Webhooks** → endpoint `https://<domeniu>/api/stripe/webhook`,
   evenimente: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`.
4. Variabile:
   ```
   STRIPE_SECRET_KEY     = sk_live_... / sk_test_...
   STRIPE_WEBHOOK_SECRET = whsec_...
   ```

Din pagina organizației generezi **linkul de plată** (checkout) sau deschizi
**portalul de facturare** al clientului. Webhook-ul sincronizează automat statusul
abonamentului (`active` → activ, `unpaid` → suspendat, `canceled` → anulat) și
toate facturile cu link către PDF. Evenimentele sunt idempotente — retry-urile
Stripe nu produc dubluri.

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
