import type { Metadata } from "next";
import "./globals.css";
import { loadOwner } from "@/lib/owner.mjs";

const owner = loadOwner();

export const metadata: Metadata = {
  title: owner.appName,
  description: `Relationship-centered business development for ${owner.configured ? owner.practiceName : "your practice"}`,
};

/**
 * Minimal root: html/body/global styles only. The navigation chrome lives in
 * app/(app)/layout.tsx; the sign-in page (app/(bare)) renders without it.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
