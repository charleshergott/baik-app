import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Position, SavedRoute, Waypoint } from '../interfaces/master';
import { environment } from '../environments/environment.prod';

@Injectable({
  providedIn: 'root'
})
export class GpsService {

  private currentPosition$ = new BehaviorSubject<Position | null>(null);
  private routeCoordinates$ = new BehaviorSubject<[number, number][]>([]);

  private isTracking = false;
  private watchId: number | null = null;

  isGPSEnabled = false;
  private lastPosition: Position | null = null;
  private lastPositionTime = 0;
  currentSpeed = 0; // in knots

  // Enhanced filtering parameters
  private SPEED_HISTORY_LENGTH = 5;
  private speedHistory: number[] = [];
  MIN_SPEED_THRESHOLD = 5; // Minimum speed in km/h to consider as "moving"
  private MAX_ACCURACY_THRESHOLD = 20; // meters - ignore readings worse than this
  private STATIONARY_ACCURACY_MULTIPLIER = 2; // Use 2x accuracy as stationary radius
  private MAX_REALISTIC_SPEED_KMH = 80; // Maximum realistic speed for a bike in km/h
  private MAX_ACCELERATION_MS2 = 5; // Maximum realistic acceleration in m/s² (bikes ~3-5)

  // Kalman filter variables for position smoothing
  private kalmanLat: number | null = null;
  private kalmanLon: number | null = null;
  private kalmanVariance = 1000; // Initial high uncertainty
  private PROCESS_NOISE = 0.5;

  // GPS warm-up parameters
  private gpsWarmupStartTime: number = 0;
  private readonly GPS_WARMUP_DURATION = 5000; // 5 seconds warmup period
  private readonly MIN_READINGS_FOR_MOVEMENT = 3; // Need 3 consistent readings to confirm movement
  private movementReadingsCount = 0;
  private isFirstReading = true;
  private hasBeenMoving = false;

  // Route tracking properties
  private routeCoordinates: [number, number][] = [];
  private isRecordingRoute = false;
  private routeStartTime: number = 0;
  private routeDistance: number = 0;
  private routeMaxSpeed: number = 0;
  private MIN_DISTANCE_BETWEEN_POINTS = 5; // meters

  // IndexedDB
  private db: IDBDatabase | null = null;
  private dbInitialized: Promise<void>;
  private readonly DB_NAME = 'BikeRoutesDB';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'routes';
  private isDevelopmentMode = environment.enableMockGPS;

  // GPS Quality tracking
  currentAccuracy: number = 0;
  gpsQuality$ = new BehaviorSubject<'excellent' | 'good' | 'fair' | 'poor'>('poor');

  constructor() {
    console.log(`🔧 GPS Service: ${this.isDevelopmentMode ? 'MOCK MODE' : 'REAL MODE'}`);
    this.dbInitialized = this.initIndexedDB();
  }

  // ... [Keep all your IndexedDB methods unchanged] ...

  private async initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onerror = () => {
        console.error('❌ IndexedDB failed to open');
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB initialized');
        resolve();
      };
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const objectStore = db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id'
          });
          objectStore.createIndex('createdAt', 'createdAt', { unique: false });
          objectStore.createIndex('lastUsed', 'lastUsed', { unique: false });
          console.log('📦 IndexedDB object store created');
        }
      };
    });
  }

  async ensureDbReady(): Promise<void> {
    await this.dbInitialized;
  }

  getCurrentPosition(): Observable<Position | null> {
    return this.currentPosition$.asObservable();
  }

  getRouteCoordinates(): Observable<[number, number][]> {
    return this.routeCoordinates$.asObservable();
  }

  getCurrentRoute(): [number, number][] {
    return [...this.routeCoordinates];
  }

  getGpsQuality(): Observable<'excellent' | 'good' | 'fair' | 'poor'> {
    return this.gpsQuality$.asObservable();
  }

  startRouteRecording(): void {
    this.isRecordingRoute = true;
    this.routeStartTime = Date.now();
    this.routeDistance = 0;
    this.routeMaxSpeed = 0;
    console.log('📍 Route recording started');
  }

  stopRouteRecording(): void {
    this.isRecordingRoute = false;
    console.log('📍 Route recording stopped');
  }

  clearRoute(): void {
    this.routeCoordinates = [];
    this.routeCoordinates$.next([]);
    this.routeDistance = 0;
    this.routeMaxSpeed = 0;
    console.log('📍 Route cleared');
  }

  isRecording(): boolean {
    return this.isRecordingRoute;
  }

  getRouteStats() {
    return {
      distance: this.routeDistance,
      maxSpeed: this.routeMaxSpeed,
      duration: this.routeStartTime ? (Date.now() - this.routeStartTime) / 1000 : 0
    };
  }

  async startTracking(): Promise<void> {
    if (this.isTracking) return;

    try {
      // Check if geolocation is available
      if (!('geolocation' in navigator)) {
        throw new Error('Geolocation is not supported by this browser');
      }

      await this.startGPS();
      this.isTracking = true;
      console.log('✅ GPS tracking started');
    } catch (error) {
      console.error('❌ Failed to start GPS tracking:', error);
      throw error;
    }
  }

  async stopTracking(): Promise<void> {
    if (!this.isTracking) return;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.isTracking = false;
    this.resetFilters();
    console.log('🛑 GPS tracking stopped');
  }

  private async startGPS(): Promise<void> {
    console.log('📡 Starting GPS - waiting for first lock...');

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 1000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.processGPSPosition(position);
      },
      (error) => {
        console.error('GPS Error:', error);
      },
      options
    );
  }

  private processGPSPosition(position: GeolocationPosition): void {
    const accuracy = position.coords.accuracy;
    this.currentAccuracy = accuracy;

    // Update GPS quality indicator
    this.updateGPSQuality(accuracy);

    // Filter 0a: Very first reading - just establish baseline, don't calculate anything
    if (this.isFirstReading) {
      console.log('🎯 First GPS lock acquired - establishing baseline position');
      const rawLat = position.coords.latitude;
      const rawLon = position.coords.longitude;

      // Initialize Kalman filter with first position
      this.kalmanLat = rawLat;
      this.kalmanLon = rawLon;
      this.kalmanVariance = accuracy * accuracy;

      // Set baseline position
      this.lastPosition = {
        latitude: rawLat,
        longitude: rawLon,
        timestamp: position.timestamp,
        accuracy: accuracy
      };
      this.lastPositionTime = position.timestamp;

      // Start warmup timer from first lock
      this.gpsWarmupStartTime = Date.now();

      this.isFirstReading = false;
      return; // Exit without any calculations
    }

    // Filter 0b: GPS Warmup - ignore readings during warmup period
    const warmupElapsed = Date.now() - this.gpsWarmupStartTime;
    if (warmupElapsed < this.GPS_WARMUP_DURATION) {
      console.log(`🔄 GPS warming up... ${((this.GPS_WARMUP_DURATION - warmupElapsed) / 1000).toFixed(1)}s remaining`);

      // Update baseline position during warmup but don't calculate speed
      const rawLat = position.coords.latitude;
      const rawLon = position.coords.longitude;
      this.applyKalmanFilter(rawLat, rawLon, accuracy);

      this.lastPosition = {
        latitude: this.kalmanLat!,
        longitude: this.kalmanLon!,
        timestamp: position.timestamp,
        accuracy: accuracy
      };
      this.lastPositionTime = position.timestamp;
      return;
    }

    // Filter 1: Reject readings with poor accuracy
    if (accuracy > this.MAX_ACCURACY_THRESHOLD) {
      console.log(`⚠️ GPS reading rejected - poor accuracy: ${accuracy.toFixed(1)}m`);
      return;
    }

    const rawLat = position.coords.latitude;
    const rawLon = position.coords.longitude;
    const timestamp = position.timestamp;

    // Filter 2: Apply Kalman filter for position smoothing
    const filtered = this.applyKalmanFilter(rawLat, rawLon, accuracy);

    // Calculate speed
    const calculatedSpeed = this.calculateSpeed(
      filtered.lat,
      filtered.lon,
      timestamp
    );

    // Filter 3: Check if actually moving (considering accuracy)
    const isMoving = this.detectMovement(calculatedSpeed, accuracy);

    // Filter 4: Require consecutive movement readings to confirm initial movement
    if (isMoving) {
      this.movementReadingsCount++;
    } else {
      // If we've been moving and now stopped, be more lenient (allow 2 stopped readings)
      if (this.hasBeenMoving && this.movementReadingsCount > 0) {
        this.movementReadingsCount--;
      } else {
        this.movementReadingsCount = 0;
        this.hasBeenMoving = false;
      }
      calculatedSpeed.speedKmh = 0;
      calculatedSpeed.speedKnots = 0;
    }

    // Only consider as truly moving if we have enough consecutive readings
    const confirmedMovement = this.movementReadingsCount >= this.MIN_READINGS_FOR_MOVEMENT;

    // Once we've confirmed movement, remember it (for hysteresis)
    if (confirmedMovement && !this.hasBeenMoving) {
      this.hasBeenMoving = true;
      console.log('🚀 Movement confirmed! Speed tracking active.');
    }

    if (!confirmedMovement) {
      calculatedSpeed.speedKmh = 0;
      calculatedSpeed.speedKnots = 0;
    }

    // Filter 5: Smooth speed with moving average
    const smoothedSpeed = this.smoothSpeed(calculatedSpeed.speedKnots);
    this.currentSpeed = smoothedSpeed;

    // Create position object
    const pos: Position = {
      latitude: filtered.lat,
      longitude: filtered.lon,
      heading: position.coords.heading || undefined,
      speed: smoothedSpeed * 0.514444, // Convert knots to m/s for standard format
      timestamp: timestamp,
      accuracy: accuracy
    };

    this.currentPosition$.next(pos);

    // Add to route if recording and actually moving with confirmation
    if (confirmedMovement) {
      this.addPointToRoute(pos.latitude, pos.longitude);
    }

    // Update last position for next calculation
    this.lastPosition = pos;
    this.lastPositionTime = timestamp;

    console.log(`📍 GPS: Lat ${filtered.lat.toFixed(6)}, Lon ${filtered.lon.toFixed(6)}, ` +
      `Speed: ${smoothedSpeed.toFixed(1)}kn (${(smoothedSpeed * 1.852).toFixed(1)}km/h), ` +
      `Acc: ${accuracy.toFixed(1)}m, Moving: ${confirmedMovement ? 'YES' : 'NO'} ` +
      `(${this.movementReadingsCount}/${this.MIN_READINGS_FOR_MOVEMENT})`);
  }

  private applyKalmanFilter(lat: number, lon: number, accuracy: number): { lat: number, lon: number } {
    // Initialize Kalman filter on first reading
    if (this.kalmanLat === null || this.kalmanLon === null) {
      this.kalmanLat = lat;
      this.kalmanLon = lon;
      this.kalmanVariance = accuracy * accuracy;
      return { lat, lon };
    }

    // Kalman filter update
    const measurementVariance = accuracy * accuracy;

    // Prediction step (we assume constant position, so prediction = last estimate)
    const predictedVariance = this.kalmanVariance + this.PROCESS_NOISE;

    // Update step
    const kalmanGain = predictedVariance / (predictedVariance + measurementVariance);

    this.kalmanLat = this.kalmanLat + kalmanGain * (lat - this.kalmanLat);
    this.kalmanLon = this.kalmanLon + kalmanGain * (lon - this.kalmanLon);
    this.kalmanVariance = (1 - kalmanGain) * predictedVariance;

    return {
      lat: this.kalmanLat,
      lon: this.kalmanLon
    };
  }

  private calculateSpeed(lat: number, lon: number, timestamp: number): { speedKmh: number, speedKnots: number } {
    if (!this.lastPosition || !this.lastPositionTime) {
      return { speedKmh: 0, speedKnots: 0 };
    }

    const timeDiff = (timestamp - this.lastPositionTime) / 1000; // seconds

    if (timeDiff <= 0 || timeDiff > 5) {
      // Too quick or too long between updates
      return { speedKmh: 0, speedKnots: 0 };
    }

    const distance = this.calculateDistance(
      this.lastPosition.latitude,
      this.lastPosition.longitude,
      lat,
      lon
    );

    const speedMs = distance / timeDiff; // meters per second
    const speedKmh = speedMs * 3.6; // km/h
    const speedKnots = speedMs * 1.94384; // knots

    // Filter 5: Check for unrealistic speeds
    if (speedKmh > this.MAX_REALISTIC_SPEED_KMH) {
      console.log(`⚠️ Speed spike detected and rejected: ${speedKmh.toFixed(1)} km/h`);
      return { speedKmh: 0, speedKnots: 0 };
    }

    // Filter 6: Check for unrealistic acceleration
    if (this.currentSpeed > 0) {
      const lastSpeedMs = this.currentSpeed * 0.514444; // Convert knots to m/s
      const acceleration = Math.abs(speedMs - lastSpeedMs) / timeDiff;

      if (acceleration > this.MAX_ACCELERATION_MS2) {
        console.log(`⚠️ Acceleration spike detected and rejected: ${acceleration.toFixed(1)} m/s²`);
        return { speedKmh: 0, speedKnots: 0 };
      }
    }

    return { speedKmh, speedKnots };
  }

  private detectMovement(speed: { speedKmh: number, speedKnots: number }, accuracy: number): boolean {
    // If accuracy is poor, we need higher speed to confirm movement
    const effectiveThreshold = Math.max(
      this.MIN_SPEED_THRESHOLD,
      accuracy * this.STATIONARY_ACCURACY_MULTIPLIER / 2
    );

    // Use hysteresis: lower threshold to stay moving once we've started
    const thresholdToUse = this.hasBeenMoving
      ? effectiveThreshold * 0.7  // 30% lower to maintain "moving" state
      : effectiveThreshold;        // Full threshold to enter "moving" state

    return speed.speedKmh > thresholdToUse;
  }

  private smoothSpeed(speedKnots: number): number {
    // Add to history
    this.speedHistory.push(speedKnots);

    // Keep only recent history
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    // Calculate moving average
    const sum = this.speedHistory.reduce((a, b) => a + b, 0);
    return sum / this.speedHistory.length;
  }

  private updateGPSQuality(accuracy: number): void {
    let quality: 'excellent' | 'good' | 'fair' | 'poor';

    if (accuracy < 5) {
      quality = 'excellent';
    } else if (accuracy < 10) {
      quality = 'good';
    } else if (accuracy < 20) {
      quality = 'fair';
    } else {
      quality = 'poor';
    }

    this.gpsQuality$.next(quality);
  }

  private resetFilters(): void {
    this.kalmanLat = null;
    this.kalmanLon = null;
    this.kalmanVariance = 1000;
    this.speedHistory = [];
    this.lastPosition = null;
    this.lastPositionTime = 0;
    this.currentSpeed = 0;
    this.gpsWarmupStartTime = 0;
    this.movementReadingsCount = 0;
    this.isFirstReading = true; // Reset for next GPS start
    this.hasBeenMoving = false; // Reset movement state
  }

  private addPointToRoute(latitude: number, longitude: number): void {
    if (!this.isRecordingRoute) return;

    // Check if we should add this point
    if (this.routeCoordinates.length > 0) {
      const lastPoint = this.routeCoordinates[this.routeCoordinates.length - 1];
      const distance = this.calculateDistance(
        lastPoint[0], lastPoint[1],
        latitude, longitude
      );

      // Only add point if it's far enough from the last one
      if (distance < this.MIN_DISTANCE_BETWEEN_POINTS) {
        return;
      }

      // Update total route distance
      this.routeDistance += distance;

      // Update max speed (only if it's realistic)
      if (this.currentSpeed > this.routeMaxSpeed && this.currentSpeed * 1.852 <= this.MAX_REALISTIC_SPEED_KMH) {
        this.routeMaxSpeed = this.currentSpeed;
        console.log(`🏆 New max speed: ${this.currentSpeed.toFixed(1)} kn (${(this.currentSpeed * 1.852).toFixed(1)} km/h)`);
      }
    }

    this.routeCoordinates.push([latitude, longitude]);
    this.routeCoordinates$.next([...this.routeCoordinates]);
    console.log(`📍 Route point added. Total points: ${this.routeCoordinates.length}, Distance: ${(this.routeDistance / 1000).toFixed(2)} km`);
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  getMinSpeedThreshold(): number {
    return this.MIN_SPEED_THRESHOLD;
  }

  getMaxRealisticSpeed(): number {
    return this.MAX_REALISTIC_SPEED_KMH;
  }

  // Allow runtime configuration
  setMaxRealisticSpeed(speedKmh: number): void {
    this.MAX_REALISTIC_SPEED_KMH = speedKmh;
    console.log(`🎯 Max realistic speed set to ${speedKmh} km/h`);
  }

  setMinSpeedThreshold(speedKmh: number): void {
    this.MIN_SPEED_THRESHOLD = speedKmh;
    console.log(`🎯 Min speed threshold set to ${speedKmh} km/h`);
  }

  // Check if GPS is still warming up
  isGpsWarmingUp(): boolean {
    return (Date.now() - this.gpsWarmupStartTime) < this.GPS_WARMUP_DURATION;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // Keep all your saveRoute, getAllRoutes, getRoute, updateRouteLastUsed, 
  // deleteRoute, loadRouteToMap methods exactly as they are...
  async saveCurrentRoute(name?: string, description?: string): Promise<string> {
    if (this.routeCoordinates.length === 0) {
      throw new Error('No route to save');
    }

    const endTime = Date.now();
    const duration = (endTime - this.routeStartTime) / 1000;
    const averageSpeed = duration > 0 ? (this.routeDistance / duration) * 3600 / 1852 : 0;

    const waypoints: Waypoint[] = this.routeCoordinates.map((coord, index) => ({
      id: this.generateId(),
      name: `Point ${index + 1}`,
      latitude: coord[0],
      longitude: coord[1],
      altitudeQNH: 0,
      speedKnots: 0,
      estimatedArrival: '',
      routingDegrees: 0,
      frequency: ''
    }));

    const route: SavedRoute = {
      id: this.generateId(),
      name: name || `Ride ${new Date(this.routeStartTime).toLocaleString()}`,
      waypoints: waypoints,
      coordinates: [...this.routeCoordinates],
      distance: this.routeDistance,
      duration: duration,
      maxSpeed: this.routeMaxSpeed,
      averageSpeed: averageSpeed,
      startTime: this.routeStartTime,
      endTime: endTime,
      createdAt: new Date(this.routeStartTime).toISOString(),
      lastUsed: new Date(endTime).toISOString(),
      description: description || `Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Duration: ${Math.floor(duration / 60)}min, Max Speed: ${this.routeMaxSpeed.toFixed(1)}kmh, Avg Speed: ${averageSpeed.toFixed(1)}kmh`
    };

    await this.saveRoute(route);
    return route.id;
  }

  private async saveRoute(route: SavedRoute): Promise<void> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.put(route);
      request.onsuccess = () => {
        console.log('💾 Route saved with ID:', route.id);
        resolve();
      };
      request.onerror = () => {
        console.error('❌ Failed to save route:', request.error);
        reject(request.error);
      };
    });
  }

  async getAllRoutes(): Promise<SavedRoute[]> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.getAll();
      request.onsuccess = () => {
        const routes = request.result as SavedRoute[];
        routes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        resolve(routes);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async getRoute(id: string): Promise<SavedRoute | null> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.get(id);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async updateRouteLastUsed(id: string): Promise<void> {
    await this.dbInitialized;
    const route = await this.getRoute(id);
    if (route) {
      route.lastUsed = new Date().toISOString();
      await this.saveRoute(route);
    }
  }

  async deleteRoute(id: string): Promise<void> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.delete(id);
      request.onsuccess = () => {
        console.log('🗑️ Route deleted:', id);
        resolve();
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  loadRouteToMap(route: SavedRoute): void {
    this.routeCoordinates = route.waypoints.map(wp => [wp.latitude, wp.longitude] as [number, number]);
    this.routeCoordinates$.next(this.routeCoordinates);
    this.updateRouteLastUsed(route.id);
    console.log('📍 Route loaded to map');
  }

  disableGPSSpeedMonitoring(): void {
    this.isGPSEnabled = false;
    this.resetFilters();
    console.log('GPS speed monitoring disabled');
  }
}