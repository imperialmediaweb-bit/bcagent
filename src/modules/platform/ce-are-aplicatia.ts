/**
 * CE ARE APLICAȚIA, DE FAPT.
 *
 * Costin a scris din teren: „sc ancavit tonic srl, nu găsesc pe hartă".
 * I s-a răspuns: „deschide fișa clientului… apasă «Salvează locația
 * curentă» / «Setează GPS aici»". Butoanele alea NU EXISTĂ. Omul le-a
 * căutat pe telefon, în mașină, și n-a găsit nimic.
 *
 * AI-ul care răspunde nu știa aplicația, așa că a inventat-o. E aceeași
 * greșeală ca oriunde altundeva: ce inventăm noi ajunge în mâinile unor
 * oameni care lucrează după el.
 *
 * Fișierul ăsta e adevărul: numele EXACTE ale butoanelor, luate din
 * ecrane. Se dă AI-ului ca să nu mai ghicească. Când se schimbă un buton,
 * se schimbă și aici — de-aia stă lângă cod, nu într-un document uitat.
 */

export const CE_ARE_APLICATIA = `
PANOUL AGENTULUI (linkul lui, deschis pe telefon) — file: Ziua mea,
Clienții mei, Harta, Comenzi, Vânzări, Antrenor.

HARTA (fila „Harta"):
· Buton „Arată clienții pe hartă" / „Ascunde clienții de pe hartă".
· Buton „Magazine (N ale clienților · N de prospectat)" — punctele VERZI
  sunt magazine ale clienților lui, cele MOV sunt de prospectat.
· Apeși pe un punct → balonaș cu numele, adresa, CUI-ul, și butoanele:
  „🧭 Navighează", „✅ Există", „✕ Nu mai e".
· Buton „Doar zona de <zi>" — arată doar satele din ziua lui.
· Pe fișa unei firme: „Pune locul" (tragi pinul cu degetul pe hartă) și
  „Sunt aici acum" (ia poziția telefonului). ASTA e felul în care se pune
  locul unui magazin — NU există „Salvează locația curentă" sau „Setează
  GPS aici".
· Dacă a greșit: „Șterge locul pus" — firma revine în centrul satului.
· Poate ADĂUGA un magazin nou de pe teren: apasă pe hartă unde e
  magazinul și-i scrie numele.

ZIUA MEA:
· „Pornește ruta de azi" / „Continuă ruta cu opririle rămase" — deschide
  Google Maps cu opririle, în ordinea drumului.
· „Adaugă în rută" / „Scoate din rută" pe fiecare client.
· La fiecare oprire: „Am fost" → alege rezultatul (A devenit client / Se
  mai gândește / Ne sună el / Nu vrea / Închis azi, n-am prins pe nimeni /
  Nu mai există, s-a desființat) și scrie o notă. Nota se poate DICTA cu
  microfonul (merge doar în Chrome).
· „Închis azi" NU schimbă nimic despre firmă — doar scrie vizita.
  „Nu mai există" o scoate din listele ÎNTREGII firme și de pe hartă;
  întreabă o dată înainte, iar managerul o poate aduce înapoi din
  „Clienți" → „Scoase din liste de pe teren".
· La un CLIENT vechi, „Nu vrea" înseamnă „nu ia marfă azi": rămâne
  client. Doar la un prospect înseamnă „nu vrea cu noi".

ZONELE LUI (pe zile):
· Lipește textul cu satele, pe zile, exact cum îl are pe WhatsApp.
· „Verifică ce am înțeles" arată ce a priceput, ÎNAINTE de salvare.
· Ce nu recunoaște: îi apare o căsuță de căutare — scrie 2-3 litere și
  alege din satele lui. Alegerea se ține minte pentru firma lui.
· Dacă e o ZONĂ („Țara Dornelor"), îl întreabă direct care sunt satele
  din ea și le scrie pe toate deodată.

CLIENȚII MEI:
· Căutare după nume sau CUI. „Editează date de contact" (telefon, persoană).
· „Importă clienții" — dintr-un fișier XLS/CSV.
· „Fișa clientului, făcută de AI din tot istoricul".

ANTRENORUL (fila „Antrenorul meu") POATE ȘI SĂ FACĂ, prin vorbă sau
scris — pe contul agentului care vorbește, atât:
· „pune-mi <firma> în ruta de azi/mâine/luni" — o caută și o pune în
  ruta lui pe ziua aia; dacă numele se potrivește la mai multe, întreabă.
· „pune-mi zonele: luni - <sate>; marți - <sate>" — le salvează cu
  aceeași citire ca ecranul; ce nu recunoaște NU se ghicește, i se
  spune pe nume.
· „caută-mi firma <nume>" — caută în registru cum ar căuta el pe ecran.
· „am fost la <firma>, a comandat / se mai gândește / nu vrea / era
  închis" — scrie vizita în jurnal, ca butonul „Am fost". Dacă nu spune
  ce s-a întâmplat, întreabă întâi.
· „sunt în fața la <firma>" — pune locul firmei pe poziția telefonului,
  ca „Sunt aici acum" (cere GPS bun).
· „adaugă magazinul <nume> aici" — magazin nou pe poziția lui, ca
  butonul „Adaugă magazin" de pe hartă.
· „Nu mai există (s-a desființat)" NU se poate da din chat, dinadins —
  doar de pe buton, cu confirmare.
Butoanele manuale rămân toate — asistentul e în plus, nu în loc.

COMENZI: le bate pe telefon la client; depozitul le vede imediat.
Poate face poză la factură, iar AI-ul o citește.
VAN SALES: „Marfă încărcată în dubă", vinde pe loc, „Dă retur".

PANOUL FIRMEI (contul managerului, pe calculator) — meniu în stânga:
Dashboard, Raportul săpt., Vânzări, Comenzi, Targeturi, Agenți, Vizite,
Harta firmei, Zonele agenților, Adu locațiile, Clienți, Solduri, Decont,
Probleme, Echipa, Setări.

· „Adu locațiile" — lipești linkul hărții Google My Maps și aduce
  locurile magazinelor; tot de acolo se aduc și magazinele de pe
  OpenStreetMap. Se poate da înapoi cu „Anulează ce am adus".
· „Agenți" — aici se emit linkurile agenților și se vede „Munca de teren"
  (câte locuri a pus fiecare, câte magazine a confirmat).
· „Zonele agenților" — managerul poate scrie zonele în locul agentului.
· „Clienți" — „Scoase din liste de pe teren": firmele pe care agenții
  le-au raportat ca desființate, cu „Adu-o înapoi" pe fiecare.
· „Zonele agenților" — „Ce a învățat aplicația de la voi": perechile
  învățate („Burdujeni → SUCEAVA"), fiecare cu „Scoate".
· „Clienți" — „Adu universul de clienți (XLS/CSV)"; dacă fișierul are
  coloană de adresă de livrare sau punct de lucru, ea se folosește la
  navigare, fiind mai bună decât sediul social.

CE NU EXISTĂ (ca să nu se inventeze):
· NU există buton „Salvează locația curentă", „Setează GPS aici" sau
  „Actualizează locație" — locul se pune cu „Pune locul" sau „Sunt aici acum".
· NU există „pull-to-refresh" ca funcție a aplicației; pagina se
  reîncarcă normal, din browser.
· Agentul NU poate șterge clienți și NU poate umbla la prețuri.
· Adresa unui client NU se editează din panoul agentului; se editează
  doar contactul (telefon, persoană).

DE UNDE VIN DATELE (util la „nu găsesc firma X"):
· Clienții vin din fișierul firmei, potriviți cu registrul Finanțelor
  după CUI sau după nume.
· Dacă o firmă NU e în listă, ori n-a fost în fișier, ori are alt nume în
  acte. Se caută după 3-4 litere din nume, nu după numele întreg.
· Locul pe hartă vine, în ordine: pinul pus de agent (cel mai bun) →
  harta veche a firmei → OpenStreetMap → adresa din acte → centrul
  satului. Dacă firma n-are adresă cu număr, pinul stă în centrul
  satului: de-aia „nu apare unde trebuie".
`.trim();
