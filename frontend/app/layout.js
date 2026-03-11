import "./globals.css";
import SessionManager from "../components/SessionManager";
import ServiceWorkerReset from "../components/ServiceWorkerReset";

export const metadata = {
  title: "turn1carnage",
  description: "turn1carnage Formula 1 picks league",
  manifest: "/manifest.json"
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
