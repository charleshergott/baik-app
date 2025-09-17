import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { UnifiedMovementService } from '../../services/unified-movement.service';
import { MovementState } from '../../interfaces/master';


@Component({
  selector: 'app-chronometer',
  imports: [CommonModule],
  templateUrl: './chronometer.component.html',
  styleUrl: './chronometer.component.scss'
})
export class ChronometerComponent implements OnInit, OnDestroy {
  // Chronometer properties
  elapsedTime = 0;
  isRunning = false;
  startTime = 0;
  lapTimes: number[] = [];
  private intervalId: any;
  private currentTimeInterval: any;

  // Movement tracking properties
  currentSpeed = 0;
  isMoving = false;
  autoStartEnabled = true;
  isGPSEnabled = false;
  gpsQuality: 'good' | 'poor' | 'very_poor' = 'poor';

  // Auto-start/stop state
  private stoppedDuration = 0;
  private movementSubscription?: Subscription;

  // Configuration
  startThreshold = 3; // km/h
  stopThreshold = 1; // km/h
  stopDelay = 3000; // ms

  constructor(
    private movementService: UnifiedMovementService
  ) { }

  ngOnInit(): void {
    // Chronometer interval for smooth updates
    this.intervalId = setInterval(() => {
      if (this.isRunning) {
        this.elapsedTime = Date.now() - this.startTime;
      }
    }, 10);

    // Current time interval for watch display
    this.currentTimeInterval = setInterval(() => {
      // Triggers change detection
    }, 1000);

    // Initialize movement tracking
    this.initializeMovementTracking();
  }

  ngOnDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.currentTimeInterval) {
      clearInterval(this.currentTimeInterval);
    }
    if (this.movementSubscription) {
      this.movementSubscription.unsubscribe();
    }
  }

  /**
   * Initialize movement tracking with unified service
   */
  async initializeMovementTracking(): Promise<void> {
    try {
      // Subscribe to movement state changes
      this.movementSubscription = this.movementService.getMovementState().subscribe(
        (state: MovementState) => this.handleMovementStateChange(state)
      );

      // Update service configuration with chronometer settings
      this.movementService.updateConfig({
        startThreshold: this.startThreshold,
        stopThreshold: this.stopThreshold,
        stopDelay: this.stopDelay
      });

      // Start GPS tracking
      await this.movementService.startTracking();
      this.isGPSEnabled = true;
      console.log('🎯 Chronometer movement tracking initialized');

    } catch (error) {
      console.error('❌ Failed to initialize movement tracking:', error);
      this.isGPSEnabled = false;
      this.handleGPSError();
    }
  }

  /**
   * Handle movement state changes from unified service
   */
  private handleMovementStateChange(state: MovementState): void {
    // Update display values
    this.currentSpeed = state.speed;
    this.isMoving = state.isMoving;
    this.gpsQuality = state.quality;

    // Auto-start/stop logic
    if (this.autoStartEnabled && state.quality !== 'very_poor') {
      if (state.isMoving && !this.isRunning) {
        this.autoStartChronometer();
      } else if (!state.isMoving && this.isRunning) {
        // Only auto-stop if we've been stationary, not just slow
        if (state.isStationary) {
          this.autoStopChronometer();
        }
      }
    }

    // Log significant state changes
    const prevState = this.movementService.getCurrentState();
    if (state.isMoving !== prevState.isMoving) {
      console.log(`🚴‍♂️ Movement state changed: ${state.isMoving ? 'MOVING' : 'STOPPED'} (${state.speed.toFixed(1)} km/h)`);
    }
  }

  /**
   * Auto-start chronometer
   */
  private autoStartChronometer(): void {
    if (!this.isRunning) {
      console.log(`🚀 Auto-starting chronometer: ${this.currentSpeed.toFixed(1)} km/h`);
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
  }

  /**
   * Auto-stop chronometer
   */
  private autoStopChronometer(): void {
    if (this.isRunning) {
      console.log(`⏹️ Auto-stopping chronometer: stationary`);
      this.isRunning = false;
    }
  }

  /**
   * Handle GPS errors
   */
  private handleGPSError(): void {
    this.currentSpeed = 0;
    this.isMoving = false;
    this.gpsQuality = 'very_poor';

    // Auto-stop chronometer if it was running due to GPS
    if (this.isRunning && this.autoStartEnabled) {
      this.autoStopChronometer();
    }
  }

  // Configuration methods
  setStartThreshold(threshold: number): void {
    this.startThreshold = Math.max(1, threshold);
    this.stopThreshold = Math.max(0.5, threshold - 1);

    // Update service configuration
    this.movementService.updateConfig({
      startThreshold: this.startThreshold,
      stopThreshold: this.stopThreshold
    });
  }

  setStopDelay(delaySeconds: number): void {
    this.stopDelay = Math.max(1, delaySeconds) * 1000;
    this.movementService.updateConfig({
      stopDelay: this.stopDelay
    });
  }

  toggleAutoStart(): void {
    this.autoStartEnabled = !this.autoStartEnabled;
    console.log(`🔧 Auto-start ${this.autoStartEnabled ? 'enabled' : 'disabled'}`);
  }

  setIndoorMode(enabled: boolean): void {
    this.movementService.setIndoorMode(enabled);
  }

  // Status methods
  formatSpeed(speed: number): string {
    return speed.toFixed(1);
  }

  getSpeedStatus(): string {
    const state = this.movementService.getCurrentState();

    if (!this.isGPSEnabled) return 'GPS DISABLED';
    if (state.quality === 'very_poor') return 'GPS TOO WEAK';
    if (state.isStationary) return 'STATIONARY';
    if (state.isMoving) return 'MOVING';
    return 'STOPPED';
  }

  getGPSQuality(): { quality: string, color: string, description: string } {
    switch (this.gpsQuality) {
      case 'good':
        return {
          quality: 'GOOD',
          color: '#28a745',
          description: 'Accurate GPS signal'
        };
      case 'poor':
        return {
          quality: 'FAIR',
          color: '#ffc107',
          description: 'GPS signal present but less accurate'
        };
      case 'very_poor':
        return {
          quality: 'POOR',
          color: '#dc3545',
          description: 'GPS signal too weak for reliable tracking'
        };
      default:
        return {
          quality: 'UNKNOWN',
          color: '#6c757d',
          description: 'GPS status unknown'
        };
    }
  }

  getCyclingStats(): {
    distance: number,
    avgSpeed: number,
    maxSpeed: number,
    gpsQuality: string,
    isTracking: boolean
  } {
    const timeInHours = this.elapsedTime / (1000 * 60 * 60);
    const avgSpeed = this.currentSpeed; // Current smoothed speed from service
    const maxSpeed = this.currentSpeed; // Could track max separately if needed
    const distance = timeInHours * avgSpeed;

    return {
      distance: Math.max(0, distance),
      avgSpeed,
      maxSpeed,
      gpsQuality: this.gpsQuality,
      isTracking: this.isGPSEnabled
    };
  }

  getDebugInfo(): any {
    return {
      chronometer: {
        running: this.isRunning,
        autoStart: this.autoStartEnabled,
        elapsedTime: this.elapsedTime,
        currentSpeed: this.currentSpeed,
        isMoving: this.isMoving,
        gpsEnabled: this.isGPSEnabled,
        gpsQuality: this.gpsQuality
      },
      movementService: this.movementService.getDebugInfo()
    };
  }

  // Manual chronometer controls (unchanged)
  startStop(): void {
    if (this.isRunning) {
      this.isRunning = false;
    } else {
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
  }

  reset(): void {
    if (!this.isRunning) {
      this.elapsedTime = 0;
      this.startTime = 0;
      this.lapTimes = [];
    }
  }

  lap(): void {
    if (this.isRunning) {
      this.lapTimes.unshift(this.elapsedTime);
      if (this.lapTimes.length > 5) {
        this.lapTimes = this.lapTimes.slice(0, 5);
      }
    }
  }

  forceStop(): void {
    this.isRunning = false;
    console.log('🛑 Chronometer force stopped');
  }

  // Time formatting methods (unchanged)
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

  // Watch methods (unchanged)
  getCurrentTime(): string {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  getCurrentDate(): string {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  getCurrentTimezone(): string {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return timezone.split('/').pop() || 'LOCAL';
  }

  getUTCTime(): string {
    const now = new Date();
    return now.toUTCString().split(' ')[4];
  }

  getHourAngle(): number {
    const now = new Date();
    const hours = now.getHours() % 12;
    const minutes = now.getMinutes();
    return (hours * 30) + (minutes * 0.5);
  }

  getMinuteAngle(): number {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    return (minutes * 6) + (seconds * 0.1);
  }

  getSecondAngle(): number {
    const now = new Date();
    const seconds = now.getSeconds();
    const milliseconds = now.getMilliseconds();
    return (seconds * 6) + (milliseconds * 0.006);
  }

  getWorldTimes(): Array<{ city: string, time: string }> {
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
}