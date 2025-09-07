import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { GpsService } from './gps.service';
import { NavigationData, Position, Route } from '../interfaces/master';

// Coordinate interface for distance/bearing calculations
interface Coordinates {
  latitude: number;
  longitude: number;
}

@Injectable({
  providedIn: 'root'
})

export class NavigationService {

  private currentRoute$ = new BehaviorSubject<Route | null>(null);
  private currentWaypointIndex$ = new BehaviorSubject<number>(0);

  constructor(private gpsService: GpsService) { }

  setRoute(route: Route): void {
    this.currentRoute$.next(route);
    this.currentWaypointIndex$.next(0);
  }

  getCurrentRoute(): Observable<Route | null> {
    return this.currentRoute$.asObservable();
  }

  // Update the getNavigationData method in navigation.service.ts
  getNavigationData(): Observable<NavigationData | null> {
    return combineLatest([
      this.gpsService.getCurrentPosition(),
      this.currentRoute$,
      this.currentWaypointIndex$
    ]).pipe(
      map(([position, route, waypointIndex]) => {
        if (!position || !route || route.waypoints.length === 0) {
          return null;
        }

        const nextWaypoint = route.waypoints[waypointIndex];
        if (!nextWaypoint) return null;

        const distance = this.calculateDistance(position, nextWaypoint);
        const bearing = this.calculateBearing(position, nextWaypoint);
        const groundSpeed = this.calculateGroundSpeed(position);

        // Fix ETA calculation with minimum speed threshold
        const eta = this.calculateETA(distance, groundSpeed);

        return {
          currentPosition: position,
          nextWaypoint,
          distanceToNext: distance,
          bearingToNext: bearing,
          crossTrackError: 0,
          groundSpeed,
          estimatedTimeToNext: eta
        };
      })
    );
  }

  private calculateETA(distanceNM: number, groundSpeedKnots: number): number {
    // Set minimum threshold - below 10 knots, don't calculate ETA
    const MIN_SPEED_KNOTS = 10;

    if (groundSpeedKnots < MIN_SPEED_KNOTS) {
      return -1; // Special value to indicate "no ETA available"
    }

    // Calculate ETA in minutes
    const etaMinutes = (distanceNM / groundSpeedKnots) * 60;

    // Cap maximum ETA at 999 minutes (16+ hours seems unrealistic for VFR)
    return Math.min(etaMinutes, 999);
  }

  private calculateGroundSpeed(position: Position): number {
    if (!position.speed) return 0;

    const speedKnots = position.speed * 1.94384; // Convert m/s to knots

    // Filter out GPS noise - speeds below 2 knots are likely noise when stationary
    return speedKnots < 2 ? 0 : speedKnots;
  }

  advanceToNextWaypoint(): void {
    combineLatest([this.currentRoute$, this.currentWaypointIndex$]).pipe(
      map(([route, index]) => {
        if (route && index < route.waypoints.length - 1) {
          this.currentWaypointIndex$.next(index + 1);
        }
      })
    ).subscribe();
  }

  private calculateDistance(pos1: Coordinates, pos2: Coordinates): number {
    const R = 3440.065; // Earth's radius in nautical miles
    const dLat = this.toRadians(pos2.latitude - pos1.latitude);
    const dLon = this.toRadians(pos2.longitude - pos1.longitude);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(pos1.latitude)) * Math.cos(this.toRadians(pos2.latitude)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private calculateBearing(pos1: Coordinates, pos2: Coordinates): number {
    const dLon = this.toRadians(pos2.longitude - pos1.longitude);
    const lat1 = this.toRadians(pos1.latitude);
    const lat2 = this.toRadians(pos2.latitude);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let bearing = Math.atan2(y, x);
    bearing = this.toDegrees(bearing);
    return (bearing + 360) % 360;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private toDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }
}