import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChronometerState, SpeedData } from '../../interfaces/master';
import { ChronometerService } from '../../services/chronometer.service';



@Component({
  selector: 'app-chronometer',
  imports: [CommonModule],
  templateUrl: './chronometer.component.html',
  styleUrl: './chronometer.component.scss',
  standalone: true
})

export class ChronometerComponent implements OnInit, OnDestroy {
  // Current state from service
  currentState: ChronometerState = {
    isRunning: false,
    elapsedTime: 0,
    formattedTime: '00',
    formattedMilliseconds: '00',
    lapTimes: [],
    currentSpeed: 0,
    speedThreshold: 30,
    autoStartEnabled: true,
    speedStatus: 'BELOW THRESHOLD',
    currentTime: '',
    currentDate: '',
    currentTimezone: '',
    utcTime: '',
    worldTimes: [],
    hourAngle: 0,
    minuteAngle: 0,
    secondAngle: 0,
    frozenStartTime: null,
    frozenStopTime: null,
    freezeStep: 0
  };

  private stateSubscription?: Subscription;
  state!: ChronometerState;
  private subscription: Subscription = new Subscription();

  // Speed tracking properties
  speedData: SpeedData = {
    currentSpeed: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    distance: 0,
    lastPosition: null
  };

  private watchId: number | null = null;
  private speedReadings: number[] = [];
  useMetric: boolean = true; // toggle between km/h and mph

  constructor(
    private _cdr: ChangeDetectorRef,
    private _chronometerService: ChronometerService
  ) {
    this.state = this._chronometerService.currentState;
  }

  ngOnInit(): void {
    // Subscribe to chronometer state
    this.stateSubscription = this._chronometerService.state$.subscribe(
      state => {
        this.currentState = state;
        this.state = state;
        this._cdr.detectChanges();
      }
    );
    this.initializeGeolocation();
  }

  ngOnDestroy(): void {
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
    }
    this.stopTracking();
  }

  // Chronometer methods (delegate to service)
  startStop(): void {
    this._chronometerService.startStop();
    if (this.currentState.isRunning) {
      this.startSpeedTracking();
    } else {
      this.stopSpeedTracking();
    }
  }

  reset(): void {
    this._chronometerService.reset();
    this.resetSpeedData();
  }

  lap(): void {
    this._chronometerService.lap();
  }

  onFreezeTime(): void {
    this._chronometerService.freezeTime();
  }

  onResetFrozenTimes(): void {
    this._chronometerService.resetFrozenTimes();
  }

  getTimeDifference(): string | null {
    return this._chronometerService.getTimeDifference();
  }

  getFreezeButtonText(): string {
    switch (this.currentState.freezeStep) {
      case 0:
        return 'CLOCK START';
      case 1:
        return 'CLOCK STOP';
      case 2:
        return 'CLOCK NEW START';
      default:
        return 'FREEZE TIME';
    }
  }

  getFreezeButtonClass(): string {
    switch (this.currentState.freezeStep) {
      case 0:
        return 'freeze-btn ready';
      case 1:
        return 'freeze-btn start-captured';
      case 2:
        return 'freeze-btn completed';
      default:
        return 'freeze-btn';
    }
  }

  // Getters for template access
  get elapsedTime(): number {
    return this.currentState.elapsedTime;
  }

  get isRunning(): boolean {
    return this.currentState.isRunning;
  }

  get lapTimes(): number[] {
    return this.currentState.lapTimes;
  }

  get currentSpeed(): number {
    return this.currentState.currentSpeed;
  }

  get speedThreshold(): number {
    return this.currentState.speedThreshold;
  }

  get autoStartEnabled(): boolean {
    return this.currentState.autoStartEnabled;
  }

  get frozenStartTime(): string | null {
    return this.currentState.frozenStartTime;
  }

  get frozenStopTime(): string | null {
    return this.currentState.frozenStopTime;
  }

  get freezeStep(): number {
    return this.currentState.freezeStep;
  }

  // Formatting methods
  formatTime(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${seconds.toString().padStart(2, '0')}`;
    }
  }

  formatMilliseconds(milliseconds: number): string {
    const ms = Math.floor((milliseconds % 1000) / 10);
    return ms.toString().padStart(2, '0');
  }

  getSpeedStatus(): string {
    return this.currentState.speedStatus;
  }

  getCurrentTime(): string {
    return this.currentState.currentTime;
  }

  getCurrentDate(): string {
    return this.currentState.currentDate;
  }

  getCurrentTimezone(): string {
    return this.currentState.currentTimezone;
  }

  getUTCTime(): string {
    return this.currentState.utcTime;
  }

  getHourAngle(): number {
    return this.currentState.hourAngle;
  }

  getMinuteAngle(): number {
    return this.currentState.minuteAngle;
  }

  getSecondAngle(): number {
    return this.currentState.secondAngle;
  }

  getWorldTimes(): Array<{ city: string, time: string }> {
    return this.currentState.worldTimes;
  }

  setManualSpeed(speed: number): void {
    this._chronometerService.setManualSpeed(speed);
  }

  setSpeedThreshold(threshold: number): void {
    this._chronometerService.setSpeedThreshold(threshold);
  }

  toggleAutoStart(): void {
    this._chronometerService.toggleAutoStart();
  }

  // Geolocation and Speed tracking methods
  private initializeGeolocation(): void {
    if (!navigator.geolocation) {
      console.error('Geolocation is not supported by this browser.');
      return;
    }
  }

  private startSpeedTracking(): void {
    if (!navigator.geolocation) return;

    const options = {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.updateSpeed(position),
      (error) => console.error('Geolocation error:', error),
      options
    );
  }

  private stopSpeedTracking(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private stopTracking(): void {
    this.stopSpeedTracking();
  }

  private updateSpeed(position: GeolocationPosition): void {
    // Get speed from GPS (in m/s)
    let speedMPS = position.coords.speed || 0;

    // If speed from GPS is not available or unreliable, calculate from position changes
    if (this.speedData.lastPosition && (!position.coords.speed || position.coords.speed < 0)) {
      const distance = this.calculateDistance(
        this.speedData.lastPosition.coords.latitude,
        this.speedData.lastPosition.coords.longitude,
        position.coords.latitude,
        position.coords.longitude
      );

      const timeDiff = (position.timestamp - this.speedData.lastPosition.timestamp) / 1000;
      if (timeDiff > 0) {
        speedMPS = distance / timeDiff;
      }
    }

    // Update current speed (convert to km/h or mph)
    this.speedData.currentSpeed = this.useMetric
      ? speedMPS * 3.6  // m/s to km/h
      : speedMPS * 2.237; // m/s to mph

    // Update max speed
    if (this.speedData.currentSpeed > this.speedData.maxSpeed) {
      this.speedData.maxSpeed = this.speedData.currentSpeed;
    }

    // Track speed readings for average calculation
    this.speedReadings.push(speedMPS);

    // Calculate average speed
    const avgSpeedMPS = this.speedReadings.reduce((a, b) => a + b, 0) / this.speedReadings.length;
    this.speedData.avgSpeed = this.useMetric
      ? avgSpeedMPS * 3.6
      : avgSpeedMPS * 2.237;

    // Update distance if we have a previous position
    if (this.speedData.lastPosition) {
      const distanceIncrement = this.calculateDistance(
        this.speedData.lastPosition.coords.latitude,
        this.speedData.lastPosition.coords.longitude,
        position.coords.latitude,
        position.coords.longitude
      );
      this.speedData.distance += distanceIncrement;
    }

    this.speedData.lastPosition = position;
    this._cdr.detectChanges();
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Haversine formula to calculate distance between two GPS coordinates
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

  private resetSpeedData(): void {
    this.speedData = {
      currentSpeed: 0,
      maxSpeed: 0,
      avgSpeed: 0,
      distance: 0,
      lastPosition: null
    };
    this.speedReadings = [];
  }

  // Formatting methods for speed display
  formatSpeed(speed: number): string {
    return speed.toFixed(1);
  }

  formatDistance(meters: number): string {
    if (this.useMetric) {
      return meters >= 1000
        ? `${(meters / 1000).toFixed(2)} km`
        : `${meters.toFixed(0)} m`;
    } else {
      const miles = meters * 0.000621371;
      return miles >= 1
        ? `${miles.toFixed(2)} mi`
        : `${(meters * 3.28084).toFixed(0)} ft`;
    }
  }

  getSpeedUnit(): string {
    return this.useMetric ? 'km/h' : 'mph';
  }

  toggleUnits(): void {
    this.useMetric = !this.useMetric;
    // Recalculate current displayed speeds
    const conversionFactor = this.useMetric ? 1.60934 : 0.621371;
    this.speedData.currentSpeed *= conversionFactor;
    this.speedData.maxSpeed *= conversionFactor;
    this.speedData.avgSpeed *= conversionFactor;
  }
}