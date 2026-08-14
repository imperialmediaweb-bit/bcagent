"use client";

import { useEffect } from "react";

/**
 * Perechea paznicului de pornire din layout: când React chiar a pornit,
 * ridică steagul — scriptul inline din HTML vede steagul și stă cuminte.
 * Tot aici se șterge marcajul de „am reîncărcat o dată", ca la următorul
 * deploy paznicul să poată reîncărca din nou automat.
 */
export default function BootFlag() {
  useEffect(() => {
    (window as unknown as { __provendiBooted?: boolean }).__provendiBooted = true;
    try {
      sessionStorage.removeItem("boot-reload");
    } catch {
      /* sessionStorage blocat — nu contează */
    }
  }, []);
  return null;
}
