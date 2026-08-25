"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import ReportIssue from "@/app/ReportIssue";
import Logo from "@/app/Logo";
import {
  Bug,
  Building2,
  Map,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
  Wallet,
  Settings,
  UserRound,
  X,
} from "lucide-react";

const NAV = [
  { href: "/agentie", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agentie/raport", label: "Raportul săpt.", icon: FileText },
  { href: "/agentie/vanzari", label: "Vânzări", icon: TrendingUp },
  { href: "/agentie/comenzi", label: "Comenzi", icon: ShoppingCart },
  { href: "/agentie/targete", label: "Targeturi", icon: Target },
  { href: "/agentie/agenti", label: "Agenți", icon: UserRound },
  { href: "/agentie/vizite", label: "Vizite", icon: ClipboardList },
  { href: "/agentie/harta", label: "Harta firmei", icon: Map },
  { href: "/agentie/clienti", label: "Clienți", icon: Building2 },
  { href: "/agentie/solduri", label: "Solduri", icon: Wallet },
  { href: "/agentie/decont", label: "Decont", icon: Receipt },
  { href: "/agentie/probleme", label: "Probleme", icon: Bug },
  { href: "/agentie/echipa", label: "Echipa", icon: Users },
  { href: "/agentie/setari", label: "Setări", icon: Settings },
];

export default function OrgShell({
  name,
  role,
  trialDaysLeft = null,
  children,
}: {
  name: string;
  role: string;
  trialDaysLeft?: number | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    return href === "/agentie" ? pathname === "/agentie" : pathname.startsWith(href);
  }

  async function logout() {
    await fetch("/api/agentie/logout", { method: "POST" });
    router.replace("/agentie/login");
    router.refresh();
  }

  const nav = (
    <nav className="space-y-1">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? "bg-[#ff4d00] text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
      <a
        href="/ghid"
        target="_blank"
        rel="noopener"
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
      >
        <span className="w-4 text-center">❓</span>
        Ghidul platformei
      </a>
    </nav>
  );

  return (
    <div className="paperbg min-h-screen">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Logo iconSize={26} textClassName="text-sm" variant="dark" />
          <span className="rounded-full bg-[#ffd23f] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#161412]">beta</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg p-2 text-slate-300 hover:bg-white/10"
          aria-label="Meniu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 top-[57px] z-30 bg-slate-900 p-4 lg:hidden">
          {nav}
          <button
            type="button"
            onClick={logout}
            className="mt-4 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5"
          >
            <LogOut className="h-4 w-4" /> Ieși din cont
          </button>
        </div>
      )}

      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col justify-between bg-slate-900 p-4 lg:flex">
        <div>
          <div className="mb-6 px-1">
            <Logo iconSize={30} textClassName="text-base" variant="dark" />
            <p className="mt-1 px-0.5 text-xs text-slate-400">
              {role === "owner" ? "Panou administrator" : "Panou manager"}
            </p>
          </div>
          {nav}
        </div>
        <div className="border-t border-white/10 pt-3">
          <p className="truncate px-3 text-xs text-slate-400" title={name}>
            {name}
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Ieși din cont
          </button>
        </div>
      </aside>

      <main className="px-4 py-6 sm:px-6 lg:ml-60 lg:px-8">
        {trialDaysLeft !== null &&
          (trialDaysLeft > 0 ? (
            <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-800">
              🎁 Perioadă de probă — mai ai{" "}
              <strong>
                {trialDaysLeft} {trialDaysLeft === 1 ? "zi" : "zile"}
              </strong>{" "}
              cu tot inclus. Ai nevoie de mai mult timp? Scrie-ne din butonul 💬.
            </p>
          ) : (
            // Proba s-a terminat, dar NU tăiem accesul (platformă la început):
            // îi lăsăm să lucreze mai departe și le cerem frumos un feedback.
            <div className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
              <p className="font-semibold">
                🙌 Perioada de probă s-a încheiat — dar poți lucra în
                continuare, nu-ți oprim nimic.
              </p>
              <p className="mt-1 text-indigo-800">
                Suntem la început și feedbackul tău contează enorm: ce ți-a
                plăcut, ce lipsește, ce te-a enervat? Ne spui în două rânduri
                din butonul <strong>💬 Sugestii / erori</strong> din colț.
                Mulțumim că testezi Provendi!
              </p>
            </div>
          ))}
        {children}
      </main>
      <ReportIssue />
    </div>
  );
}
