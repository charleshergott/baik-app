import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChronometerState, SpeedData } from '../../interfaces/master';
import { ChronometerService } from '../../services/chronometer.service';
import { GpsService } from '../../services/gps.service';
import { OdometerService } from '../../services/odometer.service';

@Component({
  selector: 'app-chronometer',
  imports: [CommonModule],
  templateUrl: './chronometer.component.html',
  styleUrl: './chronometer.component.scss',
  standalone: true
})

export class ChronometerComponent implements OnInit, OnDestroy {

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
    frozenStartTime: null,
    frozenStopTime: null,
    freezeStep: 0
  };

  private stateSubscription?: Subscription;
  state!: ChronometerState;

  // Speed tracking properties - now from OdometerService
  speedData: SpeedData = {
    currentSpeed: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    distance: 0,
    lastPosition: null
  };

  useMetric: boolean = true; // toggle between km/h and mph
  private speedSubscription?: Subscription;
  private maxSpeedSubscription?: Subscription;
  private avgSpeedSubscription?: Subscription;
  private distanceSubscription?: Subscription;

  constructor(
    private _cdr: ChangeDetectorRef,
    private _chronometerService: ChronometerService,
    private _gpsService: GpsService,
    private _odometerService: OdometerService
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

    // Initialize GPS and odometer tracking
    this.initializeSpeedMonitoring();

    // Subscribe to odometer updates
    this.subscribeToOdometerUpdates();
  }

  /**
   * Initialize GPS tracking and odometer
   */
  private initializeSpeedMonitoring(): void {
    if ('geolocation' in navigator) {
      // Start GPS tracking
      this._gpsService.startTracking();

      // Start odometer tracking
      this._odometerService.startTracking();

      console.log('✅ Speed monitoring initialized');
    } else {
      console.warn('⚠️ Geolocation not supported');
    }
  }

  /**
   * Subscribe to all odometer observables
   */
  private subscribeToOdometerUpdates(): void {
    // Current speed
    this.speedSubscription = this._odometerService.getCurrentSpeed().subscribe(
      speedKmh => {
        this.speedData.currentSpeed = this.convertSpeed(speedKmh);
        this._cdr.detectChanges();
      }
    );

    // Max speed
    this.maxSpeedSubscription = this._odometerService.getMaxSpeed().subscribe(
      maxSpeedKmh => {
        this.speedData.maxSpeed = this.convertSpeed(maxSpeedKmh);
        this._cdr.detectChanges();
      }
    );

    // Average speed
    this.avgSpeedSubscription = this._odometerService.getAverageSpeed().subscribe(
      avgSpeedKmh => {
        this.speedData.avgSpeed = this.convertSpeed(avgSpeedKmh);
        this._cdr.detectChanges();
      }
    );

    // Trip distance
    this.distanceSubscription = this._odometerService.getTripDistance().subscribe(
      distance => {
        this.speedData.distance = distance;
        this._cdr.detectChanges();
      }
    );
  }

  /**
   * Convert speed based on current unit preference
   */
  private convertSpeed(speedKmh: number): number {
    return this.useMetric ? speedKmh : speedKmh * 0.621371; // km/h to mph
  }

  startStop(): void {
    this._chronometerService.startStop();
  }

  reset(): void {
    this._chronometerService.reset();
    this._odometerService.resetTripStats();
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
        return 'CLOCK';
      case 1:
        return 'CLOCK STOP';
      case 2:
        return 'REBOOT';
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

  get lapTimes(): number[] {
    return this.currentState.lapTimes;
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

  setManualSpeed(speed: number): void {
    this._chronometerService.setManualSpeed(speed);
  }

  setSpeedThreshold(threshold: number): void {
    this._chronometerService.setSpeedThreshold(threshold);
  }

  toggleAutoStart(): void {
    this._chronometerService.toggleAutoStart();
  }

  lap(): void {
    console.log('Lap button clicked!');
    console.log('Is running?', this.isRunning);
    console.log('Current lap times:', this.lapTimes);

    if (this.isRunning) {
      this._chronometerService.lap();
      console.log('After lap, lap times:', this.lapTimes);
      this._cdr.detectChanges();
    }
  }

  formatLapTime(lapTime: number): string {
    const totalSeconds = Math.floor(lapTime / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const milliseconds = Math.floor((lapTime % 1000) / 10); // Get centiseconds (00-99)

    if (minutes > 0) {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    } else {
      return `${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`;
    }
  }

  getLapNumber(index: number): number {
    return this._chronometerService.totalLapCount - index;
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

  toggleUnits(): void {
    this.useMetric = !this.useMetric;

    // Get current values from odometer in km/h
    const currentKmh = this._odometerService.getCurrentSpeedValue();
    const maxKmh = this._odometerService.getMaxSpeedValue();
    const stats = this._odometerService.getSpeedStats();

    // Update display with converted values
    this.speedData.currentSpeed = this.convertSpeed(currentKmh);
    this.speedData.maxSpeed = this.convertSpeed(maxKmh);
    this.speedData.avgSpeed = this.convertSpeed(stats.average);

    this._cdr.detectChanges();
  }

  formatSpeed(speed: number): string {
    return speed.toFixed(1);
  }

  getSpeedUnit(): string {
    return this.useMetric ? 'km/h' : 'mph';
  }

  getOdometerStats() {
    return this._odometerService.getTripStats();
  }

  isMoving(): boolean {
    return this._odometerService.isMoving();
  }

  ngOnDestroy(): void {
    // Unsubscribe from all observables
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
    }
    if (this.speedSubscription) {
      this.speedSubscription.unsubscribe();
    }
    if (this.maxSpeedSubscription) {
      this.maxSpeedSubscription.unsubscribe();
    }
    if (this.avgSpeedSubscription) {
      this.avgSpeedSubscription.unsubscribe();
    }
    if (this.distanceSubscription) {
      this.distanceSubscription.unsubscribe();
    }

    // Stop tracking
    this._odometerService.stopTracking();
    this._gpsService.stopTracking();
  }
}