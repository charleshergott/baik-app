import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { OdometerStats, Position, SpeedStats } from '../interfaces/master';

@Injectable({
  providedIn: 'root'
})

export class OdometerService implements OnDestroy {

  // Speed tracking
  private currentSpeed$ = new BehaviorSubject<number>(0);
  private currentSpeed = 0;

  // Thresholds
  MIN_SPEED_THRESHOLD = 2; // km/h - match GPS service
  private MIN_GPS_ACCURACY = 25; // meters - if accuracy > 25m, GPS is unreliable (indoors)
  private GPS_NOISE_SPEED_THRESHOLD = 0.5; // km/h - reject speeds below this (GPS jitter)

  // Trip statistics
  private tripDistance$ = new BehaviorSubject<number>(0);
  private totalDistance$ = new BehaviorSubject<number>(0);
  private maxSpeed$ = new BehaviorSubject<number>(0);
  private averageSpeed$ = new BehaviorSubject<number>(0);
  private speedHistory: number[] = [];
  private tripDistance = 0;
  private totalDistance = 0;
  private maxSpeed = 0;
  private lastPositionTime = 0;
  private SPEED_HISTORY_LENGTH = 2;
  private movingTime = 0;
  private totalTime = 0;
  private tripStartTime: number | null = null;
  private lastUpdateTime: number | null = null;
  private MAX_REALISTIC_SPEED_KMH = 80;

  // Tracking state
  private isTracking = false;
  private lastPosition: Position | null = null;
  private lastPositionAccuracy: number | null = null;
  private MAX_ACCELERATION_MS2 = 5; // Maximum realistic acceleration in m/s²

  // Subscriptions
  private positionSubscription?: Subscription;

  constructor() { }

  ngOnDestroy(): void {
    this.stopTracking();
    if (this.positionSubscription) {
      this.positionSubscription.unsubscribe();
    }
  }

  updateSpeed(speedKmh: number): void {
    this.currentSpeed = Math.max(0, speedKmh);
    this.currentSpeed$.next(this.currentSpeed);

    // Update max speed only if realistic
    if (this.currentSpeed > this.maxSpeed) {
      const maxRealistic = this.getMaxRealisticSpeed();

      if (this.currentSpeed <= maxRealistic) {
        this.maxSpeed = this.currentSpeed;
        this.maxSpeed$.next(this.maxSpeed);
        console.log(`🏆 New max speed: ${this.maxSpeed.toFixed(1)} km/h`);
      }
    }
  }

  /**
   * Calculate speed from GPS position change
   * @param lat Current latitude
   * @param lon Current longitude
   * @param timestamp Current timestamp (ms)
   * @param accuracy GPS accuracy in meters (optional - reject if poor)
   */
  calculateSpeed(lat: number, lon: number, timestamp: number, accuracy?: number): number {
    if (!this.lastPosition || !this.lastPositionTime) {
      this.lastPosition = { latitude: lat, longitude: lon, timestamp };
      this.lastPositionTime = timestamp;
      this.lastPositionAccuracy = accuracy || null;
      return 0;
    }

    // FILTER 1: Reject if GPS accuracy is poor (indoors = high uncertainty)
    if (accuracy && accuracy > this.MIN_GPS_ACCURACY) {
      console.log(`⚠️ GPS accuracy too poor (${accuracy.toFixed(0)}m), ignoring position`);
      return 0;
    }

    // FILTER 2: Reject if last position had poor accuracy
    if (this.lastPositionAccuracy && this.lastPositionAccuracy > this.MIN_GPS_ACCURACY) {
      console.log(`⚠️ Last GPS accuracy was too poor, resetting position`);
      this.lastPosition = { latitude: lat, longitude: lon, timestamp };
      this.lastPositionTime = timestamp;
      this.lastPositionAccuracy = accuracy || null;
      return 0;
    }

    const timeDiff = (timestamp - this.lastPositionTime) / 1000; // seconds

    if (timeDiff <= 0 || timeDiff > 5) {
      return 0;
    }

    const distance = this.calculateDistance(
      this.lastPosition.latitude,
      this.lastPosition.longitude,
      lat,
      lon
    );

    const speedMs = distance / timeDiff; // meters per second
    const speedKmh = speedMs * 3.6; // km/h

    // FILTER 3: Reject speeds below noise threshold (GPS jitter)
    if (speedKmh < this.GPS_NOISE_SPEED_THRESHOLD) {
      console.log(`⚠️ Speed below noise threshold (${speedKmh.toFixed(2)} km/h), ignoring`);
      // Still update position for next calculation, but don't count speed
      this.lastPosition = { latitude: lat, longitude: lon, timestamp };
      this.lastPositionTime = timestamp;
      this.lastPositionAccuracy = accuracy || null;
      return 0;
    }

    // FILTER 4: Check for unrealistic speeds
    if (speedKmh > this.MAX_REALISTIC_SPEED_KMH) {
      console.log(`⚠️ Speed spike detected and rejected: ${speedKmh.toFixed(1)} km/h`);
      return 0;
    }

    // FILTER 5: Check for unrealistic acceleration
    if (this.currentSpeed > 0) {
      const lastSpeedMs = this.currentSpeed / 3.6;
      const acceleration = Math.abs(speedMs - lastSpeedMs) / timeDiff;

      if (acceleration > this.MAX_ACCELERATION_MS2) {
        console.log(`⚠️ Acceleration spike detected and rejected: ${acceleration.toFixed(1)} m/s²`);
        return 0;
      }
    }

    // Update last position for next calculation
    this.lastPosition = { latitude: lat, longitude: lon, timestamp };
    this.lastPositionTime = timestamp;
    this.lastPositionAccuracy = accuracy || null;

    return speedKmh;
  }

  smoothSpeed(speedKmh: number): number {
    // Add to history
    this.speedHistory.push(speedKmh);

    // Keep only recent history
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    // Calculate moving average
    const sum = this.speedHistory.reduce((a, b) => a + b, 0);
    return sum / this.speedHistory.length;
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

    return R * c;
  }

  /**
   * Update trip distance with meters traveled
   */
  updateTripDistance(meters: number): void {
    if (!this.isTracking) return;

    // Only count distance if moving above threshold
    if (this.currentSpeed >= this.MIN_SPEED_THRESHOLD) {
      this.tripDistance += meters;
      this.tripDistance$.next(this.tripDistance);
    }
  }

  /**
   * Update total distance with meters traveled
   */
  updateTotalDistance(meters: number): void {
    if (!this.isTracking) return;

    // Only count distance if moving above threshold
    if (this.currentSpeed >= this.MIN_SPEED_THRESHOLD) {
      this.totalDistance += meters;
      this.totalDistance$.next(this.totalDistance);
    }
  }

  /**
   * Update time tracking
   */
  updateTimeTracking(timeDiff: number): void {
    if (!this.isTracking) return;

    this.totalTime += timeDiff;

    if (this.currentSpeed >= this.MIN_SPEED_THRESHOLD) {
      this.movingTime += timeDiff;
    }

    this.updateAverageSpeed();
  }

  setMaxRealisticSpeed(speedKmh: number): void {
    this.MAX_REALISTIC_SPEED_KMH = speedKmh;
    console.log(`🎯 Max realistic speed set to ${speedKmh} km/h`);
  }

  getMaxRealisticSpeed(): number {
    return this.MAX_REALISTIC_SPEED_KMH;
  }

  /**
   * Set minimum GPS accuracy threshold (in meters)
   * Higher values = reject more positions (more strict)
   * Default: 25m (typical GPS accuracy)
   */
  setMinGpsAccuracy(meters: number): void {
    this.MIN_GPS_ACCURACY = Math.max(0, meters);
    console.log(`📍 Min GPS accuracy threshold set to ${this.MIN_GPS_ACCURACY}m`);
  }

  /**
   * Set GPS noise speed threshold (in km/h)
   * Speeds below this are considered GPS jitter
   * Default: 0.5 km/h
   */
  setGpsNoiseThreshold(speedKmh: number): void {
    this.GPS_NOISE_SPEED_THRESHOLD = Math.max(0, speedKmh);
    console.log(`📊 GPS noise threshold set to ${this.GPS_NOISE_SPEED_THRESHOLD} km/h`);
  }

  updateAverageSpeed(): void {
    if (this.movingTime > 0) {
      const avgSpeed = (this.tripDistance / this.movingTime) * 3.6;
      this.averageSpeed$.next(avgSpeed);
    }
  }

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

  stopTracking(): void {
    this.isTracking = false;
    this.lastPosition = null;
    this.lastPositionTime = 0;
    this.lastPositionAccuracy = null;
    this.lastUpdateTime = null;
    this.speedHistory = [];
    console.log('🛑 Odometer tracking stopped');
  }

  resetTripStats(): void {
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

  resetAll(): void {
    this.resetTripStats();
    this.totalDistance = 0;
    this.totalDistance$.next(0);
    console.log('🔄 All statistics reset');
  }

  setManualSpeed(speed: number): void {
    this.updateSpeed(speed);
  }

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

  getMovingTime(): number {
    return this.movingTime;
  }

  getTotalTime(): number {
    return this.totalTime;
  }

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

  isMoving(): boolean {
    return this.currentSpeed >= this.MIN_SPEED_THRESHOLD;
  }

  isTrackingActive(): boolean {
    return this.isTracking;
  }

  getElapsedTime(): number {
    if (!this.tripStartTime) return 0;
    return (Date.now() - this.tripStartTime) / 1000;
  }

  getMovingTimePercentage(): number {
    if (this.totalTime === 0) return 0;
    return (this.movingTime / this.totalTime) * 100;
  }
}