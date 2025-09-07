// src/app/models/interfaces.ts

export interface Position {
    latitude: number;
    longitude: number;
    altitude?: number;
    heading?: number;
    speed?: number;
    timestamp: number;
}


export interface Waypoint {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    altitude?: number;
    altitudeQNH?: number;  // QNH altitude
    speedKnots?: number;   // Speed in knots
    estimatedArrival?: string; // ETA time
    routingDegrees?: number;   // Next routing in degrees
    frequency?: string;    // Required frequency
    notes?: string;
}

export interface Route {
    id: string;
    name: string;
    waypoints: Waypoint[];
    cruiseAltitude: number;
    cruiseSpeed: number; // knots
    createdAt: Date;
}

export interface FlightAlert {
    id: string;
    type: 'waypoint' | 'altitude' | 'frequency' | 'time' | 'distance';
    message: string;
    triggerDistance?: number; // nautical miles
    triggerAltitude?: number; // feet
    waypointId?: string;
    isActive: boolean;
    triggered: boolean;
}

export interface NavigationData {
    currentPosition: Position;
    nextWaypoint?: Waypoint;
    distanceToNext: number; // nautical miles
    bearingToNext: number; // degrees
    crossTrackError: number; // nautical miles
    groundSpeed: number; // knots
    estimatedTimeToNext: number; // minutes
}