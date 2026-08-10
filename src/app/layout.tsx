import type { Metadata } from "next";
import { Manrope, Noto_Sans_Devanagari, Yeseva_One } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const yesevaOne = Yeseva_One({
  variable: "--font-yeseva",
  subsets: ["latin"],
  weight: "400",
});

// Kitchen board only (EN/हिं toggle) — item names/variants render in this
// when Hindi is selected; nothing else in the app needs Devanagari glyphs.
const notoSansDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Golden City Restaurant",
  description: "Golden City Restaurant — table ordering, order entry, and kitchen board.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${yesevaOne.variable} ${notoSansDevanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
