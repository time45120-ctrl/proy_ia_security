import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFCRseguridad | Seguridad empresarial con IA",
  description:
    "Sistema integral B2B de seguridad con mini PC, inteligencia artificial, dispositivos IoT y soporte anual.",
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
