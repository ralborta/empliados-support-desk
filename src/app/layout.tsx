import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Soporte",
  description: "Plataforma de soporte por WhatsApp y tickets",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-slate-100 text-slate-900 antialiased min-h-screen`}
      >
        {process.env.WARA_V2_LAB_MODE === "true" ? (
          <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950">
            V2 LAB — Mesa operativa aislada. Sin WhatsApp productivo ni tickets de agentes reales.
          </div>
        ) : null}
        {children}
      </body>
    </html>
  );
}
