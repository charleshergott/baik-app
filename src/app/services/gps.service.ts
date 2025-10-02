import { Injectable } from '@angular/core';
import { BehaviorSubject, filter, Observable, Subscription } from 'rxjs';
import { Position, SavedRoute, Waypoint } from '../interfaces/master';
import { environment } from '../environments/environment.prod';
import { OdometerService } from './odometer.service';
import * as geolib from 'geolib';

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
  currentSpeed = 0; // in km/h
  private tripDistance$ = new BehaviorSubject<number>(0);
  private totalDistance$ = new BehaviorSubject<number>(0);
  private maxSpeed$ = new BehaviorSubject<number>(0);
  private averageSpeed$ = new BehaviorSubject<number>(0);
  private speedHistory: number[] = [];
  private tripDistance = 0;
  private totalDistance = 0;
  private maxSpeed = 0;
  private SPEED_HISTORY_LENGTH = 5;
  private movingTime = 0;
  private totalTime = 0;
  private tripStartTime: number | null = null;
  // Enhanced filtering parameters

  MIN_SPEED_THRESHOLD = 5; // Minimum speed in km/h to consider as "moving"
  private MAX_ACCURACY_THRESHOLD = 20; // meters - ignore readings worse than this
  private MAX_REALISTIC_SPEED_KMH = 80; // Maximum realistic speed for a bike in km/h


  // GPS initialization
  private isFirstReading = true; // Flag to ignore very first GPS lock

  // Kalman filter variables for position smoothing
  private kalmanLat: number | null = null;
  private kalmanLon: number | null = null;
  private kalmanVariance = 1000; // Initial high uncertainty
  private PROCESS_NOISE = 0.5;

  // Route tracking properties
  private routeCoordinates: [number, number][] = [];
  private isRecordingRoute = false;
  private routeStartTime: number = 0;
  private routeDistance: number = 0;
  private routeMaxSpeed: number = 0;
  private routeMovingTime: number = 0; // Cumulative moving time in seconds
  private lastMovingTimestamp: number = 0; // Last time we were moving
  private stationaryCount: number = 0; // Count consecutive stationary readings
  private readonly STATIONARY_THRESHOLD = 3; // 3 consecutive readings before pausing timer
  private isCurrentlyMoving: boolean = false;
  private readonly MIN_DISTANCE_BETWEEN_POINTS = 5; // meters
  private lastUpdateTime: number | null = null;
  // IndexedDB
  private db: IDBDatabase | null = null;
  private dbInitialized: Promise<void>;
  private readonly DB_NAME = 'BikeRoutesDB';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'routes';
  private isDevelopmentMode = environment.enableMockGPS;
  private positionSubscription?: Subscription;

  // GPS Quality tracking
  currentAccuracy: number = 0;
  gpsQuality$ = new BehaviorSubject<'excellent' | 'good' | 'fair' | 'poor'>('poor');

  constructor(
    private _odometerService: OdometerService
  ) {
    console.log(`🔧 GPS Service: ${this.isDevelopmentMode ? 'MOCK MODE' : 'REAL MODE'}`);
    this.dbInitialized = this.initIndexedDB();
    this.initializeTracking();
  }

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

  /**
  * Initialize tracking - use GPS service's filtered data
  */
  private initializeTracking(): void {
    this.positionSubscription = this.getCurrentPosition().pipe(
      filter(position => position !== null)
    ).subscribe(currPos => {
      if (this.isTracking && currPos) {
        this.processPositionUpdate(currPos);
      }
    });
  }

  private processPositionUpdate(currPos: Position): void {
    const currentTime = Date.now();

    // Get the already-filtered speed from GPS service (in km/h)
    const speedKmh = this.currentSpeed;

    // Update speed directly from GPS service (already filtered and smoothed)
    this._odometerService.updateSpeed(speedKmh);

    // Calculate distance if we have a previous position
    if (this.lastPosition && this.lastUpdateTime) {
      const timeDiff = (currentTime - this.lastUpdateTime) / 1000; // seconds

      if (timeDiff > 0 && timeDiff <= 10) {
        // Calculate distance using Geolib
        const distance = geolib.getDistance(
          { latitude: this.lastPosition.latitude, longitude: this.lastPosition.longitude },
          { latitude: currPos.latitude, longitude: currPos.longitude },
          1 // 1 meter accuracy
        );

        // Update distance tracking
        this.updateDistance(distance);

        // Update time tracking
        this.updateTimeTracking(timeDiff, speedKmh);

        // Update average speed
        this._odometerService.updateAverageSpeed();
      }
    }

    this.lastPosition = currPos;
    this.lastUpdateTime = currentTime;
  }

  private updateTimeTracking(timeDiff: number, speed: number): void {
    this.totalTime += timeDiff;

    if (speed >= this.MIN_SPEED_THRESHOLD) {
      this.movingTime += timeDiff;
    }
  }

  private updateDistance(distance: number): void {
    // Only count distance if moving above threshold
    if (this.currentSpeed >= this.MIN_SPEED_THRESHOLD) {
      this.tripDistance += distance;
      this.totalDistance += distance;

      this.tripDistance$.next(this.tripDistance);
      this.totalDistance$.next(this.totalDistance);

      console.log(`📏 Distance: ${(this.tripDistance / 1000).toFixed(2)} km, Speed: ${this.currentSpeed.toFixed(1)} km/h`);
    }
  }

  startRouteRecording(): void {
    this.isRecordingRoute = true;
    this.routeStartTime = Date.now();
    this.routeDistance = 0;
    this.routeMaxSpeed = 0;
    this.routeMovingTime = 0;
    this.lastMovingTimestamp = 0;
    this.stationaryCount = 0;
    this.isCurrentlyMoving = false;
    console.log('📍 Route recording started - waiting for movement...');
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
    this.routeMovingTime = 0;
    this.lastMovingTimestamp = 0;
    this.stationaryCount = 0;
    this.isCurrentlyMoving = false;
    console.log('📍 Route cleared');
  }

  isRecording(): boolean {
    return this.isRecordingRoute;
  }

  getRouteStatsToTraceRouteOnMap() {
    return {
      distance: this.routeDistance,
      maxSpeed: this.routeMaxSpeed,
      duration: this.routeMovingTime
    };
  }

  private updateMovingTime(isMoving: boolean, timestamp: number): void {
    if (isMoving) {
      // User is moving
      if (!this.isCurrentlyMoving) {
        // Just started moving (or resumed after stop)
        this.isCurrentlyMoving = true;
        this.lastMovingTimestamp = timestamp;
        this.stationaryCount = 0;
        console.log('⏱️ Timer started/resumed');
      } else {
        // Continue moving - accumulate time
        if (this.lastMovingTimestamp > 0) {
          const timeDiff = (timestamp - this.lastMovingTimestamp) / 1000;
          if (timeDiff > 0 && timeDiff < 5) { // Sanity check
            this.routeMovingTime += timeDiff;
          }
        }
        this.lastMovingTimestamp = timestamp;
      }
    } else {
      // User is stationary
      this.stationaryCount++;

      if (this.isCurrentlyMoving) {
        // Still count as moving for first few stationary readings
        if (this.stationaryCount >= this.STATIONARY_THRESHOLD) {
          // Been stationary for 3+ readings - pause timer
          this.isCurrentlyMoving = false;
          console.log('⏸️ Timer paused - stationary for 3 seconds');
        } else {
          // Grace period - still accumulate time
          if (this.lastMovingTimestamp > 0) {
            const timeDiff = (timestamp - this.lastMovingTimestamp) / 1000;
            if (timeDiff > 0 && timeDiff < 5) {
              this.routeMovingTime += timeDiff;
            }
          }
          this.lastMovingTimestamp = timestamp;
        }
      }
    }
  }

  async startTracking(): Promise<void> {
    if (this.isTracking) return;

    try {
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

    // Filter 0: Very first reading - just establish baseline, don't calculate anything
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

      this.isFirstReading = false;
      console.log('✅ GPS ready - speed tracking active');
      return; // Exit without any calculations
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

    // Filter 3: Calculate speed with spike protection (returns km/h)
    const calculatedSpeedKmh = this._odometerService.calculateSpeed(
      filtered.lat,
      filtered.lon,
      timestamp
    );

    // Filter 4: Simple movement detection - if speed > threshold, we're moving
    const isMoving = calculatedSpeedKmh > this.MIN_SPEED_THRESHOLD;

    const speedToUse = isMoving ? calculatedSpeedKmh : 0;

    // Filter 5: Smooth speed with moving average
    const smoothedSpeed = this._odometerService.smoothSpeed(speedToUse);
    this.currentSpeed = smoothedSpeed;

    // Create position object
    const pos: Position = {
      latitude: filtered.lat,
      longitude: filtered.lon,
      heading: position.coords.heading || undefined,
      speed: smoothedSpeed / 3.6, // Convert km/h to m/s for standard format
      timestamp: timestamp,
      accuracy: accuracy
    };

    this.currentPosition$.next(pos);

    // Track moving time for route recording
    if (this.isRecordingRoute) {
      this.updateMovingTime(isMoving, timestamp);
    }

    // Add to route if recording and actually moving
    if (isMoving && this.isRecordingRoute) {
      this.addPointToRoute(pos.latitude, pos.longitude, calculatedSpeedKmh); // Pass actual speed
    }

    // Update last position for next calculation
    this.lastPosition = pos;
    this.lastPositionTime = timestamp;

    console.log(`📍 GPS: ${smoothedSpeed.toFixed(1)}km/h, Acc: ${accuracy.toFixed(1)}m, Moving: ${isMoving ? 'YES' : 'NO'}`);
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

    // Prediction step
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
    this.isFirstReading = true;
  }

  private addPointToRoute(latitude: number, longitude: number, actualSpeedKmh: number): void {
    if (!this.isRecordingRoute) return;

    if (this.routeCoordinates.length > 0) {
      const lastPoint = this.routeCoordinates[this.routeCoordinates.length - 1];
      const distance = this._odometerService.calculateDistance(
        lastPoint[0], lastPoint[1],
        latitude, longitude
      );

      if (distance < this.MIN_DISTANCE_BETWEEN_POINTS) {
        // Still update max speed even if not adding point
        if (actualSpeedKmh > this.routeMaxSpeed && actualSpeedKmh <= this.MAX_REALISTIC_SPEED_KMH) {
          this.routeMaxSpeed = actualSpeedKmh;
          console.log(`🏆 New max speed: ${actualSpeedKmh.toFixed(1)} km/h`);
        }
        return;
      }

      this.routeDistance += distance;

      // Update max speed using actual calculated speed (not smoothed)
      if (actualSpeedKmh > this.routeMaxSpeed && actualSpeedKmh <= this.MAX_REALISTIC_SPEED_KMH) {
        this.routeMaxSpeed = actualSpeedKmh;
        console.log(`🏆 New max speed: ${actualSpeedKmh.toFixed(1)} km/h`);
      }
    }

    this.routeCoordinates.push([latitude, longitude]);
    this.routeCoordinates$.next([...this.routeCoordinates]);

    const movingMin = Math.floor(this.routeMovingTime / 60);
    const movingSec = Math.floor(this.routeMovingTime % 60);
    console.log(`📍 Point added. Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Moving time: ${movingMin}m ${movingSec}s`);
  }



  async saveCurrentRoute(name?: string, description?: string): Promise<string> {
    if (this.routeCoordinates.length === 0) {
      throw new Error('No route to save');
    }

    const endTime = Date.now();
    const duration = (endTime - this.routeStartTime) / 1000;
    const averageSpeed = duration > 0 ? (this.routeDistance / duration) * 3.6 : 0;

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
      description: description || `Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Duration: ${Math.floor(duration / 60)}min, Max Speed: ${this.routeMaxSpeed.toFixed(1)}km/h, Avg Speed: ${averageSpeed.toFixed(1)}km/h`
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

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}