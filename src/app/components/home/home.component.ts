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


  private centerMapOnUser(): void {
    this.gpsService.getCurrentPosition().subscribe(position => {
      if (position) {
        this.map.setView([position.latitude, position.longitude], 10);
      }
    });
  }

  getMarkerScreenPosition(marker: any): { x: number, y: number } {
    const point = this.map.latLngToContainerPoint(marker.getLatLng());
    return { x: point.x, y: point.y };
  }


  hasValidWaypoints(): boolean {
    return this.waypoints.some(wp => wp.name.trim() !== '');
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