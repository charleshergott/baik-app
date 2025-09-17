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

  // Cycling speed monitoring properties
  currentSpeed = 0; // in km/h
  startThreshold = 3; // km/h - speed to start chronometer
  stopThreshold = 1; // km/h - speed to stop chronometer (lower for hysteresis)
  autoStartEnabled = true;
  isGPSEnabled = false;
  private speedMonitoringInterval: any;
  private lastPosition: GeolocationPosition | null = null;
  private lastPositionTime = 0;

  // Speed history for smoothing and stop detection
  private speedHistory: number[] = [];
  private stoppedDuration = 0; // How long we've been below stop threshold
  private STOP_DELAY = 3000; // 3 seconds below threshold before stopping (ms)
  private lastSpeedCheck = 0;

  // Enhanced GPS accuracy and reliability settings
  private readonly MIN_ACCURACY = 10; // Stricter: 10 meters instead of 20
  private readonly MIN_TIME_BETWEEN_READINGS = 3000; // 3 seconds instead of 1 second
  private readonly MAX_REASONABLE_SPEED = 50; // km/h - ignore speeds above this
  private readonly MIN_DISTANCE_FOR_SPEED = 5; // meters - minimum distance to calculate speed

  // Enhanced stationary detection
  private readonly STATIONARY_RADIUS = 15; // meters - if all recent positions are within this radius, consider stationary
  private readonly STATIONARY_SAMPLE_COUNT = 5; // number of positions to check for stationary detection
  private positionHistory: GeolocationPosition[] = [];

  // Enhanced speed filtering
  private readonly SPEED_HISTORY_LENGTH = 12; // More samples for better smoothing
  private readonly MAX_SPEED_JUMP = 10; // km/h - ignore readings that jump more than this
  private lastValidSpeed = 0;

  // GPS quality monitoring
  private consecutivePoorReadings = 0;
  private readonly MAX_POOR_READINGS = 3;
  private gpsQuality: string = 'poor';

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
    this.initializeCyclingSpeedMonitoring();
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

  // Cycling-specific speed monitoring
  initializeCyclingSpeedMonitoring(): void {
    if ('geolocation' in navigator) {
      this.enableGPSSpeedMonitoring();
    } else {
      console.warn('Geolocation not supported, using manual speed input');
      // Fallback to simulated cycling speed for demo
      this.startCyclingSpeedSimulation();
    }
  }

  enableGPSSpeedMonitoring(): void {
    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 15000, // Increased timeout
      maximumAge: 1000 // Reduced maximum age for fresher readings
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.isGPSEnabled = true;
        this.lastPosition = position;
        this.lastPositionTime = Date.now();
        this.lastSpeedCheck = Date.now();
        this.positionHistory = [position]; // Initialize position history
        console.log('GPS enabled for cycling speed monitoring');

        // Start watching position changes
        navigator.geolocation.watchPosition(
          (newPosition) => this.calculateCyclingSpeedFromGPS(newPosition),
          (error) => {
            console.error('GPS error:', error);
            this.isGPSEnabled = false;
            this.handleGPSError();
          },
          options
        );
      },
      (error) => {
        console.error('GPS initialization failed:', error);
        this.isGPSEnabled = false;
        this.handleGPSError();
      },
      options
    );
  }

  private handleGPSError(): void {
    // Reset all GPS-related state
    this.currentSpeed = 0;
    this.positionHistory = [];
    this.speedHistory = [];
    this.gpsQuality = 'very_poor';

    // Auto-stop chronometer if it was running due to GPS
    if (this.isRunning && this.autoStartEnabled) {
      this.autoStopChronometer();
    }

    // Optionally start simulation for demo/testing
    // this.startCyclingSpeedSimulation();
    console.log('GPS tracking disabled due to errors');
  }

  calculateCyclingSpeedFromGPS(position: GeolocationPosition): void {
    const currentTime = Date.now();

    // Enhanced accuracy check
    if (position.coords.accuracy > this.MIN_ACCURACY) {
      this.consecutivePoorReadings++;
      console.log(`GPS accuracy too low: ${position.coords.accuracy.toFixed(1)}m (need <${this.MIN_ACCURACY}m)`);

      if (this.consecutivePoorReadings >= this.MAX_POOR_READINGS) {
        this.gpsQuality = 'very_poor';
        this.currentSpeed = 0; // Set speed to 0 when GPS is unreliable
        this.updateCyclingSpeed(0);
      }
      return;
    }

    // Reset poor readings counter on good reading
    this.consecutivePoorReadings = 0;
    this.gpsQuality = position.coords.accuracy <= 5 ? 'good' : 'poor';

    // Check if enough time has passed
    if (currentTime - this.lastPositionTime < this.MIN_TIME_BETWEEN_READINGS) {
      return;
    }

    // Add to position history for stationary detection
    this.positionHistory.push(position);
    if (this.positionHistory.length > this.STATIONARY_SAMPLE_COUNT) {
      this.positionHistory.shift();
    }

    // Check if we're stationary (all recent positions within a small radius)
    if (this.isStationary()) {
      console.log('📍 Detected stationary - setting speed to 0');
      this.updateCyclingSpeed(0);
      this.lastPosition = position;
      this.lastPositionTime = currentTime;
      return;
    }

    if (!this.lastPosition) {
      this.lastPosition = position;
      this.lastPositionTime = currentTime;
      return;
    }

    const timeDiff = (currentTime - this.lastPositionTime) / 1000; // seconds

    if (timeDiff > 0) {
      // Calculate distance using Haversine formula
      const distance = this.calculateDistance(
        this.lastPosition.coords.latitude,
        this.lastPosition.coords.longitude,
        position.coords.latitude,
        position.coords.longitude
      );

      // Only calculate speed if we've moved a meaningful distance
      if (distance < this.MIN_DISTANCE_FOR_SPEED) {
        console.log(`Distance too small: ${distance.toFixed(1)}m (need >${this.MIN_DISTANCE_FOR_SPEED}m)`);
        this.updateCyclingSpeed(0);
        this.lastPosition = position;
        this.lastPositionTime = currentTime;
        return;
      }

      // Convert to km/h
      let calculatedSpeed = (distance / timeDiff) * 3.6;

      // Use GPS speed if available and reasonable
      if (position.coords.speed !== null && position.coords.speed >= 0) {
        const gpsSpeedKmh = position.coords.speed * 3.6;

        // Use GPS speed if it's reasonable and close to calculated speed
        if (gpsSpeedKmh <= this.MAX_REASONABLE_SPEED &&
          Math.abs(gpsSpeedKmh - calculatedSpeed) < 8) {
          calculatedSpeed = gpsSpeedKmh;
          console.log(`Using GPS speed: ${gpsSpeedKmh.toFixed(1)} km/h`);
        } else {
          console.log(`GPS speed ${gpsSpeedKmh.toFixed(1)} rejected, using calculated ${calculatedSpeed.toFixed(1)} km/h`);
        }
      }

      // Filter out unreasonable speeds
      if (calculatedSpeed > this.MAX_REASONABLE_SPEED) {
        console.log(`Speed ${calculatedSpeed.toFixed(1)} km/h too high, ignoring`);
        return;
      }

      // Filter out sudden speed jumps (likely GPS errors)
      if (this.lastValidSpeed > 0 &&
        Math.abs(calculatedSpeed - this.lastValidSpeed) > this.MAX_SPEED_JUMP) {
        console.log(`Speed jump too large: ${this.lastValidSpeed.toFixed(1)} -> ${calculatedSpeed.toFixed(1)} km/h, ignoring`);
        return;
      }

      this.lastValidSpeed = calculatedSpeed;
      this.updateCyclingSpeed(calculatedSpeed);

      console.log(`Valid speed: ${calculatedSpeed.toFixed(1)} km/h, distance: ${distance.toFixed(1)}m, time: ${timeDiff.toFixed(1)}s, accuracy: ${position.coords.accuracy.toFixed(1)}m`);

      this.lastPosition = position;
      this.lastPositionTime = currentTime;
    }
  }

  private isStationary(): boolean {
    if (this.positionHistory.length < 3) {
      return false; // Need at least 3 positions to determine
    }

    // Calculate the center point of recent positions
    const centerLat = this.positionHistory.reduce((sum, pos) => sum + pos.coords.latitude, 0) / this.positionHistory.length;
    const centerLon = this.positionHistory.reduce((sum, pos) => sum + pos.coords.longitude, 0) / this.positionHistory.length;

    // Check if all positions are within the stationary radius
    const allWithinRadius = this.positionHistory.every(pos => {
      const distance = this.calculateDistance(
        centerLat, centerLon,
        pos.coords.latitude, pos.coords.longitude
      );
      return distance <= this.STATIONARY_RADIUS;
    });

    return allWithinRadius;
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

  startCyclingSpeedSimulation(): void {
    // Simulate realistic cycling speeds (0-25 km/h with stops)
    let simulatedSpeed = 0;
    let phase = 'stopped'; // 'stopped', 'accelerating', 'cruising', 'slowing'
    let phaseTimer = 0;

    this.speedMonitoringInterval = setInterval(() => {
      phaseTimer += 2000;

      switch (phase) {
        case 'stopped':
          simulatedSpeed = 0;
          if (phaseTimer > 5000) { // Stop for 5 seconds
            phase = 'accelerating';
            phaseTimer = 0;
          }
          break;

        case 'accelerating':
          simulatedSpeed += 2 + Math.random() * 3;
          if (simulatedSpeed >= 15 || phaseTimer > 10000) {
            phase = 'cruising';
            phaseTimer = 0;
          }
          break;

        case 'cruising':
          simulatedSpeed = 15 + Math.random() * 8 - 4; // 11-19 km/h range
          if (phaseTimer > 15000) { // Cruise for 15 seconds
            phase = 'slowing';
            phaseTimer = 0;
          }
          break;

        case 'slowing':
          simulatedSpeed -= 2 + Math.random() * 2;
          if (simulatedSpeed <= 0 || phaseTimer > 8000) {
            simulatedSpeed = 0;
            phase = 'stopped';
            phaseTimer = 0;
          }
          break;
      }

      simulatedSpeed = Math.max(0, simulatedSpeed);
      this.updateCyclingSpeed(simulatedSpeed);
    }, 2000);
  }

  updateCyclingSpeed(newSpeed: number): void {
    const currentTime = Date.now();

    // Don't update speed if GPS quality is very poor
    if (this.gpsQuality === 'very_poor') {
      console.log('GPS quality very poor, not updating speed');
      return;
    }

    // Add to speed history for smoothing
    this.speedHistory.push(newSpeed);
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    // Calculate smoothed speed with weighted average (recent readings count more)
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < this.speedHistory.length; i++) {
      const weight = (i + 1) / this.speedHistory.length; // More recent = higher weight
      weightedSum += this.speedHistory[i] * weight;
      totalWeight += weight;
    }

    const smoothedSpeed = totalWeight > 0 ? weightedSum / totalWeight : 0;
    this.currentSpeed = Math.max(0, smoothedSpeed);

    // Enhanced auto-start/stop logic
    if (this.autoStartEnabled && this.gpsQuality !== 'very_poor') {
      // Only start if we have good GPS quality and consistent speed
      if (this.currentSpeed >= this.startThreshold && !this.isRunning) {
        // Require consistent speed above threshold
        const recentSpeeds = this.speedHistory.slice(-3); // Last 3 readings
        const allAboveThreshold = recentSpeeds.length >= 2 &&
          recentSpeeds.every(speed => speed >= this.startThreshold * 0.8);

        if (allAboveThreshold) {
          this.autoStartChronometer();
          this.stoppedDuration = 0;
        }
      } else if (this.currentSpeed <= this.stopThreshold && this.isRunning) {
        // Start counting how long we've been below threshold
        if (this.stoppedDuration === 0) {
          this.stoppedDuration = currentTime;
        } else if (currentTime - this.stoppedDuration >= this.STOP_DELAY) {
          this.autoStopChronometer();
        }
      } else if (this.currentSpeed > this.stopThreshold) {
        // Reset stopped duration if speed goes back up
        this.stoppedDuration = 0;
      }
    }
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
    positionCount: number
  } {
    // Calculate approximate distance traveled
    const timeInHours = this.elapsedTime / (1000 * 60 * 60);
    const avgSpeed = this.speedHistory.length > 0 ?
      this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length : 0;
    const maxSpeed = Math.max(...this.speedHistory, 0);
    const distance = timeInHours * avgSpeed;

    return {
      distance: Math.max(0, distance),
      avgSpeed,
      maxSpeed,
      gpsQuality: this.gpsQuality,
      positionCount: this.positionHistory.length
    };
  }

  toggleGPSQuality(): void {
    const qualities = ['good', 'poor', 'very_poor'] as const;
    const currentIndex = qualities.indexOf(this.gpsQuality as any);
    this.gpsQuality = qualities[(currentIndex + 1) % qualities.length];
    console.log(`GPS quality manually set to: ${this.gpsQuality}`);
  }

  autoStartChronometer(): void {
    console.log(`🚴‍♂️ Auto-starting: Speed ${this.currentSpeed.toFixed(1)} km/h >= ${this.startThreshold} km/h`);
    if (!this.isRunning) {
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
  }

  autoStopChronometer(): void {
    console.log(`🛑 Auto-stopping: Speed ${this.currentSpeed.toFixed(1)} km/h <= ${this.stopThreshold} km/h for ${this.STOP_DELAY / 1000}s`);
    if (this.isRunning) {
      this.isRunning = false;
      this.stoppedDuration = 0; // Reset for next time
    }
  }

  // Manual speed input method
  setManualSpeed(speed: number): void {
    this.updateCyclingSpeed(speed);
  }

  // Settings methods
  setStartThreshold(threshold: number): void {
    this.startThreshold = Math.max(1, threshold);
    this.stopThreshold = Math.max(0.5, threshold - 1); // Always lower than start
  }

  setStopDelay(delaySeconds: number): void {
    this.STOP_DELAY = Math.max(1, delaySeconds) * 1000;
  }

  toggleAutoStart(): void {
    this.autoStartEnabled = !this.autoStartEnabled;
    if (!this.autoStartEnabled && this.isRunning) {
      console.log('🔧 Auto-start disabled - chronometer continues in manual mode');
    }
    this.stoppedDuration = 0; // Reset stopped duration
  }

  // Speed formatting
  formatSpeed(speed: number): string {
    return speed.toFixed(1);
  }

  getSpeedStatus(): string {
    if (this.stoppedDuration > 0) {
      const timeToStop = Math.max(0, this.STOP_DELAY - (Date.now() - this.stoppedDuration));
      return `STOPPING IN ${Math.ceil(timeToStop / 1000)}s`;
    } else if (this.currentSpeed >= this.startThreshold) {
      return 'MOVING';
    } else {
      return 'STOPPED';
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
      this.speedHistory = [];
      this.stoppedDuration = 0;
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