import { Component, HostListener } from '@angular/core';
import { MovementState, SavedRoute, Waypoint } from '../../interfaces/master';
import { GpsService } from '../../services/gps.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, Subscription, take } from 'rxjs';
import { ChronometerComponent } from '../chronometer copy/chronometer.component';
import { UnifiedMovementService } from '../../services/unified-movement.service';


declare var L: any;

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    FormsModule,
    ChronometerComponent
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})

export class HomeComponent {

  private actualPath: any[] = []; // User's actual cycling path (L.LatLng objects)
  private actualPathLine: any = null; // Polyline showing where user has been
  private completedRouteLine: any = null; // Completed portions of planned route
  private remainingRouteLine: any = null; // Remaining portions of planned route
  private isTracking = false; // Whether route tracking is active
  private trackingStartTime: Date | null = null;
  private lastPosition: { latitude: number, longitude: number } | null = null;

  // Route progress tracking
  private currentWaypointTarget = 0; // Index of next waypoint to reach
  private waypointReachDistance = 50; // meters - distance to consider waypoint "reached"
  private routeDeviationThreshold = 100; // meters - distance to consider "off route"

  // Visual settings for route tracking
  private completedRouteColor = '#28a745'; // Green for completed
  private remainingRouteColor = '#6c757d'; // Gray for remaining
  private actualPathColor = '#ff6b35'; // Orange for actual path
  private offRouteColor = '#dc3545'; // Red when off route

  private movementSubscription?: Subscription;
  private movementState: MovementState | null = null;

  waypoints: Waypoint[] = [];
  gpsEnabled = true;
  hasGpsSignal = false;
  routeLoaded = false;
  private userLocationMarker: any;

  private map: any;
  private markers: any[] = [];

  // New properties for info window approach
  activeWaypoint: Waypoint | null = null;
  activeWaypointIndex: number = -1;
  isNewWaypoint: boolean = false;
  infoWindowPosition = { x: 0, y: 0 };
  isMobile = false;
  // Add this property to your class
  private lastRecordTime: number = 0;
  // Saved routes for quick access
  savedRoutes: SavedRoute[] = [];

  // Route line visualization
  private routeLine: any = null;

  // Handle window resize for mobile detection
  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkIfMobile();
  }

  constructor(
    private gpsService: GpsService,
    private alertService: AlertService,
    private _movementService: UnifiedMovementService
  ) {
    this.checkIfMobile();

    // Monitor GPS signal
    this.gpsService.getCurrentPosition().subscribe(position => {
      this.hasGpsSignal = position !== null;
    });

  }

  ngAfterViewInit(): void {
    this.initializeMap();
    this.updateMapWithWaypoints();
    // Start GPS tracking immediately
    this.gpsService.startTracking();
    this.alertService.requestNotificationPermission();

    // Wait for GPS signal, then center ONCE and start position tracking
    this.initializeGPSWithMap();

    // Initialize unified movement tracking
    this.initializeMovementTracking();
    this.alertService.requestNotificationPermission();
  }

  private async initializeMovementTracking(): Promise<void> {
    try {
      // Subscribe to movement state changes
      this.movementSubscription = this._movementService.getMovementState().subscribe(
        (state: MovementState) => this.handleMovementStateChange(state)
      );

      // Start GPS tracking through unified service
      await this._movementService.startTracking();
      this.hasGpsSignal = true;
      console.log('🗺️ Map movement tracking initialized');

      // Initial map centering when GPS connects
      this.centerOnFirstGPSSignal();

    } catch (error) {
      console.error('❌ Failed to initialize map movement tracking:', error);
      this.hasGpsSignal = false;
    }
  }

  /**
   * Handle movement state changes
   */
  private handleMovementStateChange(state: MovementState): void {
    this.movementState = state;
    this.hasGpsSignal = state.quality !== 'very_poor';

    // Update user location marker
    if (state.position) {
      this.showUserLocationOnMap({
        latitude: state.position.coords.latitude,
        longitude: state.position.coords.longitude
      });
    }

    // Process for route tracking if active
    if (this.isTracking && state.position && state.isMoving) {
      this.processTrackingPosition({
        latitude: state.position.coords.latitude,
        longitude: state.position.coords.longitude
      });
    }
  }

  /**
   * Center map on first GPS signal with smooth animation
   */
  private centerOnFirstGPSSignal(): void {
    // Wait for first valid GPS position
    const subscription = this._movementService.getMovementState().subscribe(state => {
      if (state.position && state.quality !== 'very_poor') {
        console.log('📍 First GPS signal - centering map');

        this.map.flyTo([
          state.position.coords.latitude,
          state.position.coords.longitude
        ], 16, {
          animate: true,
          duration: 2.5,
          easeLinearity: 0.25
        });

        subscription.unsubscribe(); // Only center once
      }
    });
  }

  stopRouteTracking(): void {
    this.isTracking = false;
    this.trackingStartTime = null;

    // Reset movement service to default config
    this._movementService.updateConfig({
      minAccuracy: 15,
      minDistance: 5,
      minTimeBetweenReadings: 2000
    });

    console.log('🚴 Route tracking stopped');
  }

  private processTrackingPosition(position: { latitude: number, longitude: number }): void {
    if (!this.isTracking || !this.movementState) return;

    const currentPos = (L as any).latLng(position.latitude, position.longitude);

    // Add to actual path if we have decent GPS (relax the movement requirement for cycling)
    if (this.movementState.quality !== 'very_poor') {
      // Check if we should record this position
      if (this.shouldRecordPosition(position)) {
        this.actualPath.push(currentPos);
        this.updateActualPathVisualization();
        this.lastPosition = position;

        // Check for waypoint progress
        this.checkWaypointProgress(position);
      }
    }

    // Always check waypoint progress even if not recording (in case user is stationary near waypoint)
    this.checkWaypointProgress(position);
  }

  private checkWaypointProgress(position: { latitude: number, longitude: number }): void {
    if (this.currentWaypointTarget >= this.waypoints.length) return;

    const targetWaypoint = this.waypoints[this.currentWaypointTarget];
    const distanceToTarget = this.calculateDistanceMeters(
      position.latitude, position.longitude,
      targetWaypoint.latitude, targetWaypoint.longitude
    );

    // If within reach distance of current target waypoint
    if (distanceToTarget <= this.waypointReachDistance) {
      console.log(`🎯 Reached waypoint ${this.currentWaypointTarget + 1}: ${targetWaypoint.name}`);

      // Move to next waypoint
      this.currentWaypointTarget++;

      // Update route visualization
      this.updateRouteProgress();

      // Show notification
      this.alertService.showSuccess(`Reached: ${targetWaypoint.name}`);

      // If all waypoints completed
      if (this.currentWaypointTarget >= this.waypoints.length) {
        console.log('🏁 Route completed!');
        this.alertService.showSuccess('Route completed! 🏁');
      }
    }
  }

  private shouldRecordPosition(position: { latitude: number, longitude: number }): boolean {
    if (!this.lastPosition) return true;

    const distance = this.calculateDistanceMeters(
      this.lastPosition.latitude, this.lastPosition.longitude,
      position.latitude, position.longitude
    );

    // Record if moved at least 5 meters (reduced from 8 for better tracking)
    // OR if it's been more than 10 seconds since last recording
    const timeSinceLastRecord = Date.now() - (this.lastRecordTime || 0);
    return distance > 5 || timeSinceLastRecord > 10000;
  }

  private updateRouteProgress(): void {
    if (!this.isTracking || this.waypoints.length < 2) return;

    // Remove existing progress lines
    if (this.completedRouteLine) {
      this.map.removeLayer(this.completedRouteLine);
      this.completedRouteLine = null;
    }
    if (this.remainingRouteLine) {
      this.map.removeLayer(this.remainingRouteLine);
      this.remainingRouteLine = null;
    }

    // Create completed route (from start to current target waypoint)
    if (this.currentWaypointTarget > 0) {
      const completedCoordinates = this.waypoints
        .slice(0, this.currentWaypointTarget + 1)
        .map(wp => [wp.latitude, wp.longitude]);

      this.completedRouteLine = L.polyline(completedCoordinates, {
        color: this.completedRouteColor,
        weight: 5,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(this.map);

      console.log(`✅ Updated completed route: ${this.currentWaypointTarget + 1} waypoints`);
    }

    // Create remaining route (from current target to end)
    if (this.currentWaypointTarget < this.waypoints.length) {
      const remainingCoordinates = this.waypoints
        .slice(this.currentWaypointTarget)
        .map(wp => [wp.latitude, wp.longitude]);

      this.remainingRouteLine = L.polyline(remainingCoordinates, {
        color: this.remainingRouteColor,
        weight: 3,
        opacity: 0.7,
        dashArray: '10, 5',
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(this.map);

      console.log(`⏳ Updated remaining route: ${this.waypoints.length - this.currentWaypointTarget} waypoints left`);
    }

    // Update waypoint markers to show progress
    this.updateWaypointMarkers();
  }

  private updateWaypointMarkers(): void {
    this.waypoints.forEach((waypoint, index) => {
      if (this.markers[index]) {
        const marker = this.markers[index];

        // Update marker style based on progress
        if (index < this.currentWaypointTarget) {
          // Completed waypoint - green
          marker.setIcon(this.createWaypointIcon('#28a745', '✓'));
        } else if (index === this.currentWaypointTarget) {
          // Current target - orange
          marker.setIcon(this.createWaypointIcon('#ffc107', '→'));
        } else {
          // Future waypoint - gray
          marker.setIcon(this.createWaypointIcon('#6c757d', (index + 1).toString()));
        }
      }
    });
  }

  /**
   * Create waypoint icon with status indication
   */
  private createWaypointIcon(color: string, text: string): any {
    const iconHtml = `
    <div style="
      background: ${color}; 
      color: white; 
      border: 2px solid white; 
      border-radius: 50%; 
      width: 30px; 
      height: 30px; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-weight: bold; 
      font-size: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    ">${text}</div>
  `;

    return L.divIcon({
      html: iconHtml,
      className: 'custom-waypoint-marker',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });
  }

  startRouteTracking(): void {
    if (!this.hasValidWaypoints()) {
      this.alertService.showError('Please create a route with waypoints before starting tracking.');
      return;
    }

    if (!this.hasGpsSignal) {
      this.alertService.showError('GPS signal required to start tracking.');
      return;
    }

    this.isTracking = true;
    this.trackingStartTime = new Date();
    this.currentWaypointTarget = 0;
    this.actualPath = [];
    this.lastPosition = null;
    this.lastRecordTime = Date.now();

    // Clear any existing tracking visualization
    this.clearTrackingVisualization();

    // Initialize route visualization for tracking
    this.initializeTrackingVisualization();

    // Configure movement service for route tracking
    this._movementService.updateConfig({
      minAccuracy: 15, // More lenient for cycling
      minDistance: 2,  // Reduced for better tracking
      minTimeBetweenReadings: 1000 // More frequent updates
    });

    console.log('🚴 Route tracking started with enhanced waypoint detection');
    this.alertService.showSuccess('Route tracking started! 🚴‍♂️');
  }

  centerOnCurrentPosition(): void {
    if (!this.hasGpsSignal) {
      alert('GPS signal not available. Please wait for GPS to connect.');
      return;
    }

    if (this.movementState?.position) {
      console.log('📍 Manual centering on current position with smooth animation');

      this.map.flyTo([
        this.movementState.position.coords.latitude,
        this.movementState.position.coords.longitude
      ], 16, {
        animate: true,
        duration: 1.5,
        easeLinearity: 0.25
      });
    }
  }

  getGPSQualityInfo(): { quality: string, color: string, description: string } {
    if (!this.movementState) {
      return {
        quality: 'UNKNOWN',
        color: '#6c757d',
        description: 'GPS initializing...'
      };
    }

    switch (this.movementState.quality) {
      case 'good':
        return {
          quality: 'GOOD',
          color: '#28a745',
          description: `Accurate GPS signal (${this.movementState.accuracy.toFixed(1)}m)`
        };
      case 'poor':
        return {
          quality: 'FAIR',
          color: '#ffc107',
          description: `GPS signal present (${this.movementState.accuracy.toFixed(1)}m accuracy)`
        };
      case 'very_poor':
        return {
          quality: 'POOR',
          color: '#dc3545',
          description: `GPS too weak (${this.movementState.accuracy.toFixed(1)}m accuracy)`
        };
    }
  }

  getCurrentMovementInfo(): {
    speed: number,
    isMoving: boolean,
    isStationary: boolean,
    quality: string
  } {
    if (!this.movementState) {
      return {
        speed: 0,
        isMoving: false,
        isStationary: true,
        quality: 'unknown'
      };
    }

    return {
      speed: this.movementState.speed,
      isMoving: this.movementState.isMoving,
      isStationary: this.movementState.isStationary,
      quality: this.movementState.quality
    };
  }

  setIndoorMode(enabled: boolean): void {
    this._movementService.setIndoorMode(enabled);
  }

  getMovementDebugInfo(): any {
    return {
      movementState: this.movementState,
      tracking: this.isTracking,
      serviceDebug: this._movementService.getDebugInfo()
    };
  }

  checkIfMobile() {
    this.isMobile = window.innerWidth <= 768;
  }

  private initializeGPSWithMap(): void {
    // Wait for GPS to get a signal, then center once
    this.gpsService.getCurrentPosition().pipe(
      filter(position => position !== null), // Wait for actual GPS signal
      take(1) // Only take the first valid position
    ).subscribe(position => {
      if (position && this.map) {
        console.log('📍 Initial GPS signal received, centering map once');

        // Center map ONCE on first GPS signal
        this.map.setView([position.latitude, position.longitude], 12);

        // Now start continuous tracking (marker updates only)
        this.startTrackingUserPosition();
      }
    });
  }

  private initializeMap(): void {
    // Initialize map centered on Geneva, Switzerland
    this.map = L.map('map').setView([46.2044, 6.1432], 17);

    // Add OpenStreetMap tiles (free)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Add click event to map - modified to open info window
    this.map.on('click', (e: any) => {
      this.onMapClick(e.latlng.lat, e.latlng.lng, e.containerPoint);
    });

    // Try to fly to user's location if GPS is available
    if (this.gpsEnabled && this.hasGpsSignal) {
      this.flyToUserLocation();
    }
  }

  private flyToUserLocation(): void {
    // Get user's current position
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          // Fly to user's location with smooth animation
          this.map.flyTo([lat, lng], 17, {
            animate: true,
            duration: 2.5 // Duration in seconds
          });
        },
        (error) => {
          console.error('Error getting user location:', error);
          // Optionally handle error (e.g., show a message to user)
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000
        }
      );
    }
  }

  onMapClick(lat: number, lng: number, screenPosition: any) {
    if (this.activeWaypoint) {
      this.closeInfoWindow(); // Close any open info window first
      return;
    }

    // Create new waypoint
    const newWaypoint: Waypoint = {
      id: this.generateId(),
      name: '',
      latitude: lat,
      longitude: lng,
      altitudeQNH: 3000,
      speedKnots: 120,
      estimatedArrival: '',
      routingDegrees: 0,
      frequency: ''
    };

    // Set active waypoint for editing
    this.activeWaypoint = { ...newWaypoint };
    this.activeWaypointIndex = this.waypoints.length; // Will be the index if saved
    this.isNewWaypoint = true;

    // Position info window near click point
    this.infoWindowPosition = {
      x: Math.min(screenPosition.x - 150, window.innerWidth - 320),
      y: Math.max(screenPosition.y - 100, 10)
    };
  }

  // Open existing waypoint info window
  openWaypointInfo(index: number) {
    this.activeWaypoint = { ...this.waypoints[index] };
    this.activeWaypointIndex = index;
    this.isNewWaypoint = false;

    // Position info window (get marker screen position)
    const marker = this.markers[index];
    if (marker) {
      const screenPos = this.getMarkerScreenPosition(marker);
      this.infoWindowPosition = {
        x: Math.min(screenPos.x - 150, window.innerWidth - 320),
        y: Math.max(screenPos.y - 100, 10)
      };
    }
  }


  cancelWaypoint() {
    this.closeInfoWindow();
  }

  async deleteActiveWaypoint() {
    if (this.isNewWaypoint || this.activeWaypointIndex < 0) return;

    this.closeInfoWindow();

  }

  closeInfoWindow() {
    this.activeWaypoint = null;
    this.activeWaypointIndex = -1;
    this.isNewWaypoint = false;
  }

  private updateRouteVisualization(): void {
    // Remove existing route line
    if (this.routeLine) {
      // Remove distance labels if they exist
      if (this.routeLine.distanceLabels) {
        this.routeLine.distanceLabels.forEach((label: any) => this.map.removeLayer(label));
      }
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }

    // Only draw line if we have 2 or more waypoints
    if (this.waypoints.length < 2) return;

    // Create array of coordinates for the polyline
    const routeCoordinates = this.waypoints.map(wp => [wp.latitude, wp.longitude]);

    // Create the route line
    this.routeLine = L.polyline(routeCoordinates, {
      color: '#007bff',
      weight: 3,
      opacity: 0.7,
      dashArray: '10, 5', // Dashed line
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(this.map);

    console.log(`📏 Route line updated with ${this.waypoints.length} waypoints`);
  }



  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 3440.065; // Nautical miles
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }


  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }


  getDistanceToPreviousWaypoint(index: number): number {
    if (index === 0) return 0;

    const wp1 = this.waypoints[index - 1];
    const wp2 = this.waypoints[index];

    return this.calculateDistance(wp1.latitude, wp1.longitude, wp2.latitude, wp2.longitude);
  }


  getTotalRouteDistance(): number {
    if (this.waypoints.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < this.waypoints.length; i++) {
      totalDistance += this.getDistanceToPreviousWaypoint(i);
    }

    return totalDistance;
  }


  getTotalRouteTime(): number {
    const totalDistance = this.getTotalRouteDistance();
    if (totalDistance === 0) return 0;

    // Calculate average speed from all waypoints that have speed defined
    const waypointsWithSpeed = this.waypoints.filter(wp => wp.speedKnots && wp.speedKnots > 0);
    if (waypointsWithSpeed.length === 0) return 0;

    const averageSpeed = waypointsWithSpeed.reduce((sum, wp) => sum + (wp.speedKnots || 0), 0) / waypointsWithSpeed.length;

    return totalDistance / averageSpeed; // Hours
  }


  async clearAllWaypoints(): Promise<void> {
    // Remove all markers
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    // Remove route line and distance labels
    if (this.routeLine) {
      // Remove distance labels if they exist
      if (this.routeLine.distanceLabels) {
        this.routeLine.distanceLabels.forEach((label: any) => this.map.removeLayer(label));
      }
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }

    this.waypoints = [];
    this.routeLoaded = false;
    this.closeInfoWindow();
  }


  getMarkerScreenPosition(marker: any): { x: number, y: number } {
    const point = this.map.latLngToContainerPoint(marker.getLatLng());
    return { x: point.x, y: point.y };
  }

  private updateMapWithWaypoints(): void {
    // Clear existing markers and route line
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    if (this.routeLine) {
      // Remove distance labels if they exist
      if (this.routeLine.distanceLabels) {
        this.routeLine.distanceLabels.forEach((label: any) => this.map.removeLayer(label));
      }
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }


    console.log(`🗺️ Map updated with ${this.waypoints.length} waypoints and route visualization`);
  }


  hasWaypoints(): boolean {
    return this.waypoints.length > 0;
  }

  hasValidWaypoints(): boolean {
    return this.waypoints.some(wp => wp.name.trim() !== '');
  }

  canLoadRoute(): boolean {
    return this.gpsEnabled && this.hasWaypoints() && this.hasValidWaypoints();
  }

  private showUserLocationOnMap(position: any): void {
    // Check if map exists and is properly initialized
    if (!this.map || !this.map.getContainer()) {
      console.warn('Map not ready yet, skipping marker update');
      return;
    }

    // Remove existing user marker if any
    if (this.userLocationMarker) {
      this.map.removeLayer(this.userLocationMarker);
    }

    // Create a special icon for user location
    const userIcon = L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#2196F3">
        <circle cx="12" cy="12" r="10" fill="#2196F3" stroke="#fff" stroke-width="3"/>
        <circle cx="12" cy="12" r="4" fill="#fff"/>
        <circle cx="12" cy="12" r="12" fill="none" stroke="#2196F3" stroke-width="1" opacity="0.3"/>
      </svg>
    `),
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    try {
      // Add user location marker (this does NOT move the map view)
      this.userLocationMarker = L.marker([position.latitude, position.longitude], {
        icon: userIcon,
        zIndexOffset: 1000 // Always on top
      }).addTo(this.map);

      this.userLocationMarker.bindPopup('📍 Your Current Location<br>Click "Center on My Location" to focus here');
    } catch (error) {
      console.error('Error adding user location marker:', error);
    }
  }


  async saveCurrentRouteAs(name: string, description?: string): Promise<void> {
    if (!this.hasValidWaypoints()) {
      alert('Please add some waypoints with names before saving the route.');
      return;
    }

    const savedRoute: SavedRoute = {
      id: this.generateId(),
      name: name,
      description: description || '',
      waypoints: [...this.waypoints], // Deep copy
      createdAt: new Date().toISOString()
    };

  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }


  private initializeTrackingVisualization(): void {
    if (this.waypoints.length < 2) return;

    // Remove the standard route line
    if (this.routeLine) {
      if (this.routeLine.distanceLabels) {
        this.routeLine.distanceLabels.forEach((label: any) => this.map.removeLayer(label));
      }
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }

    // Create separate lines for completed and remaining route
    this.updateRouteProgress();
  }

  private startTrackingUserPosition(): void {
    this.gpsService.getCurrentPosition().subscribe(position => {
      if (position && this.map) {
        // Update user location marker
        this.showUserLocationOnMap(position);
        this.hasGpsSignal = true;

        // If tracking is active, process the position for route tracking
        if (this.isTracking) {
          this.processTrackingPosition(position);
        }
      }
    });
  }

  private updateActualPathVisualization(): void {
    if (this.actualPath.length < 2) return;

    // Remove existing actual path line
    if (this.actualPathLine) {
      this.map.removeLayer(this.actualPathLine);
    }

    // Create new actual path line
    this.actualPathLine = L.polyline(this.actualPath, {
      color: this.actualPathColor,
      weight: 4,
      opacity: 0.9,
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(this.map);

    // Bring user location marker to front
    if (this.userLocationMarker) {
      this.userLocationMarker.bringToFront();
    }
  }

  private calculateActualPathDistance(): number {
    if (this.actualPath.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < this.actualPath.length; i++) {
      const prev = this.actualPath[i - 1];
      const curr = this.actualPath[i];
      totalDistance += this.calculateDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    }

    return totalDistance;
  }

  private calculateDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private clearTrackingVisualization(): void {
    if (this.actualPathLine) {
      this.map.removeLayer(this.actualPathLine);
      this.actualPathLine = null;
    }
    if (this.completedRouteLine) {
      this.map.removeLayer(this.completedRouteLine);
      this.completedRouteLine = null;
    }
    if (this.remainingRouteLine) {
      this.map.removeLayer(this.remainingRouteLine);
      this.remainingRouteLine = null;
    }
  }

  getTrackingStats(): any {
    if (!this.isTracking || !this.trackingStartTime) {
      return null;
    }

    const elapsedTime = (new Date().getTime() - this.trackingStartTime.getTime()) / 1000 / 60; // minutes
    const actualDistance = this.calculateActualPathDistance() / 1000; // km
    const plannedDistance = this.getTotalRouteDistance() * 1.852; // Convert nautical miles to km
    const averageSpeed = actualDistance > 0 ? (actualDistance / elapsedTime) * 60 : 0; // km/h
    const progress = this.waypoints.length > 0 ? (this.currentWaypointTarget / this.waypoints.length) * 100 : 0;

    return {
      elapsedTime: elapsedTime,
      actualDistance: actualDistance,
      plannedDistance: plannedDistance,
      averageSpeed: averageSpeed,
      progress: progress,
      currentWaypoint: this.currentWaypointTarget + 1,
      totalWaypoints: this.waypoints.length
    };
  }

  toggleTracking(): void {
    if (this.isTracking) {
      this.stopRouteTracking();
    } else {
      this.startRouteTracking();
    }
  }

  resetTracking(): void {
    this.stopRouteTracking();
    this.clearTrackingVisualization();
    this.actualPath = [];
    this.currentWaypointTarget = 0;

    // Restore original route visualization
    if (this.waypoints.length >= 2) {
      this.updateRouteVisualization();
    }
  }

  exportTrackingData(): any {
    if (this.actualPath.length === 0) {
      return null;
    }

    const stats = this.getTrackingStats();
    const pathCoordinates = this.actualPath.map(point => ({
      latitude: point.lat,
      longitude: point.lng
    }));

    return {
      route: {
        waypoints: this.waypoints,
        plannedDistance: this.getTotalRouteDistance()
      },
      tracking: {
        startTime: this.trackingStartTime,
        endTime: this.isTracking ? null : new Date(),
        actualPath: pathCoordinates,
        statistics: stats
      }
    };
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
  }
}