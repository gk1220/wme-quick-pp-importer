// ==UserScript==
// @name        WME Quick PP Importer
// @namespace   https://github.com/gk1220
// @version     2026.04.14.00
// @description Quickly add place points based on open address data sources.
// @author      Gerhard (g1220k)
// @homepageURL https://github.com/gk1220/wme-quick-pp-importer
// @supportURL  https://github.com/gk1220/wme-quick-pp-importer/issues
// @updateURL   https://update.greasyfork.org/scripts/573546/WME%20Quick%20PP%20Importer.meta.js
// @downloadURL https://update.greasyfork.org/scripts/573546/WME%20Quick%20PP%20Importer.user.js
// @match       https://www.waze.com/editor*
// @match       https://beta.waze.com/editor*
// @match       https://www.waze.com/*/editor*
// @match       https://beta.waze.com/*/editor*
// @exclude     https://www.waze.com/user/editor*
// @exclude     https://beta.waze.com/user/editor*
// @connect     wms.kbox.at
// @license     GPL-3.0
// @grant       GM_xmlhttpRequest
// @grant       unsafeWindow
// ==/UserScript==
(function () {
    'use strict';

    class AppState {
        wmeSDK = null;
        importState = {
            isActive: false,
            isPaused: false,
            selectedSegmentIds: [],
            loadedAddresses: [],
            selectedAddresses: new Map(),
        };
        config = {
            apiBaseUrl: "https://wms.kbox.at",
            searchRadius: 0.5,
            autoFillDistance: 50,
        };
        listeners = new Map();
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
            this.importState.isPaused = false;
            this.emit("importDeactivated");
            this.clearAddresses();
        }
        togglePause() {
            this.importState.isPaused = !this.importState.isPaused;
            this.emit(this.importState.isPaused ? "importPaused" : "importResumed");
        }
        _debugMode = false;
        get debugMode() { return this._debugMode; }
        setDebugMode(val) {
            this._debugMode = val;
            console.log(`🔧 Debug Mode: ${val ? 'AN' : 'AUS'}`);
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
        getAddressById(id) {
            return this.importState.loadedAddresses.find(a => a.id === id);
        }
        markAddressProcessed(id) {
            const address = this.importState.loadedAddresses.find(a => a.id === id);
            if (address) {
                address.status = 'lightGreen';
                this.emit("addressUpdated", address);
            }
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
    function debug(...args) {
        if (appState.debugMode)
            console.log(...args);
    }

    const TILE = {
        SIZE_M: 750,
        TTL_DAYS: 7,
        MAX: 300,
        NS: 'WME_PP_TILE_',
        META: 'WME_PP_META'
    };
    const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
    const memTiles = new Map();
    class AddressDataClient {
        baseUrl = "https://wms.kbox.at";
        apiPath = "/adr";
        requestQueue = Promise.resolve();
        tileKeyForXY(x, y) {
            return `${Math.floor(x / TILE.SIZE_M)}_${Math.floor(y / TILE.SIZE_M)}`;
        }
        tilesForBounds(bounds) {
            const x1 = Math.floor(bounds.left / TILE.SIZE_M);
            const y1 = Math.floor(bounds.bottom / TILE.SIZE_M);
            const x2 = Math.floor(bounds.right / TILE.SIZE_M);
            const y2 = Math.floor(bounds.top / TILE.SIZE_M);
            const keys = [];
            for (let ty = y1; ty <= y2; ty += 1) {
                for (let tx = x1; tx <= x2; tx += 1) {
                    keys.push(`${tx}_${ty}`);
                }
            }
            return keys;
        }
        bboxFromTiles(keys) {
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
        nowDays() {
            return Math.floor(Date.now() / 86400000);
        }
        getTileFromStore(key) {
            const m = memTiles.get(key);
            if (m)
                return m;
            if (!hasGM)
                return null;
            try {
                const raw = GM_getValue(TILE.NS + key, null);
                if (!raw)
                    return null;
                const obj = JSON.parse(raw);
                memTiles.set(key, obj);
                return obj;
            }
            catch {
                return null;
            }
        }
        putTileToStore(key, obj) {
            memTiles.set(key, obj);
            if (!hasGM)
                return;
            try {
                GM_setValue(TILE.NS + key, JSON.stringify(obj));
                const meta = this.loadMeta();
                this.touchLRU(meta, key);
                this.enforceLRU(meta);
                this.saveMeta(meta);
            }
            catch { }
        }
        loadMeta() {
            if (!hasGM)
                return { order: [] };
            try {
                const m = GM_getValue(TILE.META, null);
                return m ? JSON.parse(m) : { order: [] };
            }
            catch {
                return { order: [] };
            }
        }
        saveMeta(meta) {
            if (!hasGM)
                return;
            try {
                GM_setValue(TILE.META, JSON.stringify(meta));
            }
            catch { }
        }
        touchLRU(meta, key) {
            meta.order = (meta.order || []).filter((k) => k !== key);
            meta.order.push(key);
        }
        enforceLRU(meta) {
            while ((meta.order || []).length > TILE.MAX) {
                const victim = meta.order.shift();
                try {
                    GM_deleteValue(TILE.NS + victim);
                }
                catch { }
                memTiles.delete(victim);
            }
        }
        isFresh(tileObj) {
            return !!(tileObj && typeof tileObj.ts === 'number' && this.nowDays() - tileObj.ts <= TILE.TTL_DAYS);
        }
        clearCache() {
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
            }
            catch (e) {
                console.error('❌ clearCache error', e);
            }
        }
        async fetchAddressesByBoundingBox(left, bottom, right, top) {
            try {
                debug(`📍 Fetching addresses: bbox=[${left},${bottom},${right},${top}]`);
                const webMercatorBounds = {
                    left: this.lonToWebMercator(left),
                    bottom: this.latToWebMercator(bottom),
                    right: this.lonToWebMercator(right),
                    top: this.latToWebMercator(top)
                };
                debug(`📍 Converted bbox to Web Mercator: [${webMercatorBounds.left},${webMercatorBounds.bottom},${webMercatorBounds.right},${webMercatorBounds.top}]`);
                const neededKeys = this.tilesForBounds(webMercatorBounds);
                let allFresh = true;
                let assembled = [];
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
            }
            catch (error) {
                console.error("❌ Error fetching addresses:", error);
                return [];
            }
        }
        async fetchTilesFromNetwork(neededKeys) {
            return new Promise((resolve, reject) => {
                const body = this.bboxFromTiles(neededKeys);
                debug(`🔗 Requesting tiles:`, body);
                GM_xmlhttpRequest({
                    method: "POST",
                    url: this.baseUrl + this.apiPath,
                    data: JSON.stringify(body),
                    headers: { "Content-Type": "application/json" },
                    timeout: 10000,
                    onload: (response) => {
                        try {
                            if (response.status >= 200 && response.status < 300) {
                                let result;
                                try {
                                    result = JSON.parse(response.responseText || '[]');
                                }
                                catch (e) {
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
                                const buckets = new Map();
                                for (const r of result) {
                                    const x = r.lon;
                                    const y = r.lat;
                                    const key = this.tileKeyForXY(x, y);
                                    if (!buckets.has(key))
                                        buckets.set(key, []);
                                    buckets.get(key).push({
                                        lon: x,
                                        lat: y,
                                        strassenname: r.strassenname || r.sn || "",
                                        hausnummerzahl1: r.hausnummerzahl1 || r.hn || "",
                                        gemeinde: r.gemeinde || r.gn || ""
                                    });
                                }
                                const today = this.nowDays();
                                let assembled = [];
                                for (const k of neededKeys) {
                                    const items = buckets.get(k) || [];
                                    this.putTileToStore(k, { ts: today, items });
                                    assembled = assembled.concat(items);
                                }
                                debug(`✅ Loaded ${assembled.length} addresses from ${neededKeys.length} tiles`);
                                resolve(this.processRawAddresses(assembled));
                            }
                            else {
                                console.error(`❌ API Error Status ${response.status}: ${response.responseText}`);
                                reject(new Error(`API Error: ${response.status} - ${response.statusText}`));
                            }
                        }
                        catch (error) {
                            console.error(`❌ Parse error:`, error);
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
                });
            });
        }
        processRawAddresses(rawAddresses) {
            return rawAddresses.map((raw, index) => {
                const [longitude, latitude] = this.webMercatorToLonLat(raw.lon, raw.lat);
                return {
                    id: `addr-${Date.now()}-${index}`,
                    latitude,
                    longitude,
                    streetName: raw.strassenname || raw.sn || "",
                    houseNumber: raw.hausnummerzahl1 || raw.hn || "",
                    city: raw.gemeinde || raw.gn || "",
                    status: "gray",
                    markerId: undefined,
                };
            });
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
            debug("🔄 Fetching by segment IDs:", segmentIds);
            return [];
        }
    }
    const addressDataClient = new AddressDataClient();
    const clearAddressCache = () => addressDataClient.clearCache();

    class MapRenderer {
        wmeSDK = null;
        layerName = "Quick PP Importer";
        isLayerCreated = false;
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
                eventName: "wme-map-mouse-click",
                eventHandler: (clickEvent) => {
                    if (!appState.getImportState().isActive)
                        return;
                    if (appState.getImportState().isPaused)
                        return;
                    const clickLon = clickEvent.lon;
                    const clickLat = clickEvent.lat;
                    const cosLat = Math.cos(clickLat * Math.PI / 180);
                    const THRESHOLD_M = 40;
                    const addresses = appState.getAddresses();
                    let nearest = null;
                    let nearestDist = Infinity;
                    for (const addr of addresses) {
                        if (addr.status === 'lightGreen')
                            continue;
                        const dLat = (addr.latitude - clickLat) * 111000;
                        const dLon = (addr.longitude - clickLon) * 111000 * cosLat;
                        const dist = Math.hypot(dLat, dLon);
                        if (dist < nearestDist) {
                            nearestDist = dist;
                            nearest = addr;
                        }
                    }
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
                    if (!nearest || nearestDist > THRESHOLD_M)
                        return;
                    const address = nearest;
                    debug(`📌 Nearest address ${nearestDist.toFixed(0)}m away: ${address.streetName} ${address.houseNumber} — RPP at click pos`);
                    appState.selectAddress(address);
                    this.createPlacePoint(address, { lon: clickLon, lat: clickLat }).then(() => {
                        appState.markAddressProcessed(address.id);
                        this.refreshMarker(address.id);
                    });
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
            debug(`🎨 Rendering ${addresses.length} address markers`);
            try {
                this.wmeSDK.Map.removeAllFeaturesFromLayer({
                    layerName: this.layerName
                });
                if (addresses.length === 0) {
                    debug("📍 No addresses to render");
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
                debug(`📍 ${addresses.length} addresses rendered`);
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
                    return "#ABFA99";
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
        refreshMarker(addressId) {
            if (!this.wmeSDK || !this.isLayerCreated)
                return;
            const address = appState.getAddressById(addressId);
            if (!address)
                return;
            try {
                this.wmeSDK.Map.removeFeaturesFromLayer({
                    layerName: this.layerName,
                    featureIds: [addressId]
                });
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
            }
            catch (e) {
                this.renderAddresses(appState.getAddresses());
            }
        }
        async createPlacePoint(address, position) {
            try {
                const placeLon = position?.lon ?? address.longitude;
                const placeLat = position?.lat ?? address.latitude;
                debug(`🏠 Creating RPP: ${address.streetName} ${address.houseNumber}`, position ? `at (${placeLon.toFixed(6)}, ${placeLat.toFixed(6)})` : '');
                if (!this.wmeSDK) {
                    console.error('❌ WME SDK not initialized');
                    return;
                }
                const geometry = { type: 'Point', coordinates: [placeLon, placeLat] };
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
                    }
                    catch (lockErr) {
                        console.warn(`⚠️ Failed to set lock level for ${newPlaceId}:`, lockErr);
                    }
                }
                try {
                    this.wmeSDK.DataModel.Venues.replaceNavigationPoints({
                        venueId: newPlaceId,
                        navigationPoints: [{ isEntry: true, isPrimary: true, point: geometry }]
                    });
                    debug(`🔁 Navigation point set for venue ${newPlaceId}`);
                }
                catch (navErr) {
                    console.warn(`⚠️ Failed to set navigation points for ${newPlaceId}:`, navErr);
                }
                let streetFound = false;
                try {
                    let streetId = undefined;
                    const closestStreetId = this.findClosestSegmentStreetId(placeLon, placeLat, address.streetName);
                    if (closestStreetId != null) {
                        streetId = closestStreetId;
                        const allStreets = this.wmeSDK.DataModel.Streets.getAll();
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
                        });
                        debug(`📝 Address set for venue ${newPlaceId} (streetFound=${streetFound})`);
                    }
                }
                catch (addrErr) {
                    console.warn(`⚠️ Failed to update address for ${newPlaceId}:`, addrErr);
                }
                try {
                    this.wmeSDK.Editing.setSelection({ selection: { objectType: 'venue', ids: [newPlaceId] } });
                    debug(`🔎 Selected new venue ${newPlaceId}`);
                }
                catch (selErr) {
                    console.warn(`⚠️ Failed to select new venue ${newPlaceId}:`, selErr);
                }
                if (!streetFound) {
                    debug(`📋 Street not resolved for "${address.streetName}" — opening address editor`);
                    setTimeout(() => this.openAddressEditor(), 50);
                }
                else {
                    debug(`✅ Street resolved for "${address.streetName}" — address complete`);
                }
            }
            catch (error) {
                console.error(`❌ Error creating RPP:`, error);
            }
        }
        findClosestSegmentStreetId(lon, lat, streetName) {
            try {
                const segments = this.wmeSDK.DataModel.Segments?.getAll?.();
                if (!segments || segments.length === 0)
                    return null;
                let matchingStreetIds = null;
                if (streetName) {
                    const normalizedTarget = streetName.trim().toLowerCase();
                    const allStreets = this.wmeSDK.DataModel.Streets.getAll();
                    const matched = allStreets.filter(s => s.name?.trim().toLowerCase() === normalizedTarget);
                    if (matched.length > 0) {
                        matchingStreetIds = new Set(matched.map(s => s.id));
                    }
                }
                const getMatchAndDist = (seg) => {
                    const coords = seg.geometry?.coordinates;
                    if (!coords || coords.length < 2)
                        return null;
                    let minDist = Infinity;
                    for (let i = 0; i < coords.length - 1; i++) {
                        const d = this.distPointToSegment(lon, lat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
                        if (d < minDist)
                            minDist = d;
                    }
                    if (!matchingStreetIds) {
                        if (seg.primaryStreetId == null)
                            return null;
                        return { streetId: seg.primaryStreetId, dist: minDist };
                    }
                    if (seg.primaryStreetId != null && matchingStreetIds.has(seg.primaryStreetId)) {
                        return { streetId: seg.primaryStreetId, dist: minDist };
                    }
                    for (const altId of (seg.alternateStreetIds ?? [])) {
                        if (matchingStreetIds.has(altId)) {
                            return { streetId: altId, dist: minDist };
                        }
                    }
                    return null;
                };
                let bestStreetId = null;
                let bestDist = Infinity;
                if (matchingStreetIds) {
                    for (const seg of segments) {
                        const result = getMatchAndDist(seg);
                        if (result && result.dist < bestDist) {
                            bestDist = result.dist;
                            bestStreetId = result.streetId;
                        }
                    }
                }
                if (bestStreetId === null) {
                    console.warn(`⚠️ No segment found with street name "${streetName}" — falling back to closest segment`);
                    for (const seg of segments) {
                        if (seg.primaryStreetId == null)
                            continue;
                        const coords = seg.geometry?.coordinates;
                        if (!coords || coords.length < 2)
                            continue;
                        for (let i = 0; i < coords.length - 1; i++) {
                            const d = this.distPointToSegment(lon, lat, coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
                            if (d < bestDist) {
                                bestDist = d;
                                bestStreetId = seg.primaryStreetId;
                            }
                        }
                    }
                }
                return bestStreetId;
            }
            catch (e) {
                console.warn('⚠️ Segment street lookup failed:', e);
                return null;
            }
        }
        distPointToSegment(px, py, ax, ay, bx, by) {
            const dx = bx - ax;
            const dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0)
                return Math.hypot(px - ax, py - ay);
            const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
            return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        }
        async openAddressEditor(tries = 1) {
            const addressEditView = document.querySelector('.address-edit-view');
            if (addressEditView) {
                const fullAddress = addressEditView.querySelector('.full-address');
                fullAddress?.click();
                await this.sleep(150);
                const hnHost = document.querySelector('.house-number');
                const input = hnHost?.shadowRoot?.querySelector('#id');
                input?.focus();
                debug(`📋 Address editor opened (focus on house-number field)`);
            }
            else if (tries < 1000) {
                setTimeout(() => this.openAddressEditor(tries + 1), 200);
            }
        }
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
        getDesiredResidentialLockInfo() {
            if (!this.wmeSDK)
                return null;
            const userInfo = this.wmeSDK.State.getUserInfo();
            const userRank = userInfo?.rank;
            if (typeof userRank !== 'number' || Number.isNaN(userRank)) {
                return null;
            }
            const normalizedUserRank = Math.max(Math.trunc(userRank), 0);
            return {
                userRank: normalizedUserRank,
                lockRank: Math.min(normalizedUserRank, 3)
            };
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
        redrawLayer() {
            if (!this.wmeSDK)
                return;
            this.wmeSDK.Map.redrawLayer({ layerName: this.layerName });
        }
    }
    const mapRenderer = new MapRenderer();

    class SegmentSelector {
        wmeSDK = null;
        selectedSegments = [];
        selectedStreetNames = [];
        selectedHouseNumbers = [];
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
            debug(`📌 Selected segments: ${this.selectedSegments.length}, streets:`, this.selectedStreetNames);
            appState.setSelectedSegments(this.selectedSegments);
            await this.fetchSelectedHouseNumbers();
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
                debug(`📍 Loaded ${this.selectedHouseNumbers.length} existing house numbers for selected segments`);
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
                    debug("🔍 Segment geometry:", segment.geometry);
                    segment.geometry.coordinates.forEach((coord) => {
                        debug("🔍 Raw coordinate:", coord);
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
                            debug("🔍 Converted lat/lon:", lat, lon);
                            north = Math.max(north, lat);
                            south = Math.min(south, lat);
                            east = Math.max(east, lon);
                            west = Math.min(west, lon);
                        }
                    });
                }
            });
            debug("🔍 Calculated bounds:", { north, south, east, west });
            const padding = 0.005;
            return {
                north: north + padding,
                south: south - padding,
                east: east + padding,
                west: west - padding
            };
        }
        filterAndColorAddresses(addresses) {
            const existingRpps = new Set();
            try {
                const venues = this.wmeSDK.DataModel.Venues.getAll();
                for (const venue of venues) {
                    try {
                        const va = this.wmeSDK.DataModel.Venues.getAddress({ venueId: venue.id });
                        if (va?.street?.name && va?.houseNumber) {
                            existingRpps.add(`${va.street.name.trim().toLowerCase()}|${va.houseNumber.trim().toLowerCase()}`);
                        }
                    }
                    catch { }
                }
            }
            catch (e) {
                console.warn('⚠️ Could not read existing venues for duplicate check:', e);
            }
            return addresses.map(address => {
                const streetMatch = this.selectedStreetNames.some(selectedStreet => this.normalizeStreetName(address.streetName).includes(this.normalizeStreetName(selectedStreet)) ||
                    this.normalizeStreetName(selectedStreet).includes(this.normalizeStreetName(address.streetName)));
                let status = 'gray';
                if (streetMatch) {
                    const key = `${address.streetName.trim().toLowerCase()}|${address.houseNumber.trim().toLowerCase()}`;
                    status = existingRpps.has(key) ? 'lightGreen' : 'green';
                }
                else {
                    const similarMatch = this.selectedStreetNames.some(selectedStreet => this.calculateStreetSimilarity(address.streetName, selectedStreet) > 0.8);
                    if (similarMatch) {
                        status = 'lightGreen';
                    }
                }
                return { ...address, status };
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
        async loadAddressesForSelectedSegments() {
            await this.loadAddressesForSegments();
        }
        async loadAddressesManually() {
            await this.loadAddressesForSegments();
        }
        getSelectedSegments() {
            return this.selectedSegments;
        }
        hasSelectedSegments() {
            return this.selectedSegments.length > 0;
        }
        getSelectedStreetNames() {
            return this.selectedStreetNames;
        }
    }
    const segmentSelector = new SegmentSelector();

    const LS_KEY = 'WME_PP_LAST_SEEN_VERSION';
    const shortcutState = {
        toggleKey: 'P',
        resumeKey: 'O',
    };
    const UPDATE_NOTES = {
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
    async function initializeScript(wmeSDK) {
        console.log(`✅ WME Quick PP Importer: SDK v.${wmeSDK.getSDKVersion()} initialized`);
        appState.setWmeSDK(wmeSDK);
        try {
            await setupSidebarTab(wmeSDK);
            showUpdateNotification();
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
        const debugCheckbox = tabPane.querySelector("#qpi-debug");
        if (debugCheckbox) {
            debugCheckbox.addEventListener("change", (e) => {
                appState.setDebugMode(e.target.checked);
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
            const cb = tabPane.querySelector("#qpi-enable");
            if (cb)
                cb.checked = true;
        });
        appState.on("importDeactivated", () => {
            const statusEl = tabPane.querySelector("#qpi-status");
            if (statusEl)
                statusEl.textContent = "Status: Bereit";
            const cb = tabPane.querySelector("#qpi-enable");
            if (cb)
                cb.checked = false;
        });
        appState.on("importPaused", () => {
            const statusEl = tabPane.querySelector("#qpi-status");
            if (statusEl)
                statusEl.textContent = `Status: ⏸️ Pausiert (${formatShortcutKey(shortcutState.resumeKey)} = Fortsetzen)`;
        });
        appState.on("importResumed", () => {
            const statusEl = tabPane.querySelector("#qpi-status");
            if (statusEl)
                statusEl.textContent = "Status: 🟢 Aktiv";
        });
        updateShortcutUi();
    }
    function showUpdateNotification() {
        const currentVersion = GM_info.script.version;
        const lastSeen = localStorage.getItem(LS_KEY);
        if (lastSeen === currentVersion)
            return;
        const notes = UPDATE_NOTES[currentVersion];
        if (!notes || notes.length === 0)
            return;
        const tabPane = document.querySelector('#qpi-sidebar-root');
        if (!tabPane)
            return;
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
    function setupMapLayer(wmeSDK) {
        console.log("✅ Map layer setup delegated to mapRenderer");
    }
    function setMapCursor(wmeSDK, cursor) {
        try {
            const viewport = wmeSDK.Map.getMapViewportElement();
            viewport.style.cursor = cursor;
        }
        catch (e) {
            const viewport = document.querySelector('.olMapViewport');
            if (viewport)
                viewport.style.cursor = cursor;
        }
    }
    function keyCodeToLabel(code) {
        if (Number.isNaN(code))
            return '';
        if (code >= 65 && code <= 90)
            return String.fromCharCode(code);
        if (code >= 48 && code <= 57)
            return String.fromCharCode(code);
        const special = {
            13: 'Enter',
            27: 'Esc',
            32: 'Space'
        };
        return special[code] ?? String(code);
    }
    function decodeCompactShortcut(shortcutKey) {
        const match = shortcutKey.match(/^(\d+)[\.,](\d+)$/);
        if (!match)
            return null;
        const modifierMask = Number(match[1]);
        const keyCode = Number(match[2]);
        if (!Number.isFinite(modifierMask) || !Number.isFinite(keyCode))
            return null;
        const modifiers = [];
        if (modifierMask & 2)
            modifiers.push('Ctrl');
        if (modifierMask & 1)
            modifiers.push('Alt');
        if (modifierMask & 4)
            modifiers.push('Shift');
        return { modifiers, keyCode };
    }
    function formatShortcutKey(shortcutKey) {
        if (shortcutKey === null)
            return 'nicht gesetzt';
        const compact = decodeCompactShortcut(shortcutKey);
        if (compact) {
            const keyLabel = keyCodeToLabel(compact.keyCode);
            return compact.modifiers.length ? `${compact.modifiers.join('+')}+${keyLabel}` : keyLabel;
        }
        const parts = shortcutKey.split('+').filter(Boolean);
        if (!parts.length)
            return shortcutKey;
        const keyPart = parts.pop();
        const modifierPart = parts.join('');
        const modifierLabels = [];
        if (modifierPart.includes('C'))
            modifierLabels.push('Ctrl');
        if (modifierPart.includes('A'))
            modifierLabels.push('Alt');
        if (modifierPart.includes('S'))
            modifierLabels.push('Shift');
        const parsedCode = Number(keyPart);
        const keyLabel = Number.isFinite(parsedCode)
            ? keyCodeToLabel(parsedCode)
            : keyPart.toUpperCase();
        return modifierLabels.length ? `${modifierLabels.join('+')}+${keyLabel}` : keyLabel;
    }
    function updateShortcutUi() {
        const toggleHint = document.querySelector('#qpi-toggle-hint');
        if (toggleHint) {
            toggleHint.innerHTML = `2. <strong>${formatShortcutKey(shortcutState.toggleKey)}</strong> → Adressen laden + Import starten`;
        }
        const shortcutSummary = document.querySelector('#qpi-shortcut-summary');
        if (shortcutSummary) {
            shortcutSummary.innerHTML = `<strong>Esc</strong> = Pausieren &nbsp;|&nbsp; <strong>${formatShortcutKey(shortcutState.resumeKey)}</strong> = Fortsetzen &nbsp;|&nbsp; <strong>${formatShortcutKey(shortcutState.toggleKey)}</strong> = Stoppen`;
        }
        const shortcutConfigHint = document.querySelector('#qpi-shortcut-config-hint');
        if (!shortcutConfigHint)
            return;
        const missingKeys = [shortcutState.toggleKey, shortcutState.resumeKey].some(key => key === null);
        shortcutConfigHint.textContent = missingKeys
            ? 'Belegte Shortcuts wurden ohne Taste registriert und können im WME-Shortcut-Menü frei zugewiesen werden.'
            : 'Shortcuts können im WME-Shortcut-Menü angepasst werden.';
        const statusEl = document.querySelector('#qpi-status');
        if (statusEl && appState.getImportState().isPaused) {
            statusEl.textContent = `Status: ⏸️ Pausiert (${formatShortcutKey(shortcutState.resumeKey)} = Fortsetzen)`;
        }
    }
    function isTypingTarget(target) {
        const element = target;
        if (!element)
            return false;
        const tagName = element.tagName?.toUpperCase();
        if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT')
            return true;
        if (element.isContentEditable)
            return true;
        const role = (element.getAttribute?.('role') || '').toLowerCase();
        return role === 'textbox' || role === 'searchbox' || role === 'combobox';
    }
    async function toggleImportMode() {
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
    function resumeImportMode(wmeSDK) {
        const state = appState.getImportState();
        if (state.isActive && state.isPaused) {
            debug("▶️  Fortgesetzt");
            appState.togglePause();
            setMapCursor(wmeSDK, 'crosshair');
        }
    }
    function registerShortcut(wmeSDK, shortcutId, shortcutKeys, description, callback) {
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
        }
        catch (error) {
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
    function syncShortcutStateFromSdk(wmeSDK) {
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
    function startShortcutStateSync(wmeSDK) {
        const sync = () => syncShortcutStateFromSdk(wmeSDK);
        sync();
        window.addEventListener('focus', sync);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden)
                sync();
        });
        window.setInterval(sync, 1000);
    }
    function setupEventListeners(wmeSDK) {
        shortcutState.toggleKey = registerShortcut(wmeSDK, 'qpi-toggle', 'P', 'Import starten (Segment auswählen, dann P drücken) / Stoppen', () => toggleImportMode());
        shortcutState.resumeKey = registerShortcut(wmeSDK, 'qpi-resume', 'O', 'Import fortsetzen (nach Pause)', () => resumeImportMode(wmeSDK));
        updateShortcutUi();
        startShortcutStateSync(wmeSDK);
        appState.on('importActivated', () => setMapCursor(wmeSDK, 'crosshair'));
        appState.on('importDeactivated', () => setMapCursor(wmeSDK, ''));
        appState.on('importPaused', () => setMapCursor(wmeSDK, ''));
        appState.on('importResumed', () => setMapCursor(wmeSDK, 'crosshair'));
        document.addEventListener('keydown', (e) => {
            if (isTypingTarget(e.target))
                return;
            if (e.key !== 'Escape')
                return;
            const state = appState.getImportState();
            if (!state.isActive)
                return;
            if (state.isPaused)
                return;
            debug("⏸️  Import Mode: PAUSIERT (Esc) — O zum Fortsetzen");
            appState.togglePause();
        });
        console.log("✅ SDK Shortcuts registered");
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
            const pageWindow = window.unsafeWindow || window;
            pageWindow.testQuickPP = {
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
        }
        catch (error) {
            console.error("❌ Script initialization failed:", error);
        }
    }).catch((error) => {
        console.error("❌ Script initialization promise rejected:", error);
        console.error("Stack:", error instanceof Error ? error.stack : "no stack");
    });

})();
