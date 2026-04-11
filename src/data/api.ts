import { appState, Address, debug } from "../core/state";

/**
 * kbox.at/adr API Client
 * Abfrage von österreichischen Adressdaten
 * Nach HN Importer (Reloaded) Muster - verwendet nur GM_xmlhttpRequest (kein fetch)
 * Mit Tile-Cache + FIFO-Queue
 */

// Declare GM_xmlhttpRequest (Tampermonkey API)
declare function GM_xmlhttpRequest(details: any): void;

// Declare Tampermonkey storage APIs
declare function GM_getValue(key: string, defaultValue?: any): any;
declare function GM_setValue(key: string, value: any): void;
declare function GM_deleteValue(key: string): void;
declare function GM_listValues(): string[];

export interface AddressDataRaw {
    sn: string; // Straßenname
    hn: string; // Hausnummer
    gn: string; // Gemeinde/Stadt
    lat: number;
    lon: number;
}

export interface AddressResponse {
    addresses: AddressDataRaw[];
}

// Tile cache configuration (wie HN Importer)
const TILE = {
    SIZE_M: 750,
    TTL_DAYS: 7,
    MAX: 300,
    NS: 'WME_PP_TILE_',
    META: 'WME_PP_META'
};

// Persisted storage helpers (TMs/GM)
const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
const GM_Get = (k: string, d?: any) => { try { return GM_getValue(k, d); } catch { return d; } };
const GM_Set = (k: string, v: any) => { try { GM_setValue(k, v); } catch {} };

// In-memory tile cache mirror
const memTiles = new Map<string, any>();

class AddressDataClient {
    private baseUrl = "https://wms.kbox.at";
    private apiPath = "/adr";
    private requestQueue: Promise<any> = Promise.resolve();

    // --- Tile helpers (wie HN Importer) ---
    private tileKeyForXY(x: number, y: number): string {
        return `${Math.floor(x / TILE.SIZE_M)}_${Math.floor(y / TILE.SIZE_M)}`;
    }

    private tilesForBounds(bounds: { left: number; bottom: number; right: number; top: number }): string[] {
        const x1 = Math.floor(bounds.left / TILE.SIZE_M);
        const y1 = Math.floor(bounds.bottom / TILE.SIZE_M);
        const x2 = Math.floor(bounds.right / TILE.SIZE_M);
        const y2 = Math.floor(bounds.top / TILE.SIZE_M);
        const keys: string[] = [];
        for (let ty = y1; ty <= y2; ty += 1) {
            for (let tx = x1; tx <= x2; tx += 1) {
                keys.push(`${tx}_${ty}`);
            }
        }
        return keys;
    }

    private bboxFromTiles(keys: string[]): { x1: number; y1: number; x2: number; y2: number } {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const k of keys) {
            const [txS, tyS] = k.split('_');
            const tx = +txS;
            const ty = +tyS;
            const left = tx * TILE.SIZE_M;
            const bottom = ty * TILE.SIZE_M;
            const right = left + TILE.SIZE_M;
            const top = bottom + TILE.SIZE_M;
            minX = Math.min(minX, left);
            minY = Math.min(minY, bottom);
            maxX = Math.max(maxX, right);
            maxY = Math.max(maxY, top);
        }
        return { x1: Math.floor(minX), y1: Math.floor(minY), x2: Math.ceil(maxX), y2: Math.ceil(maxY) };
    }

    private nowDays(): number {
        return Math.floor(Date.now() / 86400000);
    }

    private getTileFromStore(key: string): any {
        const m = memTiles.get(key);
        if (m) return m;
        if (!hasGM) return null;
        try {
            const raw = GM_getValue(TILE.NS + key, null);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            memTiles.set(key, obj);
            return obj;
        } catch {
            return null;
        }
    }

    private putTileToStore(key: string, obj: any): void {
        memTiles.set(key, obj);
        if (!hasGM) return;
        try {
            GM_setValue(TILE.NS + key, JSON.stringify(obj));
            const meta = this.loadMeta();
            this.touchLRU(meta, key);
            this.enforceLRU(meta);
            this.saveMeta(meta);
        } catch {}
    }

    private loadMeta(): any {
        if (!hasGM) return { order: [] };
        try {
            const m = GM_getValue(TILE.META, null);
            return m ? JSON.parse(m) : { order: [] };
        } catch {
            return { order: [] };
        }
    }

    private saveMeta(meta: any): void {
        if (!hasGM) return;
        try {
            GM_setValue(TILE.META, JSON.stringify(meta));
        } catch {}
    }

    private touchLRU(meta: any, key: string): void {
        meta.order = (meta.order || []).filter((k: string) => k !== key);
        meta.order.push(key);
    }

    private enforceLRU(meta: any): void {
        while ((meta.order || []).length > TILE.MAX) {
            const victim = meta.order.shift();
            try {
                GM_deleteValue(TILE.NS + victim);
            } catch {}
            memTiles.delete(victim);
        }
    }

    private isFresh(tileObj: any): boolean {
        return !!(tileObj && typeof tileObj.ts === 'number' && this.nowDays() - tileObj.ts <= TILE.TTL_DAYS);
    }

    // Cache leeren Funktion
    clearCache(): void {
        try {
            if (hasGM) {
                GM_listValues().forEach(k => {
                    if (String(k).startsWith(TILE.NS) || k === TILE.META) {
                        GM_deleteValue(k);
                    }
                });
            }
            memTiles.clear();
            debug('🗑️ PP Cache cleared');
        } catch (e) {
            console.error('❌ clearCache error', e);
        }
    }

    async fetchAddressesByBoundingBox(
        left: number,
        bottom: number,
        right: number,
        top: number
    ): Promise<Address[]> {
        try {
            debug(`📍 Fetching addresses: bbox=[${left},${bottom},${right},${top}]`);

            // Convert WGS84 bounds to Web Mercator first
            const webMercatorBounds = {
                left: this.lonToWebMercator(left),
                bottom: this.latToWebMercator(bottom),
                right: this.lonToWebMercator(right),
                top: this.latToWebMercator(top)
            };

            debug(`📍 Converted bbox to Web Mercator: [${webMercatorBounds.left},${webMercatorBounds.bottom},${webMercatorBounds.right},${webMercatorBounds.top}]`);

            const neededKeys = this.tilesForBounds(webMercatorBounds);

            // Try cache first
            let allFresh = true;
            let assembled: any[] = [];
            for (const key of neededKeys) {
                const tile = this.getTileFromStore(key);
                debug(`💾 Checking cache for tile ${key}:`, tile ? 'found' : 'not found');
                if (tile) {
                    debug(`💾 Tile ${key} fresh:`, this.isFresh(tile));
                }
                if (!this.isFresh(tile)) {
                    allFresh = false;
                    break;
                }
                if (tile?.items?.length) {
                    assembled = assembled.concat(tile.items);
                }
            }

            if (allFresh) {
                debug(`💾 Cache hit (${neededKeys.length} tile(s)) - skipping network`);
                return this.processRawAddresses(assembled);
            }

            debug(`🌐 Cache miss - fetching ${neededKeys.length} tile(s) from network`);
            const addresses = await this.fetchTilesFromNetwork(neededKeys);
            return addresses;
        } catch (error) {
            console.error("❌ Error fetching addresses:", error);
            return [];
        }
    }

    /**
     * Tiles von der API laden und cachen
     */
    private async fetchTilesFromNetwork(neededKeys: string[]): Promise<Address[]> {
        return new Promise((resolve, reject) => {
            const body = this.bboxFromTiles(neededKeys);
            debug(`🔗 Requesting tiles:`, body);

            GM_xmlhttpRequest({
                method: "POST",
                url: this.baseUrl + this.apiPath,
                data: JSON.stringify(body),
                headers: { "Content-Type": "application/json" },
                timeout: 10000,
                onload: (response: any) => {
                    try {
                        if (response.status >= 200 && response.status < 300) {
                            let result: any;
                            
                            try {
                                result = JSON.parse(response.responseText || '[]');
                            } catch (e) {
                                console.error('❌ JSON parse fail', e, response.responseText);
                                reject(new Error(`API JSON parse error: ${e}`));
                                return;
                            }

                            debug(`📦 Parsed response:`, result);
                            debug(`📦 Is array:`, Array.isArray(result));

                            if (!Array.isArray(result)) {
                                console.error(`❌ API Response is not an array:`, result);
                                reject(new Error(`API returned unexpected format: expected array of addresses`));
                                return;
                            }

                            // Bucket addresses by tile
                            const buckets = new Map<string, any[]>();
                            for (const r of result) {
                                const x = r.lon;
                                const y = r.lat;
                                const key = this.tileKeyForXY(x, y);
                                if (!buckets.has(key)) buckets.set(key, []);
                                buckets.get(key)!.push({
                                    lon: x,
                                    lat: y,
                                    strassenname: r.strassenname || r.sn || "",
                                    hausnummerzahl1: r.hausnummerzahl1 || r.hn || "",
                                    gemeinde: r.gemeinde || r.gn || ""
                                });
                            }

                            // Store tiles and assemble result
                            const today = this.nowDays();
                            let assembled: any[] = [];
                            for (const k of neededKeys) {
                                const items = buckets.get(k) || [];
                                this.putTileToStore(k, { ts: today, items });
                                assembled = assembled.concat(items);
                            }

                            debug(`✅ Loaded ${assembled.length} addresses from ${neededKeys.length} tiles`);
                            resolve(this.processRawAddresses(assembled));
                        } else {
                            console.error(`❌ API Error Status ${response.status}: ${response.responseText}`);
                            reject(new Error(`API Error: ${response.status} - ${response.statusText}`));
                        }
                    } catch (error) {
                        console.error(`❌ Parse error:`, error);
                        reject(error);
                    }
                },
                onerror: (error: any) => {
                    console.error(`❌ GM_xmlhttpRequest error:`, error);
                    const errorMsg = error && error.message ? error.message : String(error);
                    reject(new Error(`Network error: ${errorMsg}`));
                },
                ontimeout: () => {
                    console.error(`❌ Request timeout`);
                    reject(new Error("Request timeout"));
                }
            });
        });
    }

    /**
     * Raw API Daten zu Address-Objekten konvertieren
     */
    private processRawAddresses(rawAddresses: any[]): Address[] {
        return rawAddresses.map((raw: any, index: number) => {
            const [longitude, latitude] = this.webMercatorToLonLat(raw.lon, raw.lat);
            return {
                id: `addr-${Date.now()}-${index}`,
                latitude,
                longitude,
                streetName: raw.strassenname || raw.sn || "",
                houseNumber: raw.hausnummerzahl1 || raw.hn || "",
                city: raw.gemeinde || raw.gn || "",
                status: "gray" as const,
                markerId: undefined,
            };
        });
    }

    private lonToWebMercator(lon: number): number {
        return lon * 6378137 * (Math.PI / 180);
    }

    private latToWebMercator(lat: number): number {
        const rad = lat * (Math.PI / 180);
        return 6378137 * Math.log(Math.tan(Math.PI / 4 + rad / 2));
    }

    private webMercatorToLonLat(x: number, y: number): [number, number] {
        const lon = (x / 6378137) * (180 / Math.PI);
        const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
        return [lon, lat];
    }

    /**
     * Segmente um einen Punkt abrufen und deren Adressen laden
     * (wird später erweitert für WME-Integration)
     */
    async fetchAddressesBySegment(segmentIds: string[]): Promise<Address[]> {
        debug("🔄 Fetching by segment IDs:", segmentIds);
        return [];
    }
}

export const addressDataClient = new AddressDataClient();

export const clearAddressCache = () => addressDataClient.clearCache();
