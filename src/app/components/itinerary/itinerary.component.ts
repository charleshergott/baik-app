import { Component, OnDestroy, OnInit } from '@angular/core';
import { CyclingTrip, ItineraryPoint } from '../../interfaces/master';
import { CommonModule, DatePipe } from '@angular/common';
import { CyclingDataService } from '../../services/cycling-data.service';


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

  // Trip and distance tracking
  currentTrip: CyclingTrip | null = null;
  currentTripId: string | null = null;
  allTrips: CyclingTrip[] = [];
  totalDistanceAllTrips = 0;

  constructor(
    private cyclingDataService: CyclingDataService
  ) { }

  async ngOnInit() {
    this.checkGpsAvailability();
    await this.initializeData();
  }



  private checkGpsAvailability() {
    this.gpsAvailable = 'geolocation' in navigator;
  }

  copyCoordinates(lat: number, lng: number): void {
    const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(coords).then(() => {
      // Optional: Show toast notification
      console.log('Coordinates copied to clipboard');
    });
  }

  private async initializeData() {
    try {
      // Migrate old localStorage data if it exists
      await this.cyclingDataService.migrateFromLocalStorage();

      // Load all trips to calculate total distance
      await this.loadAllTrips();

      // Check if there's an active trip for today
      await this.loadOrCreateTodaysTrip();

    } catch (error) {
      console.error('Error initializing data:', error);
    }
  }

  private async loadAllTrips() {
    try {
      this.allTrips = await this.cyclingDataService.getAllTrips();

      // Calculate total distance across all completed trips
      this.totalDistanceAllTrips = this.allTrips
        .filter(trip => trip.isCompleted)
        .reduce((total, trip) => total + trip.totalDistance, 0);

    } catch (error) {
      console.error('Error loading trips:', error);
    }
  }

  private async loadOrCreateTodaysTrip() {
    const todayId = this.cyclingDataService.getTodayTripId();

    try {
      let trip = await this.cyclingDataService.getTrip(todayId);

      if (!trip) {
        // Create new trip for today
        await this.cyclingDataService.createTrip(new Date());
        trip = await this.cyclingDataService.getTrip(todayId);
      }

      if (trip) {
        this.currentTrip = trip;
        this.currentTripId = todayId;
        this.points = [...trip.points];
        this.pointCounter = this.points.length > 0 ? Math.max(...this.points.map(p => p.id)) + 1 : 1;

        // If trip is not completed and has points, it might have been interrupted
        if (!trip.isCompleted && trip.points.length > 0) {
          console.log('Found incomplete trip with existing points');
        }
      }
    } catch (error) {
      console.error('Error loading today\'s trip:', error);
    }
  }

  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  private startRecording() {
    if (!this.gpsAvailable || !this.currentTripId) return;

    this.isRecording = true;
    this.recordingStartTime = new Date();
    this.recordingDuration = 0;
    this.currentSpeed = 0;
    this.isMoving = false;
    this.speedHistory = [];

    // Update trip start time if this is the first recording session
    if (this.currentTrip && this.currentTrip.points.length === 0) {
      this.currentTrip.startTime = this.recordingStartTime;
    }

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

  private async stopRecording() {
    this.isRecording = false;
    const endTime = new Date();
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
      await this.recordCurrentPosition(true);
    }

    // Mark trip as completed if it has points
    if (this.currentTripId && this.points.length > 0) {
      try {
        await this.cyclingDataService.completeTrip(this.currentTripId);
        // Reload data to get updated statistics
        await this.loadAllTrips();
        await this.loadOrCreateTodaysTrip();
      } catch (error) {
        console.error('Error completing trip:', error);
      }
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

  private async recordCurrentPosition(forceRecord: boolean = false) {
    if (!this.gpsAvailable || !this.currentTripId) return;

    // Only record if moving, unless forced (start/stop points)
    if (!forceRecord && !this.isMoving) return;

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const point: ItineraryPoint = {
          id: this.pointCounter++,
          timestamp: new Date(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          speed: position.coords.speed,
          accuracy: position.coords.accuracy
        };

        // Add to local array for immediate UI update
        this.points.push(point);

        // Save to IndexedDB
        try {
          await this.cyclingDataService.addPointToTrip(this.currentTripId!, point);
          // Reload current trip to get updated statistics
          this.currentTrip = await this.cyclingDataService.getTrip(this.currentTripId!);
        } catch (error) {
          console.error('Error saving point to trip:', error);
        }

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

  async clearAllData() {
    if (confirm('Are you sure you want to clear all trip data? This cannot be undone.')) {
      try {
        await this.cyclingDataService.clearAllTrips();
        this.points = [];
        this.pointCounter = 1;
        this.currentTrip = null;
        this.currentTripId = null;
        this.allTrips = [];
        this.totalDistanceAllTrips = 0;

        // Create new trip for today
        await this.loadOrCreateTodaysTrip();
      } catch (error) {
        console.error('Error clearing all data:', error);
      }
    }
  }

  async clearTodaysTrip() {
    if (confirm('Are you sure you want to clear today\'s trip data?')) {
      if (this.currentTripId) {
        try {
          await this.cyclingDataService.deleteTrip(this.currentTripId);
          this.points = [];
          this.pointCounter = 1;
          await this.loadOrCreateTodaysTrip();
          await this.loadAllTrips();
        } catch (error) {
          console.error('Error clearing today\'s trip:', error);
        }
      }
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

  // Distance and statistics methods
  getCurrentTripDistance(): number {
    return this.currentTrip?.totalDistance || 0;
  }

  getTotalDistance(): number {
    const completedTripsDistance = this.totalDistanceAllTrips;
    const currentTripDistance = this.getCurrentTripDistance();
    return completedTripsDistance + currentTripDistance;
  }

  getCurrentTripAverageSpeed(): number {
    return this.currentTrip?.averageSpeed || 0;
  }

  getCurrentTripMaxSpeed(): number {
    if (!this.currentTrip?.maxSpeed) return 0;
    return this.currentTrip.maxSpeed * 3.6; // Convert m/s to km/h
  }

  getRecordingStats(): {
    totalPoints: number;
    tripPoints: number;
    allTripsCount: number;
    completedTrips: number;
  } {
    return {
      totalPoints: this.allTrips.reduce((sum, trip) => sum + trip.points.length, 0),
      tripPoints: this.points.length,
      allTripsCount: this.allTrips.length,
      completedTrips: this.allTrips.filter(trip => trip.isCompleted).length
    };
  }

  // Formatting methods
  formatDistance(distanceInMeters: number): string {
    if (distanceInMeters < 1000) {
      return `${Math.round(distanceInMeters)}m`;
    } else {
      return `${(distanceInMeters / 1000).toFixed(2)}km`;
    }
  }

  formatTotalDistance(): string {
    return this.formatDistance(this.getTotalDistance());
  }

  formatCurrentTripDistance(): string {
    return this.formatDistance(this.getCurrentTripDistance());
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

  formatAverageSpeed(): string {
    return `${this.getCurrentTripAverageSpeed().toFixed(1)} km/h`;
  }

  formatMaxSpeed(): string {
    return `${this.getCurrentTripMaxSpeed().toFixed(1)} km/h`;
  }

  // Get comprehensive trip statistics
  getTripStats(): {
    totalDistance: string;
    currentTripDistance: string;
    averageSpeed: string;
    maxSpeed: string;
    recordingTime: string;
    pointsRecorded: number;
    allTripsCount: number;
  } {
    return {
      totalDistance: this.formatTotalDistance(),
      currentTripDistance: this.formatCurrentTripDistance(),
      averageSpeed: this.formatAverageSpeed(),
      maxSpeed: this.formatMaxSpeed(),
      recordingTime: this.formatDuration(this.recordingDuration),
      pointsRecorded: this.points.length,
      allTripsCount: this.allTrips.length
    };
  }

  // Get recent trips for display
  getRecentTrips(limit: number = 5): CyclingTrip[] {
    return this.allTrips
      .filter(trip => trip.isCompleted)
      .slice(0, limit);
  }

  ngOnDestroy() {
    this.stopRecording();
    this.stopWatchingPosition();
    this.stopStationaryTimer();
  }
}