# Raport QA — Provendi (platforma de agenți de vânzări)

**Data:** 2 august 2026
**Versiune testată:** branch `claude/add-sales-analytics-n1L6w`, commit `2a70978`
**Mediu:** build de PRODUCȚIE (`next build` + `next start`) rulat local, cu
Postgres real. Aceleași binare care ajung pe Railway.

## Rezultat pe scurt

| | |
|---|---|
| Verificări automate | **321** (6 suite) |
| Eșecuri | **0** |
| Rulări verzi consecutive | **3 / 3** |
| Bug-uri BLOCANTE găsite | **3** |
| Bug-uri blocante rămase | **0** — toate reparate și acoperite cu test |

---

## Bug-uri găsite și reparate în această campanie

### BUG-01 · BLOCANT · Același fișier încărcat de două ori dubla TOATE cifrele

**Unde:** panoul firmei → Vânzări → încărcare raport SAGA
(`POST /api/agentie/upload`), și panoul agentului (`POST /api/batches`).

**Cum se reproduce:**
1. Administratorul încarcă `raport-iunie.xlsx` (2 rânduri, 1.500 RON).
2. Nu e sigur că a mers și îl mai încarcă o dată.

**Ce se întâmpla:** al doilea import intra ca lot nou. Vânzările, targeturile,
briefingul AI și topul de clienți arătau **3.000 RON în loc de 1.500** —
adică dublu, fără niciun avertisment. Cu 3 încărcări, triplu.

**De ce e blocant:** patronul ia decizii pe cifre false, iar comisioanele
agenților se calculează greșit.

**Reparat:** fiecare fișier primește o amprentă `sha256` din conținutul
rândurilor (nu din nume). Dacă amprenta există deja pentru firma respectivă,
importul răspunde „Fișierul ăsta e deja încărcat — nu am dublat nimic" și
NU inserează nimic. Prinde duplicatul și dacă fișierul a fost redenumit sau
rândurile sunt în altă ordine.

**Test de regresie:** `test-panouri` → secțiunea „Același fișier încărcat de
2 ori NU dublează cifrele" (6 verificări, inclusiv suma finală = 1.500).

---

### BUG-02 · BLOCANT · Comanda retrimisă intra de două ori la depozit

**Unde:** panoul agentului → comandă / vânzare pe loc (`POST /api/orders`).

**Cum se reproduce:**
1. Agentul apasă „Trimite" în magazin, cu semnal slab.
2. Apasă încă o dată (sau telefonul retrimite când revine netul).

**Ce se întâmpla:** două comenzi identice la depozit. La vânzarea din dubă,
**stocul scădea de două ori** și numerarul de predat ieșea dublu.

**De ce e blocant:** depozitul pregătea marfă dublă, iar seara suma din
aplicație nu mai bătea cu banii din buzunarul agentului — exact motivul
pentru care agenții abandonează o aplicație.

**Reparat:** două plase de siguranță.
1. Telefonul generează un `clientId` o singură dată per comandă; serverul
   recunoaște retrimiterea și întoarce comanda existentă.
2. Pentru orice client mai vechi, fără `clientId`: aceeași comandă (același
   client + aceleași produse) trimisă de același agent în ultimele 3 minute
   e tratată ca duplicat. Stocul din dubă NU se mai scade a doua oară.

**Test de regresie:** `test-panouri` → „Comanda offline nu se pierde și nu se
trimite de 2 ori".

---

### BUG-03 · BLOCANT · Harta arăta firme, lista spunea „0 firme"

**Unde:** panoul agentului → Harta pieței → click pe localitate
(raportat din teren: Brodina).

**Ce se întâmpla:** bula de pe hartă număra toate firmele nefalimentare, dar
lista din dreapta cerea strict firme *verificate ANAF*. Cum verificarea ANAF
merge treptat, majoritatea firmelor sunt încă „neverificate" → bulă plină,
listă goală.

**Reparat:** lista folosește exact același criteriu ca harta (ascunde doar
radiatele). Eticheta filtrului a devenit „Doar firme active (ascunde
radiatele)", ca să spună adevărul.

**Test de regresie:** `test-field-api` → „Hartă vs listă: firmele NEverificate
ANAF se văd".

---

### BUG-04 · MEDIU · Clicul pe „zone neacoperite" părea că nu face nimic

Butonul funcționa, dar rezultatul apărea sus lângă hartă, iar utilizatorul era
derulat jos. **Reparat:** la click, ecranul urcă automat la hartă cu lista
localității deschisă. Verificat în browser real (Chromium): de la poziția 684
sare la 357 și afișează firmele.

---

### BUG-05 · MEDIU · Ruta lungă pierdea clienții în tăcere

Google Maps acceptă maximum 10 puncte pe link. O rută de 25 de firme pleca cu
primele 10, iar restul **dispăreau fără niciun mesaj**.

**Reparat:** ruta se împarte în **etape** de câte 10 („Etapa 1", „Etapa 2"…),
opririle deja bifate ies din calcul, iar butonul devine
**„Continuă ruta (X rămase)"**. Când s-a terminat tot: „gata ✓".

---

## Ce s-a verificat (321 de verificări)

| Suită | Verificări | Acoperă |
|---|---:|---|
| `test-panouri` | 136 | fiecare funcție din cele 3 panouri + 4 scenarii critice |
| `test-van-factura-import` | 45 | van, poza la factură, import clienți, izolare |
| `test-agentie-flows` | 46 | tot panoul firmei, roluri, izolare |
| `test-field-api` | 44 | API-ul de teren, hartă, rute, vizite |
| `test-agent-flows` | 32 | fluxurile agentului cap-coadă |
| `test-2fa-lockout` | 18 | 2FA, blocare cont, istoric conectări |

Plus suitele de parsare fișiere (parser, SAGA pivot, diacritice, ODS, formate
de județ, streaming) — toate trecute.

### Scenariile critice, punct cu punct

| Cerință | Rezultat |
|---|---|
| Firma A nu citește date din Firma B (prin API, nu doar în UI) | ✅ verificat pe comenzi, poze, agenți, echipă, clienți, vânzări, raport |
| PIN-ul agentului are limită la încercări repetate | ✅ se blochează (429/423) |
| Reîncărcarea aceluiași fișier nu dublează nimic | ✅ BUG-01 reparat |
| Stocul din dubă nu poate intra pe minus | ✅ se oprește la 0 |
| Comanda retrimisă nu se dublează | ✅ BUG-02 reparat |
| **Banii de predat = banii din buzunar, la leu** | ✅ 5 vânzări mixte (numerar/card/termen) → aplicația arată **77,10 RON**, exact cât e numerarul; cardul și termenul nu intră în sumă |
| Managerul nu poate crea conturi | ✅ 403 |
| Firma nu intră în panoul de admin | ✅ 401/403 pe toate rutele |
| Token de agent expirat | ✅ 401 pe toate rutele de teren |

---

## Netestat și de ce

| Ce | De ce |
|---|---|
| **Rulare pe https://provendi.ro (producție)** | Mediul meu de lucru nu are voie să iasă către provendi.ro — proxy-ul răspunde 403 la conexiune. Am rulat în schimb **exact același build de producție**, local, cu Postgres real. |
| Offline real (avion / tunel) cu Playwright | Se poate face; partea logică (comanda nu se pierde, nu se trimite de 2 ori) e acoperită automat prin BUG-02. Restul cere telefon fizic. |
| Citirea reală a facturilor cu AI (OCR) | Cere chei LLM și poze reale; costă bani la fiecare rulare. Gating-ul, limitele de mărime, avertismentul de scris de mână și verificarea aritmetică a totalului sunt testate. |
| Emailuri către adrese reale | Interzis prin regulile de test — nu am trimis niciun email. |
| Teste de încărcare / fișiere uriașe | Interzise prin reguli. |
| Skill-urile `.claude/skills/qa-*` | **Nu există în proiect** — nu sunt instalate. Am acoperit conținutul lor cu suitele de mai sus. |

---

## Recomandarea nr. 1 rămasă

Adaugă `data-testid` pe butoanele critice (PIN, „Am fost", „Încasează și
salvează", „Salvează ruta", „Copiază linkul", stările comenzii). Fără ele,
orice test de interfață se rupe la prima schimbare de text. Testele actuale
lovesc API-ul direct, deci sunt stabile — dar pentru teste de UI cu browser
e obligatoriu.

## Cum rulezi tu campania

```bash
# 1. build de producție + server local
npx next build && npx next start -p 3131

# 2. toate suitele
for s in test-panouri test-field-api test-agent-flows \
         test-agentie-flows test-van-factura-import test-2fa-lockout; do
  BASE_URL=http://127.0.0.1:3131 TOKEN_SECRET=... DATABASE_URL=... \
    npx tsx scripts/$s.ts
done
```
