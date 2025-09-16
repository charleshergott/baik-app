import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';

@Component({
  selector: 'app-chronometer',
  imports: [
    CommonModule
  ],
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

  // Watch properties
  private currentTimeInterval: any;

  // Speed monitoring properties
  currentSpeed = 0; // in knots
  speedThreshold = 30; // knots
  autoStartEnabled = true;
  isGPSEnabled = false;
  private speedMonitoringInterval: any;
  private lastPosition: GeolocationPosition | null = null;
  private lastPositionTime = 0;

  // Speed history for smoothing
  private speedHistory: number[] = [];
  private readonly SPEED_HISTORY_LENGTH = 5;

  ngOnInit(): void {
    // Auto-start interval for smooth chronometer updates
    this.intervalId = setInterval(() => {
      if (this.isRunning) {
        this.elapsedTime = Date.now() - this.startTime;
      }
    }, 10); // Update every 10ms for smooth display

    // Update current time every second for the watch
    this.currentTimeInterval = setInterval(() => {
      // This will trigger change detection for time updates
    }, 1000);

    // Initialize speed monitoring
    this.initializeSpeedMonitoring();
  }

  ngOnDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    if (this.currentTimeInterval) {
      clearInterval(this.currentTimeInterval);
    }
    if (this.speedMonitoringInterval) {
      clearInterval(this.speedMonitoringInterval);
    }
  }

  // Speed monitoring methods
  initializeSpeedMonitoring(): void {
    if ('geolocation' in navigator) {
      this.enableGPSSpeedMonitoring();
    } else {
      console.warn('Geolocation not supported, using manual speed input');
      // Fallback to simulated speed for demo purposes
      this.startSpeedSimulation();
    }
  }

  enableGPSSpeedMonitoring(): void {
    const options = {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 1000
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.isGPSEnabled = true;
        this.lastPosition = position;
        this.lastPositionTime = Date.now();
        console.log('GPS enabled for speed monitoring');

        // Start watching position changes
        navigator.geolocation.watchPosition(
          (newPosition) => this.calculateSpeedFromGPS(newPosition),
          (error) => {
            console.error('GPS error:', error);
            this.isGPSEnabled = false;
            this.startSpeedSimulation();
          },
          options
        );
      },
      (error) => {
        console.error('GPS initialization failed:', error);
        this.isGPSEnabled = false;
        this.startSpeedSimulation();
      },
      options
    );
  }

  calculateSpeedFromGPS(position: GeolocationPosition): void {
    if (!this.lastPosition) {
      this.lastPosition = position;
      this.lastPositionTime = Date.now();
      return;
    }

    const currentTime = Date.now();
    const timeDiff = (currentTime - this.lastPositionTime) / 1000; // seconds

    if (timeDiff > 0) {
      // Calculate distance using Haversine formula
      const distance = this.calculateDistance(
        this.lastPosition.coords.latitude,
        this.lastPosition.coords.longitude,
        position.coords.latitude,
        position.coords.longitude
      );

      // Convert to knots (nautical miles per hour)
      const speedKnots = (distance / timeDiff) * 3600 / 1852;

      this.updateSpeed(speedKnots);

      this.lastPosition = position;
      this.lastPositionTime = currentTime;
    }
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

    return R * c; // Distance in meters
  }

  startSpeedSimulation(): void {
    // Simulate speed changes for demo purposes
    let simulatedSpeed = 0;
    let increasing = true;

    this.speedMonitoringInterval = setInterval(() => {
      if (increasing) {
        simulatedSpeed += Math.random() * 3;
        if (simulatedSpeed >= 40) increasing = false;
      } else {
        simulatedSpeed -= Math.random() * 2;
        if (simulatedSpeed <= 0) {
          simulatedSpeed = 0;
          increasing = true;
        }
      }

      this.updateSpeed(simulatedSpeed);
    }, 2000);
  }

  updateSpeed(newSpeed: number): void {
    // Add to speed history for smoothing
    this.speedHistory.push(newSpeed);
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    // Calculate smoothed speed (average of recent readings)
    const smoothedSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    this.currentSpeed = Math.max(0, smoothedSpeed);

    // Auto-start/stop logic
    if (this.autoStartEnabled) {
      if (this.currentSpeed >= this.speedThreshold && !this.isRunning) {
        this.autoStartChronometer();
      } else if (this.currentSpeed < this.speedThreshold && this.isRunning) {
        this.autoStopChronometer();
      }
    }
  }

  autoStartChronometer(): void {
    console.log(`Auto-starting chronometer: Speed ${this.currentSpeed.toFixed(1)} kn >= ${this.speedThreshold} kn`);
    if (!this.isRunning) {
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
  }

  autoStopChronometer(): void {
    console.log(`Auto-stopping chronometer: Speed ${this.currentSpeed.toFixed(1)} kn < ${this.speedThreshold} kn`);
    if (this.isRunning) {
      this.isRunning = false;
    }
  }

  // Manual speed input method
  setManualSpeed(speed: number): void {
    this.updateSpeed(speed);
  }

  // Settings methods
  setSpeedThreshold(threshold: number): void {
    this.speedThreshold = threshold;
  }

  toggleAutoStart(): void {
    this.autoStartEnabled = !this.autoStartEnabled;
    if (!this.autoStartEnabled && this.isRunning) {
      // If auto-start is disabled while running, keep running but mark as manual
      console.log('Auto-start disabled - chronometer continues in manual mode');
    }
  }

  // Speed formatting
  formatSpeed(speed: number): string {
    return speed.toFixed(1);
  }

  getSpeedStatus(): string {
    if (this.currentSpeed >= this.speedThreshold) {
      return 'ABOVE THRESHOLD';
    } else {
      return 'BELOW THRESHOLD';
    }
  }

  // Chronometer methods (unchanged)
  startStop(): void {
    if (this.isRunning) {
      // Stop
      this.isRunning = false;
    } else {
      // Start
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