// import { Injectable } from '@angular/core';
// import { CyclingTrip, ItineraryPoint } from '../interfaces/master';



// @Injectable({
//   providedIn: 'root'
// })

// export class CyclingDataService {

//   private dbName = 'CyclingTrackerDB';
//   private dbVersion = 1;
//   private storeName = 'cycling';
//   private db: IDBDatabase | null = null;

//   constructor() {
//     this.initDatabase();
//   }

//   private async initDatabase(): Promise<void> {
//     return new Promise((resolve, reject) => {
//       const request = indexedDB.open(this.dbName, this.dbVersion);

//       request.onerror = () => {
//         console.error('Error opening database:', request.error);
//         reject(request.error);
//       };

//       request.onsuccess = () => {
//         this.db = request.result;
//         console.log('Database opened successfully');
//         resolve();
//       };

//       request.onupgradeneeded = (event) => {
//         const db = (event.target as IDBOpenDBRequest).result;

//         // Create object store for cycling trips
//         if (!db.objectStoreNames.contains(this.storeName)) {
//           const store = db.createObjectStore(this.storeName, { keyPath: 'id' });

//           // Create indexes for querying
//           store.createIndex('startTime', 'startTime', { unique: false });
//           store.createIndex('isCompleted', 'isCompleted', { unique: false });

//           console.log('Object store created');
//         }
//       };
//     });
//   }

//   // Create a new trip
//   async createTrip(date: Date): Promise<string> {
//     const tripId = this.formatDateAsId(date);

//     const trip: CyclingTrip = {
//       id: tripId,
//       startTime: date,
//       points: [],
//       totalDistance: 0,
//       maxSpeed: 0,
//       averageSpeed: 0,
//       duration: 0,
//       isCompleted: false
//     };

//     await this.saveTrip(trip);
//     return tripId;
//   }

//   // Save or update a trip
//   async saveTrip(trip: CyclingTrip): Promise<void> {
//     if (!this.db) {
//       await this.initDatabase();
//     }

//     return new Promise((resolve, reject) => {
//       const transaction = this.db!.transaction([this.storeName], 'readwrite');
//       const store = transaction.objectStore(this.storeName);

//       const request = store.put(trip);

//       request.onsuccess = () => {
//         console.log('Trip saved:', trip.id);
//         resolve();
//       };

//       request.onerror = () => {
//         console.error('Error saving trip:', request.error);
//         reject(request.error);
//       };
//     });
//   }

//   // Get a specific trip by date
//   async getTrip(tripId: string): Promise<CyclingTrip | null> {
//     if (!this.db) {
//       await this.initDatabase();
//     }

//     return new Promise((resolve, reject) => {
//       const transaction = this.db!.transaction([this.storeName], 'readonly');
//       const store = transaction.objectStore(this.storeName);

//       const request = store.get(tripId);

//       request.onsuccess = () => {
//         const result = request.result;
//         if (result) {
//           // Convert date strings back to Date objects
//           result.startTime = new Date(result.startTime);
//           if (result.endTime) {
//             result.endTime = new Date(result.endTime);
//           }
//           result.points = result.points.map((p: any) => ({
//             ...p,
//             timestamp: new Date(p.timestamp)
//           }));
//         }
//         resolve(result || null);
//       };

//       request.onerror = () => {
//         console.error('Error getting trip:', request.error);
//         reject(request.error);
//       };
//     });
//   }

//   // Get all trips
//   async getAllTrips(): Promise<CyclingTrip[]> {
//     if (!this.db) {
//       await this.initDatabase();
//     }

//     return new Promise((resolve, reject) => {
//       const transaction = this.db!.transaction([this.storeName], 'readonly');
//       const store = transaction.objectStore(this.storeName);

//       const request = store.getAll();

//       request.onsuccess = () => {
//         const trips = request.result.map((trip: any) => ({
//           ...trip,
//           startTime: new Date(trip.startTime),
//           endTime: trip.endTime ? new Date(trip.endTime) : undefined,
//           points: trip.points.map((p: any) => ({
//             ...p,
//             timestamp: new Date(p.timestamp)
//           }))
//         }));

//         // Sort by start time (most recent first)
//         trips.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
//         resolve(trips);
//       };

//       request.onerror = () => {
//         console.error('Error getting all trips:', request.error);
//         reject(request.error);
//       };
//     });
//   }

//   // Get trips within a date range
//   async getTripsByDateRange(startDate: Date, endDate: Date): Promise<CyclingTrip[]> {
//     const allTrips = await this.getAllTrips();

//     return allTrips.filter(trip =>
//       trip.startTime >= startDate && trip.startTime <= endDate
//     );
//   }

//   // Delete a trip
//   async deleteTrip(tripId: string): Promise<void> {
//     if (!this.db) {
//       await this.initDatabase();
//     }

//     return new Promise((resolve, reject) => {
//       const transaction = this.db!.transaction([this.storeName], 'readwrite');
//       const store = transaction.objectStore(this.storeName);

//       const request = store.delete(tripId);

//       request.onsuccess = () => {
//         console.log('Trip deleted:', tripId);
//         resolve();
//       };

//       request.onerror = () => {
//         console.error('Error deleting trip:', request.error);
//         reject(request.error);
//       };
//     });
//   }

//   // Clear all data
//   async clearAllTrips(): Promise<void> {
//     if (!this.db) {
//       await this.initDatabase();
//     }

//     return new Promise((resolve, reject) => {
//       const transaction = this.db!.transaction([this.storeName], 'readwrite');
//       const store = transaction.objectStore(this.storeName);

//       const request = store.clear();

//       request.onsuccess = () => {
//         console.log('All trips cleared');
//         resolve();
//       };

//       request.onerror = () => {
//         console.error('Error clearing trips:', request.error);
//         reject(request.error);
//       };
//     });
//   }

//   // Add a point to a specific trip
//   async addPointToTrip(tripId: string, point: ItineraryPoint): Promise<void> {
//     const trip = await this.getTrip(tripId);
//     if (!trip) {
//       throw new Error(`Trip ${tripId} not found`);
//     }

//     trip.points.push(point);

//     // Update trip statistics
//     this.updateTripStatistics(trip);

//     await this.saveTrip(trip);
//   }

//   // Complete a trip (mark as finished)
//   async completeTrip(tripId: string): Promise<void> {
//     const trip = await this.getTrip(tripId);
//     if (!trip) {
//       throw new Error(`Trip ${tripId} not found`);
//     }

//     trip.isCompleted = true;
//     trip.endTime = new Date();

//     // Final statistics update
//     this.updateTripStatistics(trip);

//     await this.saveTrip(trip);
//   }

//   // Calculate and update trip statistics
//   private updateTripStatistics(trip: CyclingTrip): void {
//     if (trip.points.length < 2) {
//       return;
//     }

//     // Calculate total distance
//     let totalDistance = 0;
//     let maxSpeed = 0;
//     let totalSpeeds = 0;
//     let speedCount = 0;

//     for (let i = 1; i < trip.points.length; i++) {
//       const prevPoint = trip.points[i - 1];
//       const currentPoint = trip.points[i];

//       // Distance calculation using Haversine formula
//       const distance = this.calculateDistance(
//         prevPoint.latitude,
//         prevPoint.longitude,
//         currentPoint.latitude,
//         currentPoint.longitude
//       );

//       totalDistance += distance;

//       // Speed tracking
//       if (currentPoint.speed !== null && currentPoint.speed > maxSpeed) {
//         maxSpeed = currentPoint.speed;
//       }

//       if (currentPoint.speed !== null && currentPoint.speed >= 0) {
//         totalSpeeds += currentPoint.speed;
//         speedCount++;
//       }
//     }

//     trip.totalDistance = totalDistance;
//     trip.maxSpeed = maxSpeed;

//     // Calculate average speed in km/h
//     if (speedCount > 0) {
//       const avgSpeedMs = totalSpeeds / speedCount;
//       trip.averageSpeed = avgSpeedMs * 3.6; // Convert m/s to km/h
//     }

//     // Calculate duration
//     if (trip.endTime) {
//       trip.duration = Math.floor((trip.endTime.getTime() - trip.startTime.getTime()) / 1000);
//     }
//   }

//   // Haversine distance calculation
//   private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
//     const R = 6371e3; // Earth's radius in meters
//     const φ1 = lat1 * Math.PI / 180;
//     const φ2 = lat2 * Math.PI / 180;
//     const Δφ = (lat2 - lat1) * Math.PI / 180;
//     const Δλ = (lon2 - lon1) * Math.PI / 180;

//     const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
//       Math.cos(φ1) * Math.cos(φ2) *
//       Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
//     const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

//     return R * c;
//   }

//   // Format date as ID (YYYY-MM-DD)
//   private formatDateAsId(date: Date): string {
//     return date.toISOString().split('T')[0];
//   }

//   // Get today's trip ID
//   getTodayTripId(): string {
//     return this.formatDateAsId(new Date());
//   }

//   // Migration helper: Import from localStorage
//   async migrateFromLocalStorage(): Promise<void> {
//     const saved = localStorage.getItem('bicycle-itinerary');
//     if (!saved) return;

//     try {
//       const points = JSON.parse(saved).map((p: any) => ({
//         ...p,
//         timestamp: new Date(p.timestamp)
//       }));

//       if (points.length === 0) return;

//       // Create a trip for the imported data
//       const oldestPoint = points.reduce((oldest: any, point: any) =>
//         point.timestamp < oldest.timestamp ? point : oldest
//       );

//       const tripId = this.formatDateAsId(oldestPoint.timestamp);

//       const trip: CyclingTrip = {
//         id: tripId,
//         startTime: oldestPoint.timestamp,
//         endTime: points[points.length - 1].timestamp,
//         points: points,
//         totalDistance: 0,
//         maxSpeed: 0,
//         averageSpeed: 0,
//         duration: 0,
//         isCompleted: true
//       };

//       this.updateTripStatistics(trip);
//       await this.saveTrip(trip);

//       // Clear localStorage after successful migration
//       localStorage.removeItem('bicycle-itinerary');
//       console.log('Successfully migrated data from localStorage to IndexedDB');

//     } catch (error) {
//       console.error('Error migrating from localStorage:', error);
//     }
//   }
// }