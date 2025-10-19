import { ChangeDetectorRef, Component, HostListener, isDevMode, NgZone } from '@angular/core';
import { RouteType, SavedRoute } from '../../interfaces/master';
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
import { Router } from '@angular/router';
import { MockRouteService } from '../../services/mock-route.service';


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

  private routeMaxSpeed: number = 0;
  private routeDistance: number = 0;
  private routeStartTime: number = 0;
  routeCoordinates: any[] = [];
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
  environment = environment;
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
    private _IDBService: IDBService,
    private _router: Router,
    private _mockRouteService: MockRouteService
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

  }

  async ngAfterViewInit(): Promise<void> {
    // console.log('[ngAfterViewInit] ▶ Starting');

    //  console.log('[ngAfterViewInit] 1️⃣ Initializing map...');
    this.initializeMap();
    //  console.log('[ngAfterViewInit] ✅ Map initialized');

    //  console.log('[ngAfterViewInit] 2️⃣ Starting GPS tracking...');
    this._gpsService.startTracking();
    // console.log('[ngAfterViewInit] ✅ GPS tracking started');

    // console.log('[ngAfterViewInit] 3️⃣ Initializing GPS with map...');
    this.initializeGPSWithMap();
    // console.log('[ngAfterViewInit] ✅ GPS initialized with map');

    // console.log('[ngAfterViewInit] 4️⃣ Subscribing to route updates...');
    this.subscribeToRouteUpdates();
    //  console.log('[ngAfterViewInit] ✅ Subscribed to route updates');

    console.log('[ngAfterViewInit] 5️⃣ Loading saved routes...');
    await this.loadSavedRoutes();
    console.log('✅ Routes loaded and view ready');
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
        const id = await this.saveCurrentRoute(name, description);

        alert(`Route "${name}" saved successfully!`);
        await this.loadSavedRoutes();
        this.clearCurrentRoute();
      } catch (error) {
        console.error('Failed to save route:', error);
        alert('Failed to save route. Please try again.');
      }
    }
  }

  async saveCurrentRoute(name?: string, description?: string): Promise<string> {
    if (this.routeCoordinates.length === 0) {
      throw new Error('No route to save');
    }

    const endTime = Date.now();
    const duration = (endTime - this.routeStartTime) / 1000;
    const averageSpeed = duration > 0 ? (this.routeDistance / duration) * 3.6 : 0;

    const route: SavedRoute = {
      id: this._gpsService.generateId(),
      name: name || `Ride ${new Date(this.routeStartTime).toLocaleString()}`,
      distance: this.routeDistance,
      duration: duration,
      coordinates: [...this.routeCoordinates],
      maxSpeed: this.routeMaxSpeed,
      averageSpeed: averageSpeed,
      startTime: this.routeStartTime,
      endTime: endTime,
      createdAt: new Date(this.routeStartTime).toISOString(),
      lastUsed: new Date(endTime).toISOString(),
      description: description || `Distance: ${(this.routeDistance / 1000).toFixed(2)}km, Duration: ${Math.floor(duration / 60)}min`
    };

    await this._IDBService.saveRoute(route);
    return route.id;
  }

  async saveMockRoute(routeType: RouteType = 'city', customName?: string, customDescription?: string): Promise<string> {
    console.log(`🚴 Generating ${routeType} mock route...`);

    // Generate mock coordinates
    const mockCoordinates = this._mockRouteService.generateMockRoute(routeType);

    // Set the coordinates to your component's route tracking
    this.routeCoordinates = mockCoordinates;

    // Calculate metrics from the mock data
    this.calculateRouteMetrics(mockCoordinates);

    // Generate appropriate name and description if not provided
    const routeName = customName || `${this.capitalizeFirstLetter(routeType)} Training Ride`;
    const routeDescription = customDescription ||
      `Mock ${routeType} route with ${mockCoordinates.length} points. Total distance: ${(this.routeDistance / 1000).toFixed(2)}km`;

    // Use your existing save method
    const routeId = await this.saveCurrentRoute(routeName, routeDescription);

    console.log(`✅ Mock ${routeType} route saved successfully: ${routeId}`);
    return routeId;
  }


  async savePopularRoute(routeName: string, customName?: string, customDescription?: string): Promise<string> {
    console.log(`🗺️ Loading popular route: ${routeName}...`);

    // Get pre-defined route coordinates
    const popularCoordinates = this._mockRouteService.getPopularRoute(routeName);

    // Set the coordinates to your component's route tracking
    this.routeCoordinates = popularCoordinates;

    // Calculate metrics from the popular route data
    this.calculateRouteMetrics(popularCoordinates);

    // Use your existing save method
    const routeId = await this.saveCurrentRoute(
      customName || routeName,
      customDescription || `Popular bike route: ${routeName}`
    );

    console.log(`✅ Popular route "${routeName}" saved successfully: ${routeId}`);
    return routeId;
  }


  private calculateRouteMetrics(coordinates: any[]): void {
    if (coordinates.length < 2) {
      this.routeDistance = 0;
      this.routeMaxSpeed = 0;
      this.routeStartTime = Date.now();
      return;
    }

    let totalDistance = 0;
    let maxSpeed = 0;

    // Calculate total distance and max speed
    for (let i = 1; i < coordinates.length; i++) {
      const prev = coordinates[i - 1];
      const curr = coordinates[i];

      // Calculate distance between points using Haversine formula
      const distance = this.calculateDistance(prev.lat, prev.lon, curr.lat, curr.lon);
      totalDistance += distance;

      // Track max speed (use provided speed or calculate from distance/time)
      if (curr.speed && curr.speed > maxSpeed) {
        maxSpeed = curr.speed;
      }
    }

    this.routeDistance = totalDistance;
    this.routeMaxSpeed = maxSpeed;
    this.routeStartTime = coordinates[0].timestamp;
  }


  private capitalizeFirstLetter(string: string): string {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }

  async testAllMockRoutes(): Promise<void> {
    const routeTypes: RouteType[] = ['city', 'country', 'mountain', 'coastal'];

    console.log('🧪 Testing all mock route types...');

    for (const routeType of routeTypes) {
      try {
        await this.saveMockRoute(routeType);
        // Small delay between saves to avoid ID conflicts
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Failed to save ${routeType} route:`, error);
      }
    }

    console.log('✅ All mock route tests completed');
  }

  // NEW: Test method for popular routes
  async testAllPopularRoutes(): Promise<void> {
    const popularRoutes = ['centralParkLoop', 'goldenGateBridge', 'amsterdamCanals', 'londonThames'];

    console.log('🏛️ Testing all popular routes...');

    for (const routeName of popularRoutes) {
      try {
        await this.savePopularRoute(routeName);
        // Small delay between saves to avoid ID conflicts
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Failed to save ${routeName} route:`, error);
      }
    }

    console.log('✅ All popular route tests completed');
  }

  async testCityRoute() {
    await this.saveMockRoute('city', 'Morning City Commute', 'Test city route with traffic simulation');
  }

  async testMountainRoute() {
    await this.saveMockRoute('mountain', 'Mountain Challenge', 'High elevation gain training route');
  }

  // Save a pre-defined popular route
  async testCentralPark() {
    await this.savePopularRoute('centralParkLoop', 'Central Park Loop', 'Classic NYC bike route');
  }

  async testGoldenGate() {
    await this.savePopularRoute('goldenGateBridge', 'Golden Gate Tour', 'Scenic San Francisco ride');
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
    //  console.log('[loadSavedRoutes] ▶ Called');
    try {
      // console.log('[loadSavedRoutes] About to call getAllRoutes...');

      const routesPromise = this._IDBService.getAllRoutes();
      //  console.log('[loadSavedRoutes] Promise created, awaiting...');

      this.savedRoutes = await Promise.race([
        routesPromise,
        new Promise<SavedRoute[]>((_, reject) =>
          setTimeout(() => reject(new Error('getAllRoutes timeout after 5s')), 5000)
        )
      ]);

      //   console.log(`📂 Loaded ${this.savedRoutes?.length ?? 0} saved routes`);
    } catch (error) {
      console.error('❌ Failed to load routes:', error);
    }
  }


  toggleSavedRoutes(): void {
    this.showSavedRoutes = !this.showSavedRoutes;
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

  viewSavedRoute(route: SavedRoute): void {

    this._gpsService.loadRouteToMap(route);

    if (route.coordinates.length > 0) {
      const bounds = L.latLngBounds(route.coordinates);
      this.map.fitBounds(bounds, { padding: [50, 50] });
    }

    this.showSavedRoutes = false;
  }

  formatDistance(kilometers: number): string {
    const m = kilometers;
    return m > 1000 ? `${m.toFixed(0)}m` : `${m.toFixed(2)}km`;
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  }

  formatSpeed(kmh: number): string {
    return `${kmh.toFixed(1)} km/h`;
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

  goToContacts() {
    console.log('GO TO INFO')
    this._router.navigate(['/info']);
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