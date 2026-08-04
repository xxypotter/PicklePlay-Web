import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import BottomNav from "@/components/BottomNav";
import { canManageSessions } from "@/lib/auth/policy";
import { getCurrentPlayer } from "@/lib/auth/session";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PicklePlay",
  description: "Organize pickleball sessions and track ratings.",
  applicationName: "PicklePlay",
  appleWebApp: { capable: true, title: "PicklePlay", statusBarStyle: "default" },
};

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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        {/* Logged out, the bottom bar has nothing to navigate to. */}
        {me ? <BottomNav canCreate={canManageSessions(me.role)} /> : null}
      </body>
    </html>
  );
}
