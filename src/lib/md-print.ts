/**
 * RAPORT DE TIPĂRIT din texte AI (markdown minimal) — pentru butonul
 * „Descarcă PDF": managerul deschide fereastra de tipărire a telefonului/
 * browserului și salvează PDF-ul, pe care-l dă mai departe patronului.
 * Zero librării: aceleași reguli ca AiMarkdown (titluri ##, buline,
 * numerotate, **bold**), dar în HTML text, cu TOT textul dezarmat.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inline(s: string): string {
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function mdToPrintHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(`<ul>${bullets.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      bullets = [];
    }
    if (numbered.length) {
      out.push(`<ol>${numbered.map((li) => `<li>${inline(li)}</li>`).join("")}</ol>`);
      numbered = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      flush();
      out.push(`<h2>${inline(line.replace(/^#{1,6}\s/, ""))}</h2>`);
    } else if (/^[-*]\s/.test(line)) {
      if (numbered.length) flush();
      bullets.push(line.replace(/^[-*]\s/, ""));
    } else if (/^\d{1,2}[.)]\s/.test(line)) {
      if (bullets.length) flush();
      numbered.push(line.replace(/^\d{1,2}[.)]\s/, ""));
    } else if (line.trim() === "") {
      flush();
    } else {
      flush();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flush();
  return out.join("\n");
}

/** Pagina completă de tipărit, cu antetul raportului. Se dă la
 *  window.open(...).document.write și pornește singură dialogul de
 *  tipărire (de unde omul alege „Salvează ca PDF"). */
export function paginaRaport(opts: {
  titlu: string;
  subtitlu: string;
  corpMd: string;
}): string {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8">
<title>${esc(opts.titlu)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #161412;
         max-width: 720px; margin: 24px auto; padding: 0 20px; line-height: 1.55; }
  .brand { display: flex; align-items: baseline; gap: 8px; border-bottom: 3px solid #161412;
           padding-bottom: 10px; margin-bottom: 4px; }
  .brand b { font-size: 20px; letter-spacing: 0.5px; }
  .brand b span { color: #ff4d00; }
  .sub { color: #666; font-size: 13px; margin: 6px 0 18px; }
  h1 { font-size: 22px; margin: 14px 0 2px; }
  h2 { font-size: 15px; margin: 18px 0 4px; border-left: 4px solid #ff4d00; padding-left: 8px; }
  p { margin: 6px 0; font-size: 14px; }
  ul, ol { margin: 6px 0; padding-left: 22px; font-size: 14px; }
  li { margin: 3px 0; }
  @media print { body { margin: 0 auto; } }
</style></head><body>
<div class="brand"><b>PRO<span>VENDI</span></b></div>
<h1>${esc(opts.titlu)}</h1>
<p class="sub">${esc(opts.subtitlu)}</p>
${mdToPrintHtml(opts.corpMd)}
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>
</body></html>`;
}
