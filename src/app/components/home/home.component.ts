import { Component, HostListener } from '@angular/core';
import { SavedRoute, Waypoint } from '../../interfaces/master';
import { GpsService } from '../../services/gps.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, take } from 'rxjs';
import { ChronometerComponent } from '../chronometer copy/chronometer.component';


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

  // New properties for route tracking
  private actualPath: L.LatLng[] = []; // User's actual cycling path
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

  // Saved routes for quick access
  savedRoutes: SavedRoute[] = [];

  // Route line visualization
  private routeLine: any = null;

  constructor(
    private gpsService: GpsService,
    private alertService: AlertService,
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


  // Keep this method for manual centering
  centerOnCurrentPosition(): void {
    if (!this.hasGpsSignal) {
      alert('GPS signal not available. Please wait for GPS to connect.');
      return;
    }

    this.gpsService.getCurrentPosition().pipe(
      take(1) // Only center once when button is clicked
    ).subscribe(position => {
      if (position && this.map) {
        console.log('📍 Manual centering on current position');
        this.map.setView([position.latitude, position.longitude], 12);
      }
    });
  }

  private initializeMap(): void {
    // Initialize map centered on a default location (you can change this)
    this.map = L.map('map').setView([40.7128, -74.0060], 8); // New York area

    // Add OpenStreetMap tiles (free)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    // Add click event to map - modified to open info window
    this.map.on('click', (e: any) => {
      this.onMapClick(e.latlng.lat, e.latlng.lng, e.containerPoint);
    });

    // Try to center on user's location if GPS is available
    if (this.gpsEnabled && this.hasGpsSignal) {
      this.centerMapOnUser();
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

  // Save waypoint (add new or update existing)
  async saveWaypoint() {
    if (!this.activeWaypoint) return;

    if (this.isNewWaypoint) {
      // Add new waypoint
      this.waypoints.push({ ...this.activeWaypoint });
      this.addMarkerToMap(this.activeWaypoint, this.waypoints.length - 1);
    } else {
      // Update existing waypoint
      this.waypoints[this.activeWaypointIndex] = { ...this.activeWaypoint };
      this.updateMapMarker(this.activeWaypointIndex);
      // Update route line after waypoint update
      this.updateRouteVisualization();
    }

    this.closeInfoWindow();

  }

  // Cancel waypoint editing
  cancelWaypoint() {
    this.closeInfoWindow();
  }


  async deleteActiveWaypoint() {
    if (this.isNewWaypoint || this.activeWaypointIndex < 0) return;

    this.removeWaypoint(this.activeWaypointIndex);
    this.closeInfoWindow();

  }


  closeInfoWindow() {
    this.activeWaypoint = null;
    this.activeWaypointIndex = -1;
    this.isNewWaypoint = false;
  }

  private addMarkerToMap(waypoint: Waypoint, index: number): void {
    // Create a numbered marker icon
    const numberedIcon = this.createNumberedMarkerIcon(index + 1);

    const marker = L.marker([waypoint.latitude, waypoint.longitude], {
      icon: numberedIcon,
      draggable: true
    }).addTo(this.map);

    // Create popup content
    const popupContent = `
      <strong>Waypoint ${index + 1}: ${waypoint.name || 'Unnamed'}</strong><br>
      ${waypoint.altitudeQNH ? `${waypoint.altitudeQNH}ft` : 'No altitude'}<br>
      ${waypoint.speedKnots ? `${waypoint.speedKnots}kts` : 'No speed'}<br>
      <small>Lat: ${waypoint.latitude.toFixed(6)}, Lng: ${waypoint.longitude.toFixed(6)}</small>
    `;

    marker.bindPopup(popupContent);

    // Add click event to open info window
    marker.on('click', () => this.openWaypointInfo(index));

    // Handle marker drag
    marker.on('dragend', async (e: any) => {
      const newPos = e.target.getLatLng();
      this.waypoints[index].latitude = newPos.lat;
      this.waypoints[index].longitude = newPos.lng;

      // Update route line after drag
      this.updateRouteVisualization();

    });

    this.markers.push(marker);

    // Update route line
    this.updateRouteVisualization();
  }

  // Create numbered marker icon
  private createNumberedMarkerIcon(number: number): any {
    const color = this.getWaypointColor(number);

    return L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
          <!-- Marker background -->
          <path d="M16 2C10.486 2 6 6.486 6 12c0 8 10 18 10 18s10-10 10-18c0-5.514-4.486-10-10-10z" 
                fill="${color}" stroke="#fff" stroke-width="1.5"/>
          
          <!-- Number circle background -->
          <circle cx="16" cy="12" r="8" fill="#fff" stroke="${color}" stroke-width="1"/>
          
          <!-- Number text -->
          <text x="16" y="17" text-anchor="middle" 
                font-family="Arial, sans-serif" 
                font-size="10" 
                font-weight="bold" 
                fill="${color}">${number}</text>
        </svg>
      `),
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }

  // Get color for waypoint based on its position in route
  private getWaypointColor(number: number): string {
    if (number === 1) return '#28a745'; // Green for start
    if (number === this.waypoints.length) return '#dc3545'; // Red for end
    return '#007bff'; // Blue for intermediate waypoints
  }

  // Update route line visualization
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

    // Add distance labels along the route
    this.addDistanceLabels();

    console.log(`📏 Route line updated with ${this.waypoints.length} waypoints`);
  }

  // Add distance labels between waypoints
  private addDistanceLabels(): void {
    this.routeLine.distanceLabels = [];

    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const wp1 = this.waypoints[i];
      const wp2 = this.waypoints[i + 1];

      // Calculate distance between waypoints (in nautical miles)
      const distance = this.calculateDistance(wp1.latitude, wp1.longitude, wp2.latitude, wp2.longitude);

      // Calculate midpoint for label placement
      const midLat = (wp1.latitude + wp2.latitude) / 2;
      const midLng = (wp1.longitude + wp2.longitude) / 2;

      // Calculate bearing
      const bearing = this.calculateBearing(wp1.latitude, wp1.longitude, wp2.latitude, wp2.longitude);

      // Create distance label
      const distanceLabel = L.marker([midLat, midLng], {
        icon: this.createDistanceLabel(distance, bearing)
      }).addTo(this.map);

      // Store reference for cleanup
      this.routeLine.distanceLabels.push(distanceLabel);
    }
  }

  // Create distance label icon
  private createDistanceLabel(distance: number, bearing: number): any {
    return L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 24" width="80" height="24">
          <rect x="2" y="2" width="76" height="20" rx="10" 
                fill="rgba(255,255,255,0.9)" 
                stroke="#007bff" 
                stroke-width="1"/>
          <text x="40" y="12" text-anchor="middle" 
                font-family="Arial, sans-serif" 
                font-size="10" 
                font-weight="bold" 
                fill="#007bff" 
                dominant-baseline="middle">
            ${distance.toFixed(1)}nm
          </text>
          <text x="40" y="20" text-anchor="middle" 
                font-family="Arial, sans-serif" 
                font-size="8" 
                fill="#666" 
                dominant-baseline="middle">
            ${bearing.toFixed(0)}°
          </text>
        </svg>
      `),
      iconSize: [80, 24],
      iconAnchor: [40, 12],
      className: 'distance-label'
    });
  }

  // Calculate distance between two points (nautical miles)
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

  // Calculate bearing between two points (degrees)
  private calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = this.toRadians(lng2 - lng1);
    const lat1Rad = this.toRadians(lat1);
    const lat2Rad = this.toRadians(lat2);

    const y = Math.sin(dLng) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);

    let bearing = Math.atan2(y, x);
    bearing = bearing * (180 / Math.PI);
    bearing = (bearing + 360) % 360;

    return bearing;
  }

  // Convert degrees to radians
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // Get distance to previous waypoint (for template use)
  getDistanceToPreviousWaypoint(index: number): number {
    if (index === 0) return 0;

    const wp1 = this.waypoints[index - 1];
    const wp2 = this.waypoints[index];

    return this.calculateDistance(wp1.latitude, wp1.longitude, wp2.latitude, wp2.longitude);
  }

  // Get total route distance
  getTotalRouteDistance(): number {
    if (this.waypoints.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < this.waypoints.length; i++) {
      totalDistance += this.getDistanceToPreviousWaypoint(i);
    }

    return totalDistance;
  }

  // Get total route time estimate (based on average speed)
  getTotalRouteTime(): number {
    const totalDistance = this.getTotalRouteDistance();
    if (totalDistance === 0) return 0;

    // Calculate average speed from all waypoints that have speed defined
    const waypointsWithSpeed = this.waypoints.filter(wp => wp.speedKnots && wp.speedKnots > 0);
    if (waypointsWithSpeed.length === 0) return 0;

    const averageSpeed = waypointsWithSpeed.reduce((sum, wp) => sum + (wp.speedKnots || 0), 0) / waypointsWithSpeed.length;

    return totalDistance / averageSpeed; // Hours
  }

  // Update existing map marker
  updateMapMarker(index: number) {
    const marker = this.markers[index];
    const waypoint = this.waypoints[index];

    if (marker) {
      // Update marker icon with correct number and color
      const numberedIcon = this.createNumberedMarkerIcon(index + 1);
      marker.setIcon(numberedIcon);

      // Update marker popup content
      const popupContent = `
        <strong>Waypoint ${index + 1}: ${waypoint.name || 'Unnamed'}</strong><br>
        ${waypoint.altitudeQNH ? `${waypoint.altitudeQNH}ft` : 'No altitude'}<br>
        ${waypoint.speedKnots ? `${waypoint.speedKnots}kts` : 'No speed'}<br>
        <small>Lat: ${waypoint.latitude.toFixed(6)}, Lng: ${waypoint.longitude.toFixed(6)}</small>
      `;

      marker.setPopupContent(popupContent);
    }
  }

  private centerMapOnUser(): void {
    this.gpsService.getCurrentPosition().subscribe(position => {
      if (position) {
        this.map.setView([position.latitude, position.longitude], 10);
      }
    });
  }

  updateWaypointName(index: number, newName: string): void {
    this.waypoints[index].name = newName;
    this.updateMapMarker(index);
  }

  async removeWaypoint(index: number): Promise<void> {
    // Remove marker from map
    if (this.markers[index]) {
      this.map.removeLayer(this.markers[index]);
      this.markers.splice(index, 1);
    }

    // Remove from waypoints array
    this.waypoints.splice(index, 1);

    // Update remaining markers' indices and renumber them
    this.updateMarkerIndices();

    // Update route visualization
    this.updateRouteVisualization();

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

  // Update marker indices after deletion
  updateMarkerIndices() {
    this.markers.forEach((marker, index) => {
      if (marker) {
        const waypoint = this.waypoints[index];

        // Update marker icon with new number and color
        const numberedIcon = this.createNumberedMarkerIcon(index + 1);
        marker.setIcon(numberedIcon);

        // Remove old click listener and add new one with correct index
        marker.off('click');
        marker.on('click', () => this.openWaypointInfo(index));

        // Update popup content with new index
        const popupContent = `
          <strong>Waypoint ${index + 1}: ${waypoint.name || 'Unnamed'}</strong><br>
          ${waypoint.altitudeQNH ? `${waypoint.altitudeQNH}ft` : 'No altitude'}<br>
          ${waypoint.speedKnots ? `${waypoint.speedKnots}kts` : 'No speed'}<br>
          <small>Lat: ${waypoint.latitude.toFixed(6)}, Lng: ${waypoint.longitude.toFixed(6)}</small>
        `;
        marker.setPopupContent(popupContent);
      }
    });
  }

  // Get screen position of marker
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

    // Add new markers
    this.waypoints.forEach((waypoint, index) => {
      this.addMarkerToMap(waypoint, index);
    });

    console.log(`🗺️ Map updated with ${this.waypoints.length} waypoints and route visualization`);
  }

  private updateAllMarkers(): void {
    this.markers.forEach((marker, index) => {
      this.updateMapMarker(index);
    });
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

  // Handle window resize for mobile detection
  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkIfMobile();
  }

  startRouteTracking(): void {
    if (!this.hasValidWaypoints()) {
      alert('Please create a route with waypoints before starting tracking.');
      return;
    }

    if (!this.hasGpsSignal) {
      alert('GPS signal required to start tracking.');
      return;
    }

    this.isTracking = true;
    this.trackingStartTime = new Date();
    this.currentWaypointTarget = 0;
    this.actualPath = [];
    this.lastPosition = null;

    // Clear any existing tracking visualization
    this.clearTrackingVisualization();

    // Initialize route visualization for tracking
    this.initializeTrackingVisualization();

    console.log('🚴 Route tracking started');

    // Request notification permission for waypoint alerts
    this.alertService.requestNotificationPermission();
  }

  /**
   * Stop tracking the cycling route
   */
  stopRouteTracking(): void {
    this.isTracking = false;
    this.trackingStartTime = null;

    console.log('🚴 Route tracking stopped');

    // Optionally keep the actual path visible or clear it
    // this.clearTrackingVisualization();
  }

  /**
   * Initialize route visualization for tracking mode
   */
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

  /**
   * Update route progress visualization
   */
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
        weight: 4,
        opacity: 0.8,
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(this.map);
    }

    // Create remaining route (from current target to end)
    if (this.currentWaypointTarget < this.waypoints.length - 1) {
      const remainingCoordinates = this.waypoints
        .slice(this.currentWaypointTarget)
        .map(wp => [wp.latitude, wp.longitude]);

      this.remainingRouteLine = L.polyline(remainingCoordinates, {
        color: this.remainingRouteColor,
        weight: 3,
        opacity: 0.6,
        dashArray: '10, 5',
        lineJoin: 'round',
        lineCap: 'round'
      }).addTo(this.map);
    }
  }

  /**
   * Enhanced position tracking with route progress
   */
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

  /**
   * Process GPS position for route tracking
   */
  private processTrackingPosition(position: { latitude: number, longitude: number }): void {
    const currentPos = L.latLng(position.latitude, position.longitude);

    // Add to actual path if we've moved enough (avoid GPS jitter)
    if (this.shouldRecordPosition(position)) {
      this.actualPath.push(currentPos);
      this.updateActualPathVisualization();
      this.lastPosition = position;
    }

    // Check waypoint proximity
    this.checkWaypointProximity(position);

    // Check route deviation
    this.checkRouteDeviation(position);
  }

  /**
   * Determine if position should be recorded (reduce GPS noise)
   */
  private shouldRecordPosition(position: { latitude: number, longitude: number }): boolean {
    if (!this.lastPosition) return true;

    const distance = this.calculateDistanceMeters(
      this.lastPosition.latitude, this.lastPosition.longitude,
      position.latitude, position.longitude
    );

    // Only record if moved at least 5 meters
    return distance > 5;
  }

  /**
   * Update the actual path visualization
   */
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

  /**
   * Check if user is close to the next waypoint
   */
  private checkWaypointProximity(position: { latitude: number, longitude: number }): void {
    if (this.currentWaypointTarget >= this.waypoints.length) return;

    const targetWaypoint = this.waypoints[this.currentWaypointTarget];
    const distance = this.calculateDistanceMeters(
      position.latitude, position.longitude,
      targetWaypoint.latitude, targetWaypoint.longitude
    );

    if (distance <= this.waypointReachDistance) {
      this.waypointReached(this.currentWaypointTarget);
    }
  }

  /**
   * Handle waypoint reached
   */
  private waypointReached(waypointIndex: number): void {
    const waypoint = this.waypoints[waypointIndex];

    console.log(`🎯 Waypoint ${waypointIndex + 1} reached: ${waypoint.name}`);

    // Show notification
    this.alertService.showNotification(`Waypoint reached! You've arrived at ${waypoint.name || `Waypoint ${waypointIndex + 1}`}`);

    // Update waypoint marker to show completion
    this.updateWaypointMarkerAsCompleted(waypointIndex);

    // Move to next waypoint
    this.currentWaypointTarget++;

    // Update route progress visualization
    this.updateRouteProgress();

    // Check if route is complete
    if (this.currentWaypointTarget >= this.waypoints.length) {
      this.routeCompleted();
    }
  }

  /**
   * Update waypoint marker to show it's been reached
   */
  private updateWaypointMarkerAsCompleted(index: number): void {
    const marker = this.markers[index];
    if (marker) {
      const completedIcon = this.createCompletedWaypointIcon(index + 1);
      marker.setIcon(completedIcon);
    }
  }

  /**
   * Create icon for completed waypoint
   */
  private createCompletedWaypointIcon(number: number): any {
    return L.icon({
      iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
          <!-- Marker background -->
          <path d="M16 2C10.486 2 6 6.486 6 12c0 8 10 18 10 18s10-10 10-18c0-5.514-4.486-10-10-10z" 
                fill="#28a745" stroke="#fff" stroke-width="1.5"/>
          
          <!-- Checkmark circle background -->
          <circle cx="16" cy="12" r="8" fill="#fff" stroke="#28a745" stroke-width="1"/>
          
          <!-- Checkmark -->
          <path d="M12 12l2 2 4-4" stroke="#28a745" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `),
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    });
  }

  /**
   * Check if user has deviated from the planned route
   */
  private checkRouteDeviation(position: { latitude: number, longitude: number }): void {
    if (this.currentWaypointTarget >= this.waypoints.length - 1) return;

    const currentWaypoint = this.waypoints[this.currentWaypointTarget];
    const nextWaypoint = this.waypoints[this.currentWaypointTarget + 1];

    // Calculate distance from position to the line between current and next waypoint
    const distanceToRoute = this.calculateDistanceToLineSegment(
      position,
      currentWaypoint,
      nextWaypoint
    );

    if (distanceToRoute > this.routeDeviationThreshold) {
      this.handleRouteDeviation(distanceToRoute);
    }
  }

  /**
   * Handle route deviation
   */
  private handleRouteDeviation(distance: number): void {
    // Update actual path color to indicate deviation
    if (this.actualPathLine) {
      this.actualPathLine.setStyle({ color: this.offRouteColor });
    }

    // Could show a notification or warning here
    console.log(`⚠️ Off route by ${distance.toFixed(0)} meters`);
  }

  /**
   * Handle route completion
   */
  private routeCompleted(): void {
    this.isTracking = false;

    console.log('🏁 Route completed!');

    // Calculate total time and distance
    const totalTime = this.trackingStartTime ?
      (new Date().getTime() - this.trackingStartTime.getTime()) / 1000 / 60 : 0; // minutes
    const actualDistance = this.calculateActualPathDistance();

    this.alertService.showNotification(
      `Route completed! 🎉 Time: ${totalTime.toFixed(1)} min, Distance: ${(actualDistance / 1000).toFixed(2)} km`
    );
  }

  /**
   * Calculate total distance of actual path traveled
   */
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

  /**
   * Calculate distance between two points in meters
   */
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

  /**
   * Calculate distance from point to line segment
   */
  private calculateDistanceToLineSegment(
    point: { latitude: number, longitude: number },
    lineStart: Waypoint,
    lineEnd: Waypoint
  ): number {
    const A = point.latitude - lineStart.latitude;
    const B = point.longitude - lineStart.longitude;
    const C = lineEnd.latitude - lineStart.latitude;
    const D = lineEnd.longitude - lineStart.longitude;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) {
      param = dot / lenSq;
    }

    let xx: number, yy: number;

    if (param < 0) {
      xx = lineStart.latitude;
      yy = lineStart.longitude;
    } else if (param > 1) {
      xx = lineEnd.latitude;
      yy = lineEnd.longitude;
    } else {
      xx = lineStart.latitude + param * C;
      yy = lineStart.longitude + param * D;
    }

    return this.calculateDistanceMeters(point.latitude, point.longitude, xx, yy);
  }

  /**
   * Clear all tracking visualization
   */
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

  /**
   * Get current tracking statistics
   */
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

  /**
   * Get distance from current position to a specific waypoint (for template use)
   */
  getDistanceToWaypoint(waypointIndex: number): number {
    if (waypointIndex >= this.waypoints.length || !this.hasGpsSignal) {
      return 0;
    }

    // Get current GPS position
    let currentDistance = 0;
    this.gpsService.getCurrentPosition().pipe(take(1)).subscribe(position => {
      if (position) {
        const waypoint = this.waypoints[waypointIndex];
        currentDistance = this.calculateDistanceMeters(
          position.latitude, position.longitude,
          waypoint.latitude, waypoint.longitude
        );
      }
    });

    return currentDistance;
  }

  /**
   * Toggle tracking mode
   */
  toggleTracking(): void {
    if (this.isTracking) {
      this.stopRouteTracking();
    } else {
      this.startRouteTracking();
    }
  }

  /**
   * Reset route tracking (clear all tracking data)
   */
  resetTracking(): void {
    this.stopRouteTracking();
    this.clearTrackingVisualization();
    this.actualPath = [];
    this.currentWaypointTarget = 0;

    // Reset waypoint markers to original state
    this.updateAllMarkers();

    // Restore original route visualization
    if (this.waypoints.length >= 2) {
      this.updateRouteVisualization();
    }
  }

  /**
   * Export tracking data (useful for analysis)
   */
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