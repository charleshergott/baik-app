import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { OdometerService } from './odometer.service';
import * as geolib from 'geolib';
import { IDBService } from './idb.service';
import { Position, SavedRoute } from '../interfaces/master';

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
  private stationaryCount = 0;
  private readonly STATIONARY_THRESHOLD = 3;

  // Route tracking properties
  private routeCoordinates: [number, number][] = [];
  private isRecordingRoute = false;
  private routeStartTime: number = 0;
  private routeDistance: number = 0;
  private routeMaxSpeed: number = 0;
  private routeMovingTime: number = 0;
  private lastMovingTimestamp: number = 0;
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
    private _odometerService: OdometerService,
    private _IDBService: IDBService
  ) {
    console.log('GPS Service initialized (Real GPS Mode)');
    this.dbInitialized = this._IDBService.initIndexedDB();
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
      timeout: 5000,        // Reduced from 10000
      maximumAge: 0         // Changed from 1000 - always get fresh reading
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

    // Show raw speed immediately for responsive UI
    this._odometerService.updateSpeed(calculatedSpeedKmh);
    const minThreshold = this._odometerService.getMinSpeedThreshold();

    if (calculatedSpeedKmh < minThreshold || accuracy > 15) {
      this.stationaryCount++;
    } else {
      this.stationaryCount = 0;
    }

    // Only count as moving if we've had movement for 3+ consecutive readings
    const isMoving = calculatedSpeedKmh > minThreshold &&
      accuracy <= 15 &&
      this.stationaryCount === 0;
    const speedToUse = isMoving ? calculatedSpeedKmh : 0;

    // Then smooth for calculations
    const smoothedSpeed = this._odometerService.smoothSpeed(speedToUse);
    this._odometerService.updateSpeed(smoothedSpeed);

    const pos: Position = {
      latitude: filtered.lat,
      longitude: filtered.lon,
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

        this._odometerService.updateTripDistance(distance);
        this._odometerService.updateTotalDistance(distance);
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

    const route: SavedRoute = {
      id: this.generateId(),
      name: name || `Ride ${new Date(this.routeStartTime).toLocaleString()}`,
      distance: this.routeDistance,
      duration: duration,
      coordinates: [...this.routeCoordinates],
      maxSpeed: this.routeMaxSpeed,
      averageSpeed: averageSpeed,
      startTime: this.routeStartTime,
      endTime: endTime,
      createdAt: new Date(this.routeStartTime).toISOString(),
      lastUsed: new Date(endTime).toISOString(),
      description: description || `Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Duration: ${Math.floor(duration / 60)}min`
    };

    await this._IDBService.saveRoute(route);
    return route.id;
  }

  loadRouteToMap(route: SavedRoute): void {
    this.routeCoordinates$.next(this.routeCoordinates);
    this._IDBService.updateRouteLastUsed(route.id);
    console.log('Route loaded to map');
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}