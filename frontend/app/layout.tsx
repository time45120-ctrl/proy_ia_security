import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "proy_ia_security Dashboard",
  description: "Dashboard domotico con nucleo de IA por voz para el laboratorio IoT.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
