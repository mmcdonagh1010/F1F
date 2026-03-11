import "./globals.css";
import SessionManager from "../components/SessionManager";
import ServiceWorkerReset from "../components/ServiceWorkerReset";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  process.env.FRONTEND_URL_PROD ||
  process.env.FRONTEND_URL ||
  "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: "turn1carnage",
  description: "turn1carnage Formula 1 picks league",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64x64.png", sizes: "64x64", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" }
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
    ],
    shortcut: ["/favicon-32x32.png"]
  },
  openGraph: {
    title: "turn1carnage",
    description: "turn1carnage Formula 1 picks league",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "turn1carnage social preview"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "turn1carnage",
    description: "turn1carnage Formula 1 picks league",
    images: ["/og-image.png"]
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerReset />
        <SessionManager />
        <main>{children}</main>
      </body>
    </html>
  );
}
