import { WmeSDK } from "wme-sdk-typings";
import { appState, debug } from "./state";
import { segmentSelector } from "../logic/segment-selector";
import { mapRenderer } from "../map/renderer";

declare const GM_info: { script: { version: string } };

const LS_KEY = 'WME_PP_LAST_SEEN_VERSION';
const shortcutState = {
    toggleKey: 'P' as string | null,
    resumeKey: 'O' as string | null,
};

/** Changelog: neueste Version zuerst */
const UPDATE_NOTES: Record<string, string[]> = {
    '2026.04.14.00': [
        'Shortcut-Anzeige wird ohne Browser-Reload live aktualisiert',
        'Wenn Tasten belegt sind, werden Shortcuts auf "nicht gesetzt" registriert',
        'Nicht gesetzte Shortcuts bitte im WME-Shortcut-Menü zuweisen',
    ],
    '2026.04.13.00': [
        'Runde Marker statt quadratische für Adresspunkte',
        'Lock Level des neu angelegten RPPs wird auf den User-Level gesetzt (max. L4)',
    ],
    '2026.04.12.00': [
        'Update-Benachrichtigung im Sidebar-Tab (diese Meldung)',
        'Erstveröffentlichung auf Greasy Fork',
        'Automatische Updates über Greasy Fork',
        'Tile-basiertes Adress-Caching (750m, 7 Tage TTL)',
        'Duplikat-Erkennung für bereits vorhandene RPPs',
        'Fuzzy-Matching für Straßennamen (Levenshtein)',
    ],
};

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

        // 2. Update-Notification anzeigen (falls neue Version)
        showUpdateNotification();

        // 3. Map-Layer erstellen
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
        <div id="qpi-sidebar-root" style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
            <h3 style="margin: 0 0 10px 0; font-size: 16px;">Quick PP Importer</h3>
            
            <div style="margin-bottom: 8px;">
                <input type="checkbox" id="qpi-enable" style="cursor: pointer;">
                <label for="qpi-enable" style="cursor: pointer; margin-left: 5px;">Import Mode aktivieren</label>
            </div>
            
            <div style="background: #f0f0f0; padding: 8px; border-radius: 4px; font-size: 12px; line-height: 1.4;">
                <p style="margin: 0; font-weight: bold;">Anleitung:</p>
                <p style="margin: 5px 0 0 0;">1. Straße(n) selektieren</p>
                <p style="margin: 5px 0 0 0;" id="qpi-toggle-hint">2. <strong>${formatShortcutKey(shortcutState.toggleKey)}</strong> → Adressen laden + Import starten</p>
                <p style="margin: 5px 0 0 0;">3. Auf Marker klicken → RPP erstellen</p>
                <p style="margin: 5px 0 0 0;" id="qpi-shortcut-summary"><strong>Esc</strong> = Pausieren &nbsp;|&nbsp; <strong>${formatShortcutKey(shortcutState.resumeKey)}</strong> = Fortsetzen &nbsp;|&nbsp; <strong>${formatShortcutKey(shortcutState.toggleKey)}</strong> = Stoppen</p>
                <p style="margin: 5px 0 0 0; color: #666;" id="qpi-shortcut-config-hint"></p>
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
        if (statusEl) statusEl.textContent = `Status: ⏸️ Pausiert (${formatShortcutKey(shortcutState.resumeKey)} = Fortsetzen)`;
    });

    appState.on("importResumed", () => {
        const statusEl = tabPane.querySelector("#qpi-status");
        if (statusEl) statusEl.textContent = "Status: 🟢 Aktiv";
    });

    updateShortcutUi();
}

/**
 * Zeigt eine Update-Notification im Sidebar-Tab an,
 * wenn die aktuelle Version neu ist (noch nicht gesehen).
 */
function showUpdateNotification(): void {
    const currentVersion = GM_info.script.version;
    const lastSeen = localStorage.getItem(LS_KEY);
    if (lastSeen === currentVersion) return;

    const notes = UPDATE_NOTES[currentVersion];
    if (!notes || notes.length === 0) return;

    const tabPane = document.querySelector('#qpi-sidebar-root') as HTMLElement | null;
    if (!tabPane) return;

    const banner = document.createElement('div');
    banner.id = 'qpi-update-banner';
    banner.style.cssText = `
        background: #e8f4fd; border: 1px solid #90cdf4; border-radius: 6px;
        padding: 10px 12px; margin-bottom: 10px; font-size: 12px; position: relative;
    `;
    banner.innerHTML = `
        <button id="qpi-update-dismiss" style="
            position: absolute; top: 6px; right: 8px; background: none; border: none;
            font-size: 14px; cursor: pointer; color: #555; line-height: 1;
        " title="Schließen">✕</button>
        <div style="font-weight: bold; margin-bottom: 6px; color: #1a6fa3;">
            🎉 Neu in v${currentVersion}
        </div>
        <ul style="margin: 0; padding-left: 16px; color: #333;">
            ${notes.map(n => `<li style="margin-bottom: 3px;">${n}</li>`).join('')}
        </ul>
    `;

    tabPane.prepend(banner);

    document.getElementById('qpi-update-dismiss')?.addEventListener('click', () => {
        banner.remove();
        localStorage.setItem(LS_KEY, currentVersion);
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

function keyCodeToLabel(code: number): string {
    if (Number.isNaN(code)) return '';

    if (code >= 65 && code <= 90) return String.fromCharCode(code); // A-Z
    if (code >= 48 && code <= 57) return String.fromCharCode(code); // 0-9

    const special: Record<number, string> = {
        13: 'Enter',
        27: 'Esc',
        32: 'Space'
    };

    return special[code] ?? String(code);
}

function decodeCompactShortcut(shortcutKey: string): { modifiers: string[]; keyCode: number } | null {
    const match = shortcutKey.match(/^(\d+)[\.,](\d+)$/);
    if (!match) return null;

    const modifierMask = Number(match[1]);
    const keyCode = Number(match[2]);
    if (!Number.isFinite(modifierMask) || !Number.isFinite(keyCode)) return null;

    // Observed compact format in WME shortcut payloads: <modifierMask>.<keyCode>
    // Bitmask: 1=Alt, 2=Ctrl, 4=Shift
    const modifiers: string[] = [];
    if (modifierMask & 2) modifiers.push('Ctrl');
    if (modifierMask & 1) modifiers.push('Alt');
    if (modifierMask & 4) modifiers.push('Shift');

    return { modifiers, keyCode };
}

function formatShortcutKey(shortcutKey: string | null): string {
    if (shortcutKey === null) return 'nicht gesetzt';

    const compact = decodeCompactShortcut(shortcutKey);
    if (compact) {
        const keyLabel = keyCodeToLabel(compact.keyCode);
        return compact.modifiers.length ? `${compact.modifiers.join('+')}+${keyLabel}` : keyLabel;
    }

    const parts = shortcutKey.split('+').filter(Boolean);
    if (!parts.length) return shortcutKey;

    const keyPart = parts.pop() as string;
    const modifierPart = parts.join('');

    const modifierLabels: string[] = [];
    if (modifierPart.includes('C')) modifierLabels.push('Ctrl');
    if (modifierPart.includes('A')) modifierLabels.push('Alt');
    if (modifierPart.includes('S')) modifierLabels.push('Shift');

    const parsedCode = Number(keyPart);
    const keyLabel = Number.isFinite(parsedCode)
        ? keyCodeToLabel(parsedCode)
        : keyPart.toUpperCase();

    return modifierLabels.length ? `${modifierLabels.join('+')}+${keyLabel}` : keyLabel;
}

function updateShortcutUi(): void {
    const toggleHint = document.querySelector('#qpi-toggle-hint');
    if (toggleHint) {
        toggleHint.innerHTML = `2. <strong>${formatShortcutKey(shortcutState.toggleKey)}</strong> → Adressen laden + Import starten`;
    }

    const shortcutSummary = document.querySelector('#qpi-shortcut-summary');
    if (shortcutSummary) {
        shortcutSummary.innerHTML = `<strong>Esc</strong> = Pausieren &nbsp;|&nbsp; <strong>${formatShortcutKey(shortcutState.resumeKey)}</strong> = Fortsetzen &nbsp;|&nbsp; <strong>${formatShortcutKey(shortcutState.toggleKey)}</strong> = Stoppen`;
    }

    const shortcutConfigHint = document.querySelector('#qpi-shortcut-config-hint');
    if (!shortcutConfigHint) return;

    const missingKeys = [shortcutState.toggleKey, shortcutState.resumeKey].some(key => key === null);
    shortcutConfigHint.textContent = missingKeys
        ? 'Belegte Shortcuts wurden ohne Taste registriert und können im WME-Shortcut-Menü frei zugewiesen werden.'
        : 'Shortcuts können im WME-Shortcut-Menü angepasst werden.';

    const statusEl = document.querySelector('#qpi-status');
    if (statusEl && appState.getImportState().isPaused) {
        statusEl.textContent = `Status: ⏸️ Pausiert (${formatShortcutKey(shortcutState.resumeKey)} = Fortsetzen)`;
    }
}

function isTypingTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;

    const tagName = element.tagName?.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
    if (element.isContentEditable) return true;

    const role = (element.getAttribute?.('role') || '').toLowerCase();
    return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

async function toggleImportMode(): Promise<void> {
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

function resumeImportMode(wmeSDK: WmeSDK): void {
    const state = appState.getImportState();
    if (state.isActive && state.isPaused) {
        debug("▶️  Fortgesetzt");
        appState.togglePause();
        setMapCursor(wmeSDK, 'crosshair');
    }
}

function registerShortcut(
    wmeSDK: WmeSDK,
    shortcutId: string,
    shortcutKeys: string,
    description: string,
    callback: () => void | Promise<void>
): string | null {
    const assignedShortcutKey = wmeSDK.Shortcuts.areShortcutKeysInUse({ shortcutKeys }) ? null : shortcutKeys;

    try {
        wmeSDK.Shortcuts.createShortcut({
            shortcutId,
            description,
            shortcutKeys: assignedShortcutKey,
            callback
        });
        if (assignedShortcutKey === null) {
            console.warn(`⚠️  Shortcut ${shortcutKeys} bereits belegt — Eintrag ohne Taste registriert`);
        }
        return assignedShortcutKey;
    } catch (error) {
        if (assignedShortcutKey !== null) {
            console.warn(`⚠️  SDK-Shortcut ${shortcutKeys} konnte nicht registriert werden — versuche Eintrag ohne Taste`, error);
            wmeSDK.Shortcuts.createShortcut({
                shortcutId,
                description,
                shortcutKeys: null,
                callback
            });
            return null;
        }

        throw error;
    }
}

function syncShortcutStateFromSdk(wmeSDK: WmeSDK): void {
    const registeredShortcuts = wmeSDK.Shortcuts.getAllShortcuts();
    const toggleShortcut = registeredShortcuts.find(shortcut => shortcut.shortcutId === 'qpi-toggle');
    const resumeShortcut = registeredShortcuts.find(shortcut => shortcut.shortcutId === 'qpi-resume');

    const nextToggleKey = toggleShortcut?.shortcutKeys ?? null;
    const nextResumeKey = resumeShortcut?.shortcutKeys ?? null;

    if (shortcutState.toggleKey === nextToggleKey && shortcutState.resumeKey === nextResumeKey) {
        return;
    }

    shortcutState.toggleKey = nextToggleKey;
    shortcutState.resumeKey = nextResumeKey;
    updateShortcutUi();
}

function startShortcutStateSync(wmeSDK: WmeSDK): void {
    const sync = () => syncShortcutStateFromSdk(wmeSDK);

    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) sync();
    });
    window.setInterval(sync, 1000);
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
    shortcutState.toggleKey = registerShortcut(
        wmeSDK,
        'qpi-toggle',
        'P',
        'Import starten (Segment auswählen, dann P drücken) / Stoppen',
        () => toggleImportMode()
    );

    shortcutState.resumeKey = registerShortcut(
        wmeSDK,
        'qpi-resume',
        'O',
        'Import fortsetzen (nach Pause)',
        () => resumeImportMode(wmeSDK)
    );

    updateShortcutUi();
    startShortcutStateSync(wmeSDK);

    // Cursor-Management über State-Events
    appState.on('importActivated', () => setMapCursor(wmeSDK, 'crosshair'));
    appState.on('importDeactivated', () => setMapCursor(wmeSDK, ''));
    appState.on('importPaused', () => setMapCursor(wmeSDK, ''));
    appState.on('importResumed', () => setMapCursor(wmeSDK, 'crosshair'));

    // Escape kann nicht als SDK-Shortcut registriert werden — separater keydown-Listener
    // Esc = pausieren (nicht stoppen), damit O wieder fortsetzen kann
    document.addEventListener('keydown', (e) => {
        if (isTypingTarget(e.target)) return;
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
