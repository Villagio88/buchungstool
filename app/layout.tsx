import type { Metadata } from "next";
import { KONFIG } from "@/lib/config";
import "./globals.css";

/**
 * Als Funktion statt als feste Angabe: der Titel kommt aus der Umgebung, die
 * erst beim Start des Containers feststeht, nicht schon beim Build.
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: KONFIG.titel,
    description: "Freie Zeiten sehen und direkt einen Termin vereinbaren.",
    robots: { index: false, follow: false },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100">
        {children}
      </body>
    </html>
  );
}
