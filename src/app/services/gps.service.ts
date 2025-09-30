import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { Position, SavedRoute, Waypoint } from '../interfaces/master';
import { environment } from '../environments/environment.prod';
import { HttpClient } from '@angular/common/http';


@Injectable({
  providedIn: 'root'
})

export class GpsService {

  private currentPosition$ = new BehaviorSubject<Position | null>(null);
  private currentSpeed$ = new BehaviorSubject<number>(0);
  private isTracking = false;
  private watchId: number | null = null;
  private speedHistory: number[] = [];
  isGPSEnabled = false;
  private lastPosition: GeolocationPosition | null = null;
  private lastPositionTime = 0;
  private speedMonitoringInterval: any;
  currentSpeed = 0; // in knots
  private readonly SPEED_HISTORY_LENGTH = 5;

  // Route tracking properties
  private routeCoordinates: [number, number][] = [];
  private routeCoordinates$ = new BehaviorSubject<[number, number][]>([]);
  private isRecordingRoute = false;
  private routeStartTime: number = 0;
  private routeDistance: number = 0;
  private routeMaxSpeed: number = 0;
  private readonly MIN_DISTANCE_BETWEEN_POINTS = 5; // meters - avoid cluttering with too many points

  // IndexedDB
  private db: IDBDatabase | null = null;
  private dbInitialized: Promise<void>;
  private readonly DB_NAME = 'BikeRoutesDB';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'routes';

  private readonly MIN_SPEED_THRESHOLD = 3; // Minimum speed in knots to send position

  private isDevelopmentMode = environment.enableMockGPS;


  constructor() {
    console.log(`🔧 GPS Service: ${this.isDevelopmentMode ? 'MOCK MODE' : 'REAL MODE'}`);
    this.dbInitialized = this.initIndexedDB();
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

  // Public method to ensure DB is ready
  async ensureDbReady(): Promise<void> {
    await this.dbInitialized;
  }

  getCurrentPosition(): Observable<Position | null> {
    return this.currentPosition$.asObservable();
  }

  getSpeedUpdates(): Observable<number> {
    return this.currentSpeed$.asObservable();
  }

  getCurrentSpeed(): number {
    return this.currentSpeed;
  }

  // Route tracking methods
  getRouteCoordinates(): Observable<[number, number][]> {
    return this.routeCoordinates$.asObservable();
  }

  getCurrentRoute(): [number, number][] {
    return [...this.routeCoordinates];
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

  async saveCurrentRoute(name?: string, description?: string): Promise<string> {
    if (this.routeCoordinates.length === 0) {
      throw new Error('No route to save');
    }

    const endTime = Date.now();
    const duration = (endTime - this.routeStartTime) / 1000;

    // Calculate average speed
    const averageSpeed = duration > 0 ? (this.routeDistance / duration) * 3600 / 1852 : 0;

    // Convert coordinates to waypoints
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
      description: description || `Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Duration: ${Math.floor(duration / 60)}min, Max Speed: ${this.routeMaxSpeed.toFixed(1)}kn, Avg Speed: ${averageSpeed.toFixed(1)}kn`
    };

    await this.saveRoute(route);
    return route.id;
  }

  private async saveRoute(route: SavedRoute): Promise<void> {
    await this.dbInitialized; // Wait for DB to be ready

    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.put(route); // Use put instead of add to allow updates

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
    await this.dbInitialized; // Wait for DB to be ready

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
        // Sort by createdAt, newest first
        routes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        resolve(routes);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async getRoute(id: string): Promise<SavedRoute | null> {
    await this.dbInitialized; // Wait for DB to be ready

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
    await this.dbInitialized; // Wait for DB to be ready

    const route = await this.getRoute(id);
    if (route) {
      route.lastUsed = new Date().toISOString();
      await this.saveRoute(route);
    }
  }

  async deleteRoute(id: string): Promise<void> {
    await this.dbInitialized; // Wait for DB to be ready

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
    // Convert waypoints back to coordinates
    this.routeCoordinates = route.waypoints.map(wp => [wp.latitude, wp.longitude] as [number, number]);
    this.routeCoordinates$.next(this.routeCoordinates);

    // Update last used
    this.updateRouteLastUsed(route.id);

    console.log('📍 Route loaded to map');
  }

  private addPointToRoute(latitude: number, longitude: number): void {
    if (!this.isRecordingRoute) return;

    // Check if we should add this point (avoid too many clustered points)
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

      // Update max speed
      if (this.currentSpeed > this.routeMaxSpeed) {
        this.routeMaxSpeed = this.currentSpeed;
      }
    }

    this.routeCoordinates.push([latitude, longitude]);
    this.routeCoordinates$.next([...this.routeCoordinates]);
    console.log(`📍 Route point added. Total points: ${this.routeCoordinates.length}, Distance: ${(this.routeDistance / 1000).toFixed(2)} km`);
  }

  startTracking(): void {
    if (this.isTracking) return;

    this.startRealGPS();
    this.isTracking = true;
  }

  stopTracking(): void {
    if (this.isDevelopmentMode) {

    } else {
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    }
    this.isTracking = false;
  }

  private startRealGPS(): void {
    console.log('📡 Starting REAL GPS tracking');

    if ('geolocation' in navigator) {
      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000
      };

      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          const pos: Position = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading: position.coords.heading || undefined,
            speed: position.coords.speed || undefined,
            timestamp: Date.now()
          };
          this.currentPosition$.next(pos);

          // Add to route if recording
          this.addPointToRoute(pos.latitude, pos.longitude);
        },
        (error) => {
          console.error('GPS Error:', error);
        },
        options
      );
    }
  }

  setDevelopmentMode(enabled: boolean): void {
    const wasTracking = this.isTracking;

    if (wasTracking) {
      this.stopTracking();
    }

    this.isDevelopmentMode = enabled;
    console.log(`📱 GPS Mode: ${enabled ? 'MOCK (Development)' : 'REAL (Production)'}`);

    if (wasTracking) {
      this.startTracking();
    }
  }

  enableGPSSpeedMonitoring(userId?: string): void {
    // If already enabled, don't start again
    if (this.isGPSEnabled) {
      console.log('⚠️ GPS speed monitoring already enabled');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 1000
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.isGPSEnabled = true;
        this.lastPosition = position;
        this.lastPositionTime = Date.now();

        // IMPORTANT: Set initial position for database sync
        const initialPos: Position = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: position.coords.heading || undefined,
          speed: position.coords.speed || undefined,
          timestamp: Date.now()
        };
        this.currentPosition$.next(initialPos);

        // Add initial point to route if recording
        this.addPointToRoute(initialPos.latitude, initialPos.longitude);

        console.log('GPS enabled for speed monitoring', initialPos);

        // Start watching position changes
        navigator.geolocation.watchPosition(
          (newPosition) => this.calculateSpeedFromGPS(newPosition),
          (error) => {
            console.error('GPS error:', error);
            this.isGPSEnabled = false;
          },
          options
        );

      },
      (error) => {
        console.error('GPS initialization failed:', error);
        this.isGPSEnabled = false;
      },
      options
    );
  }

  disableGPSSpeedMonitoring(): void {
    this.isGPSEnabled = false;
    this.lastPosition = null;
    this.lastPositionTime = 0;
    this.speedHistory = [];
    this.currentSpeed = 0;

    console.log('GPS speed monitoring disabled');
  }

  calculateSpeedFromGPS(position: GeolocationPosition): void {
    // IMPORTANT: Always update the current position observable
    const pos: Position = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      heading: position.coords.heading || undefined,
      speed: position.coords.speed || undefined,
      timestamp: Date.now()
    };
    this.currentPosition$.next(pos);

    // Add to route if recording
    this.addPointToRoute(pos.latitude, pos.longitude);

    if (!this.lastPosition) {
      this.lastPosition = position;
      this.lastPositionTime = Date.now();
      return;
    }

    const currentTime = Date.now();
    const timeDiff = (currentTime - this.lastPositionTime) / 1000;

    if (timeDiff > 0) {
      const distance = this.calculateDistance(
        this.lastPosition.coords.latitude,
        this.lastPosition.coords.longitude,
        position.coords.latitude,
        position.coords.longitude
      );

      const speedKnots = (distance / timeDiff) * 3600 / 1852;
      this.updateSpeed(speedKnots);

      this.lastPosition = position;
      this.lastPositionTime = currentTime;
    }
  }

  updateSpeed(newSpeed: number): void {
    this.speedHistory.push(newSpeed);
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    const smoothedSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    this.currentSpeed = Math.max(0, smoothedSpeed);
    this.currentSpeed$.next(this.currentSpeed);

    console.log(`🚤 Speed updated: ${this.currentSpeed.toFixed(1)} kn`);
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  setManualSpeed(speed: number): void {
    this.updateSpeed(speed);
  }

  /**
   * Get the current minimum speed threshold for position tracking
   */
  getMinSpeedThreshold(): number {
    return this.MIN_SPEED_THRESHOLD;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}