# WME Quick PP Importer

Ein Tampermonkey-Userscript für Waze Map Editors, das **automatisch Adressen aus österreichischen Geodaten lädt** und diese mit Farbcodierung auf der Karte darstellt.

## Features

✨ **Adress-Integration**
- Lädt Adressen von der kbox.at API basierend auf Map-Extent
- Web Mercator (EPSG:3857) Koordinaten-Konvertierung
- Automatische Segmentauswahl erkennat Straße

🎨 **Intelligente Farbcodierung**
- 🟢 **Grün**: Neue Adressen (keine RPP vorhanden)
- 🟢 **Hellgrün**: Bestehende RPPs (House Numbers auf Segment)
- 🔘 **Grau**: Andere Straßen (zur besseren Orientierung)

🔍 **Straßen-Matching**
- Exakte Namen-Abgleichung mit normalisierten Straßencodes
- Fuzzy-Matching für ähnliche Straßennamen (Levenshtein-Distance)
- Automatische Normalisierung (Straße → Str, Gasse → G, etc.)

🗺️ **Kartendarstellung**
- WME SDK Layer-API mit GeoJSON-Features
- Hausnummer als Feature-Label
- Interaktive Marker mit Klick-Handler (vorbereitet)

⚙️ **Technische Besonderheiten**
- **Tampermonkey CSP-Bypass**: GM_xmlhttpRequest statt fetch
- **Modular**: Event-gesteuerte Architektur
- **TypeScript**: Vollständig type-safe mit WME SDK Typings
- **Rollup Build**: Optimierte Single-File `.user.js` für Tampermonkey

---

## Installation

### Für Benutzer

1. Tampermonkey Browser-Extension installieren
2. Zu [dieser Seite](about:blank) navigieren (später: Userscript-Host setzen)
3. Release-Datei `releases/release-1.0.0.user.js` installieren

### Für Entwickler

#### Mit DevContainer (empfohlen)
```bash
# VS Code: Dev Containers: Reopen in Container
npm run watch   # Automatische Neukompilierung
```

#### Manuell
```bash
npm install
npm run watch   # Oder: npm run build
```

---

## Verwendung

1. **WME öffnen** unter waze.com
2. **Quick PP Importer aktivieren** über die Sidebar (Tab "🏠 Quick PP")
3. **Straßen-Segment klicken** → Adressen werden automatisch geladen
4. **Farbcodierung nutzen**:
   - Grün: Neue Adressen hier einplanen
   - Hellgrün: RPP schon vorhanden, überprüften vorhandene

---

## Architektur

```
src/
├── main.user.ts           # Einstiegspunkt & SDK Orchestrierung
├── core/
│   ├── initialization.ts   # UI Sidebar & Keyboard Shortcutseach
│   └── state.ts            # Globaler State mit Event System
├── data/
│   └── api.ts              # kbox.at API Client (GM_xmlhttpRequest)
├── logic/
│   └── segment-selector.ts # Segment-Auswahl & Adress-Filterung
├── map/
│   └── renderer.ts         # WME SDK Layer-Rendering
└── utils/
    └── geo.ts              # Geo-Utilities (Distanzberechnung)
```

**Event-Flow:**
```
Segment-Auswahl
  ↓
Segment-Geometrie → Map-Extent
  ↓
WGS84 → Web Mercator
  ↓
kbox.at API POST /adr
  ↓
HouseNumber-Check per WME SDK
  ↓
Straßen-Matching & Fuzzy-Match
  ↓
Farbcodierung (grün/hellgrün/grau)
  ↓
WME SDK Layer rendern
```

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

## Keyboard Shortcuts

| Taste | Aktion |
|-------|--------|
| `P`   | Import Mode aktivieren/deaktivieren |
| `O`   | Pause (bei aktivem Import) |
| `Esc` | Alle Marker löschen |

---

## Debug-Commands

In der Browser-Console verfügbar via `testQuickPP.*`:

```javascript
// API testen
testQuickPP.testAPI()                // Echte kbox.at API
testQuickPP.testRender()             // Rendering mit Mock-Daten
testQuickPP.testAPIWithMock()        // API mit Mock-Fallback

// State & Debugging
testQuickPP.showState()              // Aktuellen State anzeigen
testQuickPP.countMarkers()           // Marker-Anzahl
testQuickPP.showSegments()           // Segment-Info

// Layer-Verwaltung
testQuickPP.updatePositions()        // Layer neu rendern
testQuickPP.loadAddresses()          // Adressen für Segmente laden
testQuickPP.clear()                  // Alle Marker löschen
```

---

## Konfiguration

siehe [src/core/state.ts](src/core/state.ts):

```typescript
private config: ScriptConfig = {
    apiBaseUrl: "https://wms.kbox.at",
    searchRadius: 0.5,              // km (Padding um Segmente)
    autoFillDistance: 50,            // Meter
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

- ⚠️ Adressen werden nur für Map-Extent geladen (nicht für einzelne Segmente)
- ⚠️ RPP-Creator noch nicht implementiert
- ⚠️ Nur Österreich (AT) unterstützt

---

## Roadmap

- [ ] RPP-Creator (Maus-Klick → Neue HouseNumber erstellen)
- [ ] Multi-Country Support (DE, CH, HU)
- [ ] Address-Duplicate Detection
- [ ] Batch-Import Mode
- [ ] Settings UI erweitern

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
// In Dateien
console.log(`🔍 Debug Info:`, data);
console.error(`❌ Error:`, error);

// Browser-Console
testQuickPP.showState()
testQuickPP.showSegments()
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

Siehe [LICENSE](LICENSE)

---

**Fragen?** Prüfe die Test-Commands oder öffne ein Issue! 🚀
