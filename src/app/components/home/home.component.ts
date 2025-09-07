import { Component } from '@angular/core';
import { FlightAlert, Route, Waypoint } from '../../interfaces/master';
import { GpsService } from '../../services/gps.service';
import { NavigationService } from '../../services/navigation.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { filter, take } from 'rxjs';
import { environment } from '../../environments/environment.prod';

declare var L: any;

@Component({
  selector: 'app-home',
  imports: [
    CommonModule,
    FormsModule
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

  constructor(
    private gpsService: GpsService,
    private navigationService: NavigationService,
    private alertService: AlertService
  ) {
    // Monitor GPS signal
    this.gpsService.getCurrentPosition().subscribe(position => {
      this.hasGpsSignal = position !== null;
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

  get isDevelopmentMode(): boolean {
    return environment.showDevControls;
  }

  get isUsingMockGPS(): boolean {
    return environment.enableMockGPS;
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

    // Add click event to map
    this.map.on('click', (e: any) => {
      this.addWaypointFromMap(e.latlng.lat, e.latlng.lng);
    });

    // Try to center on user's location if GPS is available
    if (this.gpsEnabled && this.hasGpsSignal) {
      this.centerMapOnUser();
    }
  }

  private addWaypointFromMap(lat: number, lng: number): void {
    const waypoint: Waypoint = {
      id: this.generateId(),
      name: `Waypoint ${this.waypoints.length + 1}`,
      latitude: lat,
      longitude: lng,
      altitudeQNH: 3000,      // Default cruise altitude
      speedKnots: 120,        // Default cruise speed
      estimatedArrival: '',   // User will fill manually
      routingDegrees: 0,      // User will fill manually
      frequency: ''           // User will fill manually
    };

    this.waypoints.push(waypoint);
    this.addMarkerToMap(waypoint, this.waypoints.length - 1);
  }

  private addMarkerToMap(waypoint: Waypoint, index: number): void {
    const marker = L.marker([waypoint.latitude, waypoint.longitude], {
      draggable: true
    }).addTo(this.map);

    marker.bindPopup(`<b>${waypoint.name}</b><br>Waypoint ${index + 1}`);

    // Handle marker drag
    marker.on('dragend', (e: any) => {
      const newPos = e.target.getLatLng();
      this.waypoints[index].latitude = newPos.lat;
      this.waypoints[index].longitude = newPos.lng;
    });

    this.markers.push(marker);
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
    // Update marker popup
    if (this.markers[index]) {
      this.markers[index].setPopupContent(`<b>${newName}</b><br>Waypoint ${index + 1}`);
    }
  }

  removeWaypoint(index: number): void {
    // Remove marker from map
    if (this.markers[index]) {
      this.map.removeLayer(this.markers[index]);
      this.markers.splice(index, 1);
    }

    // Remove from waypoints array
    this.waypoints.splice(index, 1);

    // Update remaining markers
    this.updateAllMarkers();
  }

  clearAllWaypoints(): void {
    // Remove all markers
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];
    this.waypoints = [];
  }

  private updateAllMarkers(): void {
    this.markers.forEach((marker, index) => {
      marker.setPopupContent(`<b>${this.waypoints[index].name}</b><br>Waypoint ${index + 1}`);
    });
  }

  // toggleGPS(): void {
  //   if (this.gpsEnabled) {
  //     this.gpsService.startTracking();
  //     this.alertService.requestNotificationPermission();

  //     // Start tracking user position (updates marker only)
  //     this.startTrackingUserPosition();

  //     // Auto-center ONCE when GPS is first enabled
  //     setTimeout(() => {
  //       if (this.hasGpsSignal) {
  //         this.centerOnCurrentPosition();
  //       }
  //     }, 2000);

  //   } else {
  //     this.gpsService.stopTracking();

  //     // Remove user location marker when GPS is disabled
  //     if (this.userLocationMarker) {
  //       this.map.removeLayer(this.userLocationMarker);
  //       this.userLocationMarker = null;
  //     }
  //   }
  // }

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

    // Add user location marker (this does NOT move the map view)
    this.userLocationMarker = L.marker([position.latitude, position.longitude], {
      icon: userIcon,
      zIndexOffset: 1000 // Always on top
    }).addTo(this.map);

    this.userLocationMarker.bindPopup('📍 Your Current Location<br>Click "Center on My Location" to focus here');
  }

  loadRoute(): void {
    console.log('🛫 Load Route button clicked!');

    if (!this.canLoadRoute()) return;

    const route: Route = {
      id: this.generateId(),
      name: 'Current Flight',
      waypoints: this.waypoints,
      cruiseAltitude: 3000,
      cruiseSpeed: 120,
      createdAt: new Date()
    };

    this.navigationService.setRoute(route);
    this.createDefaultAlerts(this.waypoints);
    this.routeLoaded = true;

    console.log('📍 Route created:', route);

    try {
      console.log('🗂️ Setting route in navigation service...');
      this.navigationService.setRoute(route);
      console.log('✅ Route set successfully');
    } catch (error) {
      console.error('❌ Error setting route:', error);
    }

    try {
      console.log('🚨 Creating alerts...');
      this.createDefaultAlerts(this.waypoints);
      console.log('✅ Alerts created successfully');
    } catch (error) {
      console.error('❌ Error creating alerts:', error);
    }

    console.log('✅ Setting routeLoaded to true');
    this.routeLoaded = true;

    setTimeout(() => {
      console.log('⏰ Hiding success message');
      this.routeLoaded = false;
    }, 3000);
  }

  private createDefaultAlerts(waypoints: Waypoint[]): void {
    waypoints.forEach(waypoint => {
      const alert: FlightAlert = {
        id: this.generateId(),
        type: 'waypoint',
        message: `Approaching ${waypoint.name} - 2 nautical miles`,
        triggerDistance: 2,
        waypointId: waypoint.id,
        isActive: true,
        triggered: false
      };
      this.alertService.addAlert(alert);

      if (waypoint.frequency) {
        const freqAlert: FlightAlert = {
          id: this.generateId(),
          type: 'waypoint',
          message: `Tune to ${waypoint.frequency} for ${waypoint.name}`,
          triggerDistance: 5,
          waypointId: waypoint.id,
          isActive: true,
          triggered: false
        };
        this.alertService.addAlert(freqAlert);
      }
    });
  }

  private generateId(): string {
    return Math.random().toString(36).substr(2, 9);
  }

  setMockSpeed(speedKnots: number): void {
    // This would require adding a method to GPS service to adjust mock speed
    console.log(`Setting mock speed to ${speedKnots} knots`);
  }

  addTestRoute(): void {
    // Clear existing waypoints
    this.clearAllWaypoints();

    // Add test waypoints for development
    const testWaypoints = [
      {
        id: 'test1',
        name: 'START',
        latitude: 40.7580,
        longitude: -73.9855,
        altitudeQNH: 3000,
        speedKnots: 120,
        frequency: '118.7'
      },
      {
        id: 'test2',
        name: 'MID',
        latitude: 40.8176,
        longitude: -73.7782,
        altitudeQNH: 3500,
        speedKnots: 120,
        frequency: '119.1'
      },
      {
        id: 'test3',
        name: 'END',
        latitude: 40.8848,
        longitude: -73.5764,
        altitudeQNH: 3000,
        speedKnots: 120,
        frequency: '120.5'
      }
    ];

    this.waypoints = testWaypoints;
    this.updateMapWithWaypoints();
    this.loadRoute();
  }

  private updateMapWithWaypoints(): void {
    // Clear existing markers
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];

    // Add new markers
    this.waypoints.forEach((waypoint, index) => {
      this.addMarkerToMap(waypoint, index);
    });
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.remove();
    }
  }
}