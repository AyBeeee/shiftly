import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Shiftly — Timetable to Google Calendar",
  description: "Photograph your weekly work timetable, review your shifts, and add them to Google Calendar.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Shiftly — Snap it. Shift it.",
    description: "Turn a paper work timetable into clean calendar events in under a minute.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Shiftly turns a photographed timetable into calendar events" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
