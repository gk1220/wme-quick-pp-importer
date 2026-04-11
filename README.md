# WME Quick PP Importer

Ein Tampermonkey-Userscript für Waze Map Editors, das **Residential Place Points (RPPs) aus österreichischen Adressdaten** importiert.

Adressen werden von der [kbox.at](https://wms.kbox.at) API geladen und als farbige Marker auf der Karte dargestellt. Ein Klick auf einen Marker erstellt automatisch einen RPP an der exakten Klickposition.

---

## Features

🗺️ **Adress-Marker auf der Karte**
- Lädt Adressen aus dem Bereich der aktuellen Kartenansicht
- Farbcodierung zeigt sofort welche Adressen noch fehlen:
  - 🟢 **Grün**: Adresse noch kein RPP vorhanden → anlegen
  - � **Hellgrün**: RPP bereits in WME vorhanden → überspringen
  - 🔘 **Grau**: Andere Straße (nur zur Orientierung)

🏠 **RPP-Erstellung per Klick (100% WME SDK)**
- Klick auf einen grünen Marker → RPP wird an der exakten Klickposition erstellt
- Straße wird automatisch über das nächste geladene Segment aufgelöst
- Unterstützt österreichische L- und B-Straßen (Alternativer Straßenname)
- Hausnummer wird direkt gesetzt; Adresseditor öffnet nur wenn Straße nicht aufgelöst werden kann
- Duplikat-Erkennung: bereits vorhandene House Numbers werden als hellgrün markiert

⌨️ **Tastenkürzel** (erscheinen in WME unter „Tastaturkürzel")
- **P** — Adressen laden und Import-Modus starten (Segment muss vorher selektiert sein)
- **P** (nochmals) — Import stoppen und Marker entfernen
- **Esc** — Import pausieren (Marker bleiben auf der Karte)
- **O** — Import fortsetzen nach Pause

🔍 **Straßen-Matching**
- Exakte Namen-Abgleichung mit normalisierten Straßencodes
- Fuzzy-Matching für ähnliche Straßennamen (Levenshtein-Distanz)
- Automatische Normalisierung (Straße → Str, Gasse → G, etc.)

💾 **Tile-basiertes Caching**
- Adressdaten werden in 750 m × 750 m Kacheln gecacht (7 Tage TTL, max. 300 Tiles, LRU)
- Reduziert API-Aufrufe deutlich

🐛 **Debug-Modus**
- Sidebar enthält einen Debug-Toggle für ausführlichere Console-Ausgaben

---

## Installation

### Produktiv (Release-Datei)

1. [Tampermonkey](https://www.tampermonkey.net/) installieren
2. Datei `releases/release-1.0.0.user.js` in Tampermonkey importieren

### Entwicklung (Hot-Reload)

```bash
npm install
npm run watch   # Kontinuierliche Neukompilierung
npm run build   # Einmaliger Build
```

Dann `header-dev.js` als Tampermonkey-Skript einrichten (Anweisungen in der Datei).

---

## Verwendung

1. **WME öffnen** unter waze.com
2. **Straßen-Segment selektieren**
3. **P drücken** → Adress-Marker erscheinen auf der Karte
4. **Auf grüne Marker klicken** → RPP wird erstellt
   - RPP erscheint an der Klickposition
   - Straße und Hausnummer werden automatisch gesetzt
   - Wenn die Straße nicht aufgelöst wird: Adresseditor öffnet sich automatisch
5. **Esc** zum Pausieren, **O** zum Fortsetzen, **P** zum Stoppen

**Sidebar-Tab „🏠 Quick PP"** zeigt den aktuellen Status und enthält einen Debug-Modus-Toggle.

---

## Tastenkürzel

| Taste | Aktion |
|-------|--------|
| `P`   | Import-Modus aktivieren / Marker entfernen und stoppen |
| `Esc` | Import pausieren (Marker bleiben) |
| `O`   | Import nach Pause fortsetzen |

---

## Console-Befehle (Browser DevTools)

```javascript
testQuickPP.testAPI()         // API-Aufruf für aktuelle Kartenansicht
testQuickPP.showState()       // Aktuellen Script-State ausgeben
testQuickPP.clearCache()      // Adress-Cache leeren
testQuickPP.loadAddresses()   // Adressen für selektierte Segmente laden
testQuickPP.countMarkers()    // Anzahl der Marker ausgeben
testQuickPP.updatePositions() // Layer neu zeichnen
```

---

## Architektur

```
src/
├── main.user.ts               # Einstiegspunkt & SDK-Initialisierung
├── core/
│   ├── initialization.ts      # Sidebar-UI & Tastenkürzel
│   └── state.ts               # Globaler State + Event-System + debug()
├── data/
│   └── api.ts                 # kbox.at API-Client + Tile-Cache (GM_xmlhttpRequest)
├── logic/
│   └── segment-selector.ts    # Segment-Auswahl & Adress-Filterung
├── map/
│   └── renderer.ts            # WME SDK Layer-Rendering & RPP-Erstellung
└── utils/
    └── geo.ts                 # Geo-Hilfsfunktionen
```

**Event-Flow:**
```
Segment-Auswahl
  ↓
Map-Extent ermitteln
  ↓
Tile-Cache Check (750m × 750m)
  ↓
kbox.at API POST /adr (falls Cache-Miss)
  ↓
HouseNumber-Check via WME SDK (Duplikat-Erkennung)
  ↓
Straßen-Matching & Fuzzy-Match → Farbcodierung
  ↓
WME SDK Layer rendern
  ↓
Klick auf Marker → RPP via SDK erstellen
```

**Build:** `rollup` kompiliert TypeScript → `.out/main.user.js` → konkateniert mit `header.js` → `releases/release-1.0.0.user.js`

---

## API-Integration

### kbox.at Endpoint

**Basis-URL:** `https://wms.kbox.at/adr`

**Methode:** `POST`

**Body:**
```json
{
  "x1": 1822706,  // Min Longitude (Web Mercator)
  "y1": 6141470,  // Min Latitude (Web Mercator)
  "x2": 1823282,  // Max Longitude (Web Mercator)
  "y2": 6141926   // Max Latitude (Web Mercator)
}
```

**Response:**
```json
[
  {
    "lon": 1822977.03,           // Web Mercator X
    "lat": 6141708.61,           // Web Mercator Y
    "hausnummerzahl1": "10",     // House Number
    "strassenname": "Bäckerstraße",
    "strassennr": 900334         // Internal street ID
  },
  // ... mehr Adressen
]
```

---

## Konfiguration

siehe [src/core/state.ts](src/core/state.ts) und [src/data/api.ts](src/data/api.ts):

```typescript
// API Konfiguration
private config: ScriptConfig = {
    apiBaseUrl: "https://wms.kbox.at",
    searchRadius: 0.5,              // km (Padding um Segmente)
    autoFillDistance: 50,            // Meter
};

// Cache Konfiguration
const TILE = {
    SIZE_M: 750,                    // Tile-Größe in Metern
    TTL_DAYS: 7,                    // Time-to-Live in Tagen
    MAX: 300,                       // Max. Anzahl Tiles (LRU)
    NS: 'WME_PP_TILE_',             // Storage Namespace
    META: 'WME_PP_META'             // Metadata Key
};
```

---

## Build-System

```bash
npm run compile      # TypeScript → JavaScript (Rollup)
npm run concat       # Header + Code → .user.js
npm run build        # compile + concat
npm run watch        # Automatisches Rebuild on save
```

**Output:** `releases/release-{version}.user.js`

---

## Abhängigkeiten

| Paket | Version | Zweck |
|-------|---------|-------|
| `wme-sdk-typings` | ^0.48.10 | WME SDK Type Definitions |
| `rollup` | ^4.0.0 | Bundler |
| `@rollup/plugin-typescript` | ^11.x | TypeScript Support |
| `typescript` | ^5.6.3 | Language |

---

## Bekannte Limitierungen

- ⚠️ Nur Österreich (AT) unterstützt (kbox.at API)

---

## Roadmap

- [ ] Multi-Country Support (DE, CH)
- [ ] Settings UI erweitern (z.B. konfigurierbarer Suchradius)

---

## Development

### Neuen Feature hinzufügen

1. **Neue Datei erstellen** in `src/{modul}/`
2. **In `main.user.ts` integrieren** oder via Event-System
3. **Build testen:** `npm run build`
4. **In Tampermonkey laden:** `file:///path/to/releases/release-*.user.js`
5. **Commiten:** `git add . && git commit -m "feat: ..."`

### Debugging

```typescript
// Debug-Ausgaben einschalten (Sidebar-Toggle oder via Console)
appState.setDebugMode(true);

// Browser-Console
testQuickPP.showState()
testQuickPP.testAPI()
```

---

## Troubleshooting

**Marker nicht sichtbar?**
- Prüfe: Sidebar visible (Tab "🏠 Quick PP")
- Prüfe: Import Mode aktiv (P-Taste)
- Prüfe: Segment ausgewählt

**API-Fehler 404?**
- Prüfe: Header.js `@connect wms.kbox.at` gesetzt
- Prüfe: `src/core/state.ts` apiBaseUrl korrekt
- Prüfe: POST Body mit Web-Mercator Koordinaten

**Console zeigt Fehler?**
- Browser F12 öffnen
- Prüfe: Callstack im Copilot-Chat teilen

---

## Lizenz

Dieses Skript steht unter der **GNU General Public License v3.0**. Siehe [LICENSE](LICENSE).

### Quellen / Attributions

Dieses Skript enthält Code, der von folgenden Projekten abgeleitet wurde:

- **WME Quick HN Importer** von Tom 'Glodenox' Puttemans — [GitHub](https://github.com/Glodenox/wme-quick-hn-importer) — GPL-2.0
- **WME Quick HN Importer AT Reloaded** von Ari Wazer (basierend auf Arbeit von Gerhard) — [Greasy Fork](https://greasyfork.org/en/scripts/551280-wme-quick-hn-importer-at-reloaded) — GPL-2.0
- **WME Place Interface Enhancements** von JustinS83 — [GitHub](https://github.com/WazeDev/WME-Place-Interface-Enhancements) — GPL-3.0

---

**Fragen?** Prüfe die Test-Commands oder öffne ein Issue! 🚀
