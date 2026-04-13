import { WmeSDK } from "wme-sdk-typings";
import { Address, appState, debug } from "../core/state";

/**
 * Map Rendering für Adresspunkte
 * Mit Farbcodierung: grün, blassgrün, grau
 *
 * Verwendet WME SDK Layer-API (wie HN Importer)
 */

class MapRenderer {
    private wmeSDK: WmeSDK | null = null;
    private layerName = "Quick PP Importer";
    private isLayerCreated = false;

    setWmeSDK(sdk: WmeSDK) {
        this.wmeSDK = sdk;
        this.createLayer();
    }

    /**
     * WME SDK Layer erstellen (wie HN Importer)
     */
    private createLayer(): void {
        if (!this.wmeSDK || this.isLayerCreated) return;

        try {
            this.wmeSDK.Map.addLayer({
                layerName: this.layerName,
                styleContext: {
                    fillColor: (context: any) => context.feature ? this.getColorForStatus(context.feature.properties.status) : '#BDBDBD',
                    radius: (context: any) => context.feature ? Math.max(2 + (String(context.feature.properties.houseNumber || '').length || 1) * 5, 12) : 12,
                    opacity: () => 1,
                    cursor: () => 'pointer',
                    title: (context: any) => context.feature ?
                        (context.feature.properties.streetName && context.feature.properties.houseNumber
                            ? `${context.feature.properties.streetName} - ${context.feature.properties.houseNumber}${context.feature.properties.city ? ', ' + context.feature.properties.city : ''}`
                            : '') : '',
                    number: (context: any) => context.feature ? (context.feature.properties.houseNumber || '?') : '?'
                } as any,
                styleRules: [
                    {
                        style: {
                            fillColor: '${fillColor}',
                            fillOpacity: 1,
                            fontColor: '#111111',
                            fontOpacity: 1,
                            fontWeight: 'bold',
                            strokeColor: '#ffffff',
                            strokeOpacity: 1,
                            strokeWidth: 2,
                            pointRadius: '${radius}',
                            graphicName: 'circle',
                            label: '${number}',
                            cursor: '${cursor}',
                            title: '${title}'
                        }
                    }
                ]
            });

            this.wmeSDK.Map.setLayerVisibility({ layerName: this.layerName, visibility: false });
            this.isLayerCreated = true;

            console.log(`✅ Map layer created: ${this.layerName}`);

            // Event Listener für Klicks
            this.setupEventListeners();

        } catch (error) {
            console.error("❌ Error creating map layer:", error);
        }
    }

    /**
     * Event Listener für Layer-Interaktionen einrichten
     */
    private setupEventListeners(): void {
        if (!this.wmeSDK) return;

        // Map Click Handler — intercept every map click when Import Mode is active.
        // Finds the nearest unprocessed address marker to determine address data,
        // but always creates the RPP at the exact click coordinates (old-script behaviour:
        // user can fine-tune placement for better routing while address fills automatically).
        this.wmeSDK.Events.on({
            eventName: "wme-map-mouse-click",
            eventHandler: (clickEvent: any) => {
                if (!appState.getImportState().isActive) return;
                if (appState.getImportState().isPaused) return;

                const clickLon: number = clickEvent.lon;
                const clickLat: number = clickEvent.lat;

                // Proper geodesic distance in meters:
                // At lat ~48° (Austria), 1° lon ≈ 74 400 m, 1° lat ≈ 111 000 m.
                // Scale longitude by cos(lat) so the search radius is a true circle.
                const cosLat = Math.cos(clickLat * Math.PI / 180);
                const THRESHOLD_M = 40; // metres

                const addresses = appState.getAddresses();
                let nearest: Address | null = null;
                let nearestDist = Infinity;

                for (const addr of addresses) {
                    if (addr.status === 'lightGreen') continue; // already processed
                    const dLat = (addr.latitude  - clickLat) * 111000;
                    const dLon = (addr.longitude - clickLon) * 111000 * cosLat;
                    const dist = Math.hypot(dLat, dLon); // metres
                    if (dist < nearestDist) {
                        nearestDist = dist;
                        nearest = addr;
                    }
                }

                // Log all candidates within 100m for debugging
                const nearby = addresses
                    .filter(a => a.status !== 'lightGreen')
                    .map(a => ({
                        name: `${a.streetName} ${a.houseNumber}`,
                        dist: Math.hypot((a.latitude - clickLat) * 111000, (a.longitude - clickLon) * 111000 * cosLat)
                    }))
                    .filter(a => a.dist < 100)
                    .sort((a, b) => a.dist - b.dist);
                if (nearby.length > 0) {
                    debug(`🔍 Addresses within 100m of click:`, nearby.map(a => `${a.name} (${a.dist.toFixed(1)}m)`));
                }

                if (!nearest || nearestDist > THRESHOLD_M) return; // click was not near any marker

                const address = nearest;
                debug(`📌 Nearest address ${nearestDist.toFixed(0)}m away: ${address.streetName} ${address.houseNumber} — RPP at click pos`);
                appState.selectAddress(address);

                // RPP immer am Klickpunkt anlegen, Adressdaten vom nächstgelegenen Marker
                this.createPlacePoint(address, { lon: clickLon, lat: clickLat }).then(() => {
                    appState.markAddressProcessed(address.id);
                    this.refreshMarker(address.id);
                });
            }
        });

        // Map Move/Zoom Handler für Layer-Updates
        this.wmeSDK.Events.on({
            eventName: "wme-map-move-end",
            eventHandler: () => {
                this.wmeSDK?.Map.redrawLayer({ layerName: this.layerName });
            }
        });

        console.log("✅ Event listeners registered");
    }

    /**
     * Adressen als GeoJSON Features rendern
     */
    async renderAddresses(addresses: Address[]): Promise<void> {
        if (!this.wmeSDK || !this.isLayerCreated) {
            console.error("❌ WME SDK or layer not initialized");
            return;
        }

        debug(`🎨 Rendering ${addresses.length} address markers`);

        try {
            // Alle Features entfernen
            this.wmeSDK.Map.removeAllFeaturesFromLayer({
                layerName: this.layerName
            });

            if (addresses.length === 0) {
                debug("📍 No addresses to render");
                this.setLayerVisibility(false);
                return;
            }

            // Adressen in GeoJSON Features konvertieren
            const features: any[] = addresses.map(address => ({
                type: "Feature",
                id: address.id,
                geometry: {
                    type: "Point",
                    coordinates: [address.longitude, address.latitude]
                },
                properties: {
                    streetName: address.streetName,
                    houseNumber: address.houseNumber,
                    city: address.city,
                    status: address.status
                }
            }));

            // Features zur Layer hinzufügen
            this.wmeSDK.Map.addFeaturesToLayer({
                layerName: this.layerName,
                features: features
            });

            // Layer sichtbar machen
            this.setLayerVisibility(true);

            debug(`📍 ${addresses.length} addresses rendered`);

        } catch (error) {
            console.error("❌ Error rendering addresses:", error);
        }
    }

    /**
     * Farbe basierend auf Address-Status
     */
    private getColorForStatus(status: Address["status"]): string {
        switch (status) {
            case "green":
                return "#4CAF50"; // Grün
            case "lightGreen":
                return "#ABFA99"; // Blassgrün
            case "gray":
                return "#BDBDBD"; // Grau
            default:
                return "#BDBDBD"; // Default grau
        }
    }

    /**
     * Layer-Sichtbarkeit setzen
     */
    setLayerVisibility(visible: boolean): void {
        if (!this.wmeSDK || !this.isLayerCreated) return;

        this.wmeSDK.Map.setLayerVisibility({
            layerName: this.layerName,
            visibility: visible
        });
    }

    /**
     * Einzelnen Marker nach Statusänderung neu zeichnen (Farbe aktualisieren).
     * Entfernt das Feature und fügt es mit dem aktuellen Status wieder ein.
     */
    private refreshMarker(addressId: string): void {
        if (!this.wmeSDK || !this.isLayerCreated) return;
        const address = appState.getAddressById(addressId);
        if (!address) return;
        try {
            this.wmeSDK.Map.removeFeaturesFromLayer({
                layerName: this.layerName,
                featureIds: [addressId]
            } as any);
            this.wmeSDK.Map.addFeaturesToLayer({
                layerName: this.layerName,
                features: [{
                    type: "Feature",
                    id: address.id,
                    geometry: { type: "Point", coordinates: [address.longitude, address.latitude] },
                    properties: {
                        streetName: address.streetName,
                        houseNumber: address.houseNumber,
                        city: address.city,
                        status: address.status
                    }
                }]
            });
        } catch (e) {
            // Fallback: full redraw
            this.renderAddresses(appState.getAddresses());
        }
    }

    /**
     * RPP (Residential Place Point) aus Address erstellen.
     * @param address  Adressdaten (Straße, HN, Stadt)
     * @param position Optionale Klick-Position; RPP wird DORT angelegt. Wenn nicht
     *                 angegeben wird die Position des Adresspunktes selbst verwendet.
     */
    async createPlacePoint(address: Address, position?: { lon: number; lat: number }): Promise<void> {
        try {
            const placeLon = position?.lon ?? address.longitude;
            const placeLat = position?.lat ?? address.latitude;
            debug(`🏠 Creating RPP: ${address.streetName} ${address.houseNumber}`, position ? `at (${placeLon.toFixed(6)}, ${placeLat.toFixed(6)})` : '');

            if (!this.wmeSDK) {
                console.error('❌ WME SDK not initialized');
                return;
            }

            const geometry = { type: 'Point', coordinates: [placeLon, placeLat] } as any;

            // Create a new residential place (RPP) via SDK
            const newPlaceId = this.wmeSDK.DataModel.Venues.addVenue({ category: 'RESIDENTIAL', geometry }).toString();
            debug(`✅ Created place via SDK: id=${newPlaceId}`);

            const lockInfo = this.getDesiredResidentialLockInfo();
            if (lockInfo) {
                try {
                    this.wmeSDK.DataModel.Venues.updateVenue({
                        venueId: newPlaceId,
                        lockRank: lockInfo.lockRank
                    });
                    debug(`🔒 Set RPP lock level to L${lockInfo.lockRank + 1} (user rank L${lockInfo.userRank + 1})`);
                } catch (lockErr) {
                    console.warn(`⚠️ Failed to set lock level for ${newPlaceId}:`, lockErr);
                }
            }

            // Set navigation point for RPP (entry/primary)
            try {
                this.wmeSDK.DataModel.Venues.replaceNavigationPoints({
                    venueId: newPlaceId,
                    navigationPoints: [{ isEntry: true, isPrimary: true, point: geometry }]
                } as any);
                debug(`🔁 Navigation point set for venue ${newPlaceId}`);
            } catch (navErr) {
                console.warn(`⚠️ Failed to set navigation points for ${newPlaceId}:`, navErr);
            }

            // Find street from closest map segment.
            // Use click position so the street comes from where the RPP actually is.
            let streetFound = false;
            try {
                let streetId: number | undefined = undefined;
                const closestStreetId = this.findClosestSegmentStreetId(placeLon, placeLat, address.streetName);
                if (closestStreetId != null) {
                    streetId = closestStreetId;
                    // Only consider the street "found" when we matched by name.
                    // The fallback (geometry-only) means the name wasn't in the model
                    // so we still open the editor for the user to verify.
                    const allStreets = this.wmeSDK!.DataModel.Streets.getAll() as Array<{ id: number; name: string | null }>;
                    const matchedStreet = allStreets.find(s => s.id === closestStreetId);
                    const matchedName = matchedStreet?.name?.trim().toLowerCase();
                    const targetName = address.streetName?.trim().toLowerCase();
                    streetFound = !!(matchedName && targetName && matchedName === targetName);
                    debug(`🛣️ Street: streetId=${streetId}, name="${matchedStreet?.name}", matched=${streetFound}`);
                }

                if (address.houseNumber || streetId) {
                    this.wmeSDK.DataModel.Venues.updateAddress({
                        venueId: newPlaceId,
                        houseNumber: address.houseNumber || '',
                        ...(streetId ? { streetId } : {})
                    } as any);
                    debug(`📝 Address set for venue ${newPlaceId} (streetFound=${streetFound})`);
                }
            } catch (addrErr) {
                console.warn(`⚠️ Failed to update address for ${newPlaceId}:`, addrErr);
            }

            // Select the newly created place to open editor panel
            try {
                this.wmeSDK.Editing.setSelection({ selection: { objectType: 'venue', ids: [newPlaceId] } });
                debug(`🔎 Selected new venue ${newPlaceId}`);
            } catch (selErr) {
                console.warn(`⚠️ Failed to select new venue ${newPlaceId}:`, selErr);
            }

            // Only open the address editor when the street could not be resolved —
            // skip editor when address is complete.
            if (!streetFound) {
                debug(`📋 Street not resolved for "${address.streetName}" — opening address editor`);
                setTimeout(() => this.openAddressEditor(), 50);
            } else {
                debug(`✅ Street resolved for "${address.streetName}" — address complete`);
            }
        } catch (error) {
            console.error(`❌ Error creating RPP:`, error);
        }
    }

    /**
     * Finds the primaryStreetId of the closest loaded map segment whose street name matches
     * address.streetName (case-insensitive). Also checks alternateStreetIds so that Austrian
     * roads with a "Lxx -" / "Bxx -" primary name are correctly resolved via their alternate name.
     * Falls back to geometrically closest segment if no name match is found.
     */
    private findClosestSegmentStreetId(lon: number, lat: number, streetName?: string): number | null {
        try {
            const segments = (this.wmeSDK!.DataModel as any).Segments?.getAll?.() as Array<{
                id: number;
                primaryStreetId: number | null;
                alternateStreetIds: number[];
                geometry: { coordinates: [number, number][] };
            }>;
            if (!segments || segments.length === 0) return null;

            // Build a set of streetIds whose name matches address.streetName (primary OR alternate)
            let matchingStreetIds: Set<number> | null = null;
            if (streetName) {
                const normalizedTarget = streetName.trim().toLowerCase();
                const allStreets = this.wmeSDK!.DataModel.Streets.getAll() as Array<{ id: number; name: string | null }>;
                const matched = allStreets.filter(s => s.name?.trim().toLowerCase() === normalizedTarget);
                if (matched.length > 0) {
                    matchingStreetIds = new Set(matched.map(s => s.id));
                }
            }

            // Returns the matching street ID (may be an alternate) and distance for a segment.
            const getMatchAndDist = (seg: typeof segments[number]): { streetId: number; dist: number } | null => {
                const coords = seg.geometry?.coordinates;
                if (!coords || coords.length < 2) return null;

                let minDist = Infinity;
                for (let i = 0; i < coords.length - 1; i++) {
                    const d = this.distPointToSegment(
                        lon, lat,
                        coords[i][0], coords[i][1],
                        coords[i + 1][0], coords[i + 1][1]
                    );
                    if (d < minDist) minDist = d;
                }

                if (!matchingStreetIds) {
                    // No name filter — just use primary
                    if (seg.primaryStreetId == null) return null;
                    return { streetId: seg.primaryStreetId, dist: minDist };
                }

                // Check primary street first
                if (seg.primaryStreetId != null && matchingStreetIds.has(seg.primaryStreetId)) {
                    return { streetId: seg.primaryStreetId, dist: minDist };
                }
                // Check alternate streets (handles Austrian Lxx/Bxx roads where the
                // address name is stored as an alternate rather than the primary)
                for (const altId of (seg.alternateStreetIds ?? [])) {
                    if (matchingStreetIds.has(altId)) {
                        return { streetId: altId, dist: minDist };
                    }
                }
                return null;
            };

            let bestStreetId: number | null = null;
            let bestDist = Infinity;

            // First pass: prefer segments with a name-matched street (primary or alternate)
            if (matchingStreetIds) {
                for (const seg of segments) {
                    const result = getMatchAndDist(seg);
                    if (result && result.dist < bestDist) {
                        bestDist = result.dist;
                        bestStreetId = result.streetId;
                    }
                }
            }

            // Second pass fallback: no name match found — use geometrically closest primary street
            if (bestStreetId === null) {
                console.warn(`⚠️ No segment found with street name "${streetName}" — falling back to closest segment`);
                for (const seg of segments) {
                    if (seg.primaryStreetId == null) continue;
                    const coords = seg.geometry?.coordinates;
                    if (!coords || coords.length < 2) continue;

                    for (let i = 0; i < coords.length - 1; i++) {
                        const d = this.distPointToSegment(
                            lon, lat,
                            coords[i][0], coords[i][1],
                            coords[i + 1][0], coords[i + 1][1]
                        );
                        if (d < bestDist) {
                            bestDist = d;
                            bestStreetId = seg.primaryStreetId;
                        }
                    }
                }
            }

            return bestStreetId;
        } catch (e) {
            console.warn('⚠️ Segment street lookup failed:', e);
            return null;
        }
    }

    /**
     * Minimum distance from point (px,py) to line segment (ax,ay)-(bx,by).
     * Coordinates are in WGS84 degrees — fine for relative distance comparisons.
     */
    private distPointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(px - ax, py - ay);
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    /**
     * Address editor öffnen (analog zum alten "editRPPAddress" mit Retry-Logik).
     * Klickt auf ".full-address" in ".address-edit-view" und fokussiert
     * das Hausnummer-Eingabefeld im Shadow DOM.
     */
    private async openAddressEditor(tries = 1): Promise<void> {
        const addressEditView = document.querySelector('.address-edit-view');
        if (addressEditView) {
            const fullAddress = addressEditView.querySelector('.full-address') as HTMLElement | null;
            fullAddress?.click();
            await this.sleep(150);
            const hnHost = document.querySelector('.house-number') as any;
            const input = hnHost?.shadowRoot?.querySelector('#id') as HTMLInputElement | null;
            input?.focus();
            debug(`📋 Address editor opened (focus on house-number field)`);
        } else if (tries < 1000) {
            setTimeout(() => this.openAddressEditor(tries + 1), 200);
        }
    }

    /**
     * Sleep Helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Verwendet den aktuellen User-Rank als Lock Level, maximal L4.
     */
    private getDesiredResidentialLockInfo(): { userRank: number; lockRank: number } | null {
        if (!this.wmeSDK) return null;

        const userInfo = this.wmeSDK.State.getUserInfo();
        const userRank = userInfo?.rank;

        if (typeof userRank !== 'number' || Number.isNaN(userRank)) {
            return null;
        }

        // SDK rank is 0-based: rank 0 = L1 … rank 5 = L6.
        // lockRank 3 = L4 displayed, which is the maximum we want to set.
        const normalizedUserRank = Math.max(Math.trunc(userRank), 0);
        return {
            userRank: normalizedUserRank,
            lockRank: Math.min(normalizedUserRank, 3)
        };
    }

    /**
     * Alle Features entfernen
     */
    clearMarkers(): void {
        if (!this.wmeSDK || !this.isLayerCreated) return;

        this.wmeSDK.Map.removeAllFeaturesFromLayer({
            layerName: this.layerName
        });
        this.setLayerVisibility(false);
        console.log("🗑️  All markers cleared");
    }

    /**
     * Layer neu zeichnen
     */
    redrawLayer(): void {
        if (!this.wmeSDK) return;
        this.wmeSDK.Map.redrawLayer({ layerName: this.layerName });
    }
}

export const mapRenderer = new MapRenderer();
