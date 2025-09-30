import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { Position } from '../interfaces/master';
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


  private readonly MIN_SPEED_THRESHOLD = 3; // Minimum speed in knots to send position

  private isDevelopmentMode = environment.enableMockGPS;


  constructor() {
    console.log(`🔧 GPS Service: ${this.isDevelopmentMode ? 'MOCK MODE' : 'REAL MODE'}`);
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
}