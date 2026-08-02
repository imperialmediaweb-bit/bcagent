# Checklist de producție — stadiul real

Verificat pe cod, nu din memorie. Ultima actualizare: 2 august 2026.
Legendă: ✅ făcut și acoperit cu test · ⚠️ parțial · ❌ de făcut · 👤 ține de tine, nu de cod

## 1. Blocante tehnice — 8 din 8 ✅

| # | Cerință | Stare | Unde |
|---|---|---|---|
| 1 | Izolare între firme, verificată prin API | ✅ | filtru de tenant din SESIUNE (`auth.session.orgId`), niciodată din URL. Testat pe comenzi, poze, agenți, echipă, clienți, vânzări, raport, solduri |
| 2 | Comanda offline nu se pierde / nu se dublează | ✅ **reparat azi** | `clientId` unic per comandă + plasă pe server (aceeași comandă în 3 min) |
| 3 | Stocul din dubă nu intră pe minus | ✅ | `GREATEST(0, …)` la vânzare și la retur |
| 4 | PIN cu limitare la încercări | ✅ | 20/5 min per IP + blocare pe cont după 5 greșeli/15 min |
| 5 | Token de agent aleator criptografic | ✅ | HMAC-SHA256 (256 biți) peste payload, cu `TOKEN_SECRET`. Fără semnătura corectă, linkul e inutil — nu se poate ghici și nu e ID incremental |
| 6 | Manager fără acces la salarii/echipă prin API | ✅ | rol verificat pe server la fiecare cerere (403 pentru manager) |
| 7 | Reîncărcarea aceluiași fișier nu dublează | ✅ **reparat azi** | amprentă `sha256` pe conținut la SAGA; clienți/solduri erau deja idempotente (upsert pe CUI) |
| 8 | Blocarea agentului îi omoară linkul instant | ✅ **reparat azi** | poarta era doar pe pagină; acum e pe TOATE rutele de teren, iar blocarea golește instant starea din memorie |

### Restul secțiunii 1

| Cerință | Stare |
|---|---|
| Fluxul „prima zi" de 3 ori la rând | ✅ 3 rulări identice, 500 verificări, 0 eșecuri |
| Pozele de factură inaccesibile prin URL direct | ✅ nu există URL public — stau criptate AES-256-GCM în baza de date, ies doar prin endpoint cu sesiune de firmă |
| Export CSV cu escape pentru `= + - @` | ✅ **reparat azi** (comenzi + decont) |
| Diacritice peste tot | ✅ interfață, import (UTF-8 + windows-1250), export CSV cu BOM |

## 2. Date

| Cerință | Stare |
|---|---|
| 🔴 Backup zilnic automat, în alt loc | 👤 **de făcut de tine** — Railway → Postgres → Backups. E din 2 clicuri |
| 🔴 Restaurare testată efectiv | 👤 **de făcut** — fă o restaurare o dată și cronometreaz-o |
| Retenție backup | 👤 de decis (recomand 30 de zile) |
| Backup pentru pozele de facturi | ✅ sunt în aceeași bază de date → intră în același backup |
| Ștergerea firmei șterge datele | ✅ `deleteOrg` curăță utilizatori, agenți, legături |
| Ce se întâmplă la neplată | ⚠️ codul nu blochează automat la expirarea probei (intenționat, ca să nu rămână nimeni pe dinafară în mijlocul testului). De scris politica |

## 3. Legal — 👤 tot ce urmează ține de tine

Termeni, confidențialitate, cookies, **DPA cu fiecare firmă** (ești persoană
împuternicită), informarea agentului că i se înregistrează vizitele, registrul
prelucrărilor, procedura de ștergere/export, mențiunea despre datele trimise
la furnizorul AI, datele firmei pe site.

**Notă tehnică utilă pentru politica de confidențialitate:** pozele de factură
pleacă la Google (Gemini) pentru citire; cifrele de vânzări la OpenAI/Anthropic
pentru analiză și antrenor. Nimic nu se stochează la ei pe termen lung, dar
trebuie scris.

## 4. Bani

| Cerință | Stare |
|---|---|
| Ziua 15 | ✅ banner cu zilele rămase; accesul NU se taie automat, tu decizi din admin |
| Procesator de plată testat cu plată reală | ⚠️ Stripe e integrat (planuri, checkout, portal, facturi, webhook), dar **netestat cu o plată reală** |
| Facturare fiscală / e-Factura | ❌ nu există |
| Planuri și limite clare | ⚠️ limita de agenți există și se aplică; **limita de poze OCR nu există** |
| 🔴 Cost per client calculat | 👤 de făcut cu cifrele tale |
| 🔴 Limită de siguranță pe consumul AI per firmă | ❌ **nu există** — un client entuziast îți poate goli bugetul |
| Ce se întâmplă la anulare | 👤 de scris |

**Observația din documentul tău e corectă și e cea mai importantă de aici:**
prețul pe agent e greșit pentru tine, pentru că te costă *pozele*, nu agenții.
Recomand: limită inclusă (ex. 3.000 poze/lună), restul la bucată, iar pe probă
o limită mai mică.

## 5. Operațional

| Cerință | Stare |
|---|---|
| Monitorizare uptime cu alertă | ❌ **de pus** (UptimeRobot, gratuit, 5 minute de lucru) |
| Alertă la erori | ⚠️ ai deja telemetrie proprie (`/platform/activitate`) care prinde crash-urile agenților fără să te sune — dar nu-ți dă notificare pe telefon |
| Log-uri 30 de zile | ✅ audit + `app_events` + `login_events` în bază |
| SSL cu reînnoire automată | ✅ Railway |
| Plan pentru „pică AI-ul la 9 dimineața" | ✅ **nu e blocant**: dacă AI-ul nu răspunde, agentul primește mesaj clar și scrie comanda manual — poza rămâne atașată. Fluxul de comandă nu depinde de AI |
| Timp de răspuns la 💬 | 👤 de scris în ghid |
| Testat cu 500 de clienți la un agent | ⚠️ testat cu 1,3M firme pe hartă și 300 de rânduri per pagină; portofoliu de 500 — netestat explicit |

## 6. Onboarding

| Cerință | Stare |
|---|---|
| Firma ajunge singură de la înregistrare la primul agent | ✅ înregistrare 30 sec → adaugi agent → copiezi link |
| Import cu fișiere reale, murdare | ✅ diacritice, UTF-8/windows-1250, .xls fals, coloane detectate singure, CUI lipsă |
| Mesaj de eroare cu rândul exact | ⚠️ spune câte rânduri au intrat și care agenți lipsesc; **nu spune numărul rândului** |
| Email de bun venit cu primii 3 pași | ❌ nu se trimite |
| Ghidul legat din panou | ✅ în meniu |
| Mesaj gata de copiat pentru WhatsApp | ❌ nu există |
| Un om străin face setarea singur, tu taci | 👤 **cel mai valoros test din tot documentul** — fă-l cu Bogdan |

---

## Minimul absolut, dacă lansezi săptămâna asta

1. **Toate cele 8 blocante** → ✅ gata (3 reparate azi)
2. **Backup testat** → 👤 rămâne la tine (Railway, 10 minute)
3. **Ziua 15** → ✅ gata
4. **Termeni + confidențialitate + DPA** → 👤 rămâne la tine
5. **Monitorizare cu alertă** → ❌ 5 minute pe UptimeRobot

Din cele 5, codul acoperă 2. Celelalte 3 nu se pot scrie din cod.
