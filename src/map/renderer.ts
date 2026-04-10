import { WmeSDK } from "wme-sdk-typings";
import { Address, appState } from "../core/state";

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
                            graphicName: 'square',
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

        // Feature Click Handler
        this.wmeSDK.Events.on({
            eventName: "wme-layer-feature-clicked",
            eventHandler: (clickEvent: any) => {
                if (clickEvent.layerName !== this.layerName) return;

                // Feature in Address konvertieren
                const feature = clickEvent.feature;
                const address: Address = {
                    id: feature.id,
                    latitude: feature.geometry.coordinates[1],
                    longitude: feature.geometry.coordinates[0],
                    streetName: feature.properties.streetName,
                    houseNumber: feature.properties.houseNumber,
                    city: feature.properties.city,
                    status: feature.properties.status
                };

                console.log(`📌 Address selected:`, address);
                appState.selectAddress(address);
            }
        });

        // Map Move/Zoom Handler für Layer-Updates
        this.wmeSDK.Events.on({
            eventName: "wme-map-move-end",
            eventHandler: () => {
                // Layer neu zeichnen wenn nötig
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

        console.log(`🎨 Rendering ${addresses.length} address markers`);

        try {
            // Alle Features entfernen
            this.wmeSDK.Map.removeAllFeaturesFromLayer({
                layerName: this.layerName
            });

            if (addresses.length === 0) {
                console.log("📍 No addresses to render");
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

            console.log(`📍 ${addresses.length} addresses loaded:`, addresses);

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
                return "#AED581"; // Blassgrün
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
     * Layer neu zeichnen
     */
    redrawLayer(): void {
        if (!this.wmeSDK) return;
        this.wmeSDK.Map.redrawLayer({ layerName: this.layerName });
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
     * Marker Count (Features in der Layer)
     */
    getMarkerCount(): number {
        // WME SDK bietet keine direkte Methode, aber wir können es über Events tracken
        // Für jetzt einfach eine Schätzung zurückgeben
        return 0; // TODO: Implement proper counting
    }
}

export const mapRenderer = new MapRenderer();
