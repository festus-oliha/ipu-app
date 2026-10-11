import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Footer } from "@/components/Footer";
import "./globals.css";

// Fonts are bundled from npm (@fontsource) so builds never depend on reaching Google.
const marcellus = localFont({
  src: "../../node_modules/@fontsource/marcellus/files/marcellus-latin-400-normal.woff2",
  weight: "400",
  variable: "--font-marcellus",
  display: "swap",
});
const publicSans = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-italic.woff2", style: "italic" },
  ],
  weight: "100 900",
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "IPU", template: "%s · IPU" },
  description: "Iyobor Progressive Union — contributions, loans and statements.",
  applicationName: "IPU",
};

export const viewport: Viewport = {
  themeColor: "#1e4d3a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${marcellus.variable} ${publicSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Footer />
      </body>
    </html>
  );
}
