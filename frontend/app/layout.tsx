import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFCRseguridad | Domótica residencial con IA",
  description:
    "Sistema de domótica residencial con mini PC, inteligencia artificial, seguridad, dispositivos IoT y soporte continuo.",
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
