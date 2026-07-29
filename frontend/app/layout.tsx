import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://afcrtecnologia.com",
  ),
  title: "AFCR Tecnología | Domótica residencial con IA",
  description:
    "Sistema de domótica residencial con mini PC, inteligencia artificial, tecnología, dispositivos IoT y soporte continuo.",
  applicationName: "AFCR Tecnología",
  referrer: "strict-origin-when-cross-origin",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  robots: {
    index: true,
    follow: true,
  },
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
