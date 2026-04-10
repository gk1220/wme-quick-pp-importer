import { WmeSDK } from "wme-sdk-typings";
import { appState } from "./state";
import { segmentSelector } from "../logic/segment-selector";

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
            
            <div style="margin-bottom: 12px;">
                <input type="checkbox" id="qpi-enable" style="cursor: pointer;">
                <label for="qpi-enable" style="cursor: pointer; margin-left: 5px;">Enable Import Mode</label>
            </div>
            
            <div style="background: #f0f0f0; padding: 8px; border-radius: 4px; font-size: 12px; line-height: 1.4;">
                <p style="margin: 0; font-weight: bold;">Anleitung:</p>
                <p style="margin: 5px 0 0 0;">1. Straße(n) selektieren</p>
                <p style="margin: 5px 0 0 0;">2. <strong>P</strong> drücken → Adressen laden</p>
                <p style="margin: 5px 0 0 0;">3. Klick → RPP erstellen</p>
                <p style="margin: 5px 0 0 0;"><strong>O</strong> = Fortsetzen | <strong>Esc</strong> = Pause</p>
            </div>
            
            <div style="margin-top: 10px; font-size: 11px; color: #666;">
                <p style="margin: 0;" id="qpi-status">Status: Bereit</p>
                <p style="margin: 5px 0 0 0;" id="qpi-address-count">Adressen geladen: 0</p>
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
    });

    appState.on("importDeactivated", () => {
        const statusEl = tabPane.querySelector("#qpi-status");
        if (statusEl) statusEl.textContent = "Status: Bereit";
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
 * Globale Event-Listener (Keyboard, Map Events)
 */
function setupEventListeners(wmeSDK: WmeSDK): void {
    document.addEventListener("keydown", (e) => {
        const state = appState.getImportState();

        // P = Import aktivieren/deaktivieren
        if (e.key.toLowerCase() === "p" && !state.isPaused) {
            e.preventDefault();
            if (!state.isActive) {
                console.log("▶️  Import Mode: ON");
                appState.activateImport();
            } else {
                console.log("⏹️  Import Mode: OFF");
                appState.deactivateImport();
            }
        }

        // O = Pause aufheben
        if (e.key.toLowerCase() === "o" && state.isActive) {
            e.preventDefault();
            console.log("▶️  Continuing...");
            appState.togglePause();
        }

        // Escape = Pause
        if (e.key === "Escape" && state.isActive && !state.isPaused) {
            e.preventDefault();
            console.log("⏸️  Paused");
            appState.togglePause();
        }
    });

    console.log("✅ Event listeners registered");
}

/**
 * Export für main.user.ts
 */
export { appState };
