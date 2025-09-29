import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, interval, Subscription } from 'rxjs';
import { Position } from '../interfaces/master';
import { environment } from '../environments/environment.prod';
import { HttpClient } from '@angular/common/http';

// NEW: Interface for nearby aircraft data
export interface NearbyAircraft {
  userId: string;
  position: Position;
  distance: number; // in kilometers
  bearing: number; // bearing from current position to other aircraft
  isConverging: boolean; // true if aircraft are heading towards each other
  relativeHeading: number; // difference in headings
  timeSinceUpdate: number; // milliseconds since last update
  riskLevel: 'low' | 'medium' | 'high'; // collision risk assessment
}

@Injectable({
  providedIn: 'root'
})

export class GpsService {

  private currentPosition$ = new BehaviorSubject<Position | null>(null);
  private currentSpeed$ = new BehaviorSubject<number>(0);
  private nearbyAircraft$ = new BehaviorSubject<NearbyAircraft[]>([]);
  private isTracking = false;
  private watchId: number | null = null;
  private speedHistory: number[] = [];
  isGPSEnabled = false;
  private lastPosition: GeolocationPosition | null = null;
  private lastPositionTime = 0;
  private speedMonitoringInterval: any;
  currentSpeed = 0; // in knots
  private readonly SPEED_HISTORY_LENGTH = 5;

  // NEW: Database sync properties
  private databaseSyncSubscription: Subscription | null = null;
  private isDatabaseSyncEnabled = false;
  private readonly DATABASE_SYNC_INTERVAL = 70000; // 70 seconds in milliseconds
  private readonly MAX_POSITIONS_PER_USER = 5; // Maximum stored positions per user
  private readonly MIN_SPEED_THRESHOLD = 30; // Minimum speed in knots to send position

  // NEW: Traffic monitoring properties
  private trafficMonitoringSubscription: Subscription | null = null;
  private isTrafficMonitoringEnabled = false;
  private readonly TRAFFIC_CHECK_INTERVAL = 10000; // Check every 10 seconds
  private readonly PROXIMITY_RADIUS_KM = 30; // 30 km radius
  private readonly COLLISION_ANGLE_THRESHOLD = 45; // degrees
  private currentUserId: string | null = null;
  private hasShownAlert = false; // Prevent repeated alerts
  private alertedAircraft = new Set<string>(); // Track which aircraft we've alerted about

  // Mock data properties
  private isDevelopmentMode = environment.enableMockGPS;
  private mockPosition: Position = {
    latitude: 40.7128,
    longitude: -74.0060,
    heading: 45,
    speed: 60,
    timestamp: Date.now()
  };
  private mockInterval: any;
  private mockSpeedInterval: any;

  constructor(private http: HttpClient) {
    console.log(`🔧 GPS Service: ${this.isDevelopmentMode ? 'MOCK MODE' : 'REAL MODE'}`);
  }

  getCurrentPosition(): Observable<Position | null> {
    return this.currentPosition$.asObservable();
  }

  getSpeedUpdates(): Observable<number> {
    return this.currentSpeed$.asObservable();
  }

  getCurrentSpeed(): number {
    return this.currentSpeed;
  }

  startTracking(): void {
    if (this.isTracking) return;

    this.startRealGPS();
    this.isTracking = true;
  }

  stopTracking(): void {
    if (this.isDevelopmentMode) {
      if (this.mockInterval) {
        clearInterval(this.mockInterval);
        this.mockInterval = null;
      }
      if (this.mockSpeedInterval) {
        clearInterval(this.mockSpeedInterval);
        this.mockSpeedInterval = null;
      }
    } else {
      if (this.watchId !== null) {
        navigator.geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
    }
    this.isTracking = false;
  }

  private startRealGPS(): void {
    console.log('📡 Starting REAL GPS tracking');

    if ('geolocation' in navigator) {
      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 1000
      };

      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          const pos: Position = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            heading: position.coords.heading || undefined,
            speed: position.coords.speed || undefined,
            timestamp: Date.now()
          };
          this.currentPosition$.next(pos);
        },
        (error) => {
          console.error('GPS Error:', error);
        },
        options
      );
    }
  }

  setDevelopmentMode(enabled: boolean): void {
    const wasTracking = this.isTracking;

    if (wasTracking) {
      this.stopTracking();
    }

    this.isDevelopmentMode = enabled;
    console.log(`📱 GPS Mode: ${enabled ? 'MOCK (Development)' : 'REAL (Production)'}`);

    if (wasTracking) {
      this.startTracking();
    }
  }

  enableGPSSpeedMonitoring(userId?: string): void {
    // If already enabled, don't start again
    if (this.isGPSEnabled) {
      console.log('⚠️ GPS speed monitoring already enabled');
      return;
    }

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

        // IMPORTANT: Set initial position for database sync
        const initialPos: Position = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          heading: position.coords.heading || undefined,
          speed: position.coords.speed || undefined,
          timestamp: Date.now()
        };
        this.currentPosition$.next(initialPos);

        console.log('GPS enabled for speed monitoring', initialPos);

        // Start watching position changes
        navigator.geolocation.watchPosition(
          (newPosition) => this.calculateSpeedFromGPS(newPosition),
          (error) => {
            console.error('GPS error:', error);
            this.isGPSEnabled = false;
            // Stop database sync if GPS fails
            this.stopDatabaseSync();
          },
          options
        );

        // Start database sync when GPS is enabled
        this.startDatabaseSync(userId);
      },
      (error) => {
        console.error('GPS initialization failed:', error);
        this.isGPSEnabled = false;
      },
      options
    );
  }

  /**
   * Disable GPS speed monitoring and stop database sync
   */
  disableGPSSpeedMonitoring(): void {
    this.isGPSEnabled = false;
    this.lastPosition = null;
    this.lastPositionTime = 0;
    this.speedHistory = [];
    this.currentSpeed = 0;

    // Stop database sync
    this.stopDatabaseSync();

    console.log('GPS speed monitoring disabled');
  }

  calculateSpeedFromGPS(position: GeolocationPosition): void {
    // IMPORTANT: Always update the current position observable
    const pos: Position = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      heading: position.coords.heading || undefined,
      speed: position.coords.speed || undefined,
      timestamp: Date.now()
    };
    this.currentPosition$.next(pos);

    if (!this.lastPosition) {
      this.lastPosition = position;
      this.lastPositionTime = Date.now();
      return;
    }

    const currentTime = Date.now();
    const timeDiff = (currentTime - this.lastPositionTime) / 1000;

    if (timeDiff > 0) {
      const distance = this.calculateDistance(
        this.lastPosition.coords.latitude,
        this.lastPosition.coords.longitude,
        position.coords.latitude,
        position.coords.longitude
      );

      const speedKnots = (distance / timeDiff) * 3600 / 1852;
      this.updateSpeed(speedKnots);

      this.lastPosition = position;
      this.lastPositionTime = currentTime;
    }
  }

  updateSpeed(newSpeed: number): void {
    this.speedHistory.push(newSpeed);
    if (this.speedHistory.length > this.SPEED_HISTORY_LENGTH) {
      this.speedHistory.shift();
    }

    const smoothedSpeed = this.speedHistory.reduce((a, b) => a + b, 0) / this.speedHistory.length;
    this.currentSpeed = Math.max(0, smoothedSpeed);
    this.currentSpeed$.next(this.currentSpeed);

    console.log(`🚤 Speed updated: ${this.currentSpeed.toFixed(1)} kn`);
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
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

  setManualSpeed(speed: number): void {
    this.updateSpeed(speed);
  }

  // ===== NEW: DATABASE SYNC METHODS =====

  /**
   * Start sending GPS position to database every 70 seconds
   * @param userId Optional user/device ID to organize data in Firebase
   */
  startDatabaseSync(userId?: string): void {
    if (this.isDatabaseSyncEnabled) {
      console.log('⚠️ Database sync already running');
      return;
    }

    // Store the userId for this sync session
    if (userId) {
      this.currentUserId = userId;
    }

    console.log('🔄 Starting database sync (every 70 seconds)');
    this.isDatabaseSyncEnabled = true;

    // Send immediately on start
    this.sendPositionToDatabase(userId);

    // Then send every 70 seconds
    this.databaseSyncSubscription = interval(this.DATABASE_SYNC_INTERVAL)
      .subscribe(() => {
        this.sendPositionToDatabase(userId);
      });
  }

  /**
   * Stop sending GPS position to database
   */
  stopDatabaseSync(): void {
    if (this.databaseSyncSubscription) {
      this.databaseSyncSubscription.unsubscribe();
      this.databaseSyncSubscription = null;
    }
    this.isDatabaseSyncEnabled = false;
    console.log('🛑 Database sync stopped');
  }

  /**
   * Send current position to Firebase Realtime Database
   * Maintains a maximum of 5 positions per user (circular buffer)
   * Only sends when speed is above 30 knots
   * @param userId Optional user/device ID to organize data
   */
  private sendPositionToDatabase(userId?: string): void {
    // Prevent duplicate sends
    if (!this.isDatabaseSyncEnabled) {
      console.warn('⚠️ Database sync is not enabled, skipping send');
      return;
    }

    const position = this.currentPosition$.getValue();

    if (!position) {
      console.error('❌ No position available to send to database - GPS might not be working!');
      console.log('Debug: isGPSEnabled =', this.isGPSEnabled);
      console.log('Debug: lastPosition =', this.lastPosition);
      return;
    }

    // Check speed threshold - only send if moving above 30 knots
    const currentSpeedKnots = position.speed || this.currentSpeed;

    if (currentSpeedKnots < this.MIN_SPEED_THRESHOLD) {
      console.log(`⏸️ Speed too low (${currentSpeedKnots.toFixed(1)} kn < ${this.MIN_SPEED_THRESHOLD} kn) - position not sent`);
      return;
    }

    console.log(`📤 Sending position to Firebase (speed: ${currentSpeedKnots.toFixed(1)} kn):`, position);

    // Prepare the data payload
    const payload = {
      latitude: position.latitude,
      longitude: position.longitude,
      heading: position.heading,
      speed: currentSpeedKnots,
      timestamp: position.timestamp,
      syncedAt: Date.now()
    };

    const path = userId ? `positions/${userId}` : 'positions';
    const baseUrl = `https://vfr-navaid-default-rtdb.europe-west1.firebasedatabase.app/${path}`;

    console.log('🌐 Firebase URL:', baseUrl);

    // First, always add the new position
    this.http.post(`${baseUrl}.json`, payload).subscribe({
      next: (response) => {
        console.log('✅ Position added to Firebase:', response);

        // Then check if we need to clean up old positions
        this.cleanupOldPositions(baseUrl);
      },
      error: (error) => {
        console.error('❌ Failed to send position to Firebase:', error);
      }
    });
  }

  /**
   * Clean up old positions if we exceed the maximum limit
   */
  private cleanupOldPositions(baseUrl: string): void {
    this.http.get<any>(`${baseUrl}.json`).subscribe({
      next: (existingPositions) => {
        if (!existingPositions) {
          return;
        }

        const positionKeys = Object.keys(existingPositions);
        const excessCount = positionKeys.length - this.MAX_POSITIONS_PER_USER;

        if (excessCount > 0) {
          console.log(`🗑️ Cleaning up ${excessCount} old position(s) (total: ${positionKeys.length})`);

          // Sort all positions by timestamp
          const sortedPositions = positionKeys
            .map(key => ({
              key: key,
              timestamp: existingPositions[key].timestamp
            }))
            .sort((a, b) => a.timestamp - b.timestamp);

          // Delete the oldest positions
          const positionsToDelete = sortedPositions.slice(0, excessCount);

          positionsToDelete.forEach(pos => {
            this.http.delete(`${baseUrl}/${pos.key}.json`).subscribe({
              next: () => {
                console.log(`✅ Deleted old position: ${pos.key}`);
              },
              error: (error) => {
                console.error(`❌ Failed to delete position ${pos.key}:`, error);
              }
            });
          });
        }
      },
      error: (error) => {
        console.error('❌ Failed to check for cleanup:', error);
      }
    });
  }

  /**
   * Check if database sync is currently active
   */
  isDatabaseSyncActive(): boolean {
    return this.isDatabaseSyncEnabled;
  }

  /**
   * Manually trigger a database sync (useful for testing)
   * @param userId Optional user/device ID to organize data
   */
  forceDatabaseSync(userId?: string): void {
    console.log('🔧 Manual database sync triggered');
    this.sendPositionToDatabase(userId);
  }

  // ===== NEW: TRAFFIC MONITORING METHODS =====

  /**
   * Start monitoring nearby aircraft from Firebase Realtime Database
   * @param currentUserId The ID of the current user (to exclude own positions)
   */
  startTrafficMonitoring(currentUserId: string): void {
    if (this.isTrafficMonitoringEnabled) {
      console.log('⚠️ Traffic monitoring already running');
      return;
    }

    this.currentUserId = currentUserId;
    this.isTrafficMonitoringEnabled = true;
    this.hasShownAlert = false;
    this.alertedAircraft.clear();
    console.log('🛩️ Starting traffic monitoring (30km radius)');

    // Check immediately
    this.checkNearbyTraffic();

    // Then check every 10 seconds
    this.trafficMonitoringSubscription = interval(this.TRAFFIC_CHECK_INTERVAL)
      .subscribe(() => {
        this.checkNearbyTraffic();
      });
  }

  /**
   * Stop monitoring nearby aircraft
   */
  stopTrafficMonitoring(): void {
    if (this.trafficMonitoringSubscription) {
      this.trafficMonitoringSubscription.unsubscribe();
      this.trafficMonitoringSubscription = null;
    }
    this.isTrafficMonitoringEnabled = false;
    this.hasShownAlert = false;
    this.alertedAircraft.clear();
    this.nearbyAircraft$.next([]);
    console.log('🛑 Traffic monitoring stopped');
  }

  /**
   * Get observable for nearby aircraft updates
   */
  getNearbyAircraft(): Observable<NearbyAircraft[]> {
    return this.nearbyAircraft$.asObservable();
  }

  /**
   * Check for nearby aircraft in Firebase
   */
  private checkNearbyTraffic(): void {
    const currentPos = this.currentPosition$.getValue();

    if (!currentPos) {
      console.warn('⚠️ No current position available for traffic check');
      return;
    }

    const firebaseUrl = 'https://vfr-navaid-default-rtdb.europe-west1.firebasedatabase.app/positions.json';

    this.http.get<any>(firebaseUrl).subscribe({
      next: (allPositions) => {
        if (!allPositions) {
          this.nearbyAircraft$.next([]);
          return;
        }

        const nearbyAircraft: NearbyAircraft[] = [];
        const todayStart = new Date().setHours(0, 0, 0, 0);

        // Iterate through all users
        Object.keys(allPositions).forEach(userId => {
          // Skip own positions
          if (userId === this.currentUserId) {
            return;
          }

          const userPositions = allPositions[userId];

          // Get the most recent position for this user
          let latestPosition: any = null;
          let latestKey: string = '';
          let latestTimestamp = 0;

          Object.keys(userPositions).forEach(key => {
            const pos = userPositions[key];
            // Only consider positions from today
            if (pos.timestamp >= todayStart && pos.timestamp > latestTimestamp) {
              latestTimestamp = pos.timestamp;
              latestPosition = pos;
              latestKey = key;
            }
          });

          if (latestPosition) {
            // Calculate distance to this aircraft
            const distance = this.calculateDistance(
              currentPos.latitude,
              currentPos.longitude,
              latestPosition.latitude,
              latestPosition.longitude
            ) / 1000; // Convert to kilometers

            // Check if within 30km radius
            if (distance <= this.PROXIMITY_RADIUS_KM) {
              const bearing = this.calculateBearing(
                currentPos.latitude,
                currentPos.longitude,
                latestPosition.latitude,
                latestPosition.longitude
              );

              const isConverging = this.areAircraftConverging(
                currentPos,
                latestPosition,
                bearing
              );

              const relativeHeading = this.calculateRelativeHeading(
                currentPos.heading || 0,
                latestPosition.heading || 0
              );

              const timeSinceUpdate = Date.now() - latestPosition.timestamp;

              const riskLevel = this.assessRiskLevel(distance, isConverging, timeSinceUpdate);

              nearbyAircraft.push({
                userId,
                position: latestPosition,
                distance,
                bearing,
                isConverging,
                relativeHeading,
                timeSinceUpdate,
                riskLevel
              });
            }
          }
        });

        // Sort by distance (closest first)
        nearbyAircraft.sort((a, b) => a.distance - b.distance);

        this.nearbyAircraft$.next(nearbyAircraft);

        // Show popup alert for nearby aircraft
        this.showTrafficAlert(nearbyAircraft);

        if (nearbyAircraft.length > 0) {
          console.log(`✈️ Found ${nearbyAircraft.length} nearby aircraft:`);
          nearbyAircraft.forEach(aircraft => {
            const emoji = aircraft.riskLevel === 'high' ? '🚨' :
              aircraft.riskLevel === 'medium' ? '⚠️' : 'ℹ️';
            console.log(`${emoji} ${aircraft.userId}: ${aircraft.distance.toFixed(1)}km, ` +
              `bearing ${aircraft.bearing.toFixed(0)}°, ` +
              `converging: ${aircraft.isConverging}, ` +
              `risk: ${aircraft.riskLevel}`);
          });
        }
      },
      error: (error) => {
        console.error('❌ Failed to check nearby traffic:', error);
      }
    });
  }

  /**
   * Show popup alert for nearby aircraft
   */
  private showTrafficAlert(aircraft: NearbyAircraft[]): void {
    if (aircraft.length === 0) {
      // Reset when no aircraft nearby
      this.alertedAircraft.clear();
      return;
    }

    // Check for high-risk aircraft that haven't been alerted yet
    const newHighRiskAircraft = aircraft.filter(a =>
      a.riskLevel === 'high' && !this.alertedAircraft.has(a.userId)
    );

    if (newHighRiskAircraft.length > 0) {
      newHighRiskAircraft.forEach(a => {
        const direction = this.getDirectionText(a.bearing);
        const converging = a.isConverging ? ' CONVERGING!' : '';

        alert(
          `🚨 TRAFFIC ALERT - HIGH RISK!\n\n` +
          `Aircraft: ${a.userId}\n` +
          `Distance: ${a.distance.toFixed(1)} km\n` +
          `Direction: ${direction} (${a.bearing.toFixed(0)}°)\n` +
          `Status: ${converging}\n\n` +
          `⚠️ IMMEDIATE ATTENTION REQUIRED!`
        );

        // Mark this aircraft as alerted
        this.alertedAircraft.add(a.userId);
      });
    }
    // Check for medium-risk aircraft
    else if (!this.hasShownAlert && aircraft.some(a => a.riskLevel === 'medium')) {
      const mediumRisk = aircraft.filter(a => a.riskLevel === 'medium');
      const closest = mediumRisk[0];
      const direction = this.getDirectionText(closest.bearing);

      alert(
        `⚠️ TRAFFIC ADVISORY\n\n` +
        `${mediumRisk.length} aircraft detected within 30km\n\n` +
        `Closest: ${closest.userId}\n` +
        `Distance: ${closest.distance.toFixed(1)} km\n` +
        `Direction: ${direction}\n` +
        `Converging: ${closest.isConverging ? 'YES' : 'NO'}\n\n` +
        `Maintain visual separation.`
      );

      this.hasShownAlert = true;
    }
    // First detection of any aircraft
    else if (!this.hasShownAlert) {
      alert(
        `ℹ️ Traffic Information\n\n` +
        `${aircraft.length} aircraft detected within 30km radius.\n\n` +
        `Monitor your position and maintain awareness.`
      );

      this.hasShownAlert = true;
    }
  }

  /**
   * Get direction text from bearing
   */
  private getDirectionText(bearing: number): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  /**
   * Calculate bearing from point A to point B
   */
  private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
      Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

    const θ = Math.atan2(y, x);
    const bearing = (θ * 180 / Math.PI + 360) % 360;

    return bearing;
  }

  /**
   * Determine if two aircraft are converging (heading towards each other)
   */
  private areAircraftConverging(currentPos: Position, otherPos: any, bearingToOther: number): boolean {
    const currentHeading = currentPos.heading || 0;
    const otherHeading = otherPos.heading || 0;

    // If either aircraft doesn't have heading data, can't determine
    if (!currentPos.heading || !otherPos.heading) {
      return false;
    }

    // Calculate bearing from other aircraft to current position
    const bearingFromOther = (bearingToOther + 180) % 360;

    // Check if current aircraft is heading towards other aircraft
    const currentHeadingDiff = Math.abs(this.normalizeAngleDifference(currentHeading - bearingToOther));
    const isCurrentHeadingTowards = currentHeadingDiff < this.COLLISION_ANGLE_THRESHOLD;

    // Check if other aircraft is heading towards current aircraft
    const otherHeadingDiff = Math.abs(this.normalizeAngleDifference(otherHeading - bearingFromOther));
    const isOtherHeadingTowards = otherHeadingDiff < this.COLLISION_ANGLE_THRESHOLD;

    // Both must be heading towards each other
    return isCurrentHeadingTowards && isOtherHeadingTowards;
  }

  /**
   * Calculate relative heading between two aircraft
   */
  private calculateRelativeHeading(heading1: number, heading2: number): number {
    return this.normalizeAngleDifference(heading1 - heading2);
  }

  /**
   * Normalize angle difference to -180 to 180 range
   */
  private normalizeAngleDifference(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
  }

  /**
   * Assess collision risk level
   */
  private assessRiskLevel(distance: number, isConverging: boolean, timeSinceUpdate: number): 'low' | 'medium' | 'high' {
    // If data is stale (>2 minutes), lower the risk
    if (timeSinceUpdate > 120000) {
      return 'low';
    }

    if (isConverging) {
      if (distance < 5) {
        return 'high'; // Less than 5km and converging
      } else if (distance < 15) {
        return 'medium'; // 5-15km and converging
      }
    }

    // Just nearby but not converging, or >15km
    return 'low';
  }

  /**
   * Check if traffic monitoring is active
   */
  isTrafficMonitoringActive(): boolean {
    return this.isTrafficMonitoringEnabled;
  }

  /**
   * Get the current minimum speed threshold for position tracking
   */
  getMinSpeedThreshold(): number {
    return this.MIN_SPEED_THRESHOLD;
  }
}