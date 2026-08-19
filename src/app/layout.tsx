import Telemetry from "./Telemetry";
import BootFlag from "./BootFlag";
import AutoUpdate from "./AutoUpdate";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Syne, Space_Grotesk } from "next/font/google";

// Tipografie cu identitate: Syne (display, unic) + Space Grotesk (corp).
const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
});
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Provendi — Sales Analytics",
  description: "Rapoarte de vânzări și eficiență pentru agenți",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "Provendi",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#6366f1",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro" className={`${syne.variable} ${grotesk.variable}`}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {/* PAZNICUL DE PORNIRE: script inline (ajunge mereu, e în HTML) —
            dacă în 9s aplicația n-a pornit (JS nedescărcat: semnal slab
            sau deploy nou cu chunk-uri schimbate), reîncarcă singur o
            dată; dacă nici așa, buton mare „Reîncarcă". Fără el, pagina
            rămânea ALBĂ și mută. BootFlag ridică steagul la pornire. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{setTimeout(function(){try{
if(window.__provendiBooted)return;
if(!sessionStorage.getItem("boot-reload")){sessionStorage.setItem("boot-reload","1");location.reload();return;}
var d=document.createElement("div");
d.setAttribute("style","position:fixed;inset:0;background:#f5efe4;display:flex;align-items:center;justify-content:center;z-index:2147483647;font-family:system-ui,sans-serif;padding:20px");
d.innerHTML='<div style="max-width:420px;background:#fff;border:3px solid #161412;box-shadow:6px 6px 0 #161412;padding:24px;text-align:center"><div style="font-size:40px">📵</div><h1 style="font-size:18px;margin:10px 0 6px;color:#161412">Nu s-a încărcat</h1><p style="font-size:14px;color:#161412;opacity:.7;margin:0">Semnal slab sau versiune nouă. Apasă și își revine.</p><button onclick="sessionStorage.removeItem(\\'boot-reload\\');location.reload()" style="margin-top:16px;padding:12px 22px;font-size:15px;font-weight:700;background:#ff4d00;color:#fff;border:2px solid #161412;cursor:pointer">🔄 Reîncarcă</button></div>';
document.body.appendChild(d);
}catch(e){}},9000);}catch(e){}})();`,
          }}
        />
        <BootFlag />
        <AutoUpdate />
        <Telemetry />
        {children}
      </body>
    </html>
  );
}
