"use client";

import React from "react";

/**
 * Afișare frumoasă pentru TEXTELE AI din panoul firmei (briefing, vocea
 * clientului, evaluarea agentului): markdown minimal → JSX, fără librărie
 * și fără HTML injectat. Suportă exact ce scot modelele noastre:
 * titluri (##), liste cu buline (-/*), liste numerotate (1. / 1)),
 * **bold** și paragrafe.
 */
export default function AiMarkdown({ text }: { text: string }) {
  return <>{renderAiMarkdown(text)}</>;
}

export function renderAiMarkdown(md: string): React.ReactNode {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];
  const flush = (key: number) => {
    if (bullets.length) {
      out.push(
        <ul key={`ul${key}`} className="my-1.5 list-disc space-y-0.5 pl-5">
          {bullets.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
    if (numbered.length) {
      out.push(
        <ol key={`ol${key}`} className="my-1.5 list-decimal space-y-0.5 pl-5">
          {numbered.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ol>,
      );
      numbered = [];
    }
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^#{1,6}\s/.test(line)) {
      flush(i);
      out.push(
        <p key={i} className="mt-3 text-sm font-bold text-slate-900">
          {line.replace(/^#{1,6}\s/, "")}
        </p>,
      );
    } else if (/^[-*]\s/.test(line)) {
      if (numbered.length) flush(i);
      bullets.push(line.replace(/^[-*]\s/, ""));
    } else if (/^\d{1,2}[.)]\s/.test(line)) {
      if (bullets.length) flush(i);
      numbered.push(line.replace(/^\d{1,2}[.)]\s/, ""));
    } else if (line.trim() === "") {
      flush(i);
    } else {
      flush(i);
      out.push(
        <p key={i} className="my-1">
          {inline(line)}
        </p>,
      );
    }
  });
  flush(lines.length);
  return out;
}

function inline(s: string): React.ReactNode {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold text-slate-900">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}
