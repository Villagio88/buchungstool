#!/bin/sh
# Startet als root, nur um das Datenverzeichnis dem Benutzer node zu übergeben,
# und gibt die Rechte danach ab. Nötig für Volumes aus älteren Fassungen, die
# als root liefen: dort gehört die Datenbank root, und node könnte nicht
# schreiben. Läuft der Container bereits als node (etwa mit --user), entfällt
# der Schritt.
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  chown -R node:node /data
  exec setpriv --reuid=node --regid=node --init-groups node server.js
fi
exec node server.js
