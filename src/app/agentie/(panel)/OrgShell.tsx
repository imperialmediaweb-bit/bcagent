"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import ReportIssue from "@/app/ReportIssue";
import {
  Building2,
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
  { href: "/agentie/clienti", label: "Clienți", icon: Building2 },
  { href: "/agentie/solduri", label: "Solduri", icon: Wallet },
  { href: "/agentie/decont", label: "Decont", icon: Receipt },
  { href: "/agentie/echipa", label: "Echipa", icon: Users },
  { href: "/agentie/setari", label: "Setări", icon: Settings },
];

export default function OrgShell({
  name,
  role,
  children,
}: {
  name: string;
  role: string;
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
                ? "bg-emerald-500/15 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold text-white">Agenția mea</span>
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
          <div className="mb-6 flex items-center gap-2 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                Agenția mea
              </p>
              <p className="text-xs text-slate-400">
                {role === "owner" ? "Patron" : "Manager"}
              </p>
            </div>
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

      <main className="px-4 py-6 sm:px-6 lg:ml-60 lg:px-8">{children}</main>
      <ReportIssue />
    </div>
  );
}
