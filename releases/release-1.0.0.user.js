// ==UserScript==
// @name        WME Quick PP Importer
// @namespace   wme-sdk-scripts
// @version     1.0.0
// @description Quickly add place points based on open address data sources.
// @author      Gerhard (g1220k)
// @updateURL	https://github.com/gk1220/wme-quick-pp-importer/raw/main/WME_Quick_PP_Importer.user.js
// @downloadURL https://github.com/gk1220/wme-quick-pp-importer/raw/main/WME_Quick_PP_Importer.user.js
// @match       https://www.waze.com/editor*
// @match       https://beta.waze.com/editor*
// @match       https://www.waze.com/*/editor*
// @match       https://beta.waze.com/*/editor*
// @exclude     https://www.waze.com/user/editor*
// @exclude     https://beta.waze.com/user/editor*
// @connect     wms.kbox.at
// @grant       GM_xmlhttpRequest
// ==/UserScript==
(function () {
    'use strict';

    class AppState {
        constructor() {
            this.wmeSDK = null;
            this.importState = {
                isActive: false,
                isPaused: false,
                selectedSegmentIds: [],
                loadedAddresses: [],
                selectedAddresses: new Map(),
            };
            this.config = {
                apiBaseUrl: "https://wms.kbox.at",
                searchRadius: 0.5,
                autoFillDistance: 50,
            };
            this.listeners = new Map();
        }
        setWmeSDK(sdk) {
            this.wmeSDK = sdk;
        }
        getWmeSDK() {
            if (!this.wmeSDK) {
                throw new Error("WME SDK not initialized");
            }
            return this.wmeSDK;
        }
        activateImport() {
            this.importState.isActive = true;
            this.emit("importActivated");
        }
        deactivateImport() {
            this.importState.isActive = false;
            this.emit("importDeactivated");
            this.clearAddresses();
        }
        togglePause() {
            this.importState.isPaused = !this.importState.isPaused;
            this.emit(this.importState.isPaused ? "importPaused" : "importResumed");
        }
        getImportState() {
            return { ...this.importState };
        }
        setSelectedSegments(segmentIds) {
            this.importState.selectedSegmentIds = segmentIds;
            this.emit("segmentsSelected", segmentIds);
        }
        getSelectedSegments() {
            return [...this.importState.selectedSegmentIds];
        }
        setAddresses(addresses) {
            this.importState.loadedAddresses = addresses;
            this.emit("addressesLoaded", addresses);
        }
        getAddresses() {
            return [...this.importState.loadedAddresses];
        }
        clearAddresses() {
            this.importState.loadedAddresses = [];
            this.importState.selectedAddresses.clear();
            this.emit("addressesCleared");
        }
        selectAddress(address) {
            this.importState.selectedAddresses.set(address.id, address);
            this.emit("addressSelected", address);
        }
        removeSelectedAddress(addressId) {
            this.importState.selectedAddresses.delete(addressId);
            this.emit("addressDeselected", addressId);
        }
        getSelectedAddresses() {
            return Array.from(this.importState.selectedAddresses.values());
        }
        getConfig() {
            return { ...this.config };
        }
        updateConfig(partial) {
            this.config = { ...this.config, ...partial };
            this.emit("configUpdated", this.config);
        }
        on(event, listener) {
            if (!this.listeners.has(event)) {
                this.listeners.set(event, new Set());
            }
            this.listeners.get(event).add(listener);
            return () => {
                this.listeners.get(event)?.delete(listener);
            };
        }
        emit(event, ...args) {
            const eventListeners = this.listeners.get(event);
            if (eventListeners) {
                eventListeners.forEach(listener => listener(...args));
            }
        }
        logState() {
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
    const appState = new AppState();

    class AddressDataClient {
        constructor() {
            this.baseUrl = "https://wms.kbox.at";
            this.apiPath = "/adr";
            this.requestQueue = Promise.resolve();
        }
        async fetchAddressesByBoundingBox(left, bottom, right, top) {
            try {
                console.log(`📍 Fetching addresses: bbox=[${left},${bottom},${right},${top}]`);
                const x1 = Math.round(this.lonToWebMercator(left));
                const y1 = Math.round(this.latToWebMercator(bottom));
                const x2 = Math.round(this.lonToWebMercator(right));
                const y2 = Math.round(this.latToWebMercator(top));
                console.log(`📍 Converted bbox to Web Mercator: [${x1},${y1},${x2},${y2}]`);
                const url = this.baseUrl + this.apiPath;
                const body = JSON.stringify({ x1, y1, x2, y2 });
                const addresses = await this.queuedFetch(url, body);
                console.log(`✅ Loaded ${addresses.length} addresses`);
                return addresses;
            }
            catch (error) {
                console.error("❌ Error fetching addresses:", error);
                return [];
            }
        }
        lonToWebMercator(lon) {
            return lon * 6378137 * (Math.PI / 180);
        }
        latToWebMercator(lat) {
            const rad = lat * (Math.PI / 180);
            return 6378137 * Math.log(Math.tan(Math.PI / 4 + rad / 2));
        }
        webMercatorToLonLat(x, y) {
            const lon = (x / 6378137) * (180 / Math.PI);
            const lat = (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * (180 / Math.PI);
            return [lon, lat];
        }
        async fetchAddressesBySegment(segmentIds) {
            console.log("🔄 Fetching by segment IDs:", segmentIds);
            return [];
        }
        queuedFetch(url, data) {
            this.requestQueue = this.requestQueue.then(() => {
                return this.performFetch(url, data);
            });
            return this.requestQueue;
        }
        performFetch(url, data) {
            return new Promise((resolve, reject) => {
                console.log(`🔗 Requesting: ${url}`);
                const requestDetails = {
                    method: data ? "POST" : "GET",
                    url: url,
                    timeout: 10000,
                    headers: data ? {
                        "Content-Type": "application/json"
                    } : undefined,
                    data: data ?? undefined,
                    onload: (response) => {
                        try {
                            console.log(`📦 Response status: ${response.status}`);
                            if (response.status >= 200 && response.status < 300) {
                                const data = JSON.parse(response.responseText);
                                console.log(`📦 Parsed response:`, data);
                                let addressesArray = data;
                                if (data.addresses) {
                                    addressesArray = data.addresses;
                                }
                                else if (Array.isArray(data)) {
                                    addressesArray = data;
                                }
                                if (!Array.isArray(addressesArray)) {
                                    console.error(`❌ API Response is not an array:`, data);
                                    reject(new Error(`API returned unexpected format: expected array of addresses`));
                                    return;
                                }
                                const addresses = addressesArray.map((raw, index) => {
                                    const [longitude, latitude] = this.webMercatorToLonLat(raw.lon, raw.lat);
                                    return {
                                        id: `addr-${Date.now()}-${index}`,
                                        latitude,
                                        longitude,
                                        streetName: raw.strassenname || raw.sn || "",
                                        houseNumber: raw.hausnummerzahl1 || raw.hn || "",
                                        city: raw.gn || "",
                                        status: "gray",
                                        markerId: undefined,
                                    };
                                });
                                console.log(`✅ API Response: ${addresses.length} addresses`);
                                resolve(addresses);
                            }
                            else {
                                console.error(`❌ API Error Status ${response.status}: ${response.responseText}`);
                                reject(new Error(`API Error: ${response.status} - ${response.statusText}`));
                            }
                        }
                        catch (error) {
                            console.error(`❌ Parse error:`, error);
                            console.error(`❌ Response text:`, response.responseText);
                            reject(error);
                        }
                    },
                    onerror: (error) => {
                        console.error(`❌ GM_xmlhttpRequest error:`, error);
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
    const addressDataClient = new AddressDataClient();
    function generateMockAddresses(count = 10) {
        const mockData = [
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
            status: "gray",
            markerId: undefined,
        }));
    }

    class MapRenderer {
        constructor() {
            this.wmeSDK = null;
            this.layerName = "Quick PP Importer";
            this.isLayerCreated = false;
        }
        setWmeSDK(sdk) {
            this.wmeSDK = sdk;
            this.createLayer();
        }
        createLayer() {
            if (!this.wmeSDK || this.isLayerCreated)
                return;
            try {
                this.wmeSDK.Map.addLayer({
                    layerName: this.layerName,
                    styleContext: {
                        fillColor: (context) => context.feature ? this.getColorForStatus(context.feature.properties.status) : '#BDBDBD',
                        radius: (context) => context.feature ? Math.max(2 + (String(context.feature.properties.houseNumber || '').length || 1) * 5, 12) : 12,
                        opacity: () => 1,
                        cursor: () => 'pointer',
                        title: (context) => context.feature ?
                            (context.feature.properties.streetName && context.feature.properties.houseNumber
                                ? `${context.feature.properties.streetName} - ${context.feature.properties.houseNumber}${context.feature.properties.city ? ', ' + context.feature.properties.city : ''}`
                                : '') : '',
                        number: (context) => context.feature ? (context.feature.properties.houseNumber || '?') : '?'
                    },
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
                this.setupEventListeners();
            }
            catch (error) {
                console.error("❌ Error creating map layer:", error);
            }
        }
        setupEventListeners() {
            if (!this.wmeSDK)
                return;
            this.wmeSDK.Events.on({
                eventName: "wme-layer-feature-clicked",
                eventHandler: (clickEvent) => {
                    if (clickEvent.layerName !== this.layerName)
                        return;
                    const feature = clickEvent.feature;
                    const address = {
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
            this.wmeSDK.Events.on({
                eventName: "wme-map-move-end",
                eventHandler: () => {
                    this.wmeSDK?.Map.redrawLayer({ layerName: this.layerName });
                }
            });
            console.log("✅ Event listeners registered");
        }
        async renderAddresses(addresses) {
            if (!this.wmeSDK || !this.isLayerCreated) {
                console.error("❌ WME SDK or layer not initialized");
                return;
            }
            console.log(`🎨 Rendering ${addresses.length} address markers`);
            try {
                this.wmeSDK.Map.removeAllFeaturesFromLayer({
                    layerName: this.layerName
                });
                if (addresses.length === 0) {
                    console.log("📍 No addresses to render");
                    this.setLayerVisibility(false);
                    return;
                }
                const features = addresses.map(address => ({
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
                this.wmeSDK.Map.addFeaturesToLayer({
                    layerName: this.layerName,
                    features: features
                });
                this.setLayerVisibility(true);
                console.log(`📍 ${addresses.length} addresses loaded:`, addresses);
            }
            catch (error) {
                console.error("❌ Error rendering addresses:", error);
            }
        }
        getColorForStatus(status) {
            switch (status) {
                case "green":
                    return "#4CAF50";
                case "lightGreen":
                    return "#AED581";
                case "gray":
                    return "#BDBDBD";
                default:
                    return "#BDBDBD";
            }
        }
        setLayerVisibility(visible) {
            if (!this.wmeSDK || !this.isLayerCreated)
                return;
            this.wmeSDK.Map.setLayerVisibility({
                layerName: this.layerName,
                visibility: visible
            });
        }
        redrawLayer() {
            if (!this.wmeSDK)
                return;
            this.wmeSDK.Map.redrawLayer({ layerName: this.layerName });
        }
        clearMarkers() {
            if (!this.wmeSDK || !this.isLayerCreated)
                return;
            this.wmeSDK.Map.removeAllFeaturesFromLayer({
                layerName: this.layerName
            });
            this.setLayerVisibility(false);
            console.log("🗑️  All markers cleared");
        }
        getMarkerCount() {
            return 0;
        }
    }
    const mapRenderer = new MapRenderer();

    class SegmentSelector {
        constructor() {
            this.wmeSDK = null;
            this.selectedSegments = [];
            this.selectedStreetNames = [];
            this.selectedHouseNumbers = [];
        }
        setWmeSDK(sdk) {
            this.wmeSDK = sdk;
            this.setupSelectionListener();
        }
        setupSelectionListener() {
            if (!this.wmeSDK)
                return;
            this.wmeSDK.Events.on({
                eventName: "wme-selection-changed",
                eventHandler: async () => {
                    await this.updateSelectedSegments();
                }
            });
            console.log("✅ Segment selection listener registered");
        }
        async updateSelectedSegments() {
            if (!this.wmeSDK)
                return;
            const selection = this.wmeSDK.Editing.getSelection();
            if (!selection || selection.objectType !== 'segment' || selection.ids.length === 0) {
                this.selectedSegments = [];
                this.selectedStreetNames = [];
                this.selectedHouseNumbers = [];
                appState.setSelectedSegments([]);
                return;
            }
            this.selectedSegments = selection.ids.map((segmentId) => this.wmeSDK.DataModel.Segments.getById({ segmentId })).filter(x => x);
            this.selectedStreetNames = this.extractStreetNames(this.selectedSegments);
            console.log(`📌 Selected segments: ${this.selectedSegments.length}, streets:`, this.selectedStreetNames);
            appState.setSelectedSegments(this.selectedSegments);
            await this.fetchSelectedHouseNumbers();
            if (appState.getImportState().isActive && this.selectedSegments.length > 0) {
                await this.loadAddressesForSegments();
            }
        }
        extractStreetNames(segments) {
            if (!this.wmeSDK)
                return [];
            const streetNames = new Set();
            segments.forEach(segment => {
                if (segment.primaryStreetId) {
                    const street = this.wmeSDK.DataModel.Streets.getById({ streetId: segment.primaryStreetId });
                    if (street?.name) {
                        streetNames.add(street.name.toLowerCase());
                    }
                }
                segment.alternateStreetIds?.forEach((streetId) => {
                    const street = this.wmeSDK.DataModel.Streets.getById({ streetId });
                    if (street?.name) {
                        streetNames.add(street.name.toLowerCase());
                    }
                });
            });
            return Array.from(streetNames);
        }
        async fetchSelectedHouseNumbers() {
            if (!this.wmeSDK)
                return;
            if (this.selectedSegments.length === 0) {
                this.selectedHouseNumbers = [];
                return;
            }
            const segmentIds = this.selectedSegments
                .map(segment => segment.id ?? segment.segmentId)
                .filter((segmentId) => typeof segmentId === 'number');
            if (segmentIds.length === 0) {
                this.selectedHouseNumbers = [];
                return;
            }
            try {
                this.selectedHouseNumbers = await this.wmeSDK.DataModel.HouseNumbers.fetchHouseNumbers({
                    segmentIds
                });
                console.log(`📍 Loaded ${this.selectedHouseNumbers.length} existing house numbers for selected segments`);
            }
            catch (error) {
                console.error("❌ Error fetching selected house numbers:", error);
                this.selectedHouseNumbers = [];
            }
        }
        async loadAddressesForSegments() {
            if (this.selectedSegments.length === 0)
                return;
            console.log("🔍 Loading addresses for selected segments...");
            try {
                await this.fetchSelectedHouseNumbers();
                const mapExtent = this.wmeSDK.Map.getMapExtent();
                console.log(`📍 Using map extent: [${mapExtent}]`);
                const [left, bottom, right, top] = mapExtent;
                const addresses = await addressDataClient.fetchAddressesByBoundingBox(left, bottom, right, top);
                const filteredAddresses = this.filterAndColorAddresses(addresses);
                appState.setAddresses(filteredAddresses);
                await mapRenderer.renderAddresses(filteredAddresses);
            }
            catch (error) {
                console.error("❌ Error loading addresses for segments:", error);
            }
        }
        calculateSegmentsBounds() {
            if (this.selectedSegments.length === 0)
                return null;
            let north = -90, south = 90, east = -180, west = 180;
            this.selectedSegments.forEach(segment => {
                if (segment.geometry && segment.geometry.coordinates) {
                    console.log("🔍 Segment geometry:", segment.geometry);
                    segment.geometry.coordinates.forEach((coord) => {
                        console.log("🔍 Raw coordinate:", coord);
                        const [x, y] = coord;
                        if (x >= -180 && x <= 180 && y >= -90 && y <= 90) {
                            north = Math.max(north, y);
                            south = Math.min(south, y);
                            east = Math.max(east, x);
                            west = Math.min(west, x);
                        }
                        else {
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
            const padding = 0.005;
            return {
                north: north + padding,
                south: south - padding,
                east: east + padding,
                west: west - padding
            };
        }
        filterAndColorAddresses(addresses) {
            return addresses.map(address => {
                const streetMatch = this.selectedStreetNames.some(selectedStreet => this.normalizeStreetName(address.streetName).includes(this.normalizeStreetName(selectedStreet)) ||
                    this.normalizeStreetName(selectedStreet).includes(this.normalizeStreetName(address.streetName)));
                let status = 'gray';
                if (streetMatch) {
                    status = this.addressHasExistingHouseNumber(address) ? 'lightGreen' : 'green';
                }
                else {
                    const similarMatch = this.selectedStreetNames.some(selectedStreet => this.calculateStreetSimilarity(address.streetName, selectedStreet) > 0.8);
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
        addressHasExistingHouseNumber(address) {
            if (!address.houseNumber)
                return false;
            const normalizedAddrNumber = this.normalizeHouseNumber(address.houseNumber);
            return this.selectedHouseNumbers.some(hn => this.normalizeHouseNumber(hn.number) === normalizedAddrNumber);
        }
        normalizeHouseNumber(houseNumber) {
            return houseNumber.toLowerCase().trim().replace(/\s+/g, '');
        }
        normalizeStreetName(name) {
            return name.toLowerCase()
                .replace(/straße|strasse|str\.?/g, 'str')
                .replace(/gasse|g\.?/g, 'g')
                .replace(/platz|pl\.?/g, 'pl')
                .replace(/weg|w\.?/g, 'w')
                .replace(/\s+/g, '')
                .replace(/[^a-z0-9]/g, '');
        }
        calculateStreetSimilarity(name1, name2) {
            const norm1 = this.normalizeStreetName(name1);
            const norm2 = this.normalizeStreetName(name2);
            if (norm1 === norm2)
                return 1.0;
            const longer = norm1.length > norm2.length ? norm1 : norm2;
            const shorter = norm1.length > norm2.length ? norm2 : norm1;
            if (longer.length === 0)
                return 1.0;
            const distance = this.levenshteinDistance(longer, shorter);
            return (longer.length - distance) / longer.length;
        }
        levenshteinDistance(str1, str2) {
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
                    }
                    else {
                        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
                    }
                }
            }
            return matrix[str2.length][str1.length];
        }
        async loadAddressesManually() {
            await this.loadAddressesForSegments();
        }
        getSelectedSegments() {
            return this.selectedSegments;
        }
        getSelectedStreetNames() {
            return this.selectedStreetNames;
        }
    }
    const segmentSelector = new SegmentSelector();

    async function initializeScript(wmeSDK) {
        console.log(`✅ WME Quick PP Importer: SDK v.${wmeSDK.getSDKVersion()} initialized`);
        appState.setWmeSDK(wmeSDK);
        try {
            await setupSidebarTab(wmeSDK);
            setupMapLayer(wmeSDK);
            segmentSelector.setWmeSDK(wmeSDK);
            setupEventListeners(wmeSDK);
            console.log("🚀 Quick PP Importer fully initialized");
        }
        catch (error) {
            console.error("❌ Initialization failed:", error);
            throw error;
        }
    }
    async function setupSidebarTab(wmeSDK) {
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
        const enableCheckbox = tabPane.querySelector("#qpi-enable");
        if (enableCheckbox) {
            enableCheckbox.addEventListener("change", (e) => {
                const checked = e.target.checked;
                if (checked) {
                    appState.activateImport();
                }
                else {
                    appState.deactivateImport();
                }
            });
        }
        appState.on("addressesLoaded", (addresses) => {
            const countEl = tabPane.querySelector("#qpi-address-count");
            if (countEl) {
                countEl.textContent = `Adressen geladen: ${addresses.length}`;
            }
        });
        appState.on("importActivated", () => {
            const statusEl = tabPane.querySelector("#qpi-status");
            if (statusEl)
                statusEl.textContent = "Status: 🟢 Aktiv";
        });
        appState.on("importDeactivated", () => {
            const statusEl = tabPane.querySelector("#qpi-status");
            if (statusEl)
                statusEl.textContent = "Status: Bereit";
        });
    }
    function setupMapLayer(wmeSDK) {
        console.log("✅ Map layer setup delegated to mapRenderer");
    }
    function setupEventListeners(wmeSDK) {
        document.addEventListener("keydown", (e) => {
            const state = appState.getImportState();
            if (e.key.toLowerCase() === "p" && !state.isPaused) {
                e.preventDefault();
                if (!state.isActive) {
                    console.log("▶️  Import Mode: ON");
                    appState.activateImport();
                }
                else {
                    console.log("⏹️  Import Mode: OFF");
                    appState.deactivateImport();
                }
            }
            if (e.key.toLowerCase() === "o" && state.isActive) {
                e.preventDefault();
                console.log("▶️  Continuing...");
                appState.togglePause();
            }
            if (e.key === "Escape" && state.isActive && !state.isPaused) {
                e.preventDefault();
                console.log("⏸️  Paused");
                appState.togglePause();
            }
        });
        console.log("✅ Event listeners registered");
    }

    const initSDK = async () => {
        console.log("⏳ Waiting for WME SDK to initialize...");
        try {
            const unsafeWindow = window.unsafeWindow || window;
            if (unsafeWindow.SDK_INITIALIZED) {
                console.log("⏳ SDK_INITIALIZED promise found, waiting...");
                await unsafeWindow.SDK_INITIALIZED;
                console.log("✅ SDK_INITIALIZED promise resolved");
            }
            else {
                console.log("⚠️  SDK_INITIALIZED not found in unsafeWindow");
                throw new Error("SDK_INITIALIZED not available");
            }
            if (!unsafeWindow.getWmeSdk) {
                console.log("⚠️  getWmeSdk not available in unsafeWindow");
                throw new Error("getWmeSdk not available");
            }
            console.log("🚀 Creating WME SDK instance...");
            const wmeSDK = unsafeWindow.getWmeSdk({
                scriptId: "wme-quick-pp-importer",
                scriptName: "WME Quick PP Importer"
            });
            console.log("✅ WME SDK instance created");
            return wmeSDK;
        }
        catch (error) {
            console.error("❌ SDK initialization failed:", error);
            throw error;
        }
    };
    initSDK().then(async (wmeSDK) => {
        try {
            mapRenderer.setWmeSDK(wmeSDK);
            await initializeScript(wmeSDK);
            appState.on("addressesLoaded", (addresses) => {
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
            appState.on("segmentsSelected", (segments) => {
                console.log("📌 Segments selected:", segments.length);
            });
            window.testQuickPP = {
                testAPI: async () => {
                    console.log("🧪 Testing API (real kbox.at call)...");
                    try {
                        const mapExtent = wmeSDK.Map.getMapExtent();
                        const [left, bottom, right, top] = mapExtent;
                        console.log(`📍 Using map extent: [${mapExtent}]`);
                        const addresses = await addressDataClient.fetchAddressesByBoundingBox(left, bottom, right, top);
                        console.log("✅ API Test Result:", addresses);
                        return addresses;
                    }
                    catch (error) {
                        console.error("❌ API Test failed:", error);
                        throw error;
                    }
                },
                testRender: async () => {
                    console.log("🧪 Testing Rendering with Mock Data...");
                    const addresses = generateMockAddresses(10);
                    addresses.forEach((addr, i) => {
                        if (i % 3 === 0)
                            addr.status = "green";
                        else if (i % 3 === 1)
                            addr.status = "lightGreen";
                        else
                            addr.status = "gray";
                    });
                    await mapRenderer.renderAddresses(addresses);
                    appState.setAddresses(addresses);
                    console.log("✅ Rendering Test Complete - Check map!");
                },
                testAPIWithMock: async () => {
                    console.log("🧪 Testing API with Mock Fallback...");
                    try {
                        const mapExtent = wmeSDK.Map.getMapExtent();
                        const [left, bottom, right, top] = mapExtent;
                        console.log(`📍 Using map extent: [${mapExtent}]`);
                        let addresses = await addressDataClient.fetchAddressesByBoundingBox(left, bottom, right, top);
                        if (addresses.length === 0) {
                            console.log("⚠️  API failed, using mock data");
                            addresses = generateMockAddresses(10);
                        }
                        addresses.forEach((addr, i) => {
                            if (i % 3 === 0)
                                addr.status = "green";
                            else if (i % 3 === 1)
                                addr.status = "lightGreen";
                        });
                        await mapRenderer.renderAddresses(addresses);
                        appState.setAddresses(addresses);
                        console.log("✅ Test Complete!");
                    }
                    catch (error) {
                        console.error("❌ Test API with Mock failed:", error);
                    }
                },
                showState: () => appState.logState(),
                clear: () => {
                    mapRenderer.clearMarkers();
                    appState.deactivateImport();
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
                showSegments: () => {
                    const segments = segmentSelector.getSelectedSegments();
                    const streets = segmentSelector.getSelectedStreetNames();
                    console.log(`📌 Selected segments: ${segments.length}`);
                    console.log(`🛣️  Selected streets:`, streets);
                    return { segments: segments.length, streets };
                }
            };
            console.log("💡 Debug Commands available:");
            console.log("  testQuickPP.testAPI() - Test real API");
            console.log("  testQuickPP.testRender() - Test rendering with mock data");
            console.log("  testQuickPP.testAPIWithMock() - Test API with mock fallback");
            console.log("  testQuickPP.showState() - Show current state");
            console.log("  testQuickPP.clear() - Clear markers");
            console.log("  testQuickPP.updatePositions() - Redraw layer");
            console.log("  testQuickPP.countMarkers() - Count markers");
            console.log("  testQuickPP.loadAddresses() - Load addresses for selected segments");
            console.log("  testQuickPP.showSegments() - Show selected segments info");
        }
        catch (error) {
            console.error("❌ Script initialization failed:", error);
        }
    }).catch((error) => {
        console.error("❌ Script initialization promise rejected:", error);
        console.error("Stack:", error instanceof Error ? error.stack : "no stack");
    });

})();
