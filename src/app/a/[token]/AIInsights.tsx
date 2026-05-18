"use client";

import { useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

function safeMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "strong", "em", "code", "pre", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "a", "hr",
      "table", "thead", "tbody", "tr", "th", "td",
    ],
    ALLOWED_ATTR: ["href"],
    ALLOW_DATA_ATTR: false,
  });
}
import {
  Bot,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";

marked.setOptions({ breaks: true, gfm: true });

interface AISummary {
  metric: "value" | "volume";
  period: string;
  totals: {
    volume: number;
    value: number;
    clients: number;
    transactions: number;
    returns: number;
  };
  dateRange?: { min: string; max: string };
  byAgent: Array<{
    key: string;
    volume: number;
    value: number;
    clients: number;
    transactions: number;
  }>;
  byProducer: Array<{
    key: string;
    volume: number;
    value: number;
    clients: number;
    transactions: number;
  }>;
  byClient: Array<{
    key: string;
    volume: number;
    value: number;
    clients: number;
    transactions: number;
  }>;
  evolution: Array<{ period: string; value: number; volume: number; clients: number }>;
  agentProducerMatrix: {
    rows: string[];
    cols: string[];
    matrix: number[][];
  };
  anomalies: {
    total: number;
    byType: Record<string, number>;
    examples: Array<{
      type: string;
      agent: string;
      producer: string;
      volume: number;
      note: string;
    }>;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_QUESTIONS = [
  "Cine e cel mai slab agent și pe ce brand?",
  "Ce branduri ar trebui să împinge mai mult fiecare agent?",
  "Sunt clienți care reprezintă un risc de dependență?",
  "Care e cea mai mare oportunitate de creștere?",
];

export default function AIInsights({
  token,
  summary,
  enabled,
}: {
  token: string;
  summary: AISummary;
  enabled: boolean;
}) {
  const [insights, setInsights] = useState("");
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function generateInsights() {
    if (insightsLoading) return;
    setInsightsLoading(true);
    setInsights("");
    setInsightsError(null);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, summary }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        let errMsg = `Eroare ${res.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error) errMsg = parsed.error;
        } catch {
          if (errText) errMsg = errText.slice(0, 200);
        }
        setInsightsError(errMsg);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setInsights(acc);
      }
    } catch (e) {
      setInsightsError(e instanceof Error ? e.message : String(e));
    } finally {
      setInsightsLoading(false);
    }
  }

  async function sendChat(rawText?: string) {
    const text = (rawText ?? chatInput).trim();
    if (!text || chatLoading) return;
    setChatError(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMsgs: ChatMessage[] = [
      ...chatMessages,
      userMsg,
      { role: "assistant", content: "" },
    ];
    setChatMessages(nextMsgs);
    setChatInput("");
    setChatLoading(true);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          token,
          summary,
          messages: [...chatMessages, userMsg],
        }),
      });
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        let errMsg = `Eroare ${res.status}`;
        try {
          const parsed = JSON.parse(errText);
          if (parsed?.error) errMsg = parsed.error;
        } catch {
          if (errText) errMsg = errText.slice(0, 200);
        }
        setChatError(errMsg);
        setChatMessages((m) => m.slice(0, -1));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setChatMessages((m) => {
          const copy = m.slice();
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setChatError(e instanceof Error ? e.message : String(e));
    } finally {
      setChatLoading(false);
    }
  }

  function clearChat() {
    abortRef.current?.abort();
    setChatMessages([]);
    setChatError(null);
  }

  const insightsHtml = useMemo(() => {
    if (!insights) return "";
    return safeMarkdown(insights);
  }, [insights]);

  if (!enabled) {
    return (
      <div className="card flex items-start gap-3 p-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          <Bot className="h-5 w-5 text-slate-400" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-700">AI Insights</h3>
          <p className="mt-1 text-sm text-slate-500">
            Setezi <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">ANTHROPIC_API_KEY</code> în variabilele de mediu pentru a activa
            analiza automată și chat-ul AI.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="card flex flex-col p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">
                Analiză automată
              </h3>
              <p className="text-xs text-slate-500">
                Privire generală, observații și recomandări AI
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={generateInsights}
            disabled={insightsLoading}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {insightsLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {insights ? "Regenerează" : "Generează"}
          </button>
        </div>

        <div className="mt-4 flex-1">
          {insightsError && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {insightsError}
            </p>
          )}
          {!insights && !insightsLoading && !insightsError && (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 px-4 py-8 text-center">
              <Sparkles className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">
                Apasă <strong>Generează</strong> pentru o analiză AI personalizată a datelor curente.
              </p>
            </div>
          )}
          {insights && (
            <div
              className="prose-ai mt-1 text-sm text-slate-700"
              dangerouslySetInnerHTML={{ __html: insightsHtml }}
            />
          )}
          {insightsLoading && !insights && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              AI procesează datele...
            </div>
          )}
        </div>
      </div>

      <div className="card flex flex-col p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Întreabă AI</h3>
              <p className="text-xs text-slate-500">
                Conversație despre datele tale curente
              </p>
            </div>
          </div>
          {chatMessages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              <RefreshCcw className="h-3 w-3" />
              Resetează
            </button>
          )}
        </div>

        <div className="mt-4 flex max-h-96 min-h-[200px] flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {chatMessages.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-slate-500">Întrebări sugerate:</p>
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendChat(q)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50/40"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          {chatMessages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-800"
                }`}
              >
                {m.role === "assistant" && m.content === "" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : m.role === "assistant" ? (
                  <div
                    className="prose-ai"
                    dangerouslySetInnerHTML={{
                      __html: safeMarkdown(m.content),
                    }}
                  />
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}
          {chatError && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {chatError}
            </p>
          )}
        </div>

        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Întreabă orice despre date..."
            disabled={chatLoading}
            className="flex-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={chatLoading || !chatInput.trim()}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {chatLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
