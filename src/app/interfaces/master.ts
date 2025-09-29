// src/app/models/interfaces.ts

export interface Position {
    latitude: number;
    longitude: number;
    altitude?: number;
    heading?: number;
    speed?: number;
    timestamp: number;
}

export interface ItineraryPoint {
    id: number;
    timestamp: Date;
    latitude: number;
    longitude: number;
    altitude: number | null;
    speed: number | null; // m/s from GPS, converted to km/h for display
    accuracy: number;
}

export interface SavedRoute {
    id: string;
    name: string;
    waypoints: Waypoint[];
    createdAt: string;
    lastUsed?: string;
    description?: string;
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

export interface MovementState {
    isMoving: boolean;
    speed: number; // km/h
    position: GeolocationPosition | null;
    quality: 'good' | 'poor' | 'very_poor';
    isStationary: boolean;
    accuracy: number;
    lastUpdate: number;
}

export interface MovementConfig {
    startThreshold: number; // km/h
    stopThreshold: number; // km/h
    stopDelay: number; // ms
    minAccuracy: number; // meters
    minDistance: number; // meters
    minTimeBetweenReadings: number; // ms
    maxSpeedJump: number; // km/h
    stationaryRadius: number; // meters
    historyLength: number;
}


export interface CyclingTrip {
    id: string; // Date string (YYYY-MM-DD)
    startTime: Date;
    endTime?: Date;
    points: ItineraryPoint[];
    totalDistance: number; // in meters
    maxSpeed: number; // in m/s
    averageSpeed: number; // in km/h
    duration: number; // in seconds
    isCompleted: boolean;
}

export interface ChronometerState {
    isRunning: boolean;
    elapsedTime: number;
    formattedTime: string;
    formattedMilliseconds: string;
    lapTimes: number[];
    currentSpeed: number;
    speedThreshold: number;
    autoStartEnabled: boolean;
    speedStatus: string;
    currentTime: string;
    currentDate: string;
    currentTimezone: string;
    utcTime: string;
    worldTimes: Array<{ city: string, time: string }>;
    hourAngle: number;
    minuteAngle: number;
    secondAngle: number;
    frozenStartTime: string | null;
    frozenStopTime: string | null;
    freezeStep: number;
}