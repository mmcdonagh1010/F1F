import "./globals.css";

export const metadata = {
  title: "Fantasy F1 League",
  description: "Private Formula 1 picks league",
  manifest: "/manifest.json"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
