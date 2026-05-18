import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "BC Agent — Sales Analytics",
  description: "Rapoarte de vânzări și eficiență pentru agenți",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ro">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
