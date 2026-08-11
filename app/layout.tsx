import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);

  return {
    title: "Иван & Алина — семейный центр",
    description:
      "Спокойный семейный центр для финансов, целей, планов и заметок.",
    metadataBase,
    icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
    openGraph: {
      title: "Иван & Алина — семейный центр",
      description: "Финансы и важные семейные планы в одном месте.",
      type: "website",
      images: [
        {
          url: new URL("/og.png", metadataBase).toString(),
          width: 1731,
          height: 909,
          alt: "Иван & Алина — семейный центр",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Иван & Алина — семейный центр",
      description: "Финансы и важные семейные планы в одном месте.",
      images: [new URL("/og.png", metadataBase).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
