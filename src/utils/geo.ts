/**
 * Utility-Funktionen für Geo-Berechnung
 */

/**
 * Haversine-Formel: Entfernung zwischen zwei Koordinaten berechnen
 * @param lat1 Breite 1
 * @param lon1 Länge 1
 * @param lat2 Breite 2
 * @param lon2 Länge 2
 * @returns Entfernung in Metern
 */
export function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371000; // Erdradius in Metern
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Nächste Adresse aus einer Liste finden
 * @param latitude Bezugspunkt
 * @param longitude Bezugspunkt
 * @param addresses Liste von Adressen
 * @returns { address, distanceMeters } oder null
 */
export function findNearestAddress(
    latitude: number,
    longitude: number,
    addresses: Array<{ latitude: number; longitude: number }>
): { address: any; distanceMeters: number } | null {
    if (!addresses || addresses.length === 0) {
        return null;
    }

    let nearest = addresses[0];
    let minDistance = calculateDistance(
        latitude,
        longitude,
        nearest.latitude,
        nearest.longitude
    );

    for (let i = 1; i < addresses.length; i++) {
        const distance = calculateDistance(
            latitude,
            longitude,
            addresses[i].latitude,
            addresses[i].longitude
        );
        if (distance < minDistance) {
            nearest = addresses[i];
            minDistance = distance;
        }
    }

    return { address: nearest, distanceMeters: minDistance };
}

/**
 * Koordinaten validieren
 */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
    return (
        isFinite(latitude) &&
        isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    );
}

/**
 * Throttle-Funktion für Performance
 */
export function throttle<T extends (...args: any[]) => any>(
    func: T,
    delayMs: number
): T {
    let lastCall = 0;
    let timeout: ReturnType<typeof setTimeout>;

    return ((...args: any[]) => {
        const now = Date.now();
        const diff = now - lastCall;

        if (diff >= delayMs) {
            lastCall = now;
            func(...args);
        } else {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                lastCall = Date.now();
                func(...args);
            }, delayMs - diff);
        }
    }) as T;
}
