import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Nav } from "@/components/Nav";
import { AssistantProvider } from "@/components/ai/AssistantProvider";
import { ASSISTANT_INIT } from "@/components/ai/assistant-width";
import { isHosted } from "@/lib/mode";
import "./globals.css";

const description = "Ask anything about official statistics, with citations";
const site = process.env.STATMESH_SITE_URL;
export const metadata: Metadata = {
  ...(site ? { metadataBase: new URL(site) } : {}),
  title: { default: "statmesh", template: "%s · statmesh" },
  description,
  openGraph: { title: "statmesh", description, siteName: "statmesh", type: "website" },
  twitter: { card: "summary_large_image", title: "statmesh", description },
};

// Sets .dark/.light on <html> before first paint (saved choice, else system preference).
const THEME_INIT = `try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.add(d?"dark":"light")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT + ASSISTANT_INIT }} /></head>
      <body className="min-h-screen font-sans antialiased">
        <AssistantProvider hosted={isHosted()}>
          <Nav />
          <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">{children}</main>
        </AssistantProvider>
      </body>
    </html>
  );
}
