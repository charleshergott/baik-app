import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { GpsService } from './gps.service';
import { ChronometerState } from '../interfaces/master';

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

  // Speed monitoring properties
  private currentSpeed = 0;
  private speedThreshold = 30; // knots
  private autoStartEnabled = true;

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
    private _gpsService: GpsService
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
      speedThreshold: 30,
      autoStartEnabled: true,
      speedStatus: 'BELOW THRESHOLD',
      currentTime: this.getCurrentTime(),
      currentDate: this.getCurrentDate(),
      currentTimezone: this.getCurrentTimezone(),
      utcTime: this.getUTCTime(),
      worldTimes: this.getWorldTimes(),
      hourAngle: this.getHourAngle(),
      minuteAngle: this.getMinuteAngle(),
      secondAngle: this.getSecondAngle(),
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

  private initializeSpeedMonitoring(): void {
    if ('geolocation' in navigator) {
      this._gpsService.enableGPSSpeedMonitoring();
    } else {
      console.warn('Geolocation not supported, using manual speed input');
      //this._gpsService.startSpeedSimulation();
    }
  }

  private subscribeToGPS(): void {
    // Subscribe to GPS speed updates
    this.gpsSubscription = this._gpsService.getSpeedUpdates().subscribe(
      speed => {
        this.currentSpeed = speed;

        if (this.autoStartEnabled) {
          if (speed >= this.speedThreshold && !this.isRunning) {
            this.autoStartChronometer();
          } else if (speed < this.speedThreshold && this.isRunning) {
            this.autoStopChronometer();
          }
        }
        this.updateState();
      }
    );
  }

  private updateState(): void {
    this.stateSubject.next({
      isRunning: this.isRunning,
      elapsedTime: this.elapsedTime,
      formattedTime: this.formatTime(this.elapsedTime),
      formattedMilliseconds: this.formatMilliseconds(this.elapsedTime),
      lapTimes: [...this.lapTimes],
      currentSpeed: this.currentSpeed,
      speedThreshold: this.speedThreshold,
      autoStartEnabled: this.autoStartEnabled,
      speedStatus: this.getSpeedStatus(),
      currentTime: this.getCurrentTime(),
      currentDate: this.getCurrentDate(),
      currentTimezone: this.getCurrentTimezone(),
      utcTime: this.getUTCTime(),
      worldTimes: this.getWorldTimes(),
      hourAngle: this.getHourAngle(),
      minuteAngle: this.getMinuteAngle(),
      secondAngle: this.getSecondAngle(),
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
    }
  }

  public lap(): void {
    if (this.isRunning) {
      this.lapTimes.unshift(this.elapsedTime);
      if (this.lapTimes.length > 5) {
        this.lapTimes = this.lapTimes.slice(0, 5);
      }
      this.updateState();
    }
  }

  // Time freezing methods
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
    this._gpsService.setManualSpeed(speed);
  }

  private autoStartChronometer(): void {
    console.log(`Auto-starting chronometer: Speed ${this.currentSpeed.toFixed(1)} kn >= ${this.speedThreshold} kn`);
    if (!this.isRunning) {
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
  }

  private autoStopChronometer(): void {
    console.log(`Auto-stopping chronometer: Speed ${this.currentSpeed.toFixed(1)} kn < ${this.speedThreshold} kn`);
    if (this.isRunning) {
      this.isRunning = false;
    }
  }

  public setManualSpeed(speed: number): void {
    this._gpsService.setManualSpeed(speed);
  }

  public setSpeedThreshold(threshold: number): void {
    this.speedThreshold = threshold;
    this.updateState();
  }

  public toggleAutoStart(): void {
    this.autoStartEnabled = !this.autoStartEnabled;
    if (!this.autoStartEnabled && this.isRunning) {
      console.log('Auto-start disabled - chronometer continues in manual mode');
    }
    this.updateState();
  }

  // Formatting methods
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
    if (this.currentSpeed >= this.speedThreshold) {
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

  private getWorldTimes(): Array<{ city: string, time: string }> {
    const now = new Date();
    return [
      {
        city: 'NYC',
        time: now.toLocaleTimeString('en-US', {
          timeZone: 'America/New_York',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        })
      },
      {
        city: 'LON',
        time: now.toLocaleTimeString('en-US', {
          timeZone: 'Europe/London',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        })
      },
      {
        city: 'TOK',
        time: now.toLocaleTimeString('en-US', {
          timeZone: 'Asia/Tokyo',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    ];
  }

  // Getter methods for direct access
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