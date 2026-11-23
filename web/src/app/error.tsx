"use client";
import { StateShell } from "@/components/StateShell";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StateShell title="Something went wrong">
      <p className="text-muted-foreground">This page failed to load. Trying again often works; if it keeps failing, please report the reference below.</p>
      <button type="button" onClick={reset} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground">Try again</button>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
    </StateShell>
  );
}
