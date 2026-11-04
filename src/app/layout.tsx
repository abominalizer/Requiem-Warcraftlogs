import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Requiem Logs",
  description: "Requiem's raid log analysis: deaths, avoidable damage, interrupts and progression.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-line bg-panel/80">
          <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
            <Link prefetch={false} href="/" className="text-lg font-bold">
              <span className="text-accent">Requiem</span> Logs
            </Link>
            <nav className="flex gap-4 text-sm text-muted">
              <Link prefetch={false} href="/" className="hover:text-fg">Home</Link>
              <Link prefetch={false} href="/raid" className="hover:text-fg">
                Raid
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        {/* Wowhead spell tooltips on hover (links to wowhead.com/spell=… and <a data-wowhead="spell=…">) */}
        <Script id="wowhead-config" strategy="afterInteractive">
          {"window.whTooltips = { colorLinks: false, iconizeLinks: false, renameLinks: false };"}
        </Script>
        <Script src="https://wow.zamimg.com/js/tooltips.js" strategy="afterInteractive" />
        <footer className="mx-auto max-w-7xl px-4 py-8 text-xs text-muted">
          Data from the Warcraft Logs API. Not affiliated with Warcraft Logs or Blizzard Entertainment.
        </footer>
      </body>
    </html>
  );
}
