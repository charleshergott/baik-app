import { Injectable } from '@angular/core';
import { Coordinate, RouteConfigs, RouteType } from '../interfaces/master';





@Injectable({
  providedIn: 'root'
})

export class MockRouteService {

  // Popular bike route starting points
  private readonly START_POSITIONS = {
    centralPark: { lat: 40.7829, lon: -73.9654 },
    goldenGate: { lat: 37.8076, lon: -122.4750 },
    london: { lat: 51.5074, lon: -0.1278 },
    amsterdam: { lat: 52.3676, lon: 4.9041 }
  };

  private readonly configs: RouteConfigs = {
    city: { latVariation: 0.002, lonVariation: 0.003, baseSpeed: 15, speedVariation: 8 },
    country: { latVariation: 0.005, lonVariation: 0.006, baseSpeed: 20, speedVariation: 6 },
    mountain: { latVariation: 0.008, lonVariation: 0.004, baseSpeed: 12, speedVariation: 10 },
    coastal: { latVariation: 0.003, lonVariation: 0.008, baseSpeed: 18, speedVariation: 7 }
  };

  generateMockRoute(routeType: RouteType = 'city'): Coordinate[] {
    const startPos = this.getStartPosition(routeType);
    const coordinates: Coordinate[] = [];

    const startTime = Date.now() - (30 * 60 * 1000); // Route started 30 minutes ago
    let currentTime = startTime;

    // Get config with proper typing
    const config = this.configs[routeType];

    let currentLat = startPos.lat;
    let currentLon = startPos.lon;

    // Add starting point
    coordinates.push({
      lat: currentLat,
      lon: currentLon,
      timestamp: currentTime,
      speed: 0
    });

    // Generate route points (20-40 points for a realistic route)
    const numPoints = Math.floor(Math.random() * 20) + 20;

    for (let i = 1; i < numPoints; i++) {
      // Time between points (30-120 seconds)
      const timeIncrement = (Math.random() * 90 + 30) * 1000;
      currentTime += timeIncrement;

      // Distance and direction variation based on route type
      const latVariation = (Math.random() - 0.5) * config.latVariation;
      const lonVariation = (Math.random() - 0.5) * config.lonVariation;

      currentLat += latVariation;
      currentLon += lonVariation;

      // Speed varies based on route type and point in route
      const baseSpeed = config.baseSpeed;
      const speedVariation = Math.random() * config.speedVariation;
      const speed = Math.max(0, baseSpeed + (Math.random() - 0.5) * speedVariation);

      coordinates.push({
        lat: this.roundCoordinate(currentLat),
        lon: this.roundCoordinate(currentLon),
        altitude: this.generateAltitude(routeType, i / numPoints),
        timestamp: currentTime,
        speed: speed
      });
    }

    return coordinates;
  }

  private getStartPosition(routeType: RouteType): { lat: number; lon: number } {
    switch (routeType) {
      case 'city':
        return this.START_POSITIONS.centralPark;
      case 'coastal':
        return this.START_POSITIONS.goldenGate;
      case 'country':
        return { lat: 48.8566, lon: 2.3522 }; // Paris countryside
      case 'mountain':
        return { lat: 40.0140, lon: -105.3500 }; // Boulder, CO
      default:
        return this.START_POSITIONS.amsterdam;
    }
  }

  private generateAltitude(routeType: RouteType, progress: number): number {
    const baseAltitude = 50 + Math.random() * 100;

    switch (routeType) {
      case 'mountain':
        // Mountain route has significant elevation changes
        return baseAltitude + Math.sin(progress * Math.PI * 3) * 300;
      case 'country':
        // Gentle hills
        return baseAltitude + Math.sin(progress * Math.PI * 2) * 100;
      case 'city':
        // Mostly flat with small variations
        return baseAltitude + Math.sin(progress * Math.PI) * 30;
      case 'coastal':
        // Coastal route - mostly flat
        return baseAltitude + Math.random() * 20;
      default:
        return baseAltitude;
    }
  }

  private roundCoordinate(value: number): number {
    return Math.round(value * 1000000) / 1000000;
  }

  // Pre-defined popular bike routes
  getPopularRoute(routeName: string): Coordinate[] {
    const routes: { [key: string]: Coordinate[] } = {
      'centralParkLoop': this.generateCentralParkLoop(),
      'goldenGateBridge': this.generateGoldenGateRoute(),
      'amsterdamCanals': this.generateAmsterdamRoute(),
      'londonThames': this.generateLondonRoute()
    };

    return routes[routeName] || this.generateMockRoute('city');
  }

  private generateCentralParkLoop(): Coordinate[] {
    // Simplified Central Park loop coordinates
    const baseLat = 40.7829;
    const baseLon = -73.9654;
    const coordinates: Coordinate[] = [];
    const startTime = Date.now() - (45 * 60 * 1000);

    const points = [
      [0, 0], [0.003, -0.002], [0.005, -0.005], [0.006, -0.008],
      [0.005, -0.012], [0.002, -0.015], [-0.002, -0.015], [-0.005, -0.012],
      [-0.006, -0.008], [-0.005, -0.005], [-0.003, -0.002], [0, 0]
    ];

    points.forEach(([latOffset, lonOffset], index) => {
      coordinates.push({
        lat: baseLat + latOffset,
        lon: baseLon + lonOffset,
        timestamp: startTime + (index * 4 * 60 * 1000), // 4 minutes between points
        speed: 18 + Math.random() * 5
      });
    });

    return coordinates;
  }

  private generateGoldenGateRoute(): Coordinate[] {
    // Golden Gate Bridge to Sausalito and back
    const coordinates: Coordinate[] = [];
    const startTime = Date.now() - (60 * 60 * 1000);

    const routePoints = [
      [37.8076, -122.4750], // Golden Gate start
      [37.8100, -122.4770], // On the bridge
      [37.8120, -122.4800], // Bridge midpoint
      [37.8140, -122.4830], // North end of bridge
      [37.8160, -122.4860], // Vista point
      [37.8180, -122.4900], // Heading to Sausalito
      [37.8200, -122.4850], // Sausalito
      [37.8180, -122.4800], // Return route
      [37.8160, -122.4760], // Back on bridge
      [37.8120, -122.4730], // Bridge return
      [37.8080, -122.4700]  // Back at start
    ];

    routePoints.forEach(([lat, lon], index) => {
      coordinates.push({
        lat: lat,
        lon: lon,
        timestamp: startTime + (index * 5 * 60 * 1000), // 5 minutes between points
        speed: 15 + Math.random() * 8,
        altitude: 20 + Math.random() * 50
      });
    });

    return coordinates;
  }

  private generateAmsterdamRoute(): Coordinate[] {
    // Amsterdam canal route
    const coordinates: Coordinate[] = [];
    const startTime = Date.now() - (40 * 60 * 1000);
    const baseLat = 52.3676;
    const baseLon = 4.9041;

    // Create a winding canal-like route
    for (let i = 0; i < 25; i++) {
      const angle = (i / 25) * Math.PI * 4;
      const radius = 0.005;

      coordinates.push({
        lat: baseLat + Math.sin(angle) * radius,
        lon: baseLon + Math.cos(angle * 0.7) * radius,
        timestamp: startTime + (i * 2.5 * 60 * 1000), // 2.5 minutes between points
        speed: 12 + Math.random() * 4, // Slower, city biking
        altitude: -2 + Math.random() * 4 // Amsterdam is below sea level
      });
    }

    return coordinates;
  }

  private generateLondonRoute(): Coordinate[] {
    // Thames path route
    const coordinates: Coordinate[] = [];
    const startTime = Date.now() - (50 * 60 * 1000);

    const routePoints = [
      [51.5074, -0.1278], // Central London
      [51.5100, -0.1300],
      [51.5120, -0.1250],
      [51.5140, -0.1200],
      [51.5160, -0.1150],
      [51.5180, -0.1100],
      [51.5200, -0.1050],
      [51.5220, -0.1000],
      [51.5200, -0.0950], // Loop back
      [51.5180, -0.1000],
      [51.5160, -0.1050],
      [51.5140, -0.1100],
      [51.5120, -0.1150],
      [51.5100, -0.1200],
      [51.5080, -0.1250]
    ];

    routePoints.forEach(([lat, lon], index) => {
      coordinates.push({
        lat: lat,
        lon: lon,
        timestamp: startTime + (index * 3.5 * 60 * 1000), // 3.5 minutes between points
        speed: 16 + Math.random() * 6
      });
    });

    return coordinates;
  }

  // Helper method to get all available route types
  getAvailableRouteTypes(): RouteType[] {
    return ['city', 'country', 'mountain', 'coastal'];
  }

  // Helper method to get all available popular routes
  getAvailablePopularRoutes(): string[] {
    return ['centralParkLoop', 'goldenGateBridge', 'amsterdamCanals', 'londonThames'];
  }
}