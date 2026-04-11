import { WmeSDK } from "wme-sdk-typings";
import { appState, debug } from "./state";
import { segmentSelector } from "../logic/segment-selector";
import { mapRenderer } from "../map/renderer";

/**
 * Initialisierung des WME SDK und Setup der UI
 */

export async function initializeScript(wmeSDK: WmeSDK): Promise<void> {
    console.log(`✅ WME Quick PP Importer: SDK v.${wmeSDK.getSDKVersion()} initialized`);

    // State mit SDK initialisieren
    appState.setWmeSDK(wmeSDK);

    try {
        // 1. Sidebar-Tab erstellen
        await setupSidebarTab(wmeSDK);

        // 2. Map-Layer erstellen
        setupMapLayer(wmeSDK);

        // 3. Segment-Selector initialisieren
        segmentSelector.setWmeSDK(wmeSDK);

        // 4. Event-Listener setup
        setupEventListeners(wmeSDK);

        console.log("🚀 Quick PP Importer fully initialized");
    } catch (error) {
        console.error("❌ Initialization failed:", error);
        throw error;
    }
}

/**
 * Sidebar Tab für Script UI
 */
async function setupSidebarTab(wmeSDK: WmeSDK): Promise<void> {
    const { tabLabel, tabPane } = await wmeSDK.Sidebar.registerScriptTab();
    
    tabLabel.innerText = "🏠 Quick PP";
    
    tabPane.innerHTML = `
        <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <h3 style="margin: 0 0 10px 0; font-size: 16px;">Quick PP Importer</h3>
            
            <div style="margin-bottom: 8px;">
                <input type="checkbox" id="qpi-enable" style="cursor: pointer;">
                <label for="qpi-enable" style="cursor: pointer; margin-left: 5px;">Import Mode aktivieren</label>
            </div>
            
            <div style="background: #f0f0f0; padding: 8px; border-radius: 4px; font-size: 12px; line-height: 1.4;">
                <p style="margin: 0; font-weight: bold;">Anleitung:</p>
                <p style="margin: 5px 0 0 0;">1. Straße(n) selektieren</p>
                <p style="margin: 5px 0 0 0;">2. <strong>P</strong> → Adressen laden + Import starten</p>
                <p style="margin: 5px 0 0 0;">3. Auf Marker klicken → RPP erstellen</p>
                <p style="margin: 5px 0 0 0;"><strong>Esc</strong> = Pausieren &nbsp;|&nbsp; <strong>O</strong> = Fortsetzen &nbsp;|&nbsp; <strong>P</strong> = Stoppen</p>
            </div>
            
            <div style="margin-top: 10px; font-size: 11px; color: #666;">
                <p style="margin: 0;" id="qpi-status">Status: Bereit</p>
                <p style="margin: 5px 0 0 0;" id="qpi-address-count">Adressen geladen: 0</p>
            </div>

            <div style="margin-top: 10px; border-top: 1px solid #ddd; padding-top: 8px;">
                <input type="checkbox" id="qpi-debug" style="cursor: pointer;">
                <label for="qpi-debug" style="cursor: pointer; margin-left: 5px; font-size: 11px; color: #888;">Debug-Ausgaben in Console</label>
            </div>
        </div>
    `;

    // Event-Listeners für UI
    const enableCheckbox = tabPane.querySelector("#qpi-enable") as HTMLInputElement;
    if (enableCheckbox) {
        enableCheckbox.addEventListener("change", (e) => {
            const checked = (e.target as HTMLInputElement).checked;
            if (checked) {
                appState.activateImport();
            } else {
                appState.deactivateImport();
            }
        });
    }

    // Debug-Checkbox
    const debugCheckbox = tabPane.querySelector("#qpi-debug") as HTMLInputElement;
    if (debugCheckbox) {
        debugCheckbox.addEventListener("change", (e) => {
            appState.setDebugMode((e.target as HTMLInputElement).checked);
        });
    }

    // State-Listener update UI
    appState.on("addressesLoaded", (addresses: any[]) => {
        const countEl = tabPane.querySelector("#qpi-address-count");
        if (countEl) {
            countEl.textContent = `Adressen geladen: ${addresses.length}`;
        }
    });

    appState.on("importActivated", () => {
        const statusEl = tabPane.querySelector("#qpi-status");
        if (statusEl) statusEl.textContent = "Status: 🟢 Aktiv";
        const cb = tabPane.querySelector("#qpi-enable") as HTMLInputElement | null;
        if (cb) cb.checked = true;
    });

    appState.on("importDeactivated", () => {
        const statusEl = tabPane.querySelector("#qpi-status");
        if (statusEl) statusEl.textContent = "Status: Bereit";
        const cb = tabPane.querySelector("#qpi-enable") as HTMLInputElement | null;
        if (cb) cb.checked = false;
    });

    appState.on("importPaused", () => {
        const statusEl = tabPane.querySelector("#qpi-status");
        if (statusEl) statusEl.textContent = "Status: ⏸️ Pausiert (O = Fortsetzen)";
    });

    appState.on("importResumed", () => {
        const statusEl = tabPane.querySelector("#qpi-status");
        if (statusEl) statusEl.textContent = "Status: 🟢 Aktiv";
    });
}

/**
 * Map-Layer für Adresspunkte
 * Wird jetzt im mapRenderer selbst erstellt
 */
function setupMapLayer(wmeSDK: WmeSDK): void {
    // Layer wird jetzt im mapRenderer.setWmeSDK() erstellt
    console.log("✅ Map layer setup delegated to mapRenderer");
}

/**
 * Cursor des Karten-Viewports setzen.
 * Crosshair im Import-Modus, Standard sonst.
 */
function setMapCursor(wmeSDK: WmeSDK, cursor: 'crosshair' | ''): void {
    try {
        const viewport = wmeSDK.Map.getMapViewportElement();
        viewport.style.cursor = cursor;
    } catch (e) {
        // Fallback: direkter querySelector
        const viewport = document.querySelector('.olMapViewport') as HTMLElement | null;
        if (viewport) viewport.style.cursor = cursor;
    }
}

/**
 * Keyboard-Shortcuts im WME-Menü registrieren und Cursor-Management.
 * Workflow wie im alten Skript:
 *   1. Segment(e) auswählen
 *   2. P drücken → Adressen laden + Import-Modus AN + Cursor → Crosshair
 *   3. Klick auf Marker → RPP erstellen
 *   4. P oder Esc → Stoppen + Cursor → Standard
 *   5. O → Fortsetzen nach Pause
 */
function setupEventListeners(wmeSDK: WmeSDK): void {
    // --- SDK Shortcuts (erscheinen in den WME-Tastaturkürzeln unter "Quick PP Importer") ---

    // P = Import starten / stoppen
    wmeSDK.Shortcuts.createShortcut({
        shortcutId: 'qpi-toggle',
        description: 'Import starten (Segment auswählen, dann P drücken) / Stoppen',
        shortcutKeys: 'P',
        callback: async () => {
            const state = appState.getImportState();
            if (state.isActive) {
                debug("⏹️  Import Mode: OFF");
                appState.deactivateImport();
                return;
            }
            if (!segmentSelector.hasSelectedSegments()) {
                console.warn("⚠️  P gedrückt aber kein Segment ausgewählt — bitte zuerst Straße(n) selektieren");
                return;
            }
            debug("▶️  Import Mode: ON — Lade Adressen...");
            appState.activateImport();
            await segmentSelector.loadAddressesForSelectedSegments();
        }
    });

    // O = Fortsetzen nach Pause
    wmeSDK.Shortcuts.createShortcut({
        shortcutId: 'qpi-resume',
        description: 'Import fortsetzen (nach Pause)',
        shortcutKeys: wmeSDK.Shortcuts.areShortcutKeysInUse({ shortcutKeys: 'O' }) ? null : 'O',
        callback: () => {
            const state = appState.getImportState();
            if (state.isActive && state.isPaused) {
                debug("▶️  Fortgesetzt");
                appState.togglePause();
                setMapCursor(wmeSDK, 'crosshair');
            }
        }
    });

    // Cursor-Management über State-Events
    appState.on('importActivated', () => setMapCursor(wmeSDK, 'crosshair'));
    appState.on('importDeactivated', () => setMapCursor(wmeSDK, ''));
    appState.on('importPaused', () => setMapCursor(wmeSDK, ''));
    appState.on('importResumed', () => setMapCursor(wmeSDK, 'crosshair'));

    // Escape kann nicht als SDK-Shortcut registriert werden — separater keydown-Listener
    // Esc = pausieren (nicht stoppen), damit O wieder fortsetzen kann
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const state = appState.getImportState();
        if (!state.isActive) return;
        if (state.isPaused) return; // bereits pausiert
        debug("⏸️  Import Mode: PAUSIERT (Esc) — O zum Fortsetzen");
        appState.togglePause();
    });

    console.log("✅ SDK Shortcuts registered");
}

/**
 * Export für main.user.ts
 */
export { appState };
