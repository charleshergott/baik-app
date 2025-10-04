// import { Injectable } from '@angular/core';
// import { BehaviorSubject, Observable, interval } from 'rxjs';
// import { MovementConfig, MovementState } from '../interfaces/master';



// @Injectable({
//   providedIn: 'root'
// })
// export class UnifiedMovementService {
//   private movementSubject = new BehaviorSubject<MovementState>({
//     isMoving: false,
//     speed: 0,
//     position: null,
//     quality: 'poor',
//     isStationary: true,
//     accuracy: 999,
//     lastUpdate: Date.now()
//   });

//   // Configuration with sane defaults
//   private config: MovementConfig = {
//     startThreshold: 3, // km/h
//     stopThreshold: 1, // km/h
//     stopDelay: 3000, // 3 seconds
//     minAccuracy: 15, // 15 meters
//     minDistance: 5, // 5 meters
//     minTimeBetweenReadings: 2000, // 2 seconds
//     maxSpeedJump: 15, // 15 km/h
//     stationaryRadius: 20, // 20 meters
//     historyLength: 10
//   };

//   // Internal tracking state
//   private watchId: number | null = null;
//   private isTracking = false;

//   private speedHistory: number[] = [];
//   private positionHistory: GeolocationPosition[] = [];
//   private lastValidPosition: GeolocationPosition | null = null;
//   private lastValidSpeed = 0;
//   private lastReadingTime = 0;

//   // Movement state tracking
//   private belowThresholdSince = 0;
//   private consecutivePoorReadings = 0;
//   private readonly MAX_POOR_READINGS = 4;

//   constructor() {
//     console.log('🎯 UnifiedMovementService initialized');
//   }

//   /**
//    * Get current movement state as Observable
//    */
//   getMovementState(): Observable<MovementState> {
//     return this.movementSubject.asObservable();
//   }

//   /**
//    * Get current movement state value
//    */
//   getCurrentState(): MovementState {
//     return this.movementSubject.value;
//   }

//   /**
//    * Update configuration
//    */
//   updateConfig(newConfig: Partial<MovementConfig>): void {
//     this.config = { ...this.config, ...newConfig };
//     console.log('⚙️ Movement detection config updated:', this.config);
//   }

//   /**
//    * Start GPS tracking
//    */
//   startTracking(): Promise<void> {
//     if (this.isTracking) {
//       console.log('📡 Movement tracking already active');
//       return Promise.resolve();
//     }

//     return new Promise((resolve, reject) => {
//       if (!('geolocation' in navigator)) {
//         const error = 'Geolocation not supported';
//         console.error('❌', error);
//         reject(new Error(error));
//         return;
//       }

//       const options: PositionOptions = {
//         enableHighAccuracy: true,
//         timeout: 15000,
//         maximumAge: 2000
//       };

//       // Start watching position
//       this.watchId = navigator.geolocation.watchPosition(
//         (position) => {
//           if (!this.isTracking) {
//             this.isTracking = true;
//             console.log('🎯 Movement tracking started');
//             resolve();
//           }
//           this.processPosition(position);
//         },
//         (error) => {
//           console.error('🛑 GPS error:', error);
//           this.handleGPSError(error);
//           if (!this.isTracking) {
//             reject(error);
//           }
//         },
//         options
//       );

//       // Set timeout for initial GPS lock
//       setTimeout(() => {
//         if (!this.isTracking) {
//           console.error('⏱️ GPS initialization timeout');
//           reject(new Error('GPS initialization timeout'));
//         }
//       }, 20000); // 20 second timeout
//     });
//   }

//   /**
//    * Stop GPS tracking
//    */
//   stopTracking(): void {
//     if (this.watchId !== null) {
//       navigator.geolocation.clearWatch(this.watchId);
//       this.watchId = null;
//     }

//     this.isTracking = false;
//     console.log('🛑 Movement tracking stopped');

//     // Reset state
//     this.updateMovementState({
//       isMoving: false,
//       speed: 0,
//       isStationary: true,
//       quality: 'poor'
//     });
//   }

//   /**
//    * Process new GPS position
//    */
//   private processPosition(position: GeolocationPosition): void {
//     const now = Date.now();

//     // Check accuracy
//     if (position.coords.accuracy > this.config.minAccuracy) {
//       this.consecutivePoorReadings++;
//       console.log(`📍 Poor GPS accuracy: ${position.coords.accuracy.toFixed(1)}m`);

//       if (this.consecutivePoorReadings >= this.MAX_POOR_READINGS) {
//         this.updateMovementState({
//           quality: 'very_poor',
//           speed: 0,
//           isMoving: false,
//           isStationary: true,
//           accuracy: position.coords.accuracy
//         });
//         return;
//       }
//     } else {
//       this.consecutivePoorReadings = 0;
//     }

//     // Check time since last reading
//     if (now - this.lastReadingTime < this.config.minTimeBetweenReadings) {
//       return;
//     }

//     // Add to position history
//     this.positionHistory.push(position);
//     if (this.positionHistory.length > this.config.historyLength) {
//       this.positionHistory.shift();
//     }

//     // Check if stationary
//     const isStationary = this.detectStationary();
//     if (isStationary) {
//       console.log('🛑 Detected stationary');
//       this.updateMovementState({
//         speed: 0,
//         isMoving: false,
//         isStationary: true,
//         position,
//         quality: this.getGPSQuality(position.coords.accuracy),
//         accuracy: position.coords.accuracy,
//         lastUpdate: now
//       });
//       this.lastReadingTime = now;
//       return;
//     }

//     // Calculate speed if we have a previous position
//     if (this.lastValidPosition) {
//       const speed = this.calculateSpeed(this.lastValidPosition, position, now);
//       if (speed !== null) {
//         this.processSpeedReading(speed, position, now);
//       }
//     }

//     this.lastValidPosition = position;
//     this.lastReadingTime = now;
//   }

//   /**
//    * Calculate speed between two positions
//    */
//   private calculateSpeed(
//     prevPos: GeolocationPosition,
//     currPos: GeolocationPosition,
//     currentTime: number
//   ): number | null {
//     const timeDiff = (currentTime - prevPos.timestamp) / 1000; // seconds

//     if (timeDiff <= 0) return null;

//     const distance = this.calculateDistance(
//       prevPos.coords.latitude, prevPos.coords.longitude,
//       currPos.coords.latitude, currPos.coords.longitude
//     );

//     // Minimum distance check
//     if (distance < this.config.minDistance) {
//       console.log(`📏 Distance too small: ${distance.toFixed(1)}m`);
//       return 0; // Not enough movement
//     }

//     // Calculate speed in km/h
//     let calculatedSpeed = (distance / timeDiff) * 3.6;

//     // Use GPS speed if available and reasonable
//     if (currPos.coords.speed !== null && currPos.coords.speed >= 0) {
//       const gpsSpeed = currPos.coords.speed * 3.6;
//       if (Math.abs(gpsSpeed - calculatedSpeed) < 8) {
//         calculatedSpeed = gpsSpeed;
//       }
//     }

//     // Filter sudden speed jumps
//     if (this.lastValidSpeed > 0 &&
//       Math.abs(calculatedSpeed - this.lastValidSpeed) > this.config.maxSpeedJump) {
//       console.log(`⚡ Speed jump filtered: ${this.lastValidSpeed.toFixed(1)} → ${calculatedSpeed.toFixed(1)} km/h`);
//       return null;
//     }

//     return Math.max(0, calculatedSpeed);
//   }

//   /**
//    * Process speed reading and update movement state
//    */
//   private processSpeedReading(speed: number, position: GeolocationPosition, now: number): void {
//     // Add to speed history
//     this.speedHistory.push(speed);
//     if (this.speedHistory.length > this.config.historyLength) {
//       this.speedHistory.shift();
//     }

//     // Calculate smoothed speed
//     const smoothedSpeed = this.calculateSmoothedSpeed();
//     this.lastValidSpeed = smoothedSpeed;

//     // Determine movement state
//     const wasMoving = this.movementSubject.value.isMoving;
//     let isMoving = wasMoving;

//     if (smoothedSpeed >= this.config.startThreshold && !wasMoving) {
//       // Check for consistent movement
//       const recentSpeeds = this.speedHistory.slice(-3);
//       const consistentMovement = recentSpeeds.length >= 2 &&
//         recentSpeeds.every(s => s >= this.config.startThreshold * 0.7);

//       if (consistentMovement) {
//         isMoving = true;
//         this.belowThresholdSince = 0;
//         console.log(`🚴‍♂️ Movement started: ${smoothedSpeed.toFixed(1)} km/h`);
//       }
//     } else if (smoothedSpeed <= this.config.stopThreshold && wasMoving) {
//       // Start counting time below threshold
//       if (this.belowThresholdSince === 0) {
//         this.belowThresholdSince = now;
//       } else if (now - this.belowThresholdSince >= this.config.stopDelay) {
//         isMoving = false;
//         this.belowThresholdSince = 0;
//         console.log(`🛑 Movement stopped: ${smoothedSpeed.toFixed(1)} km/h`);
//       }
//     } else if (smoothedSpeed > this.config.stopThreshold && this.belowThresholdSince > 0) {
//       // Speed went back up, reset stop timer
//       this.belowThresholdSince = 0;
//     }

//     // Update state
//     this.updateMovementState({
//       isMoving,
//       speed: smoothedSpeed,
//       position,
//       quality: this.getGPSQuality(position.coords.accuracy),
//       isStationary: false,
//       accuracy: position.coords.accuracy,
//       lastUpdate: now
//     });
//   }

//   /**
//    * Calculate smoothed speed from history
//    */
//   private calculateSmoothedSpeed(): number {
//     if (this.speedHistory.length === 0) return 0;

//     // Weighted average - more recent readings have higher weight
//     let weightedSum = 0;
//     let totalWeight = 0;

//     for (let i = 0; i < this.speedHistory.length; i++) {
//       const weight = (i + 1) / this.speedHistory.length;
//       weightedSum += this.speedHistory[i] * weight;
//       totalWeight += weight;
//     }

//     return totalWeight > 0 ? weightedSum / totalWeight : 0;
//   }

//   /**
//    * Detect if user is stationary based on position history
//    */
//   private detectStationary(): boolean {
//     if (this.positionHistory.length < 3) return false;

//     const centerLat = this.positionHistory.reduce((sum, pos) => sum + pos.coords.latitude, 0) / this.positionHistory.length;
//     const centerLng = this.positionHistory.reduce((sum, pos) => sum + pos.coords.longitude, 0) / this.positionHistory.length;

//     return this.positionHistory.every(pos => {
//       const distance = this.calculateDistance(
//         centerLat, centerLng,
//         pos.coords.latitude, pos.coords.longitude
//       );
//       return distance <= this.config.stationaryRadius;
//     });
//   }

//   /**
//    * Get GPS quality assessment
//    */
//   private getGPSQuality(accuracy: number): 'good' | 'poor' | 'very_poor' {
//     if (accuracy <= 5) return 'good';
//     if (accuracy <= 15) return 'poor';
//     return 'very_poor';
//   }

//   /**
//    * Calculate distance between two coordinates (Haversine formula)
//    */
//   private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
//     const R = 6371e3; // Earth's radius in meters
//     const φ1 = lat1 * Math.PI / 180;
//     const φ2 = lat2 * Math.PI / 180;
//     const Δφ = (lat2 - lat1) * Math.PI / 180;
//     const Δλ = (lng2 - lng1) * Math.PI / 180;

//     const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
//       Math.cos(φ1) * Math.cos(φ2) *
//       Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
//     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

//     return R * c;
//   }

//   /**
//    * Update movement state
//    */
//   private updateMovementState(updates: Partial<MovementState>): void {
//     const current = this.movementSubject.value;
//     const newState: MovementState = {
//       ...current,
//       ...updates,
//       lastUpdate: Date.now()
//     };

//     this.movementSubject.next(newState);
//   }

//   /**
//    * Handle GPS errors
//    */
//   private handleGPSError(error: GeolocationPositionError): void {
//     console.error('🛑 GPS Error:', error.message);

//     this.updateMovementState({
//       quality: 'very_poor',
//       speed: 0,
//       isMoving: false,
//       isStationary: true
//     });
//   }

//   /**
//    * Get debug information
//    */
//   getDebugInfo(): any {
//     return {
//       config: this.config,
//       state: this.movementSubject.value,
//       tracking: this.isTracking,
//       speedHistory: this.speedHistory.slice(-5),
//       positionHistory: this.positionHistory.length,
//       consecutivePoorReadings: this.consecutivePoorReadings,
//       belowThresholdSince: this.belowThresholdSince
//     };
//   }

//   /**
//    * Set indoor mode (stricter filtering)
//    */
//   setIndoorMode(enabled: boolean): void {
//     if (enabled) {
//       this.updateConfig({
//         minAccuracy: 8,
//         startThreshold: 4,
//         stopThreshold: 1.5,
//         minDistance: 8,
//         stopDelay: 4000,
//         stationaryRadius: 12,
//         maxSpeedJump: 8
//       });
//       console.log('🏠 Indoor mode enabled');
//     } else {
//       this.updateConfig({
//         minAccuracy: 15,
//         startThreshold: 3,
//         stopThreshold: 1,
//         minDistance: 5,
//         stopDelay: 3000,
//         stationaryRadius: 20,
//         maxSpeedJump: 15
//       });
//       console.log('🚴‍♂️ Outdoor mode enabled');
//     }
//   }
// }