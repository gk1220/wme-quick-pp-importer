import { WmeSDK, HouseNumber } from "wme-sdk-typings";
import { appState } from "../core/state";
import { addressDataClient } from "../data/api";
import { mapRenderer } from "../map/renderer";
import { calculateDistance } from "../utils/geo";

/**
 * Segment Selector - Erkennt ausgewählte Straßen-Segmente
 * und lädt automatisch Adressen für diese Straßen
 */

export class SegmentSelector {
    private wmeSDK: WmeSDK | null = null;
    private selectedSegments: any[] = [];
    private selectedStreetNames: string[] = [];
    private selectedHouseNumbers: HouseNumber[] = [];

    setWmeSDK(sdk: WmeSDK) {
        this.wmeSDK = sdk;
        this.setupSelectionListener();
    }

    /**
     * Event-Listener für Segment-Auswahl einrichten
     */
    private setupSelectionListener(): void {
        if (!this.wmeSDK) return;

        // Selection Changed Event
        this.wmeSDK.Events.on({
            eventName: "wme-selection-changed",
            eventHandler: async () => {
                await this.updateSelectedSegments();
            }
        });

        console.log("✅ Segment selection listener registered");
    }

    /**
     * Aktuell ausgewählte Segmente aktualisieren
     */
    private async updateSelectedSegments(): Promise<void> {
        if (!this.wmeSDK) return;

        const selection = this.wmeSDK.Editing.getSelection();
        if (!selection || selection.objectType !== 'segment' || selection.ids.length === 0) {
            this.selectedSegments = [];
            this.selectedStreetNames = [];
            this.selectedHouseNumbers = [];
            appState.setSelectedSegments([]);
            return;
        }

        // Segmente laden
        this.selectedSegments = selection.ids.map((segmentId: number) =>
            this.wmeSDK!.DataModel.Segments.getById({ segmentId })
        ).filter(x => x);

        // Straßen-Namen extrahieren
        this.selectedStreetNames = this.extractStreetNames(this.selectedSegments);

        console.log(`📌 Selected segments: ${this.selectedSegments.length}, streets:`, this.selectedStreetNames);

        appState.setSelectedSegments(this.selectedSegments);
        await this.fetchSelectedHouseNumbers();

        // Automatisch Adressen laden wenn Segmente ausgewählt
        if (appState.getImportState().isActive && this.selectedSegments.length > 0) {
            await this.loadAddressesForSegments();
        }
    }

    /**
     * Straßen-Namen aus Segmenten extrahieren
     */
    private extractStreetNames(segments: any[]): string[] {
        if (!this.wmeSDK) return [];

        const streetNames = new Set<string>();

        segments.forEach(segment => {
            // Primary Street
            if (segment.primaryStreetId) {
                const street = this.wmeSDK!.DataModel.Streets.getById({ streetId: segment.primaryStreetId });
                if (street?.name) {
                    streetNames.add(street.name.toLowerCase());
                }
            }

            // Alternate Streets
            segment.alternateStreetIds?.forEach((streetId: number) => {
                const street = this.wmeSDK!.DataModel.Streets.getById({ streetId });
                if (street?.name) {
                    streetNames.add(street.name.toLowerCase());
                }
            });
        });

        return Array.from(streetNames);
    }

    /**
     * Vorhandene HouseNumbers für die selektierten Segmente laden
     */
    private async fetchSelectedHouseNumbers(): Promise<void> {
        if (!this.wmeSDK) return;
        if (this.selectedSegments.length === 0) {
            this.selectedHouseNumbers = [];
            return;
        }

        const segmentIds = this.selectedSegments
            .map(segment => segment.id ?? segment.segmentId)
            .filter((segmentId: any) => typeof segmentId === 'number');

        if (segmentIds.length === 0) {
            this.selectedHouseNumbers = [];
            return;
        }

        try {
            this.selectedHouseNumbers = await this.wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({
                segmentIds
            });
            console.log(`📍 Loaded ${this.selectedHouseNumbers.length} existing house numbers for selected segments`);
        } catch (error) {
            console.error("❌ Error fetching selected house numbers:", error);
            this.selectedHouseNumbers = [];
        }
    }

    /**
     * Adressen für ausgewählte Segmente laden
     * Verwendet Map-Extent statt Segment-Geometrie (wie HN Importer)
     */
    private async loadAddressesForSegments(): Promise<void> {
        if (this.selectedSegments.length === 0) return;

        console.log("🔍 Loading addresses for selected segments...");

        try {
            await this.fetchSelectedHouseNumbers();

            // Bounding Box der aktuellen Map-Ansicht verwenden (wie HN Importer)
            const mapExtent = this.wmeSDK!.Map.getMapExtent();
            console.log(`📍 Using map extent: [${mapExtent}]`);

            // mapExtent format: [left, bottom, right, top]
            const [left, bottom, right, top] = mapExtent;

            // Adressen laden via kbox.at API
            const addresses = await addressDataClient.fetchAddressesByBoundingBox(
                left, bottom, right, top
            );

            // Nach Straßennamen filtern und Status setzen
            const filteredAddresses = this.filterAndColorAddresses(addresses);

            // Im State speichern und rendern
            appState.setAddresses(filteredAddresses);
            await mapRenderer.renderAddresses(filteredAddresses);

        } catch (error) {
            console.error("❌ Error loading addresses for segments:", error);
        }
    }

    /**
     * Bounding Box der ausgewählten Segmente berechnen
     */
    private calculateSegmentsBounds(): { north: number, south: number, east: number, west: number } | null {
        if (this.selectedSegments.length === 0) return null;

        let north = -90, south = 90, east = -180, west = 180;

        this.selectedSegments.forEach(segment => {
            if (segment.geometry && segment.geometry.coordinates) {
                console.log("🔍 Segment geometry:", segment.geometry);
                segment.geometry.coordinates.forEach((coord: [number, number]) => {
                    console.log("🔍 Raw coordinate:", coord);
                    const [x, y] = coord;

                    // Check if coordinates are already in lat/lng range
                    if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
                        // Already lat/lng
                        north = Math.max(north, y);
                        south = Math.min(south, y);
                        east = Math.max(east, x);
                        west = Math.min(west, x);
                    } else {
                        // Convert from Web Mercator (EPSG:3857) to lat/lng
                        const lat = (y / 6378137) * (180 / Math.PI);
                        const lon = (x / 6378137) * (180 / Math.PI);
                        console.log("🔍 Converted lat/lon:", lat, lon);

                        north = Math.max(north, lat);
                        south = Math.min(south, lat);
                        east = Math.max(east, lon);
                        west = Math.min(west, lon);
                    }
                });
            }
        });

        console.log("🔍 Calculated bounds:", { north, south, east, west });

        // Padding hinzufügen (500m ≈ 0.0045° bei 48° Breite)
        const padding = 0.005; // ~500m
        return {
            north: north + padding,
            south: south - padding,
            east: east + padding,
            west: west - padding
        };
    }

    /**
     * Adressen filtern und Farben zuweisen basierend auf Straßennamen-Match
     */
    private filterAndColorAddresses(addresses: any[]): any[] {
        return addresses.map(address => {
            const streetMatch = this.selectedStreetNames.some(selectedStreet =>
                this.normalizeStreetName(address.streetName).includes(this.normalizeStreetName(selectedStreet)) ||
                this.normalizeStreetName(selectedStreet).includes(this.normalizeStreetName(address.streetName))
            );

            let status: 'green' | 'lightGreen' | 'gray' = 'gray';

            if (streetMatch) {
                status = this.addressHasExistingHouseNumber(address) ? 'lightGreen' : 'green';
            } else {
                // Check for similar street names (fuzzy match)
                const similarMatch = this.selectedStreetNames.some(selectedStreet =>
                    this.calculateStreetSimilarity(address.streetName, selectedStreet) > 0.8
                );
                if (similarMatch) {
                    status = 'lightGreen';
                }
            }

            return {
                ...address,
                status
            };
        });
    }

    /**
     * Prüfe, ob eine Adresse bereits eine HouseNumber auf den selektierten Segmenten hat
     */
    private addressHasExistingHouseNumber(address: any): boolean {
        if (!address.houseNumber) return false;

        const normalizedAddrNumber = this.normalizeHouseNumber(address.houseNumber);
        return this.selectedHouseNumbers.some(hn => this.normalizeHouseNumber(hn.number) === normalizedAddrNumber);
    }

    private normalizeHouseNumber(houseNumber: string): string {
        return houseNumber.toLowerCase().trim().replace(/\s+/g, '');
    }

    /**
     * Straßen-Namen normalisieren für Vergleich
     */
    private normalizeStreetName(name: string): string {
        return name.toLowerCase()
            .replace(/straße|strasse|str\.?/g, 'str')
            .replace(/gasse|g\.?/g, 'g')
            .replace(/platz|pl\.?/g, 'pl')
            .replace(/weg|w\.?/g, 'w')
            .replace(/\s+/g, '')
            .replace(/[^a-z0-9]/g, '');
    }

    /**
     * Einfache Ähnlichkeitsberechnung für Straßennamen
     */
    private calculateStreetSimilarity(name1: string, name2: string): number {
        const norm1 = this.normalizeStreetName(name1);
        const norm2 = this.normalizeStreetName(name2);

        if (norm1 === norm2) return 1.0;

        // Levenshtein-Distance basierte Ähnlichkeit
        const longer = norm1.length > norm2.length ? norm1 : norm2;
        const shorter = norm1.length > norm2.length ? norm2 : norm1;

        if (longer.length === 0) return 1.0;

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    /**
     * Levenshtein-Distance für String-Ähnlichkeit
     */
    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Manuelles Laden von Adressen triggern (für Debug)
     */
    async loadAddressesManually(): Promise<void> {
        await this.loadAddressesForSegments();
    }

    /**
     * Getter für Debug-Zwecke
     */
    getSelectedSegments(): any[] {
        return this.selectedSegments;
    }

    getSelectedStreetNames(): string[] {
        return this.selectedStreetNames;
    }
}

export const segmentSelector = new SegmentSelector();