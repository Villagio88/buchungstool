import { test, before } from "node:test";
import assert from "node:assert/strict";

// Die Konfiguration liest die Umgebung beim Laden, deshalb erst setzen, dann laden.
Object.assign(process.env, {
  BEREICHE: "beratung,privat,impressum,Gross",
  BEREICH_BERATUNG_MAIL: "a@example.com",
  BEREICH_BERATUNG_ALIAS: "erstgespraech,absagen",
  BEREICH_BERATUNG_SCHRIFT: "Montserrat",
  BEREICH_BERATUNG_SCHRIFTDATEI: "/marke/montserrat.woff2",
  BEREICH_PRIVAT_MAIL: "p@example.com",
  BEREICH_PRIVAT_SCHRIFT: 'X"}body{display:none',
  BEREICH_PRIVAT_SCHRIFTDATEI: "https://fremd.example/font.woff2",
  BEREICH_PRIVAT_AKZENT: "red;background:url(x)",
  BEREICH_IMPRESSUM_MAIL: "i@example.com",
  BEREICH_GROSS_MAIL: "g@example.com",
  FUSSZEILE: "Eigene Fusszeile",
});

let config: typeof import("./config");
before(async () => {
  config = await import("./config");
});

test("reservierte und ungültige Schlüssel werden nicht angeboten", () => {
  assert.deepEqual(config.BEREICHE.map((b) => b.key), ["beratung", "privat"]);
});

test("ein Bereich ist auch über seinen Alias erreichbar, reservierte Alias nicht", () => {
  assert.equal(config.bereichAus("erstgespraech")?.key, "beratung");
  assert.equal(config.bereichAus("absagen"), null);
});

test("Schrift und Fusszeile kommen aus der Umgebung", () => {
  const m = config.marke("beratung");
  assert.equal(m.schrift, "Montserrat");
  assert.equal(m.schriftDatei, "/marke/montserrat.woff2");
  assert.equal(m.fusszeile, "Eigene Fusszeile");
});

test("eingeschleustes CSS und fremde Adressen werden verworfen", () => {
  const m = config.marke("privat");
  assert.equal(m.schrift, null);
  assert.equal(m.schriftDatei, null);
  assert.equal(m.akzent, "#3b82f6");
});
