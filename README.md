# Schach

Ein Schachspiel für zwei Personen mit Online-Partien über Netlify. Das Brett und
die Schachregeln laufen im Browser; Netlify Functions prüfen die Züge und
Netlify Blobs speichern die Partie, damit beide Spieler denselben Stand sehen.

## Spielen

- Auf der Startseite kannst du zwischen einer Partie gegen den Bot und einer
  Online-Partie mit einem Freund wählen.
- Klicke oder tippe eine eigene Figur und anschließend auf ein markiertes Zielfeld.
- Klicke auch eine gegnerische Figur an, um ihre möglichen Züge zu sehen. Diese
  Vorschau erlaubt nicht, außerhalb des eigenen Zuges einen Zug auszuführen.
- Enthält legale Züge, Schach, Schachmatt, Patt, Rochade, en passant und Bauernumwandlung.
- **Partie erstellen** erzeugt einen Einladungscode. Dein Freund kann den Code
  eingeben oder den kopierten Link öffnen. Beim Erstellen kannst du Bedenkzeit,
  unbegrenzte Zeit und deine Farbe (und damit, wer mit Weiß beginnt) festlegen.
- Mit **Zug automatisch abschließen** wird ein Zug sofort übertragen. Ist die
  Option aus, kannst du den Zug erst prüfen und anschließend **Zug absenden**.
- In einer Bot-Partie kannst du deinen letzten Zug zurücknehmen. Online kannst
  du eine Rücknahme anfragen, die dein Mitspieler annehmen oder ablehnen kann.
- Züge werden alle 1,5 Sekunden synchronisiert. Spielstände werden auf Netlify
  gespeichert; Konten oder externe Schlüssel sind nicht erforderlich.
- Eine Online-Partie unterstützt genau zwei Spieler. **Lokal spielen** trennt
  die eigene Ansicht von der Partie; der Spielstand des Freundes bleibt erhalten.
- Außerhalb von Netlify kannst du die Seite lokal öffnen, um am selben Gerät zu
  spielen. Die Online-Funktionen brauchen Netlify Functions und Blobs.

## Auf Netlify veröffentlichen

1. Lade das Projekt in ein GitHub-Repository und importiere es in Netlify.
2. Netlify verwendet `netlify.toml`: Der Build-Befehl ist `npm run build`, das
   Veröffentlichungsverzeichnis ist `dist`. Netlify installiert die Pakete aus
   `package.json` automatisch.
3. Nach dem Deploy kannst du eine Partie erstellen und den Link oder Code teilen.

Die Online-Partien werden über die Netlify-Installation gespeichert. Ein
statischer Datei-Upload ohne Netlify-Functions-Unterstützung reicht dafür nicht.
