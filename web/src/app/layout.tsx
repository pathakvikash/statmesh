import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Nav } from "@/components/Nav";
import { AssistantProvider } from "@/components/ai/AssistantProvider";
import { isHosted } from "@/lib/mode";
import "./globals.css";

export const metadata: Metadata = { title: "statmesh", description: "Ask anything about official statistics, with citations" };

// Sets .dark/.light on <html> before first paint (saved choice, else system preference).
const THEME_INIT = `try{var t=localStorage.getItem("theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.add(d?"dark":"light")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body className="min-h-screen font-sans antialiased">
        <AssistantProvider hosted={isHosted()}>
          <Nav />
          <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">{children}</main>
        </AssistantProvider>
      </body>
    </html>
  );
}
