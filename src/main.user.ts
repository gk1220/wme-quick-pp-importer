import { WmeSDK } from "wme-sdk-typings";
import { initializeScript, appState } from "./core/initialization";
import { addressDataClient, clearAddressCache } from "./data/api";
import { mapRenderer } from "./map/renderer";
import { segmentSelector } from "./logic/segment-selector";

// Tampermonkey GM_xmlhttpRequest Deklaration
declare function GM_xmlhttpRequest(details: any): void;

/**
 * WME Quick PP Importer - Einstiegspunkt
 *
 * Das Skript wird ausgeführt, sobald das SDK bereit ist.
 * Alle Module werden hier orchestriert.
 */

// SDK Initialization - Verwende unsafeWindow wie HN Importer
const initSDK = async (): Promise<WmeSDK> => {
    console.log("⏳ Waiting for WME SDK to initialize...");

    try {
        // Verwende unsafeWindow wie im HN Importer AT Reloaded
        const unsafeWindow = (window as any).unsafeWindow || window;

        if (unsafeWindow.SDK_INITIALIZED) {
            console.log("⏳ SDK_INITIALIZED promise found, waiting...");
            await unsafeWindow.SDK_INITIALIZED;
            console.log("✅ SDK_INITIALIZED promise resolved");
        } else {
            console.log("⚠️  SDK_INITIALIZED not found in unsafeWindow");
            throw new Error("SDK_INITIALIZED not available");
        }

        // Prüfe ob getWmeSdk verfügbar ist
        if (!unsafeWindow.getWmeSdk) {
            console.log("⚠️  getWmeSdk not available in unsafeWindow");
            throw new Error("getWmeSdk not available");
        }

        console.log("🚀 Creating WME SDK instance...");
        // SDK-Instanz erstellen
        const wmeSDK: WmeSDK = unsafeWindow.getWmeSdk({
            scriptId: "wme-quick-pp-importer",
            scriptName: "WME Quick PP Importer"
        });
        console.log("✅ WME SDK instance created");

        // SDK-Instanz zurückgeben für weitere Initialisierung
        return wmeSDK;
    } catch (error) {
        console.error("❌ SDK initialization failed:", error);
        throw error;
    }
};

// SDK Initialization
initSDK().then(async (wmeSDK: WmeSDK) => {
    try {
        // Module mit SDK initialisieren
        mapRenderer.setWmeSDK(wmeSDK);

        // Skript initialisieren
        await initializeScript(wmeSDK);

        // State-Listener für Demo/Testing
        appState.on("addressesLoaded", (addresses: any[]) => {
            console.log(`📍 ${addresses.length} addresses loaded:`, addresses);
        });

        appState.on("importActivated", () => {
            console.log("▶️  Import Mode: ACTIVE");
            appState.logState();
        });

        appState.on("importDeactivated", () => {
            console.log("⏹️  Import Mode: DEACTIVATED");
            mapRenderer.clearMarkers();
        });

        appState.on("segmentsSelected", (segments: any[]) => {
            console.log("📌 Segments selected:", segments.length);
        });

        // --- DEMO: Test die Funktionalität ---
        // Entferne dies später oder wrap in Development Condition

        const pageWindow = (window as any).unsafeWindow || window;
        pageWindow.testQuickPP = {
            // Test API (real kbox.at call)
            testAPI: async () => {
                console.log("🧪 Testing API (real kbox.at call)...");
                try {
                    const mapExtent = wmeSDK.Map.getMapExtent();
                    const [left, bottom, right, top] = mapExtent;
                    console.log(`📍 Using map extent: [${mapExtent}]`);
                    const addresses = await addressDataClient.fetchAddressesByBoundingBox(
                        left, bottom, right, top
                    );
                    console.log("✅ API Test Result:", addresses);
                    return addresses;
                } catch (error) {
                    console.error("❌ API Test failed:", error);
                    throw error;
                }
            },

            showState: () => appState.logState(),

            clearCache: () => {
                clearAddressCache();
                console.log("🗑️ Address cache cleared");
            },

            updatePositions: () => {
                mapRenderer.redrawLayer();
                console.log("🔄 Layer redrawn");
            },

            countMarkers: () => {
                const count = appState.getAddresses().length;
                console.log(`📊 Current markers: ${count}`);
                return count;
            },

            loadAddresses: async () => {
                console.log("🔍 Loading addresses for selected segments...");
                await segmentSelector.loadAddressesManually();
                console.log("✅ Address loading triggered");
            },
        };

        console.log("💡 Debug Commands: testQuickPP.testAPI() | .showState() | .clearCache() | .updatePositions() | .countMarkers() | .loadAddresses()");

    } catch (error) {
        console.error("❌ Script initialization failed:", error);
    }
}).catch((error) => {
    console.error("❌ Script initialization promise rejected:", error);
    console.error("Stack:", error instanceof Error ? error.stack : "no stack");
});