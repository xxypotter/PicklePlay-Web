import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import BottomNav from "@/components/BottomNav";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale, getT } from "@/lib/i18n/server";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const me = await getCurrentPlayer();
  const t = await getT(me?.locale);

  /*
   * Open Graph URLs have to be absolute, and the deployment doesn't know its
   * own hostname at build time — preview builds, the vercel.app domain and a
   * custom domain are all the same code. Taking it from the request means a
   * link shared from wherever the reader was actually browsing resolves.
   */
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");

  return {
    metadataBase: new URL(`${proto}://${host}`),
    title: t("app.name"),
    description: t("app.description"),
    applicationName: t("app.name"),
    appleWebApp: { capable: true, title: t("app.name"), statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Full-bleed on notched phones, and follows the OS light/dark setting.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await getCurrentPlayer();
  // The account's choice is the fallback; the cookie, if set, wins inside.
  const locale = await getLocale(me?.locale);

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {/* Client components read the language from here rather than by prop. */}
        <LocaleProvider locale={locale}>
          {children}
          {/* Logged out, the bottom bar has nothing to navigate to. */}
          {me ? <BottomNav canCreate={canManageSessions(me.role)} /> : null}
        </LocaleProvider>
      </body>
    </html>
  );
}
