import { appState, Address } from "../core/state";

/**
 * kbox.at/adr API Client
 * Abfrage von österreichischen Adressdaten
 * Nach HN Importer (Reloaded) Muster - verwendet nur GM_xmlhttpRequest (kein fetch)
 */

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

// Declare GM_xmlhttpRequest (Tampermonkey API)
declare function GM_xmlhttpRequest(details: any): void;

class AddressDataClient {
    private baseUrl = "https://wms.kbox.at";
    private apiPath = "/adr";
    private requestQueue: Promise<any> = Promise.resolve();

    /**
     * Adressen basierend auf Bounding Box abrufen
     * @param left Min Längengrad (x1)
     * @param bottom Min Breitengrad (y1)
     * @param right Max Längengrad (x2)
     * @param top Max Breitengrad (y2)
     */
    async fetchAddressesByBoundingBox(
        left: number,
        bottom: number,
        right: number,
        top: number
    ): Promise<Address[]> {
        try {
            console.log(`📍 Fetching addresses: bbox=[${left},${bottom},${right},${top}]`);

            const x1 = Math.round(this.lonToWebMercator(left));
            const y1 = Math.round(this.latToWebMercator(bottom));
            const x2 = Math.round(this.lonToWebMercator(right));
            const y2 = Math.round(this.latToWebMercator(top));

            console.log(`📍 Converted bbox to Web Mercator: [${x1},${y1},${x2},${y2}]`);

            const url = this.baseUrl + this.apiPath;
            const body = JSON.stringify({ x1, y1, x2, y2 });

            // API-Abfrage mit Queue (verhindert Parallel-Requests)
            const addresses = await this.queuedFetch(url, body);

            console.log(`✅ Loaded ${addresses.length} addresses`);
            return addresses;
        } catch (error) {
            console.error("❌ Error fetching addresses:", error);
            return [];
        }
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
        // TODO: Segmentdaten von WME SDK abrufen
        // und dann fetchAddressesByLocation aufrufen
        console.log("🔄 Fetching by segment IDs:", segmentIds);
        return [];
    }

    /**
     * Queue-basierte Abfrage (verhindert Race Conditions)
     */
    private queuedFetch(url: string, data?: string): Promise<Address[]> {
        this.requestQueue = this.requestQueue.then(() => {
            return this.performFetch(url, data);
        });
        return this.requestQueue;
    }

    /**
     * Eigentliche Fetch-Operation mit GM_xmlhttpRequest (umgeht CSP)
     * Nach HN Importer Reloaded Muster - KEIN fetch fallback!
     */
    private performFetch(url: string, data?: string): Promise<Address[]> {
        return new Promise((resolve, reject) => {
            // IMMER GM_xmlhttpRequest verwenden (Tampermonkey API)
            // Dies umgeht Content Security Policy vollständig
            console.log(`🔗 Requesting: ${url}`);
            
            const requestDetails: any = {
                method: data ? "POST" : "GET",
                url: url,
                timeout: 10000,
                headers: data ? {
                    "Content-Type": "application/json"
                } : undefined,
                data: data ?? undefined,
                onload: (response: any) => {
                    try {
                        console.log(`📦 Response status: ${response.status}`);
                        
                        if (response.status >= 200 && response.status < 300) {
                            const data = JSON.parse(response.responseText);
                            console.log(`📦 Parsed response:`, data);
                            
                            // Die API gibt wahrscheinlich ein Array direkt zurück, nicht {addresses: [...]}
                            let addressesArray = data;
                            if (data.addresses) {
                                // Falls es {addresses: [...]} Format ist
                                addressesArray = data.addresses;
                            } else if (Array.isArray(data)) {
                                // Falls es direkt ein Array ist
                                addressesArray = data;
                            }
                            
                            if (!Array.isArray(addressesArray)) {
                                console.error(`❌ API Response is not an array:`, data);
                                reject(new Error(`API returned unexpected format: expected array of addresses`));
                                return;
                            }

                            // Raw-Daten zu Address-Objekten konvertieren
                            const addresses = addressesArray.map((raw: any, index: number) => {
                                const [longitude, latitude] = this.webMercatorToLonLat(raw.lon, raw.lat);
                                return {
                                    id: `addr-${Date.now()}-${index}`,
                                    latitude,
                                    longitude,
                                    streetName: raw.strassenname || raw.sn || "",
                                    houseNumber: raw.hausnummerzahl1 || raw.hn || "",
                                    city: raw.gn || "",
                                    status: "gray" as const, // Initiale Status
                                    markerId: undefined,
                                };
                            });
                            
                            console.log(`✅ API Response: ${addresses.length} addresses`);
                            resolve(addresses);
                        } else {
                            console.error(`❌ API Error Status ${response.status}: ${response.responseText}`);
                            reject(new Error(`API Error: ${response.status} - ${response.statusText}`));
                        }
                    } catch (error) {
                        console.error(`❌ Parse error:`, error);
                        console.error(`❌ Response text:`, response.responseText);
                        reject(error);
                    }
                },
                onerror: (error: any) => {
                    console.error(`❌ GM_xmlhttpRequest error:`, error);
                    // error ist ein Error-Objekt, nicht etwas das man stringifizieren kann
                    const errorMsg = error && error.message ? error.message : String(error);
                    reject(new Error(`Network error: ${errorMsg}`));
                },
                ontimeout: () => {
                    console.error(`❌ Request timeout`);
                    reject(new Error("Request timeout"));
                }
            };

            console.log(`🔧 Request method: ${requestDetails.method}`);
            if (requestDetails.data) {
                console.log(`🔧 Request body: ${requestDetails.data}`);
            }

            GM_xmlhttpRequest(requestDetails);
        });
    }
}

export const addressDataClient = new AddressDataClient();

/**
 * Mock-Daten für Development/Testing (ohne API-Abfrage)
 */
export function generateMockAddresses(count: number = 10): Address[] {
    const mockData: AddressDataRaw[] = [
        { sn: "Stephansplatz", hn: "1", gn: "Wien", lat: 48.2082, lon: 16.3738 },
        { sn: "Stephansplatz", hn: "2", gn: "Wien", lat: 48.2083, lon: 16.3739 },
        { sn: "Stephansplatz", hn: "3", gn: "Wien", lat: 48.2084, lon: 16.3740 },
        { sn: "Stephansplatz", hn: "4", gn: "Wien", lat: 48.2085, lon: 16.3741 },
        { sn: "Graben", hn: "5", gn: "Wien", lat: 48.2088, lon: 16.3745 },
        { sn: "Graben", hn: "6", gn: "Wien", lat: 48.2089, lon: 16.3746 },
        { sn: "Kohlmarkt", hn: "7", gn: "Wien", lat: 48.2090, lon: 16.3750 },
        { sn: "Kohlmarkt", hn: "8", gn: "Wien", lat: 48.2091, lon: 16.3751 },
        { sn: "Herrengasse", hn: "9", gn: "Wien", lat: 48.2092, lon: 16.3752 },
        { sn: "Herrengasse", hn: "10", gn: "Wien", lat: 48.2093, lon: 16.3753 },
    ];

    return mockData.slice(0, count).map((raw, index) => ({
        id: `mock-addr-${index}`,
        latitude: raw.lat,
        longitude: raw.lon,
        streetName: raw.sn,
        houseNumber: raw.hn,
        city: raw.gn,
        status: "gray" as const,
        markerId: undefined,
    }));
}
