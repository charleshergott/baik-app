import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { Position, SavedRoute, Waypoint } from '../interfaces/master';
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

  // Enhanced filtering parameters
  private MAX_ACCURACY_THRESHOLD = 20;

  // GPS initialization
  private isFirstReading = true;

  // Kalman filter variables
  private kalmanLat: number | null = null;
  private kalmanLon: number | null = null;
  private kalmanVariance = 1000;
  private PROCESS_NOISE = 0.5;

  // Route tracking properties
  private routeCoordinates: [number, number][] = [];
  private isRecordingRoute = false;
  private routeStartTime: number = 0;
  private routeDistance: number = 0;
  private routeMaxSpeed: number = 0;
  private routeMovingTime: number = 0;
  private lastMovingTimestamp: number = 0;
  private stationaryCount: number = 0;
  private readonly STATIONARY_THRESHOLD = 3;
  private isCurrentlyMoving: boolean = false;
  private readonly MIN_DISTANCE_BETWEEN_POINTS = 5;
  private lastUpdateTime: number | null = null;

  // IndexedDB
  private db: IDBDatabase | null = null;
  private dbInitialized: Promise<void>;
  private readonly DB_NAME = 'BikeRoutesDB';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'routes';

  // GPS Quality tracking
  currentAccuracy: number = 0;
  gpsQuality$ = new BehaviorSubject<'excellent' | 'good' | 'fair' | 'poor'>('poor');

  constructor(
    private _odometerService: OdometerService
  ) {
    console.log('GPS Service initialized (Real GPS Mode)');
    this.dbInitialized = this.initIndexedDB();
  }

  private async initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onerror = () => {
        console.error('IndexedDB failed to open');
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized');
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

  async startTracking(): Promise<void> {
    if (this.isTracking) {
      console.log('Already tracking');
      return;
    }

    try {
      if (!('geolocation' in navigator)) {
        throw new Error('Geolocation is not supported by this browser');
      }

      this._odometerService.startTracking();
      await this.startGPS();
      this.isTracking = true;
      console.log('GPS tracking started');
    } catch (error) {
      console.error('Failed to start GPS tracking:', error);
      throw error;
    }
  }

  async stopTracking(): Promise<void> {
    if (!this.isTracking) return;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this._odometerService.stopTracking();
    this.isTracking = false;
    this.resetFilters();
    console.log('GPS tracking stopped');
  }

  private async startGPS(): Promise<void> {
    console.log('Starting GPS - waiting for first lock...');

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
    this.updateGPSQuality(accuracy);

    if (this.isFirstReading) {
      console.log('First GPS lock acquired');
      const rawLat = position.coords.latitude;
      const rawLon = position.coords.longitude;

      this.kalmanLat = rawLat;
      this.kalmanLon = rawLon;
      this.kalmanVariance = accuracy * accuracy;

      this.lastPosition = {
        latitude: rawLat,
        longitude: rawLon,
        timestamp: position.timestamp,
        accuracy: accuracy
      };
      this.lastPositionTime = position.timestamp;
      this.lastUpdateTime = Date.now();

      // IMPORTANT: Initialize odometer's baseline too
      this._odometerService.calculateSpeed(rawLat, rawLon, position.timestamp);

      this.isFirstReading = false;
      console.log('GPS ready - speed tracking active');
      return;
    }

    if (accuracy > this.MAX_ACCURACY_THRESHOLD) {
      console.log(`GPS reading rejected - poor accuracy: ${accuracy.toFixed(1)}m`);
      return;
    }

    const rawLat = position.coords.latitude;
    const rawLon = position.coords.longitude;
    const timestamp = position.timestamp;

    const filtered = this.applyKalmanFilter(rawLat, rawLon, accuracy);

    const calculatedSpeedKmh = this._odometerService.calculateSpeed(
      filtered.lat,
      filtered.lon,
      timestamp
    );

    const minThreshold = this._odometerService.getMinSpeedThreshold();
    const isMoving = calculatedSpeedKmh > minThreshold;
    const speedToUse = isMoving ? calculatedSpeedKmh : 0;

    const smoothedSpeed = this._odometerService.smoothSpeed(speedToUse);
    this._odometerService.updateSpeed(smoothedSpeed);

    const pos: Position = {
      latitude: filtered.lat,
      longitude: filtered.lon,
      heading: position.coords.heading || undefined,
      speed: smoothedSpeed / 3.6,
      timestamp: timestamp,
      accuracy: accuracy
    };

    this.currentPosition$.next(pos);

    // Update distance tracking
    if (this.lastPosition && this.lastUpdateTime) {
      const timeDiff = (Date.now() - this.lastUpdateTime) / 1000;
      if (timeDiff > 0 && timeDiff <= 10) {
        const distance = geolib.getDistance(
          { latitude: this.lastPosition.latitude, longitude: this.lastPosition.longitude },
          { latitude: pos.latitude, longitude: pos.longitude },
          1
        );

        this._odometerService.updateTimeTracking(timeDiff);
      }
    }

    if (this.isRecordingRoute) {
      this.updateMovingTime(isMoving, timestamp);
    }

    if (isMoving && this.isRecordingRoute) {
      this.addPointToRoute(pos.latitude, pos.longitude, calculatedSpeedKmh);
    }

    this.lastPosition = pos;
    this.lastPositionTime = timestamp;
    this.lastUpdateTime = Date.now();
  }

  private applyKalmanFilter(lat: number, lon: number, accuracy: number): { lat: number, lon: number } {
    if (this.kalmanLat === null || this.kalmanLon === null) {
      this.kalmanLat = lat;
      this.kalmanLon = lon;
      this.kalmanVariance = accuracy * accuracy;
      return { lat, lon };
    }

    const measurementVariance = accuracy * accuracy;
    const predictedVariance = this.kalmanVariance + this.PROCESS_NOISE;
    const kalmanGain = predictedVariance / (predictedVariance + measurementVariance);

    this.kalmanLat = this.kalmanLat + kalmanGain * (lat - this.kalmanLat);
    this.kalmanLon = this.kalmanLon + kalmanGain * (lon - this.kalmanLon);
    this.kalmanVariance = (1 - kalmanGain) * predictedVariance;

    return { lat: this.kalmanLat, lon: this.kalmanLon };
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
    this.lastPosition = null;
    this.lastPositionTime = 0;
    this.lastUpdateTime = null;
    this.isFirstReading = true;
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
    console.log('Route recording started');
  }

  stopRouteRecording(): void {
    this.isRecordingRoute = false;
    console.log('Route recording stopped');
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
    console.log('Route cleared');
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
      if (!this.isCurrentlyMoving) {
        this.isCurrentlyMoving = true;
        this.lastMovingTimestamp = timestamp;
        this.stationaryCount = 0;
      } else {
        if (this.lastMovingTimestamp > 0) {
          const timeDiff = (timestamp - this.lastMovingTimestamp) / 1000;
          if (timeDiff > 0 && timeDiff < 5) {
            this.routeMovingTime += timeDiff;
          }
        }
        this.lastMovingTimestamp = timestamp;
      }
    } else {
      this.stationaryCount++;
      if (this.isCurrentlyMoving) {
        if (this.stationaryCount >= this.STATIONARY_THRESHOLD) {
          this.isCurrentlyMoving = false;
        } else {
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

  private addPointToRoute(latitude: number, longitude: number, actualSpeedKmh: number): void {
    if (!this.isRecordingRoute) return;

    if (this.routeCoordinates.length > 0) {
      const lastPoint = this.routeCoordinates[this.routeCoordinates.length - 1];
      const distance = this._odometerService.calculateDistance(
        lastPoint[0], lastPoint[1],
        latitude, longitude
      );

      if (distance < this.MIN_DISTANCE_BETWEEN_POINTS) {
        const maxRealistic = this._odometerService.getMaxRealisticSpeed();
        if (actualSpeedKmh > this.routeMaxSpeed && actualSpeedKmh <= maxRealistic) {
          this.routeMaxSpeed = actualSpeedKmh;
        }
        return;
      }

      this.routeDistance += distance;

      const maxRealistic = this._odometerService.getMaxRealisticSpeed();
      if (actualSpeedKmh > this.routeMaxSpeed && actualSpeedKmh <= maxRealistic) {
        this.routeMaxSpeed = actualSpeedKmh;
      }
    }

    this.routeCoordinates.push([latitude, longitude]);
    this.routeCoordinates$.next([...this.routeCoordinates]);
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
      description: description || `Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Duration: ${Math.floor(duration / 60)}min`
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
        console.log('Route saved with ID:', route.id);
        resolve();
      };
      request.onerror = () => {
        console.error('Failed to save route:', request.error);
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
        console.log('Route deleted:', id);
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
    console.log('Route loaded to map');
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}