import { ChangeDetectorRef, Component, HostListener, isDevMode, NgZone } from '@angular/core';
import { SavedRoute } from '../../interfaces/master';
import { GpsService } from '../../services/gps.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, Subscription, take } from 'rxjs';
import { ChronometerComponent } from '../chronometer/chronometer.component';
import * as L from 'leaflet';
import { ChronometerService } from '../../services/chronometer.service';
import { OdometerService } from '../../services/odometer.service';
import { environment } from '../../environments/environment';
import { IDBService } from '../../services/idb.service';


@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    FormsModule,
    ChronometerComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})

export class HomeComponent {

  selectedTab: string = 'map';

  //--=====================================================================================
  //--=====================================================================================

  showMockControl = environment.enableMockGPS;
  private map!: L.Map;
  private routeLine: L.Polyline | null = null;
  private gpsRouteLine: L.Polyline | null = null;
  gpsEnabled = true;
  hasGpsSignal = false;
  routeLoaded = false;
  private userLocationMarker: any;
  private markers: any[] = [];
  private userLocation?: { lat: number, lng: number };

  infoWindowPosition = { x: 0, y: 0 };
  isMobile = false;

  // Route tracking properties
  isRecordingRoute = false;
  currentRouteStats = { distance: 0, maxSpeed: 0, duration: 0 };
  savedRoutes: SavedRoute[] = [];
  showSavedRoutes = false;
  private routeSubscription?: Subscription;

  //--=====================================================================================
  //--=====================================================================================


  navigationActive = false;
  totalRouteDistance = 0;
  remainingDistance = 0;
  estimatedTimeRemaining = 0;
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
  private readonly BIKING_ZOOM_LEVEL = 18;
  private movementZoomSubscription?: Subscription;

  //--==========================================================================================

  constructor(
    public _gpsService: GpsService,
    private _cdr: ChangeDetectorRef,
    private _ngZone: NgZone,
    private _chronometerService: ChronometerService,
    private _odometerService: OdometerService,
    private _IDBService: IDBService
  ) {
    this.checkIfMobile();

    // Monitor GPS signal
    this._gpsService.getCurrentPosition().subscribe(position => {
      this.hasGpsSignal = position !== null;
    });
  }

  async ngOnInit(): Promise<void> {
    // Run animation outside Angular zone
    this._ngZone.runOutsideAngular(() => {
      this.animationInterval = setInterval(() => {
        this.aircraftOffset = Math.sin(Date.now() / 1000) * 2;
        this._ngZone.run(() => {
          this._cdr.detectChanges();
        });
      }, 50);
    });

    this.movementZoomSubscription = this._chronometerService.onMovementDetected()
      .subscribe(position => {
        console.log('🗺️ Zooming map to user position:', position);
        this.map.setView(
          [position.lat, position.lng],
          this.BIKING_ZOOM_LEVEL,
          { animate: true, duration: 1 }
        );
      });

    if (isDevMode()) {
      await this._gpsService.seedMockRoutesIfEmpty();
    }

    // Load routes after seeding
    this.loadSavedRoutes();
  }

  ngAfterViewInit(): void {
    this.initializeMap();
    this._gpsService.startTracking();
    this.initializeGPSWithMap();
    this.subscribeToRouteUpdates();
  }

  checkIfMobile() {
    this.isMobile = window.innerWidth <= 768;
  }

  private initializeGPSWithMap(): void {
    this._gpsService.getCurrentPosition().pipe(
      filter(position => position !== null),
      take(1)
    ).subscribe(position => {
      if (position && this.map) {
        console.log('📍 Initial GPS signal received, centering map once');
        this.map.setView([position.latitude, position.longitude], 12);
        this.startTrackingUserPosition();
      }
    });
  }

  private startTrackingUserPosition(): void {
    this._gpsService.getCurrentPosition().subscribe(position => {
      if (position && this.map) {
        this.showUserLocationOnMap(position);
        this.hasGpsSignal = true;
      }
    });
  }


  private subscribeToRouteUpdates(): void {
    this.routeSubscription = this._gpsService.getRouteCoordinates().subscribe(coordinates => {
      if (coordinates.length > 0) {
        this.updateGpsRouteOnMap(coordinates);
      }
    });
  }

  private updateGpsRouteOnMap(coordinates: [number, number][]): void {
    if (!this.map) return;

    if (this.gpsRouteLine) {
      // Update existing route
      this.gpsRouteLine.setLatLngs(coordinates);
    } else {
      // Create new route line
      this.gpsRouteLine = L.polyline(coordinates, {
        color: '#FF5722',
        weight: 4,
        opacity: 0.8,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(this.map);
    }

    // Update stats
    if (this.isRecordingRoute) {
      this.currentRouteStats = this._gpsService.getRouteStatsToTraceRouteOnMap();
    }
  }

  startRecording(): void {
    if (!this.hasGpsSignal) {
      alert('GPS signal not available. Please wait for GPS to connect.');
      return;
    }

    this._gpsService.clearRoute();
    this._gpsService.startRouteRecording();
    this.isRecordingRoute = true;

    // Clear previous GPS route line
    if (this.gpsRouteLine) {
      this.map.removeLayer(this.gpsRouteLine);
      this.gpsRouteLine = null;
    }

    console.log('🎬 Started recording route');
  }

  async saveRoute(): Promise<void> {
    if (!this.isRecordingRoute && this._gpsService.getCurrentRoute().length === 0) {
      alert('No route to save');
      return;
    }

    const stats = this._odometerService.getTripStats();
    const distanceKm = (stats.tripDistance / 1000).toFixed(2);
    const durationMin = Math.floor(stats.movingTime / 60);

    const name = prompt(
      `Save this ride?\n\nDistance: ${distanceKm} km\nDuration: ${durationMin} min\nMax Speed: ${stats.maxSpeed.toFixed(1)} km/h\nAvg Speed: ${stats.averageSpeed.toFixed(1)} km/h\n\nEnter a name:`,
      `Ride ${distanceKm}km`
    );

    if (name) {
      try {

        const description = `Distance: ${distanceKm}km, Duration: ${durationMin}min, Max: ${stats.maxSpeed.toFixed(1)}km/h, Avg: ${stats.averageSpeed.toFixed(1)}km/h`;
        const id = await this._gpsService.saveCurrentRoute(name, description);

        console.log('💾 Route saved with ID:', id);
        alert(`Route "${name}" saved successfully!`);
        await this.loadSavedRoutes();
        this.clearCurrentRoute();
      } catch (error) {
        console.error('Failed to save route:', error);
        alert('Failed to save route. Please try again.');
      }
    }
  }

  clearCurrentRoute(): void {
    this._gpsService.clearRoute();
    this.isRecordingRoute = false;
    this.currentRouteStats = { distance: 0, maxSpeed: 0, duration: 0 };

    if (this.gpsRouteLine) {
      this.map.removeLayer(this.gpsRouteLine);
      this.gpsRouteLine = null;
    }
  }

  async loadSavedRoutes(): Promise<void> {
    try {
      this.savedRoutes = await this._IDBService.getAllRoutes();
      console.log(`📂 Loaded ${this.savedRoutes.length} saved routes`);
    } catch (error) {
      console.error('Failed to load routes:', error);
    }
  }

  toggleSavedRoutes(): void {
    this.showSavedRoutes = !this.showSavedRoutes;
  }

  viewSavedRoute(route: SavedRoute): void {

    this._gpsService.loadRouteToMap(route);

    // Center map on route
    if (route.coordinates.length > 0) {
      const bounds = L.latLngBounds(route.coordinates);
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }

    this.showSavedRoutes = false;
  }

  async deleteSavedRoute(route: SavedRoute, event: Event): Promise<void> {
    event.stopPropagation();

    if (!route.id) return;

    const confirmDelete = confirm(`Delete route "${route.name}"?`);
    if (confirmDelete) {
      try {
        await this._IDBService.deleteRoute(route.id);
        await this.loadSavedRoutes();
        console.log('🗑️ Route deleted');
      } catch (error) {
        console.error('Failed to delete route:', error);
        alert('Failed to delete route');
      }
    }
  }

  formatDistance(meters: number): string {
    const km = meters / 1000;
    return km < 1 ? `${meters.toFixed(0)}m` : `${km.toFixed(2)}km`;
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  formatSpeed(knots: number): string {
    return `${knots.toFixed(1)} kn`;
  }

  formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  centerOnCurrentPosition(): void {
    if (!this.hasGpsSignal) {
      alert('GPS signal not available. Please wait for GPS to connect.');
      return;
    }

    this._gpsService.getCurrentPosition().pipe(
      take(1)
    ).subscribe(position => {
      if (position && this.map) {
        console.log('📍 Manual centering on current position');
        this.map.setView([position.latitude, position.longitude], 12);
      }
    });
  }

  private initializeMap(): void {

    this.map = L.map('map', {
      zoomControl: false,      // Removes zoom buttons
      attributionControl: false // Removes attribution text
    }).setView([40.7128, -74.0060], 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

    if (this.gpsEnabled && this.hasGpsSignal) {
      this.centerMapOnUser();
    }
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


  private centerMapOnUser(): void {
    this._gpsService.getCurrentPosition().subscribe(position => {
      if (position) {
        this.map.setView([position.latitude, position.longitude], 10);
      }
    });
  }

  getMarkerScreenPosition(marker: any): { x: number, y: number } {
    const point = this.map.latLngToContainerPoint(marker.getLatLng());
    return { x: point.x, y: point.y };
  }

  private showUserLocationOnMap(position: any): void {
    if (!this.map || !this.map.getContainer()) {
      console.warn('Map not ready yet, skipping marker update');
      return;
    }

    if (this.userLocationMarker) {
      this.map.removeLayer(this.userLocationMarker);
    }

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
      this.userLocationMarker = L.marker([position.latitude, position.longitude], {
        icon: userIcon,
        zIndexOffset: 1000
      }).addTo(this.map);

      this.userLocationMarker.bindPopup('📍 Your Current Location<br>Click "Center on My Location" to focus here');
    } catch (error) {
      console.error('Error adding user location marker:', error);
    }
  }

  @HostListener('window:resize', ['$event'])
  onResize(event: any) {
    this.checkIfMobile();
  }


  toggleDistances(): void {
    this.showDistances = !this.showDistances;
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
    if (this.animationInterval) {
      clearInterval(this.animationInterval);
    }
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
    this.movementZoomSubscription?.unsubscribe();
  }
}