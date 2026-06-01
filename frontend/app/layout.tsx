import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
