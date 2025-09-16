import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from './app/environments/environment.prod';
import { ApplicationConfig, isDevMode } from '@angular/core';
//$ yarn add @angular/fire firebase//


const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
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
