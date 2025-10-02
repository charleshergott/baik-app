import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { GpsService } from '../../services/gps.service';
import { OdometerService } from '../../services/odometer.service';
import { ChronometerService } from '../../services/chronometer.service';
import { MockGpsService } from '../../services/mock-gps.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-mock-gps-control',
  imports: [
    CommonModule,
    FormsModule
  ],
  standalone: true,
  templateUrl: './mock-gps-control.component.html',
  styleUrl: './mock-gps-control.component.scss'
})

export class MockGpsControlComponent implements OnInit, OnDestroy {

  // State
  isTracking = false;
  isRecording = false;
  currentSpeed = 0;
  tripDistance = 0;
  maxSpeed = 0;
  formattedTime = '00:00';
  gpsQuality: 'excellent' | 'good' | 'fair' | 'poor' = 'good';
  currentScenario = 'normal_ride';
  customSpeed = 25;
  speedThreshold = 5;
  mockState: any = null;

  // Scenarios
  scenarios = [
    { value: 'stationary', label: 'Stationary', icon: '🛑' },
    { value: 'slow_ride', label: 'Slow Ride', icon: '🚶' },
    { value: 'normal_ride', label: 'Normal Ride', icon: '🚴' },
    { value: 'fast_ride', label: 'Fast Ride', icon: '🏃' },
    { value: 'stop_and_go', label: 'Stop & Go', icon: '🚦' },
    { value: 'acceleration', label: 'Acceleration', icon: '🚀' },
    { value: 'custom', label: 'Custom', icon: '⚙️' }
  ];

  // Locations
  locations = [
    { name: 'New York', lat: 40.7128, lon: -74.0060, icon: '🗽' },
    { name: 'San Francisco', lat: 37.7749, lon: -122.4194, icon: '🌉' },
    { name: 'London', lat: 51.5074, lon: -0.1278, icon: '🇬🇧' },
    { name: 'Tokyo', lat: 35.6762, lon: 139.6503, icon: '🗼' },
    { name: 'Paris', lat: 48.8566, lon: 2.3522, icon: '🗼' }
  ];

  private subscriptions: Subscription[] = [];

  constructor(
    private gpsService: GpsService,
    private odometerService: OdometerService,
    private chronometerService: ChronometerService,
    private mockGpsService: MockGpsService
  ) { }

  ngOnInit(): void {
    // Subscribe to updates
    this.subscriptions.push(
      this.odometerService.getCurrentSpeed().subscribe(speed => {
        this.currentSpeed = speed;
      }),

      this.odometerService.getTripDistance().subscribe(distance => {
        this.tripDistance = distance;
      }),

      this.odometerService.getMaxSpeed().subscribe(speed => {
        this.maxSpeed = speed;
      }),

      this.chronometerService.state$.subscribe(state => {
        this.formattedTime = state.formattedTime;
      }),

      this.gpsService.getGpsQuality().subscribe(quality => {
        this.gpsQuality = quality;
      })
    );

    // Update mock state periodically
    setInterval(() => {
      this.mockState = this.gpsService.getMockState();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }

  toggleTracking(): void {
    if (this.isTracking) {
      this.gpsService.stopTracking();
      this.isTracking = false;
    } else {
      this.gpsService.startTracking();
      this.isTracking = true;
    }
  }

  setScenario(scenario: string): void {
    this.currentScenario = scenario;

    if (scenario === 'custom') {
      this.gpsService.setMockScenario(scenario, this.customSpeed);
    } else {
      this.gpsService.setMockScenario(scenario);
    }
  }

  setCustomSpeed(): void {
    if (this.currentScenario === 'custom') {
      this.gpsService.setMockScenario('custom', this.customSpeed);
    }
  }

  updateSpeedThreshold(): void {
    this.odometerService.setMinSpeedThreshold(this.speedThreshold);
  }

  teleportTo(location: any): void {
    this.mockGpsService.teleport(location.lat, location.lon);
    // Pause movement after teleport
    this.mockGpsService.setScenario('stationary');
    this.currentScenario = 'stationary';
  }

  simulateGoodSignal(): void {
    this.mockGpsService.simulateGoodSignal();
  }

  simulatePoorSignal(): void {
    this.mockGpsService.simulatePoorSignal();
  }

  resetStats(): void {
    this.odometerService.resetAll();
  }

  startRouteRecording(): void {
    this.gpsService.startRouteRecording();
    this.isRecording = true;
  }

  stopRouteRecording(): void {
    this.gpsService.stopRouteRecording();
    this.isRecording = false;
  }
}