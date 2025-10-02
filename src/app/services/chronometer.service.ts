import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription, Subject } from 'rxjs';
import { GpsService } from './gps.service';
import { ChronometerState } from '../interfaces/master';
import { OdometerService } from './odometer.service';

@Injectable({
  providedIn: 'root'
})

export class ChronometerService {

  // Chronometer properties
  private elapsedTime = 0;
  private isRunning = false;
  private startTime = 0;
  private lapTimes: number[] = [];
  private timerSubscription: Subscription | null = null;
  private clockSubscription: Subscription | null = null;
  public totalLapCount: number = 0;
  // Speed monitoring properties
  private currentSpeed = 0;

  private autoStartEnabled = true;
  private hasZoomedOnMovement = false;
  private readonly BIKING_ZOOM_LEVEL = 16; // Good zoom level for biking (13-18 is typical)
  private previousPosition: { lat: number; lng: number } | null = null;
  private movementSubscription?: Subscription;
  private movementDetected$ = new Subject<{ lat: number; lng: number }>();
  private hasDetectedMovement = false;
  // Time freezing properties
  private frozenStartTime: string | null = null;
  private frozenStopTime: string | null = null;
  private freezeStep = 0; // 0 = ready, 1 = start captured, 2 = stop captured

  // BehaviorSubject to emit current state
  private stateSubject = new BehaviorSubject<ChronometerState>(this.getInitialState());

  // Public observable for components to subscribe to
  public state$: Observable<ChronometerState> = this.stateSubject.asObservable();

  // GPS subscription
  private gpsSubscription: Subscription | null = null;

  constructor(
    private _ngZone: NgZone,
    private _gpsService: GpsService,
    private _odometerService: OdometerService
  ) {
    this.initializeTimers();
    this.initializeSpeedMonitoring();
    this.subscribeToGPS();
  }



  private getInitialState(): ChronometerState {
    return {
      isRunning: false,
      elapsedTime: 0,
      formattedTime: this.formatTime(0),
      formattedMilliseconds: this.formatMilliseconds(0),
      lapTimes: [],
      currentSpeed: 0,
      speedThreshold: 3,
      autoStartEnabled: true,
      speedStatus: 'BELOW THRESHOLD',
      currentTime: this.getCurrentTime(),
      currentDate: this.getCurrentDate(),
      // New frozen time properties
      frozenStartTime: null,
      frozenStopTime: null,
      freezeStep: 0
    };
  }

  private initializeTimers(): void {
    // Run timers outside Angular zone to prevent interference with component lifecycle
    this._ngZone.runOutsideAngular(() => {
      // Chronometer timer - updates every 10ms when running
      const chronometerInterval = setInterval(() => {
        if (this.isRunning) {
          this.elapsedTime = Date.now() - this.startTime;
          // Manually trigger state update inside Angular zone
          this._ngZone.run(() => {
            this.updateState();
          });
        }
      }, 10);

      // Clock timer - updates every 1000ms
      const clockInterval = setInterval(() => {
        this._ngZone.run(() => {
          this.updateState();
        });
      }, 1000);

      // Store interval IDs for cleanup
      this.timerSubscription = {
        unsubscribe: () => {
          clearInterval(chronometerInterval);
        }
      } as Subscription;

      this.clockSubscription = {
        unsubscribe: () => {
          clearInterval(clockInterval);
        }
      } as Subscription;
    });
  }

  onMovementDetected(): Observable<{ lat: number; lng: number }> {
    return this.movementDetected$.asObservable();
  }

  private monitorMovementForZoom(): void {
    this.hasDetectedMovement = false; // Reset flag

    this.movementSubscription = this._gpsService.getCurrentPosition().subscribe(position => {
      if (!position || this.hasDetectedMovement) return;

      const currentPos = { lat: position.latitude, lng: position.longitude };

      // Check if user is actually moving
      if (this.isUserMoving(currentPos, position.speed)) {
        console.log('🚴 Movement detected in chronometer service');

        // Emit the position to any subscribers (the component)
        this.movementDetected$.next(currentPos);
        this.hasDetectedMovement = true;
      }

      this.previousPosition = currentPos;
    });
  }

  private isUserMoving(currentPos: { lat: number; lng: number }, speed?: number): boolean {
    // Method 1: Check speed if available (in m/s)
    if (speed !== undefined && speed !== null && speed > 0.5) {
      return true;
    }

    // Method 2: Check distance from previous position
    if (this.previousPosition) {
      const distance = this._odometerService.calculateDistance(
        this.previousPosition.lat,
        this.previousPosition.lng,
        currentPos.lat,
        currentPos.lng
      );

      // If moved more than 10 meters
      return distance > 10;
    }

    return false;
  }


  stopSpeedMonitoring(): void {
    this.movementSubscription?.unsubscribe();
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Simple Euclidean distance (fine for small distances)
    return Math.sqrt(Math.pow(lat2 - lat1, 2) + Math.pow(lon2 - lon1, 2));
  }

  // Update your speed monitoring initialization
  private initializeSpeedMonitoring(): void {
    if ('geolocation' in navigator) {
      this._gpsService.startTracking();
      this._odometerService.startTracking();

      // Start monitoring for movement to trigger zoom
      this.monitorMovementForZoom();

      console.log('✅ Speed monitoring initialized');
    } else {
      console.warn('⚠️ Geolocation not supported, using manual speed input');
    }
  }


  private subscribeToGPS(): void {
    // Subscribe to odometer speed updates (not GPS directly)
    this.gpsSubscription = this._odometerService.getCurrentSpeed().subscribe(
      speed => {
        this.currentSpeed = speed;

        if (this.autoStartEnabled) {
          const threshold = this._odometerService.getMinSpeedThreshold();

          // Auto-start when speed exceeds threshold
          if (speed >= threshold && !this.isRunning) {
            this.autoStartChronometer();
            // 🚴 Start route recording when chronometer starts
            this._gpsService.startRouteRecording();
          }
          // Auto-stop when speed drops below threshold
          else if (speed < threshold && this.isRunning) {
            this.autoStopChronometer();
            // 🛑 Stop route recording when chronometer stops
            this._gpsService.stopRouteRecording();
          }
        }

        this.updateState();
      }
    );
  }

  resetSpeedMonitoring(): void {
    this._odometerService.resetTripStats();
    this.currentSpeed = 0;
    console.log('🔄 Speed monitoring reset');
  }

  private updateState(): void {
    this.stateSubject.next({
      isRunning: this.isRunning,
      elapsedTime: this.elapsedTime,
      formattedTime: this.formatTime(this.elapsedTime),
      formattedMilliseconds: this.formatMilliseconds(this.elapsedTime),
      lapTimes: [...this.lapTimes],
      currentSpeed: this.currentSpeed,
      speedThreshold: this._gpsService.MIN_SPEED_THRESHOLD,
      autoStartEnabled: this.autoStartEnabled,
      speedStatus: this.getSpeedStatus(),
      currentTime: this.getCurrentTime(),
      currentDate: this.getCurrentDate(),
      // Add frozen time properties only after updating ChronometerState interface
      frozenStartTime: this.frozenStartTime,
      frozenStopTime: this.frozenStopTime,
      freezeStep: this.freezeStep
    });
  }

  // Chronometer control methods
  public startStop(): void {
    if (this.isRunning) {
      this.isRunning = false;
    } else {
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
    this.updateState();
  }

  public reset(): void {
    if (!this.isRunning) {
      this.elapsedTime = 0;
      this.startTime = 0;
      this.lapTimes = [];
      this.updateState();
      this.totalLapCount = 0;
    }
  }

  public lap(): void {
    if (this.isRunning) {
      this.totalLapCount++; // Increment total count
      this.lapTimes.unshift(this.elapsedTime);
      if (this.lapTimes.length > 5) {
        this.lapTimes = this.lapTimes.slice(0, 5);
      }
      this.updateState();
    }
  }


  public freezeTime(): void {
    const currentTime = this.getCurrentTime();

    if (this.freezeStep === 0) {
      // First click - capture start time
      this.frozenStartTime = currentTime;
      this.frozenStopTime = null;
      this.freezeStep = 1;
      console.log('Start time frozen:', currentTime);
    } else if (this.freezeStep === 1) {
      // Second click - capture stop time
      this.frozenStopTime = currentTime;
      this.freezeStep = 2;
      console.log('Stop time frozen:', currentTime);
    } else {
      // Reset and start over
      this.resetFrozenTimes();
      this.frozenStartTime = currentTime;
      this.freezeStep = 1;
      console.log('Reset and new start time frozen:', currentTime);
    }

    this.updateState();
  }

  public resetFrozenTimes(): void {
    this.frozenStartTime = null;
    this.frozenStopTime = null;
    this.freezeStep = 0;
    this.updateState();
    console.log('Frozen times reset');
  }

  public getTimeDifference(): string | null {
    if (this.frozenStartTime && this.frozenStopTime) {
      // Parse the time strings to calculate difference
      const start = this.parseTimeString(this.frozenStartTime);
      const stop = this.parseTimeString(this.frozenStopTime);

      if (start && stop) {
        const diffMs = Math.abs(stop.getTime() - start.getTime());
        return this.formatTimeDifference(diffMs);
      }
    }
    return null;
  }

  private parseTimeString(timeString: string): Date | null {
    try {
      const today = new Date();
      const [hours, minutes, seconds] = timeString.split(':').map(Number);
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, seconds);
      return date;
    } catch {
      return null;
    }
  }

  private formatTimeDifference(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const ms = Math.floor((milliseconds % 1000) / 10);

    if (minutes > 0) {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    } else {
      return `${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}s`;
    }
  }

  // Speed monitoring methods
  public updateSpeed(speed: number): void {
    // Delegate to GPS service which will emit updates
    this._odometerService.setManualSpeed(speed);
  }

  private autoStartChronometer(): void {
    console.log(`Auto-starting chronometer: Speed ${this.currentSpeed.toFixed(1)} kn >= ${this._gpsService.MIN_SPEED_THRESHOLD} km/h`);
    if (!this.isRunning) {
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;

      // 🚴 Start route recording when chronometer auto-starts
      this._gpsService.startRouteRecording();
      console.log('📍 Route recording started automatically');
    }
  }

  private autoStopChronometer(): void {
    console.log(`Auto-stopping chronometer: Speed ${this.currentSpeed.toFixed(1)} kn < ${this._gpsService.MIN_SPEED_THRESHOLD} km/h`);
    if (this.isRunning) {
      this.isRunning = false;

      // 🛑 Stop route recording when chronometer auto-stops
      this._gpsService.stopRouteRecording();
      console.log('📍 Route recording stopped automatically');
    }
  }

  public setManualSpeed(speed: number): void {
    this._odometerService.setManualSpeed(speed);
  }

  public setSpeedThreshold(threshold: number): void {
    this._gpsService.MIN_SPEED_THRESHOLD = threshold;
    this.updateState();
  }

  public toggleAutoStart(): void {
    this.autoStartEnabled = !this.autoStartEnabled;
    if (!this.autoStartEnabled && this.isRunning) {
      console.log('Auto-start disabled - chronometer continues in manual mode');
    }
    this.updateState();
  }

  private formatTime(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${seconds.toString().padStart(2, '0')}`;
    }
  }

  private formatMilliseconds(milliseconds: number): string {
    const ms = Math.floor((milliseconds % 1000) / 10);
    return ms.toString().padStart(2, '0');
  }

  public formatSpeed(speed: number): string {
    return speed.toFixed(1);
  }

  private getSpeedStatus(): string {
    if (this.currentSpeed >= this._gpsService.MIN_SPEED_THRESHOLD) {
      return 'ABOVE THRESHOLD';
    } else {
      return 'BELOW THRESHOLD';
    }
  }

  private getCurrentTime(): string {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  private getCurrentDate(): string {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  private getCurrentTimezone(): string {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone.split('/').pop() || 'LOCAL';
  }

  private getUTCTime(): string {
    const now = new Date();
    return now.toUTCString().split(' ')[4];
  }

  private getHourAngle(): number {
    const now = new Date();
    const hours = now.getHours() % 12;
    const minutes = now.getMinutes();
    return (hours * 30) + (minutes * 0.5);
  }

  private getMinuteAngle(): number {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    return (minutes * 6) + (seconds * 0.1);
  }

  private getSecondAngle(): number {
    const now = new Date();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();
    return (seconds * 6) + (milliseconds * 0.006);
  }

  public get currentState(): ChronometerState {
    return this.stateSubject.value;
  }

  public get running(): boolean {
    return this.isRunning;
  }

  public get currentElapsedTime(): number {
    return this.elapsedTime;
  }

  // Cleanup method
  public destroy(): void {
    if (this.timerSubscription) {
      this.timerSubscription.unsubscribe();
    }
    if (this.clockSubscription) {
      this.clockSubscription.unsubscribe();
    }
    if (this.gpsSubscription) {
      this.gpsSubscription.unsubscribe();
    }
  }
}