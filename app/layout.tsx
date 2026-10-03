import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NarcoHistoria | Research compendium",
  description: "An independent, source-backed archive of Mexican organized-crime history, people, organizations, and relationships.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
