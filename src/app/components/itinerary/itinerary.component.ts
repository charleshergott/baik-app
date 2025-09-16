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

  ngOnInit() {
    this.checkGpsAvailability();
    this.loadSavedItinerary();
  }

  ngOnDestroy() {
    this.stopRecording();
    this.stopWatchingPosition();
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

    // Start watching position for real-time updates
    this.startWatchingPosition();

    // Record point immediately
    this.recordCurrentPosition();

    // Set up 30-second interval for recording
    this.recordingInterval = setInterval(() => {
      this.recordCurrentPosition();
    }, 30000);

    // Set up duration counter
    this.durationInterval = setInterval(() => {
      if (this.recordingStartTime) {
        this.recordingDuration = Math.floor((Date.now() - this.recordingStartTime.getTime()) / 1000);
      }
    }, 1000);
  }

  private stopRecording() {
    this.isRecording = false;
    this.recordingStartTime = null;
    this.recordingDuration = 0;

    if (this.recordingInterval) {
      clearInterval(this.recordingInterval);
      this.recordingInterval = null;
    }

    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }

    this.stopWatchingPosition();
  }

  private startWatchingPosition() {
    if (!this.gpsAvailable) return;

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.currentPosition = position;
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

  private recordCurrentPosition() {
    if (!this.gpsAvailable) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point: ItineraryPoint = {
          id: this.pointCounter++,
          timestamp: new Date(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          altitude: position.coords.altitude,
          speed: position.coords.speed, // This is in m/s
          accuracy: position.coords.accuracy
        };

        this.points.push(point);
        this.saveItinerary();
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
}