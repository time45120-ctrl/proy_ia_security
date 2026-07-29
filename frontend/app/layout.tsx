import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://afcrtecnologia.com",
  ),
  title: "AFCR Tecnología | Domótica residencial con IA",
  description:
    "Sistema de domótica residencial con mini PC, inteligencia artificial, tecnología, dispositivos IoT y soporte continuo.",
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
