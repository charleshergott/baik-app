import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
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

  // Thresholds
  MIN_SPEED_THRESHOLD = 5; // km/h - match GPS service

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

  // Subscriptions
  private positionSubscription?: Subscription;

  constructor(private gpsService: GpsService) {
    this.initializeTracking();
  }

  ngOnDestroy(): void {
    this.stopTracking();
    if (this.positionSubscription) {
      this.positionSubscription.unsubscribe();
    }
  }

  /**
   * Initialize tracking - use GPS service's filtered data
   */
  private initializeTracking(): void {
    this.positionSubscription = this.gpsService.getCurrentPosition().pipe(
      filter(position => position !== null)
    ).subscribe(currPos => {
      if (this.isTracking && currPos) {
        this.processPositionUpdate(currPos);
      }
    });
  }

  /**
   * Process position updates - use filtered speed from GPS service
   */
  private processPositionUpdate(currPos: Position): void {
    const currentTime = Date.now();

    // Get the already-filtered speed from GPS service (in km/h)
    const speedKmh = this.gpsService.currentSpeed;

    // Update speed directly from GPS service (already filtered and smoothed)
    this.updateSpeed(speedKmh);

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
        this.updateAverageSpeed();
      }
    }

    this.lastPosition = currPos;
    this.lastUpdateTime = currentTime;
  }

  /**
   * Update current speed - now just stores the filtered value from GPS
   */
  private updateSpeed(speedKmh: number): void {
    this.currentSpeed = Math.max(0, speedKmh);
    this.currentSpeed$.next(this.currentSpeed);

    // Update max speed only if realistic (GPS service already filters this)
    if (this.currentSpeed > this.maxSpeed) {
      const maxRealistic = this.gpsService.getMaxRealisticSpeed();

      // Double-check it's realistic
      if (this.currentSpeed <= maxRealistic) {
        this.maxSpeed = this.currentSpeed;
        this.maxSpeed$.next(this.maxSpeed);
        console.log(`🏆 New max speed: ${this.maxSpeed.toFixed(1)} km/h`);
      }
    }
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

      console.log(`📏 Distance: ${(this.tripDistance / 1000).toFixed(2)} km, Speed: ${this.currentSpeed.toFixed(1)} km/h`);
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
    this.currentSpeed = 0;

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