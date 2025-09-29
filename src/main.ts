import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from './app/environments/environment.prod';
import { ApplicationConfig, isDevMode } from '@angular/core';
//$ yarn add @angular/fire firebase//
import { provideFirebaseApp, initializeApp } from '@angular/fire/app';
import { provideFirestore, getFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';
import { provideHttpClient } from '@angular/common/http';

// Initialize Firebase app
const firebaseApp = initializeApp(environment.firebase);

const firebaseProviders = [
  provideFirebaseApp(() => firebaseApp),
  provideFirestore(() => getFirestore(firebaseApp)),
  provideStorage(() => getStorage(firebaseApp)),
  provideHttpClient()
];

const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    ...firebaseProviders,
    provideServiceWorker('firebase-messaging-sw.js', {
      enabled: environment.production,
      registrationStrategy: 'registerImmediately'
    }), provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
  ]
};

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
