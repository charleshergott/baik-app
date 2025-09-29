import { ChangeDetectorRef, Component, HostListener, NgZone } from '@angular/core';
import { SavedRoute, Waypoint } from '../../interfaces/master';
import { GpsService } from '../../services/gps.service';
import { NavigationService } from '../../services/navigation.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, Subscription, take } from 'rxjs';


import * as L from 'leaflet';
import { ChronometerComponent } from '../chronometer/chronometer.component';


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

  selectedTab: string = 'map';

  //--=====================================================================================
  //--=====================================================================================

  private map!: L.Map;
  private routeLine: L.Polyline | null = null;
  private distanceLabels: L.Marker[] = [];
  waypoints: Waypoint[] = [];
  gpsEnabled = true;
  hasGpsSignal = false;
  routeLoaded = false;
  private userLocationMarker: any;
  private markers: any[] = [];
  private userLocation?: { lat: number, lng: number };
  // New properties for info window approach
  activeWaypoint: Waypoint | null = null;
  activeWaypointIndex: number = -1;
  isNewWaypoint: boolean = false;
  infoWindowPosition = { x: 0, y: 0 };
  isMobile = false;

  // Saved routes for quick access
  savedRoutes: SavedRoute[] = [];



  //--=====================================================================================
  //--=====================================================================================


  private waypointsSubscription?: Subscription;
  navigationActive = false;
  totalRouteDistance = 0;
  remainingDistance = 0;
  estimatedTimeRemaining = 0;
  currentWaypointIndex = 0;
  aircraftSpeed = 0; // Current aircraft speed in knots
  distanceToNextWaypoint = 0; // Distance to next waypoint in nautical miles
  rollProgressPercentage = 0; // How far through the current waypoint roll we are
  isRolling = false;
  currentPosition: { latitude: number; longitude: number } | null = null;
  showDistances = true;
  showBearings = true;
  showETAs = true;
  private aircraftOffset = 0;
  private animationInterval: any;
  private gpsSubscription?: Subscription;
  rollSpeed = 2000; // milliseconds per roll

  //--==========================================================================================

  constructor(
    private gpsService: GpsService,
    private alertService: AlertService,
    private _cdr: ChangeDetectorRef,
    private _ngZone: NgZone
  ) {
    this.checkIfMobile();

    // Monitor GPS signal
    this.gpsService.getCurrentPosition().subscribe(position => {
      this.hasGpsSignal = position !== null;
    });

  }


  //--=====================================================================================================================================--//
  //--=====================================================================================================================================--//
  //--=====================================================================================================================================--//



  setSelectedTab(tab: string): void {
    setTimeout(() => {
      this.selectedTab = tab;
      this._cdr.detectChanges(); // Use detectChanges instead of markForCheck

      if (tab === 'map') {
        setTimeout(async () => {
          await this.recreateMap();
        }, 200);
      }
    }, 0);
  }


  private async recreateMap(): Promise<void> {
    try {
      // Define default center and zoom
      let currentCenter: L.LatLngExpression = this.getDefaultMapCenter();
      let currentZoom = 8;

      if (this.map) {
        try {
          // Try to preserve current view
          const center = this.map.getCenter();
          if (center && center.lat && center.lng) {
            currentCenter = [center.lat, center.lng];
            currentZoom = this.map.getZoom();
          }
        } catch (error) {
          console.warn('Could not get current map center, using default');
        }

        this.map.remove(); // Remove old map
      }

      console.log('🗺️ Recreating map...');

      // Wait for DOM cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Create new map
      this.map = L.map('map').setView(currentCenter, currentZoom);

      // Add tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(this.map);

      console.log('🗺️ Map created, adding click event...');

      // Add click event with proper typing
      this.map.on('click', (e: L.LeafletMouseEvent) => {
        console.log('🖱️ Map clicked:', e.latlng);
        this.onMapClick(e.latlng.lat, e.latlng.lng, e.containerPoint);
      });

      // Wait for map to render
      await new Promise(resolve => setTimeout(resolve, 100));

      console.log('🗺️ Map recreation complete');

      // Center on user if GPS is available
      if (this.gpsEnabled && this.hasGpsSignal) {
        this.centerMapOnUser();
      }

    } catch (error) {
      console.error('❌ Error recreating map:', error);
    }
  }

  // Helper method to get default center coordinates
  private getDefaultMapCenter(): L.LatLngExpression {
    // You can customize this based on your application's needs
    // Examples:
    // return [40.7128, -74.0060]; // New York
    // return [51.5074, -0.1278];  // London
    // return [37.7749, -122.4194]; // San Francisco

    // Or use user's last known location if available
    if (this.userLocation) {
      return [this.userLocation.lat, this.userLocation.lng];
    }

    // Default fallback (London)
    return [51.505, -0.09];
  }



  //--=====================================================================================================================================--//
  //--=====================================================================================================================================--//
  //--=====================================================================================================================================--//




  ngOnInit(): void {
    // Run animation outside Angular zone
    this._ngZone.runOutsideAngular(() => {
      this.animationInterval = setInterval(() => {
        this.aircraftOffset = Math.sin(Date.now() / 1000) * 2;
        // Only trigger change detection occasionally for the animation
        this._ngZone.run(() => {
          this._cdr.detectChanges();
        });
      }, 50); // Update every 50ms instead of every change detection cycle
    });
  }

  ngAfterViewInit(): void {
    this.initializeMap();

    // Start GPS tracking immediately
    this.gpsService.startTracking();
    this.alertService.requestNotificationPermission();

    // Wait for GPS signal, then center ONCE and start position tracking
    this.initializeGPSWithMap();

    this.startGPSTracking();
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

  private addMarkerToMap(waypoint: Waypoint, index: number): void {
    // Create a numbered marker icon
    const numberedIcon = this.createNumberedMarkerIcon(index + 1);
    const marker = L.marker([waypoint.latitude, waypoint.longitude], {
      icon: numberedIcon,
      draggable: true
    }).addTo(this.map);

    // Create floating name label if name exists
    if (waypoint.name) {
      const nameIcon = this.createNameLabelIcon(waypoint.name, waypoint.altitudeQNH);
      const labelMarker = L.marker([waypoint.latitude, waypoint.longitude], {
        icon: nameIcon,
        interactive: false  // Don't intercept clicks
      }).addTo(this.map);

      // Store both markers for cleanup
      this.markers.push(marker, labelMarker);
    } else {
      this.markers.push(marker);
    }

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

  private createNameLabelIcon(name: string, altitudeQNH?: number): L.Icon {
    const svgContent = `
      <svg xmlns="http://www.w3.org/2000/svg" width="50" height="24" viewBox="0 0 120 24">
        <rect x="1" y="1" width="118" height="22" rx="4" ry="4" 
              fill="rgba(255,255,255,0.95)" stroke="#2563eb" stroke-width=".5"/>
        <text x="60" y="15" text-anchor="middle" font-family="Arial,sans-serif" 
              font-size="11" font-weight="bold" fill="#1e40af">${name}, ${altitudeQNH}</text>
      </svg>
    `;

    return L.icon({
      iconUrl: `data:image/svg+xml,${encodeURIComponent(svgContent)}`,
      iconSize: [100, 24],
      iconAnchor: [80, 50], // Position above the main marker
      className: 'name-label'
    });
  }


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


  private getWaypointColor(number: number): string {
    if (number === 1) return '#28a745'; // Green for start
    if (number === this.waypoints.length) return '#dc3545'; // Red for end
    return '#007bff'; // Blue for intermediate waypoints
  }


  private updateRouteVisualization(): void {
    // Remove existing route line
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }

    // Remove existing distance labels
    this.clearDistanceLabels();

    // Only draw line if we have 2 or more waypoints
    if (this.waypoints.length < 2) return;

    // Create array of coordinates for the polyline
    const routeCoordinates: L.LatLngExpression[] = this.waypoints.map(wp => [wp.latitude, wp.longitude]);

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

  private clearDistanceLabels(): void {
    if (this.distanceLabels && this.distanceLabels.length > 0) {
      this.distanceLabels.forEach((label: L.Marker) => {
        this.map.removeLayer(label);
      });
      this.distanceLabels = [];
    }
  }

  private addDistanceLabels(): void {
    // Clear any existing labels first
    this.clearDistanceLabels();

    console.log('🏷️ Creating distance labels:');

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

      // Log what we're about to pass to createDistanceLabel
      console.log(`  Label ${i + 1}: ${wp1.name || 'WP' + (i + 1)} → ${wp2.name || 'WP' + (i + 2)}`);
      console.log(`    Using wp2.frequency: "${wp2.frequency || 'NONE'}"`);

      // Create distance label with destination waypoint's frequency
      const distanceLabel = L.marker([midLat, midLng], {
        icon: this.createDistanceLabel(distance, bearing, wp2.frequency || '')
      }).addTo(this.map);

      this.distanceLabels.push(distanceLabel);
    }
  }

  private createDistanceLabel(distance: number, bearing: number, frequency?: string): L.Icon {
    // Pre-calculate text values to avoid template literal issues
    const distanceText = distance.toFixed(1);
    const bearingText = bearing.toFixed(0);
    const timeToWaypoint = this.getTimeToNextWaypoint();
    const frequencyText = frequency || '';

    // Build SVG string with four-line layout
    const svgContent =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="64" viewBox="0 0 100 64">' +
      // Background with subtle shadow
      '<defs>' +
      '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">' +
      '<feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="rgba(0,0,0,0.2)"/>' +
      '</filter>' +
      '</defs>' +
      // Main background rectangle
      '<rect x="2" y="2" width="96" height="60" rx="6" ry="6" ' +
      'fill="rgba(255,255,255,0.95)" stroke="#2563eb" stroke-width="1.5" filter="url(#shadow)"/>' +
      // Distance (main value) - Line 1
      '<text x="50" y="16" text-anchor="middle" font-family="Arial,sans-serif" ' +
      'font-size="14" font-weight="bold" fill="#1e40af">' + distanceText + ' nm</text>' +
      // Bearing - Line 2
      '<text x="50" y="30" text-anchor="middle" font-family="Arial,sans-serif" ' +
      'font-size="10" fill="#6b7280">' + bearingText + '°</text>' +
      // Time - Line 3
      '<text x="50" y="42" text-anchor="middle" font-family="Arial,sans-serif" ' +
      'font-size="10" fill="#6b7280">' + timeToWaypoint + 's</text>' +
      // Frequency - Line 4 (only if frequency exists)
      (frequencyText ? '<text x="50" y="56" text-anchor="middle" font-family="Arial,sans-serif" ' +
        'font-size="10" fill="#6b7280">' + frequencyText + '</text>' : '') +
      '</svg>';

    // Use encodeURIComponent for better encoding
    const encodedSvg = encodeURIComponent(svgContent);

    return L.icon({
      iconUrl: `data:image/svg+xml,${encodedSvg}`,
      iconSize: [100, 64],  // Match the SVG dimensions
      iconAnchor: [50, 32], // Center the icon (half of width, half of height)
      className: 'distance-label'
    });
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
      this.clearDistanceLabels();
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }

    // Add new markers
    this.waypoints.forEach((waypoint, index) => {
      this.addMarkerToMap(waypoint, index);
    });

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


  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }


  // Handle window resize for mobile detection
  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkIfMobile();
  }






  //--=====================================================================================================================================--//
  //--=====================================================================================================================================--//
  //--=====================================================================================================================================--//




  private startGPSTracking(): void {
    let lastPosition: { latitude: number; longitude: number; timestamp: number } | null = null;

    this.gpsSubscription = this.gpsService.getCurrentPosition().subscribe(position => {
      if (position) {
        const now = Date.now();

        // Calculate aircraft speed if we have a previous position
        if (lastPosition && this.currentPosition) {
          const timeDelta = (now - lastPosition.timestamp) / 1000; // seconds
          const distance = this.calculateDistance(
            lastPosition.latitude,
            lastPosition.longitude,
            position.latitude,
            position.longitude
          );

          // Speed in knots (nautical miles per hour)
          this.aircraftSpeed = timeDelta > 0 ? (distance / timeDelta) * 3600 : 0;
        }

        this.currentPosition = {
          latitude: position.latitude,
          longitude: position.longitude
        };

        // Store for next speed calculation
        lastPosition = {
          latitude: position.latitude,
          longitude: position.longitude,
          timestamp: now
        };


      }
    });
  }


  getStatusMessage(): string {
    if (!this.navigationActive) return 'No active route';
    if (this.currentWaypointIndex >= this.waypoints.length) return 'Route completed';

    const remaining = this.waypoints.length - this.currentWaypointIndex;
    return `${remaining} waypoint${remaining !== 1 ? 's' : ''} remaining`;
  }

  getProgressPercentage(): number {
    if (this.waypoints.length === 0) return 0;
    return (this.currentWaypointIndex / this.waypoints.length) * 100;
  }

  getAircraftSpeed(): number {
    return Math.round(this.aircraftSpeed);
  }

  getTimeToNextWaypoint(): number {
    if (this.aircraftSpeed <= 0 || this.distanceToNextWaypoint <= 0) return 0;
    return (this.distanceToNextWaypoint / this.aircraftSpeed) * 60; // minutes
  }


  toggleDistances(): void {
    this.showDistances = !this.showDistances;
  }

  toggleBearings(): void {
    this.showBearings = !this.showBearings;
  }

  toggleETAs(): void {
    this.showETAs = !this.showETAs;
  }

  getProgressiveRollOffset(): number {
    // Convert percentage to pixels offset
    // Each waypoint item is approximately 100px high
    const waypointHeight = 100;
    return (this.rollProgressPercentage / 100) * waypointHeight;
  }

  getAircraftPositionOffset(): number {
    return this.aircraftOffset;
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }
  }
}