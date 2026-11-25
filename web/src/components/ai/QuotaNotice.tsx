import { UNAVAILABLE_TEXT, quotaText } from "./free";

/** Inline notice for an exhausted or unavailable free assistant. No retry: the only action is opening the provider picker. */
export function QuotaNotice({ resetAt, unavailable, onPick }: { resetAt?: string; unavailable?: boolean; onPick: () => void }) {
  return (
    <div role="alert" className="mt-2 rounded-xl border border-border bg-muted px-3 py-2 text-sm text-foreground">
      <p>{unavailable ? UNAVAILABLE_TEXT : quotaText(resetAt)}</p>
      <button type="button" onClick={onPick} className="mt-2 rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        Choose another provider
      </button>
    </div>
  );
}
