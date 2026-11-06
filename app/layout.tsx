import type { Metadata } from "next";
import "./globals.css";
import { loadOwner } from "@/lib/owner.mjs";

/** Every tab is "Page · Siryous CRM", so tabs and history entries can be told apart. */
export function generateMetadata(): Metadata {
  const owner = loadOwner();
  return {
    title: { default: owner.appName, template: `%s · ${owner.appName}` },
    // Generic: the sign-in page is served before sign-in, so it names nothing about the owner.
    description: "Relationship-centered business development CRM",
  };
}

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
