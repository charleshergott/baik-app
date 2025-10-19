import { Injectable } from '@angular/core';
import { SavedRoute } from '../interfaces/master';

@Injectable({
  providedIn: 'root'
})

export class IDBService {

  private db: IDBDatabase | null = null;
  public dbInitialized!: Promise<void>;
  private readonly DB_NAME = 'BikeRoutesDB';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'routes';

  constructor() {
    this.dbInitialized = this.initIndexedDB();
  }

  async initIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      request.onerror = () => {
        console.error('IndexedDB failed to open');
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        console.log('IndexedDB initialized');
        resolve();
      };
      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const objectStore = db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id'
          });
          objectStore.createIndex('createdAt', 'createdAt', { unique: false });
          objectStore.createIndex('lastUsed', 'lastUsed', { unique: false });
        }
      };
    });
  }

  async ensureDbReady(): Promise<void> {
    await this.dbInitialized;
  }

  async getRoutesCount(): Promise<number> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.count();

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async saveRoute(route: SavedRoute): Promise<void> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.put(route);
      request.onsuccess = () => {
        console.log('Route saved with ID:', route.id);
        resolve();
      };
      request.onerror = () => {
        console.error('Failed to save route:', request.error);
        reject(request.error);
      };
    });
  }

  async getAllRoutes(): Promise<SavedRoute[]> {
    // console.log('[getAllRoutes] ▶ Starting method...');
    await this.dbInitialized;
    // console.log('[getAllRoutes] ✅ Database initialization awaited.');

    // console.log('[getAllRoutes] 🔁 Promise created'); // 👈 put here

    return new Promise((resolve, reject) => {
      if (!this.db) {
        console.error('[getAllRoutes] ❌ Database not initialized!');
        reject(new Error('Database not initialized'));
        return;
      }

      // console.log('[getAllRoutes] 💾 Opening readonly transaction on store:', this.STORE_NAME);
      const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.getAll();

      request.onsuccess = () => {
        //   console.log('[getAllRoutes] 🔍 Fetch successful. Processing results...');
        const routes = request.result as SavedRoute[];

        if (!routes || routes.length === 0) {
          console.warn('[getAllRoutes] ⚠️ No routes found in store.');
        } else {
          //  console.log(`[getAllRoutes] 📦 Retrieved ${routes.length} routes.`);
          routes.forEach((route, index) => {

            console.log(`📏 Distance: ${route.distance != null ? (route.distance / 1000).toFixed(2) + ' km' : 'N/A'}`);
            console.log(`⏱️ Duration: ${route.duration != null ? (route.duration / 60).toFixed(1) + ' min' : 'N/A'}`);
            console.log(`⚡ Max Speed: ${route.maxSpeed != null ? route.maxSpeed.toFixed(1) + ' m/s' : 'N/A'}`);
            console.log(`🚀 Avg Speed: ${route.averageSpeed != null ? route.averageSpeed.toFixed(1) + ' m/s' : 'N/A'}`);

            if (route.coordinates && route.coordinates.length > 0) {
              const coordPreview = route.coordinates.slice(0, 3);
              // console.log(
              //   `🌍 Coordinates: [${coordPreview
              //     .map(c => `(${c[0].toFixed(4)}, ${c[1].toFixed(4)})`)
              //     .join(', ')}${route.coordinates.length > 3 ? ', ...' : ''}]`
              // );
            } else {
              //  console.log('🌍 Coordinates: N/A');
            }
            // console.log('───────────────────────────────');
          });
        }

        routes.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // 👇 this is the key — we log before resolving the promise
        //  console.log('[getAllRoutes] 🔚 Resolving promise with', routes.length, 'routes');
        resolve(routes);
      };

      request.onerror = () => {
        console.error('[getAllRoutes] ❌ Error fetching routes:', request.error);
        reject(request.error);
      };
    });
  }




  async getRoute(id: string): Promise<SavedRoute | null> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.get(id);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }

  async updateRouteLastUsed(id: string): Promise<void> {
    await this.dbInitialized;
    const route = await this.getRoute(id);
    if (route) {
      route.lastUsed = new Date().toISOString();
      await this.saveRoute(route);
    }
  }

  async deleteRoute(id: string): Promise<void> {
    await this.dbInitialized;
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      const transaction = this.db.transaction([this.STORE_NAME], 'readwrite');
      const objectStore = transaction.objectStore(this.STORE_NAME);
      const request = objectStore.delete(id);
      request.onsuccess = () => {
        console.log('Route deleted:', id);
        resolve();
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  }
}
