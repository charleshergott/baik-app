import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval } from 'rxjs';
import { Position } from '../interfaces/master';
import { environment } from '../environments/environment.prod';


@Injectable({
  providedIn: 'root'
})

export class GpsService {

  private currentPosition$ = new BehaviorSubject<Position | null>(null);
  private isTracking = false;
  private watchId: number | null = null;

  // Mock data properties
  private isDevelopmentMode = environment.enableMockGPS;
  private mockPosition: Position = {
    latitude: 40.7128,
    longitude: -74.0060,
    heading: 45,
    speed: 60,
    timestamp: Date.now()
  };
  private mockInterval: any;

  constructor() {
    console.log(`🔧 GPS Service: ${this.isDevelopmentMode ? 'MOCK MODE' : 'REAL MODE'}`);
  }

  getCurrentPosition(): Observable<Position | null> {
    return this.currentPosition$.asObservable();
  }

  startTracking(): void {
    if (this.isTracking) return;

    if (this.isDevelopmentMode) {
      this.startMockTracking();
    } else {
      this.startRealGPS();
    }

    this.isTracking = true;
  }

  stopTracking(): void {
    if (this.isDevelopmentMode) {
      if (this.mockInterval) {
        clearInterval(this.mockInterval);
        this.mockInterval = null;
      }
    } else {
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    }
    this.isTracking = false;
  }

  // Mock GPS simulation
  private startMockTracking(): void {
    console.log('🧪 Starting MOCK GPS tracking for development');

    // Simulate movement every 1 second
    this.mockInterval = setInterval(() => {
      this.simulateMovement();
      this.currentPosition$.next(this.mockPosition);
    }, 1000);

    // Emit initial position immediately
    this.currentPosition$.next(this.mockPosition);
  }

  private simulateMovement(): void {
    // Simulate flying northeast at ~116 knots
    const speedKnots = 116;
    const speedMs = speedKnots * 0.514444; // Convert knots to m/s
    const distancePerSecond = speedMs; // meters per second

    // Convert to lat/lng changes (very rough approximation)
    const latChangePerSecond = (distancePerSecond / 111000) * Math.sin(Math.PI / 4); // Northeast
    const lngChangePerSecond = (distancePerSecond / (111000 * Math.cos(this.mockPosition.latitude * Math.PI / 180))) * Math.cos(Math.PI / 4);

    // Update position
    this.mockPosition.latitude += latChangePerSecond;
    this.mockPosition.longitude += lngChangePerSecond;
    this.mockPosition.timestamp = Date.now();

    // Add some random variation to make it realistic
    this.mockPosition.speed = speedMs + (Math.random() - 0.5) * 5; // ±2.5 m/s variation
    this.mockPosition.altitude = 3000 + (Math.random() - 0.5) * 100; // ±50 ft variation
    this.mockPosition.heading = 45 + (Math.random() - 0.5) * 10; // ±5 degree variation
  }

  // Updated GPS service - remove altitude capture
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
            // REMOVED: altitude capture
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

  // Method to toggle between real and mock GPS (for testing)
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
}