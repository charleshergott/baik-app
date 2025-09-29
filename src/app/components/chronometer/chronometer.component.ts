import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ChronometerState } from '../../interfaces/master';
import { ChronometerService } from '../../services/chronometer.service';


@Component({
  selector: 'app-chronometer',
  imports: [
    CommonModule
  ],
  templateUrl: './chronometer.component.html',
  styleUrl: './chronometer.component.scss',
  standalone: true
})

export class ChronometerComponent implements OnInit, OnDestroy {

  // Current state from service - updated to include frozen time properties
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
    // New frozen time properties
    frozenStartTime: null,
    frozenStopTime: null,
    freezeStep: 0
  };

  private stateSubscription?: Subscription;
  state!: ChronometerState;
  private subscription: Subscription = new Subscription();

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
        this.state = state; // Keep both updated
        this._cdr.detectChanges();
      }
    );
  }

  startStop(): void {
    this._chronometerService.startStop();
  }

  reset(): void {
    this._chronometerService.reset();
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

  // NEW: Dynamic button text based on current freeze step
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

  // NEW: Dynamic CSS class for freeze button based on current step
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

  // Speed monitoring methods - delegate to service
  setManualSpeed(speed: number): void {
    this._chronometerService.setManualSpeed(speed);
  }

  setSpeedThreshold(threshold: number): void {
    this._chronometerService.setSpeedThreshold(threshold);
  }

  toggleAutoStart(): void {
    this._chronometerService.toggleAutoStart();
  }

  formatSpeed(speed: number): string {
    return this._chronometerService.formatSpeed(speed);
  }

  // Getter methods for template access (now from state)
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

  // NEW: Getters for frozen time properties
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

  // Time display methods
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

  ngOnDestroy(): void {
    // Clean up subscriptions
    if (this.stateSubscription) {
      this.stateSubscription.unsubscribe();
    }
  }
}