import { Component, OnDestroy, OnInit } from '@angular/core';
import { ItineraryPoint } from '../../interfaces/master';
import { CommonModule, DatePipe } from '@angular/common';

@Component({
  selector: 'app-itinerary',
  imports: [
    DatePipe,
    CommonModule
  ],
  templateUrl: './itinerary.component.html',
  styleUrl: './itinerary.component.scss'
})

export class ItineraryComponent implements OnInit, OnDestroy {
  points: ItineraryPoint[] = [];
  isRecording = false;
  gpsAvailable = false;
  currentPosition: GeolocationPosition | null = null;

  private recordingInterval: any;
  private recordingStartTime: Date | null = null;
  private pointCounter = 1;
  private watchId: number | null = null;

  recordingDuration = 0;
  private durationInterval: any;

  // Movement detection properties
  currentSpeed = 0; // km/h
  movementThreshold = 2; // km/h - minimum speed to record points
  isMoving = false;
  private lastPosition: GeolocationPosition | null = null;
  private lastPositionTime = 0;
  private speedHistory: number[] = [];
  private readonly SPEED_HISTORY_LENGTH = 5;
  private readonly MIN_ACCURACY = 20; // meters
  private readonly MIN_TIME_BETWEEN_READINGS = 2000; // ms

  // Movement status tracking
  stationaryDuration = 0;
  private stationaryStartTime = 0;
  private stationaryInterval: any;

  ngOnInit() {
    this.checkGpsAvailability();
    this.loadSavedItinerary();
  }

  ngOnDestroy() {
    this.stopRecording();
    this.stopWatchingPosition();
    this.stopStationaryTimer();
  }

  private checkGpsAvailability() {
    this.gpsAvailable = 'geolocation' in navigator;
  }

  private loadSavedItinerary() {
    const saved = localStorage.getItem('bicycle-itinerary');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.points = parsed.map((p: any) => ({
          ...p,
          timestamp: new Date(p.timestamp)
        }));
        this.pointCounter = this.points.length > 0 ? Math.max(...this.points.map(p => p.id)) + 1 : 1;
      } catch (e) {
        console.error('Error loading saved itinerary:', e);
      }
    }
  }

  private saveItinerary() {
    localStorage.setItem('bicycle-itinerary', JSON.stringify(this.points));
  }

  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private startRecording() {
    if (!this.gpsAvailable) return;

    this.isRecording = true;
    this.recordingStartTime = new Date();
    this.recordingDuration = 0;
    this.currentSpeed = 0;
    this.isMoving = false;
    this.speedHistory = [];

    // Start watching position for real-time updates and movement detection
    this.startWatchingPosition();

    // Record initial point immediately (even if stationary)
    this.recordCurrentPosition(true);

    // Set up 30-second interval for recording (only when moving)
    this.recordingInterval = setInterval(() => {
      this.checkAndRecordPosition();
    }, 30000);

    // Set up duration counter
    this.durationInterval = setInterval(() => {
      if (this.recordingStartTime) {
        this.recordingDuration = Math.floor((Date.now() - this.recordingStartTime.getTime()) / 1000);
      }
    }, 1000);

    // Start stationary timer
    this.startStationaryTimer();
  }

  private stopRecording() {
    this.isRecording = false;
    this.recordingStartTime = null;
    this.recordingDuration = 0;
    this.currentSpeed = 0;
    this.isMoving = false;
    this.stationaryDuration = 0;

    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    this.stopWatchingPosition();
    this.stopStationaryTimer();

    // Record final point when stopping
    if (this.currentPosition) {
      this.recordCurrentPosition(true);
    }
  }

  private startWatchingPosition() {
    if (!this.gpsAvailable) return;

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 2000
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.currentPosition = position;
        this.calculateMovementFromGPS(position);
      },
      (error) => {
        console.error('GPS error:', error);
      },
      options
    );
  }

  private stopWatchingPosition() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private startStationaryTimer() {
    this.stationaryInterval = setInterval(() => {
      if (!this.isMoving && this.stationaryStartTime > 0) {
        this.stationaryDuration = Math.floor((Date.now() - this.stationaryStartTime) / 1000);
      }
    }, 1000);
  }

  private stopStationaryTimer() {
    if (this.stationaryInterval) {
      clearInterval(this.stationaryInterval);
      this.stationaryInterval = null;
    }
  }

  private calculateMovementFromGPS(position: GeolocationPosition): void {
    const currentTime = Date.now();

    // Check GPS accuracy
    if (position.coords.accuracy > this.MIN_ACCURACY) {
      return;
    }

    // Check if enough time has passed
    if (currentTime - this.lastPositionTime < this.MIN_TIME_BETWEEN_READINGS) {
      return;
    }

    if (!this.lastPosition) {
      this.lastPosition = position;
      this.lastPositionTime = currentTime;
      return;
    }

    const timeDiff = (currentTime - this.lastPositionTime) / 1000;

    if (timeDiff > 0) {
      let speed = 0;

      // Use GPS speed if available and reasonable
      if (position.coords.speed !== null && position.coords.speed >= 0) {
        speed = position.coords.speed * 3.6; // Convert m/s to km/h
      } else {
        // Calculate speed from position change
        const distance = this.calculateDistance(
          this.lastPosition.coords.latitude,
          this.lastPosition.coords.longitude,
          position.coords.latitude,
          position.coords.longitude
        );
        speed = (distance / timeDiff) * 3.6;
      }

      this.updateMovementStatus(speed);

      this.lastPosition = position;
      this.lastPositionTime = currentTime;
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

  private updateMovementStatus(newSpeed: number): void {
    // Add to speed history for smoothing
    this.speedHistory.push(newSpeed);
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    // Calculate smoothed speed
    this.currentSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;

    const wasMoving = this.isMoving;
    this.isMoving = this.currentSpeed >= this.movementThreshold;

    // Track stationary time
    if (!this.isMoving && wasMoving) {
      // Just stopped moving
      this.stationaryStartTime = Date.now();
      this.stationaryDuration = 0;
    } else if (this.isMoving && !wasMoving) {
      // Just started moving
      this.stationaryStartTime = 0;
      this.stationaryDuration = 0;
    }
  }

  private checkAndRecordPosition() {
    if (!this.isRecording) return;

    if (this.isMoving) {
      console.log(`📍 Recording point: Moving at ${this.currentSpeed.toFixed(1)} km/h`);
      this.recordCurrentPosition();
    } else {
      console.log(`⏸️ Skipping point: Stationary at ${this.currentSpeed.toFixed(1)} km/h`);
    }
  }

  private recordCurrentPosition(forceRecord: boolean = false) {
    if (!this.gpsAvailable) return;

    // Only record if moving, unless forced (start/stop points)
    if (!forceRecord && !this.isMoving) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: ItineraryPoint = {
          id: this.pointCounter++,
          timestamp: new Date(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          accuracy: position.coords.accuracy
        };

        this.points.push(point);
        this.saveItinerary();

        if (forceRecord) {
          console.log(`📍 Forced recording: ${this.isMoving ? 'Moving' : 'Stationary'} point`);
        }
      },
      (error) => {
        console.error('Error getting GPS position:', error);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }

  clearItinerary() {
    if (confirm('Are you sure you want to clear all recorded points?')) {
      this.points = [];
      this.pointCounter = 1;
      this.saveItinerary();
    }
  }

  // Settings methods
  setMovementThreshold(threshold: number): void {
    this.movementThreshold = Math.max(0.5, threshold);
  }

  // Status and formatting methods
  getMovementStatus(): string {
    if (!this.isRecording) return 'NOT RECORDING';

    if (this.isMoving) {
      return `MOVING (${this.currentSpeed.toFixed(1)} km/h)`;
    } else {
      return `STATIONARY (${this.formatDuration(this.stationaryDuration)})`;
    }
  }

  getRecordingStats(): { totalPoints: number, movingPoints: number, stationaryPoints: number } {
    // This is a simplified calculation - in a real app you'd track this more precisely
    return {
      totalPoints: this.points.length,
      movingPoints: Math.floor(this.points.length * 0.8), // Estimate
      stationaryPoints: Math.floor(this.points.length * 0.2) // Estimate
    };
  }

  formatSpeed(speed: number | null): string {
    if (speed === null || speed < 0) return 'N/A';
    // Convert m/s to km/h
    const kmh = speed * 3.6;
    return `${kmh.toFixed(1)} km/h`;
  }

  formatAltitude(altitude: number | null): string {
    if (altitude === null) return 'N/A';
    return `${altitude.toFixed(1)}m`;
  }

  formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  formatCurrentSpeed(): string {
    return `${this.currentSpeed.toFixed(1)} km/h`;
  }
}