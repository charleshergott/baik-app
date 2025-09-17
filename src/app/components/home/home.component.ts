import { Component, HostListener } from '@angular/core';
import { FlightAlert, Route, SavedRoute, Waypoint } from '../../interfaces/master';
import { GpsService } from '../../services/gps.service';
import { NavigationService } from '../../services/navigation.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, take } from 'rxjs';
import { environment } from '../../environments/environment.prod';
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

  private startTrackingUserPosition(): void {
    // Continuously update user position marker WITHOUT moving the map
    this.gpsService.getCurrentPosition().subscribe(position => {
      if (position && this.map) {
        // ONLY update the marker, never call setView()
        this.showUserLocationOnMap(position);

        // Update GPS signal status
        this.hasGpsSignal = true;
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

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
  }
}