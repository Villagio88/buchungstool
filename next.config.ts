import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Schlankes Laufzeit-Image: nur server.js plus die wirklich benutzten Module.
  output: "standalone",

  /** Verrät sonst die eingesetzte Technik, ohne Nutzen. */
  poweredByHeader: false,

  /**
   * Kopfzeilen zur Absicherung. Die Seite steht offen im Netz und nimmt
   * Personendaten entgegen; das Wenige, was ohne Aufwand geht, gehört gesetzt.
   *
   * Die Regeln für Inhalte sind eng gefasst: die Seite lädt nichts von fremden
   * Hosts.
   */
  async headers() {
    return [
      {
        source: "/:pfad*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js braucht inline-Skripte für die Auslieferung des Zustands.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },

  /**
   * Kurze Adressen zum Verschicken.
   *
   * /beratung zeigt dieselbe Seite wie /?fuer=beratung, nur lesbar. Das gilt für
   * jeden Bereich aus BEREICHE; unbekannte Namen zeigen die normale Auswahl.
   * Ein Rewrite und keine Weiterleitung: die Adresszeile behält den kurzen Pfad,
   * bis der Gast den ersten Tag anklickt. Eigene Seiten wie /impressum gehen vor,
   * weil Rewrites dieser Art erst nach den vorhandenen Routen greifen.
   */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [{ source: "/:fuer([a-z0-9-]+)", destination: "/?fuer=:fuer" }],
    };
  },
};

export default nextConfig;
