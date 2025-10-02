import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { MockGPSConfig, MockScenario, Position } from '../interfaces/master';


@Injectable({
  providedIn: 'root'
})

export class MockGpsService {

  private currentPosition$ = new BehaviorSubject<Position | null>(null);
  private isRunning = false;
  private updateSubscription?: Subscription;

  // Current state
  private currentLat = 40.7128; // Default: New York City
  private currentLon = -74.0060;
  private currentSpeed = 0; // m/s
  private currentHeading = 0; // degrees
  private currentAccuracy = 10; // meters
  private startTime = Date.now();

  // Configuration
  private config: MockGPSConfig = {
    scenario: 'normal_ride',
    updateInterval: 1000,
    enableNoise: true
  };

  constructor() { }

  /**
   * Start generating mock GPS data
   */
  startMockGPS(config?: Partial<MockGPSConfig>): void {
    if (this.isRunning) {
      console.log('Mock GPS already running');
      return;
    }

    // Merge config
    this.config = { ...this.config, ...config };

    // Set start position if provided
    if (this.config.startPosition) {
      this.currentLat = this.config.startPosition.lat;
      this.currentLon = this.config.startPosition.lon;
    }

    this.isRunning = true;
    this.startTime = Date.now();

    console.log(`🎮 Mock GPS started - Scenario: ${this.config.scenario}`);

    // Start generating position updates
    this.updateSubscription = interval(this.config.updateInterval).subscribe(() => {
      this.generatePositionUpdate();
    });
  }

  /**
   * Stop generating mock GPS data
   */
  stopMockGPS(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    this.updateSubscription?.unsubscribe();
    console.log('🛑 Mock GPS stopped');
  }

  /**
   * Get current position observable
   */
  getCurrentPosition(): Observable<Position | null> {
    return this.currentPosition$.asObservable();
  }

  /**
   * Change scenario on the fly
   */
  setScenario(scenario: MockScenario, customSpeed?: number): void {
    this.config.scenario = scenario;
    if (customSpeed !== undefined) {
      this.config.customSpeed = customSpeed;
    }
    console.log(`🎮 Scenario changed to: ${scenario}`);
  }

  /**
   * Manually set position (useful for testing specific locations)
   */
  setPosition(lat: number, lon: number): void {
    this.currentLat = lat;
    this.currentLon = lon;
    console.log(`📍 Position set to: ${lat}, ${lon}`);
  }

  /**
   * Generate a position update based on current scenario
   */
  private generatePositionUpdate(): void {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;

    // Update speed and position based on scenario
    this.updateScenario(elapsedSeconds);

    // Add GPS noise if enabled
    let lat = this.currentLat;
    let lon = this.currentLon;
    let accuracy = this.currentAccuracy;

    if (this.config.enableNoise) {
      const noise = this.generateGPSNoise();
      lat += noise.latOffset;
      lon += noise.lonOffset;
      accuracy += noise.accuracyVariation;
    }

    // Create position object
    const position: Position = {
      latitude: lat,
      longitude: lon,
      heading: this.currentHeading,
      speed: this.currentSpeed, // m/s
      timestamp: Date.now(),
      accuracy: Math.max(5, accuracy)
    };

    this.currentPosition$.next(position);

    // Log periodically
    if (Math.floor(elapsedSeconds) % 5 === 0) {
      const speedKmh = this.currentSpeed * 3.6;
      console.log(`🎮 Mock GPS: ${speedKmh.toFixed(1)} km/h, Accuracy: ${accuracy.toFixed(1)}m`);
    }
  }

  /**
   * Update speed and position based on scenario
   */
  private updateScenario(elapsedSeconds: number): void {
    switch (this.config.scenario) {
      case 'stationary':
        this.currentSpeed = 0;
        this.currentAccuracy = 8;
        break;

      case 'slow_ride':
        // 10-15 km/h with slight variation
        this.currentSpeed = (12 + Math.sin(elapsedSeconds / 10) * 2) / 3.6;
        this.movePosition(this.currentSpeed, elapsedSeconds);
        this.currentAccuracy = 8;
        break;

      case 'normal_ride':
        // 20-25 km/h with variation
        this.currentSpeed = (22 + Math.sin(elapsedSeconds / 10) * 3) / 3.6;
        this.movePosition(this.currentSpeed, elapsedSeconds);
        this.currentAccuracy = 10;
        break;

      case 'fast_ride':
        // 35-45 km/h
        this.currentSpeed = (40 + Math.sin(elapsedSeconds / 10) * 5) / 3.6;
        this.movePosition(this.currentSpeed, elapsedSeconds);
        this.currentAccuracy = 12;
        break;

      case 'stop_and_go':
        // Alternate between moving and stopped
        const cycle = Math.floor(elapsedSeconds / 10) % 2;
        if (cycle === 0) {
          // Moving for 10 seconds
          this.currentSpeed = 20 / 3.6;
          this.movePosition(this.currentSpeed, elapsedSeconds);
        } else {
          // Stopped for 10 seconds
          this.currentSpeed = 0;
        }
        this.currentAccuracy = 10;
        break;

      case 'acceleration':
        // Gradual acceleration from 0 to 40 km/h over 30 seconds, then maintain
        const targetSpeed = Math.min(40, elapsedSeconds * 1.33); // Accelerate at ~1.33 km/h per second
        this.currentSpeed = targetSpeed / 3.6;
        this.movePosition(this.currentSpeed, elapsedSeconds);
        this.currentAccuracy = 10;
        break;

      case 'custom':
        if (this.config.customSpeed !== undefined) {
          this.currentSpeed = this.config.customSpeed / 3.6;
          this.movePosition(this.currentSpeed, elapsedSeconds);
        }
        if (this.config.customAccuracy !== undefined) {
          this.currentAccuracy = this.config.customAccuracy;
        }
        break;
    }
  }

  /**
   * Move position based on speed and heading
   */
  private movePosition(speedMs: number, elapsedSeconds: number): void {
    // Update heading with gradual changes (simulating turns)
    this.currentHeading = (45 + Math.sin(elapsedSeconds / 20) * 30) % 360;

    // Calculate distance moved (assuming 1 second intervals)
    const distanceMeters = speedMs * (this.config.updateInterval / 1000);

    // Convert to lat/lon offset
    const latOffset = (distanceMeters * Math.cos(this.currentHeading * Math.PI / 180)) / 111320;
    const lonOffset = (distanceMeters * Math.sin(this.currentHeading * Math.PI / 180)) / (111320 * Math.cos(this.currentLat * Math.PI / 180));

    this.currentLat += latOffset;
    this.currentLon += lonOffset;
  }

  /**
   * Generate realistic GPS noise
   */
  private generateGPSNoise(): { latOffset: number; lonOffset: number; accuracyVariation: number } {
    // GPS noise typically follows a normal distribution
    const latOffset = (Math.random() - 0.5) * 0.00001; // ~1-2 meters
    const lonOffset = (Math.random() - 0.5) * 0.00001;
    const accuracyVariation = (Math.random() - 0.5) * 4; // ±2 meters

    return { latOffset, lonOffset, accuracyVariation };
  }

  /**
   * Simulate poor GPS signal
   */
  simulatePoorSignal(): void {
    this.currentAccuracy = 50 + Math.random() * 50; // 50-100m accuracy
    console.log('⚠️ Simulating poor GPS signal');
  }

  /**
   * Simulate good GPS signal
   */
  simulateGoodSignal(): void {
    this.currentAccuracy = 5 + Math.random() * 5; // 5-10m accuracy
    console.log('✅ Simulating good GPS signal');
  }

  /**
   * Jump to a specific location instantly (for testing)
   */
  teleport(lat: number, lon: number): void {
    this.currentLat = lat;
    this.currentLon = lon;
    this.currentSpeed = 0;
    console.log(`🚀 Teleported to: ${lat}, ${lon}`);
  }

  /**
   * Get current mock state
   */
  getMockState(): any {
    return {
      isRunning: this.isRunning,
      scenario: this.config.scenario,
      position: { lat: this.currentLat, lon: this.currentLon },
      speed: this.currentSpeed * 3.6, // km/h
      heading: this.currentHeading,
      accuracy: this.currentAccuracy,
      elapsedTime: (Date.now() - this.startTime) / 1000
    };
  }
}