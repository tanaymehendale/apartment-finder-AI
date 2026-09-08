import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import "./globals.css";
import { AuthGate } from "@/components/AuthGate";

// Display face — warm, idiosyncratic grotesque used for headlines and section
// marks. Paired (not swapped for) Figtree for body/UI text: personality
// contrast between Bricolage's wonky ink-trap details and Figtree's quiet
// humanist forms, rather than two similar geometric sans faces.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ApartmentFinder AI",
  description: "Find your next home with AI — powered by Gemini 2.5 Flash",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`h-full ${display.variable} ${body.variable}`}>
      <body className="h-full">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
