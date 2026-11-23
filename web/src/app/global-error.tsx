"use client";
import { useEffect, useRef } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => h.current?.focus(), []);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", colorScheme: "light dark" }}>
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "64px 16px" }}>
          <h1 ref={h} tabIndex={-1} style={{ fontSize: 24, outline: "none" }}>Something went wrong</h1>
          <p style={{ opacity: 0.75 }}>statmesh hit an unexpected error. Trying again often works.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 16px", fontSize: 14, fontWeight: 600, border: 0, borderRadius: 8, background: "#4F46E5", color: "#fff" }}>Try again</button>
          {error.digest && <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, opacity: 0.75 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
