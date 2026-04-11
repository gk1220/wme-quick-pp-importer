import { WmeSDK } from "wme-sdk-typings";

/**
 * Globaler State der Anwendung
 * Zentraler Speicher für alle Scriptstatus
 */

export interface ImportState {
    isActive: boolean; // Import-Modus aktiv?
    isPaused: boolean; // Im Pause-Modus?
    selectedSegmentIds: string[];
    loadedAddresses: Address[];
    selectedAddresses: Map<string, Address>; // addressId -> Address
}

export interface Address {
    id: string;
    latitude: number;
    longitude: number;
    streetName: string;
    houseNumber: string;
    city: string;
    status: 'green' | 'lightGreen' | 'gray'; // grün, blassgrün, grau
    markerId?: string; // Marker-ID auf der Karte
}

export interface ScriptConfig {
    apiBaseUrl: string;
    searchRadius: number; // Radius in km
    autoFillDistance: number; // Auto-Fill Distanz in Metern
}

class AppState {
    private wmeSDK: WmeSDK | null = null;
    private importState: ImportState = {
        isActive: false,
        isPaused: false,
        selectedSegmentIds: [],
        loadedAddresses: [],
        selectedAddresses: new Map(),
    };
    private config: ScriptConfig = {
        apiBaseUrl: "https://wms.kbox.at",
        searchRadius: 0.5,
        autoFillDistance: 50,
    };

    // Event-Listener Registry
    private listeners: Map<string, Set<Function>> = new Map();

    /**
     * Initiale Setup mit WME SDK
     */
    setWmeSDK(sdk: WmeSDK) {
        this.wmeSDK = sdk;
    }

    getWmeSDK(): WmeSDK {
        if (!this.wmeSDK) {
            throw new Error("WME SDK not initialized");
        }
        return this.wmeSDK;
    }

    /**
     * Import-State Management
     */
    activateImport(): void {
        this.importState.isActive = true;
        this.emit("importActivated");
    }

    deactivateImport(): void {
        this.importState.isActive = false;
        this.importState.isPaused = false;
        this.emit("importDeactivated");
        this.clearAddresses();
    }

    togglePause(): void {
        this.importState.isPaused = !this.importState.isPaused;
        this.emit(this.importState.isPaused ? "importPaused" : "importResumed");
    }

    // --- Debug Mode ---
    private _debugMode = false;

    get debugMode(): boolean { return this._debugMode; }

    setDebugMode(val: boolean): void {
        this._debugMode = val;
        console.log(`🔧 Debug Mode: ${val ? 'AN' : 'AUS'}`);
    }

    getImportState(): Readonly<ImportState> {
        return { ...this.importState };
    }

    /**
     * Segment Management
     */
    setSelectedSegments(segmentIds: string[]): void {
        this.importState.selectedSegmentIds = segmentIds;
        this.emit("segmentsSelected", segmentIds);
    }

    getSelectedSegments(): string[] {
        return [...this.importState.selectedSegmentIds];
    }

    /**
     * Address Management
     */
    setAddresses(addresses: Address[]): void {
        this.importState.loadedAddresses = addresses;
        this.emit("addressesLoaded", addresses);
    }

    getAddresses(): Address[] {
        return [...this.importState.loadedAddresses];
    }

    getAddressById(id: string): Address | undefined {
        return this.importState.loadedAddresses.find(a => a.id === id);
    }

    markAddressProcessed(id: string): void {
        const address = this.importState.loadedAddresses.find(a => a.id === id);
        if (address) {
            address.status = 'lightGreen';
            this.emit("addressUpdated", address);
        }
    }

    clearAddresses(): void {
        this.importState.loadedAddresses = [];
        this.importState.selectedAddresses.clear();
        this.emit("addressesCleared");
    }

    selectAddress(address: Address): void {
        this.importState.selectedAddresses.set(address.id, address);
        this.emit("addressSelected", address);
    }

    removeSelectedAddress(addressId: string): void {
        this.importState.selectedAddresses.delete(addressId);
        this.emit("addressDeselected", addressId);
    }

    getSelectedAddresses(): Address[] {
        return Array.from(this.importState.selectedAddresses.values());
    }

    /**
     * Configuration
     */
    getConfig(): Readonly<ScriptConfig> {
        return { ...this.config };
    }

    updateConfig(partial: Partial<ScriptConfig>): void {
        this.config = { ...this.config, ...partial };
        this.emit("configUpdated", this.config);
    }

    /**
     * Event System
     */
    on(event: string, listener: Function): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);

        // Unsubscribe Funktion zurückgeben
        return () => {
            this.listeners.get(event)?.delete(listener);
        };
    }

    private emit(event: string, ...args: any[]): void {
        const eventListeners = this.listeners.get(event);
        if (eventListeners) {
            eventListeners.forEach(listener => listener(...args));
        }
    }

    /**
     * Debug-Ausgabe
     */
    logState(): void {
        console.group("🔍 Quick PP Importer State");
        console.log("Import Active:", this.importState.isActive);
        console.log("Paused:", this.importState.isPaused);
        console.log("Selected Segments:", this.importState.selectedSegmentIds.length);
        console.log("Loaded Addresses:", this.importState.loadedAddresses.length);
        console.log("Selected Addresses:", this.importState.selectedAddresses.size);
        console.log("Config:", this.config);
        console.groupEnd();
    }
}

// Singleton
export const appState = new AppState();

/**
 * Debug-Logging Hilfsfunktion — gibt nur aus wenn Debug-Modus aktiv.
 */
export function debug(...args: any[]): void {
    if (appState.debugMode) console.log(...args);
}
