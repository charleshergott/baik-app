import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { FlightAlert, NavigationData } from '../interfaces/master';


@Injectable({
  providedIn: 'root'
})

export class AlertService {

  private alerts$ = new BehaviorSubject<FlightAlert[]>([]);
  private activeAlert$ = new BehaviorSubject<FlightAlert | null>(null);

  getAlerts(): Observable<FlightAlert[]> {
    return this.alerts$.asObservable();
  }

  getActiveAlert(): Observable<FlightAlert | null> {
    return this.activeAlert$.asObservable();
  }

  addAlert(alert: FlightAlert): void {
    const alerts = this.alerts$.value;
    this.alerts$.next([...alerts, alert]);
  }

  removeAlert(alertId: string): void {
    const alerts = this.alerts$.value.filter(a => a.id !== alertId);
    this.alerts$.next(alerts);
  }

  checkAlerts(navData: NavigationData): void {
    const alerts = this.alerts$.value;

    alerts.forEach(alert => {
      if (!alert.isActive || alert.triggered) return;

      let shouldTrigger = false;

      switch (alert.type) {
        case 'waypoint':
          if (alert.waypointId === navData.nextWaypoint?.id &&
            alert.triggerDistance &&
            navData.distanceToNext <= alert.triggerDistance) {
            shouldTrigger = true;
          }
          break;
        case 'altitude':
          if (alert.triggerAltitude &&
            navData.currentPosition.altitude &&
            Math.abs(navData.currentPosition.altitude - alert.triggerAltitude) <= 100) {
            shouldTrigger = true;
          }
          break;
      }

      if (shouldTrigger) {
        alert.triggered = true;
        this.activeAlert$.next(alert);
        this.showNotification(alert.message);
      }
    });
  }

  dismissActiveAlert(): void {
    this.activeAlert$.next(null);
  }

  private showNotification(message: string): void {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('VFR Navigation Alert', { body: message });
    }
  }

  requestNotificationPermission(): void {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
  }
}