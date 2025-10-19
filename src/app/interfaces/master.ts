export interface SavedRoute {
    id: string;
    name: string;
    distance: number; // in meters
    duration: number; // in seconds
    maxSpeed: number;
    averageSpeed: number;
    startTime: number;
    endTime: number;
    createdAt: string; // ISO string
    lastUsed?: string; // ISO string
    description?: string;
    coordinates: [number, number][];
}

export type RouteType = 'city' | 'country' | 'mountain' | 'coastal';

export interface Coordinate {
    lat: number;
    lon: number;
    altitude?: number;
    timestamp: number;
    speed?: number;
}

export interface RouteConfig {
    latVariation: number;
    lonVariation: number;
    baseSpeed: number;
    speedVariation: number;
}

export interface RouteConfigs {
    city: RouteConfig;
    country: RouteConfig;
    mountain: RouteConfig;
    coastal: RouteConfig;
}

export interface Route {
    id: string;
    name: string;
    createdAt: Date;
}

export interface Position {
    latitude: number;
    longitude: number;
    speed?: number;
    timestamp: number;
    accuracy?: number;
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
    frozenStartTime: string | null;
    frozenStopTime: string | null;
    freezeStep: number;
}

export interface SpeedData {
    currentSpeed: number;
    maxSpeed: number;
    avgSpeed: number;
    distance: number; // in meters
    lastPosition: GeolocationPosition | null;
}

export interface SpeedStats {
    current: number;
    max: number;
    average: number;
}

export interface OdometerStats {
    totalDistance: number;
    tripDistance: number;
    currentSpeed: number;
    maxSpeed: number;
    averageSpeed: number;
    movingTime: number; // time spent moving (above threshold)
    totalTime: number; // total elapsed time
}

export type MockScenario =
    | 'stationary'
    | 'slow_ride'
    | 'normal_ride'
    | 'fast_ride'
    | 'stop_and_go'
    | 'acceleration'
    | 'custom';

export interface MockGPSConfig {
    scenario: MockScenario;
    updateInterval: number; // milliseconds
    startPosition?: { lat: number; lon: number };
    customSpeed?: number; // km/h
    customAccuracy?: number; // meters
    enableNoise?: boolean; // Add realistic GPS jitter
}
