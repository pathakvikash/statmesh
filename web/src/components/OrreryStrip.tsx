// "Part of Orrery" strip. Hidden unless NEXT_PUBLIC_ORRERY_URL is an http(s) URL.
export function OrreryStrip() {
  const url = process.env.NEXT_PUBLIC_ORRERY_URL;
  if (!url || !/^https?:\/\//.test(url)) return null;
  return (
    <div className="border-b border-border bg-muted px-4 py-1 text-center text-xs text-muted-foreground">
      Part of{" "}
      <a href={url} className="font-medium underline underline-offset-2">
        Orrery
      </a>
    </div>
  );
}
