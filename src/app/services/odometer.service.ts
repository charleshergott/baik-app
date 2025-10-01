import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter, pairwise } from 'rxjs/operators';
import { OdometerStats, Position, SpeedStats } from '../interfaces/master';
import { GpsService } from './gps.service';
import * as geolib from 'geolib';


@Injectable({
  providedIn: 'root'
})

export class OdometerService implements OnDestroy {

  // Speed tracking
  private currentSpeed$ = new BehaviorSubject<number>(0);
  private currentSpeed = 0;
  private speedHistory: number[] = [];
  private readonly SPEED_HISTORY_LENGTH = 5;

  // Thresholds
  MIN_SPEED_THRESHOLD = 5; // km/h

  // Trip statistics
  private tripDistance$ = new BehaviorSubject<number>(0);
  private totalDistance$ = new BehaviorSubject<number>(0);
  private maxSpeed$ = new BehaviorSubject<number>(0);
  private averageSpeed$ = new BehaviorSubject<number>(0);

  private tripDistance = 0;
  private totalDistance = 0;
  private maxSpeed = 0;
  private movingTime = 0;
  private totalTime = 0;
  private tripStartTime: number | null = null;
  private lastUpdateTime: number | null = null;

  // Tracking state
  private isTracking = false;
  private lastPosition: Position | null = null;

  // Kalman filter for GPS smoothing (optional enhancement)
  private useKalmanFilter = false;
  private filteredLat: number | null = null;
  private filteredLon: number | null = null;
  private readonly KALMAN_R = 0.008; // Process noise
  private readonly KALMAN_Q = 3; // Measurement noise (meters)

  // Subscriptions
  private positionSubscription?: Subscription;

  constructor(private gpsService: GpsService) {
    this.initializePositionTracking();
  }

  ngOnDestroy(): void {
    this.stopTracking();
    if (this.positionSubscription) {
      this.positionSubscription.unsubscribe();
    }
  }

  /**
   * Initialize position tracking to calculate speed and distance
   */
  private initializePositionTracking(): void {
    this.positionSubscription = this.gpsService.getCurrentPosition().pipe(
      filter(position => position !== null),
      pairwise()
    ).subscribe(([prevPos, currPos]) => {
      if (this.isTracking && prevPos && currPos) {
        this.processPositionUpdate(prevPos, currPos);
      }
    });
  }

  /**
   * Process position updates using Geolib for accurate calculations
   */
  private processPositionUpdate(prevPos: Position, currPos: Position): void {
    const currentTime = Date.now();
    const timeDiff = (currentTime - (prevPos.timestamp || 0)) / 1000; // seconds

    if (timeDiff <= 0 || timeDiff > 10) {
      this.lastPosition = currPos;
      this.lastUpdateTime = currentTime;
      return;
    }

    // Apply Kalman filter if enabled (reduces GPS jitter)
    let lat = currPos.latitude;
    let lon = currPos.longitude;

    if (this.useKalmanFilter) {
      const filtered = this.applyKalmanFilter(lat, lon);
      lat = filtered.latitude;
      lon = filtered.longitude;
    }

    // Calculate distance using Geolib (more accurate than basic Haversine)
    const distance = geolib.getDistance(
      { latitude: prevPos.latitude, longitude: prevPos.longitude },
      { latitude: lat, longitude: lon },
      1 // 1 meter accuracy
    );

    // Calculate speed using Geolib (returns m/s)
    const speedMs = geolib.getSpeed(
      { latitude: prevPos.latitude, longitude: prevPos.longitude, time: prevPos.timestamp },
      { latitude: lat, longitude: lon, time: currentTime }
    ) || 0;

    // Convert m/s to km/h
    const speedKmh = speedMs * 3.6;

    // Alternative: calculate speed manually if preferred
    // const speedKmh = (distance / timeDiff) * 3.6;

    // Update speed with smoothing
    this.updateSpeed(speedKmh);

    // Update distance
    this.updateDistance(distance);

    // Update time tracking
    this.updateTimeTracking(timeDiff, this.currentSpeed);

    // Update average speed
    this.updateAverageSpeed();

    this.lastPosition = currPos;
    this.lastUpdateTime = currentTime;
  }

  /**
   * Simple Kalman filter to smooth GPS coordinates
   */
  private applyKalmanFilter(lat: number, lon: number): { latitude: number, longitude: number } {
    if (this.filteredLat === null || this.filteredLon === null) {
      this.filteredLat = lat;
      this.filteredLon = lon;
      return { latitude: lat, longitude: lon };
    }

    // Simple 1D Kalman filter for each coordinate
    this.filteredLat = this.filteredLat + this.KALMAN_R * (lat - this.filteredLat);
    this.filteredLon = this.filteredLon + this.KALMAN_R * (lon - this.filteredLon);

    return {
      latitude: this.filteredLat,
      longitude: this.filteredLon
    };
  }

  /**
   * Update current speed with smoothing
   */
  private updateSpeed(newSpeed: number): void {
    // Add to history for smoothing
    this.speedHistory.push(newSpeed);
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    // Calculate smoothed speed
    const smoothedSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    this.currentSpeed = Math.max(0, smoothedSpeed);
    this.currentSpeed$.next(this.currentSpeed);

    // Update max speed
    if (this.currentSpeed > this.maxSpeed) {
      this.maxSpeed = this.currentSpeed;
      this.maxSpeed$.next(this.maxSpeed);
    }

    console.log(`🚴 Speed: ${this.currentSpeed.toFixed(1)} km/h (Max: ${this.maxSpeed.toFixed(1)} km/h)`);
  }

  /**
   * Update distance tracking
   */
  private updateDistance(distance: number): void {
    // Only count distance if moving above threshold
    if (this.currentSpeed >= this.MIN_SPEED_THRESHOLD) {
      this.tripDistance += distance;
      this.totalDistance += distance;

      this.tripDistance$.next(this.tripDistance);
      this.totalDistance$.next(this.totalDistance);
    }
  }

  /**
   * Update time tracking
   */
  private updateTimeTracking(timeDiff: number, speed: number): void {
    this.totalTime += timeDiff;

    if (speed >= this.MIN_SPEED_THRESHOLD) {
      this.movingTime += timeDiff;
    }
  }

  /**
   * Calculate average speed
   */
  private updateAverageSpeed(): void {
    if (this.movingTime > 0) {
      const avgSpeed = (this.tripDistance / this.movingTime) * 3.6;
      this.averageSpeed$.next(avgSpeed);
    }
  }

  /**
   * Calculate bearing/heading between two points
   */
  getBearing(fromPos: Position, toPos: Position): number {
    return geolib.getGreatCircleBearing(
      { latitude: fromPos.latitude, longitude: fromPos.longitude },
      { latitude: toPos.latitude, longitude: toPos.longitude }
    );
  }

  /**
   * Get compass direction (N, NE, E, etc.)
   */
  getCompassDirection(fromPos: Position, toPos: Position): string {
    return geolib.getCompassDirection(
      { latitude: fromPos.latitude, longitude: fromPos.longitude },
      { latitude: toPos.latitude, longitude: toPos.longitude }
    );
  }

  /**
   * Enable/disable Kalman filtering for GPS smoothing
   */
  setKalmanFilterEnabled(enabled: boolean): void {
    this.useKalmanFilter = enabled;
    if (!enabled) {
      this.filteredLat = null;
      this.filteredLon = null;
    }
    console.log(`🔧 Kalman filter: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Start tracking speed and distance
   */
  startTracking(): void {
    if (this.isTracking) {
      console.log('⚠️ Odometer already tracking');
      return;
    }

    this.isTracking = true;
    this.tripStartTime = Date.now();
    this.lastUpdateTime = Date.now();
    console.log('🎯 Odometer tracking started');
  }

  /**
   * Stop tracking
   */
  stopTracking(): void {
    this.isTracking = false;
    this.lastPosition = null;
    this.lastUpdateTime = null;
    this.filteredLat = null;
    this.filteredLon = null;
    console.log('🛑 Odometer tracking stopped');
  }

  /**
   * Reset trip statistics
   */
  resetTrip(): void {
    this.tripDistance = 0;
    this.maxSpeed = 0;
    this.movingTime = 0;
    this.totalTime = 0;
    this.tripStartTime = null;
    this.speedHistory = [];
    this.currentSpeed = 0;
    this.filteredLat = null;
    this.filteredLon = null;

    this.tripDistance$.next(0);
    this.maxSpeed$.next(0);
    this.averageSpeed$.next(0);
    this.currentSpeed$.next(0);

    console.log('🔄 Trip reset');
  }

  /**
   * Reset all statistics
   */
  resetAll(): void {
    this.resetTrip();
    this.totalDistance = 0;
    this.totalDistance$.next(0);
    console.log('🔄 All statistics reset');
  }

  /**
   * Manually set speed (for testing)
   */
  setManualSpeed(speed: number): void {
    this.updateSpeed(speed);
  }

  /**
   * Set minimum speed threshold
   */
  setMinSpeedThreshold(threshold: number): void {
    this.MIN_SPEED_THRESHOLD = Math.max(0, threshold);
    console.log(`🎚️ Min speed threshold set to ${this.MIN_SPEED_THRESHOLD} km/h`);
  }

  // Observable getters

  getCurrentSpeed(): Observable<number> {
    return this.currentSpeed$.asObservable();
  }

  getMaxSpeed(): Observable<number> {
    return this.maxSpeed$.asObservable();
  }

  getAverageSpeed(): Observable<number> {
    return this.averageSpeed$.asObservable();
  }

  getTripDistance(): Observable<number> {
    return this.tripDistance$.asObservable();
  }

  getTotalDistance(): Observable<number> {
    return this.totalDistance$.asObservable();
  }

  // Synchronous getters

  getCurrentSpeedValue(): number {
    return this.currentSpeed;
  }

  getMaxSpeedValue(): number {
    return this.maxSpeed;
  }

  getTripDistanceValue(): number {
    return this.tripDistance;
  }

  getTotalDistanceValue(): number {
    return this.totalDistance;
  }

  getMinSpeedThreshold(): number {
    return this.MIN_SPEED_THRESHOLD;
  }

  /**
   * Get comprehensive trip statistics
   */
  getTripStats(): OdometerStats {
    const avgSpeed = this.movingTime > 0
      ? (this.tripDistance / this.movingTime) * 3.6
      : 0;

    return {
      totalDistance: this.totalDistance,
      tripDistance: this.tripDistance,
      currentSpeed: this.currentSpeed,
      maxSpeed: this.maxSpeed,
      averageSpeed: avgSpeed,
      movingTime: this.movingTime,
      totalTime: this.totalTime
    };
  }

  /**
   * Get speed statistics
   */
  getSpeedStats(): SpeedStats {
    const avgSpeed = this.movingTime > 0
      ? (this.tripDistance / this.movingTime) * 3.6
      : 0;

    return {
      current: this.currentSpeed,
      max: this.maxSpeed,
      average: avgSpeed
    };
  }

  /**
   * Check if currently moving
   */
  isMoving(): boolean {
    return this.currentSpeed >= this.MIN_SPEED_THRESHOLD;
  }

  /**
   * Check if tracking is active
   */
  isTrackingActive(): boolean {
    return this.isTracking;
  }

  /**
   * Get elapsed time since trip start
   */
  getElapsedTime(): number {
    if (!this.tripStartTime) return 0;
    return (Date.now() - this.tripStartTime) / 1000;
  }

  /**
   * Get moving time percentage
   */
  getMovingTimePercentage(): number {
    if (this.totalTime === 0) return 0;
    return (this.movingTime / this.totalTime) * 100;
  }
}