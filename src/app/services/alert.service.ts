// import { Injectable } from '@angular/core';
// import { BehaviorSubject, Observable } from 'rxjs';



// @Injectable({
//   providedIn: 'root'
// })

// export class AlertService {

  

//   getAlerts(): Observable<FlightAlert[]> {
//     return this.alerts$.asObservable();
//   }

//   getActiveAlert(): Observable<FlightAlert | null> {
//     return this.activeAlert$.asObservable();
//   }

//   addAlert(alert: FlightAlert): void {
//     const alerts = this.alerts$.value;
//     this.alerts$.next([...alerts, alert]);
//   }

//   removeAlert(alertId: string): void {
//     const alerts = this.alerts$.value.filter(a => a.id !== alertId);
//     this.alerts$.next(alerts);
//   }

//   checkAlerts(navData: NavigationData): void {
//     const alerts = this.alerts$.value;

//     alerts.forEach(alert => {
//       if (!alert.isActive || alert.triggered) return;

//       let shouldTrigger = false;

//       switch (alert.type) {
//         case 'waypoint':
//           if (alert.waypointId === navData.nextWaypoint?.id &&
//             alert.triggerDistance &&
//             navData.distanceToNext <= alert.triggerDistance) {
//             shouldTrigger = true;
//           }
//           break;
//         case 'altitude':
//           if (alert.triggerAltitude &&
//             navData.currentPosition.altitude &&
//             Math.abs(navData.currentPosition.altitude - alert.triggerAltitude) <= 100) {
//             shouldTrigger = true;
//           }
//           break;
//       }

//       if (shouldTrigger) {
//         alert.triggered = true;
//         this.activeAlert$.next(alert);
//         this.showNotification(alert.message);
//       }
//     });
//   }

//   dismissActiveAlert(): void {
//     this.activeAlert$.next(null);
//   }

//   showNotification(message: string): void {
//     if ('Notification' in window && Notification.permission === 'granted') {
//       new Notification('VFR Navigation Alert', { body: message });
//     }
//   }

//   requestNotificationPermission(): void {
//     if ('Notification' in window) {
//       Notification.requestPermission();
//     }
//   }

//   showSuccess(message: string): void {
//     console.log(`✅ SUCCESS: ${message}`);

//     // Option 1: Browser notification
//     if ('Notification' in window && Notification.permission === 'granted') {
//       new Notification('Success', {
//         body: message,
//         icon: '/favicon.ico'
//       });
//     }

//     // Option 2: Add to DOM as toast (if you have a toast container)
//     this.showToast(message, 'success');
//   }

//   /**
//    * Show error message
//    */
//   showError(message: string): void {
//     console.error(`❌ ERROR: ${message}`);

//     if ('Notification' in window && Notification.permission === 'granted') {
//       new Notification('Error', {
//         body: message,
//         icon: '/favicon.ico'
//       });
//     }

//     this.showToast(message, 'error');
//   }

//   /**
//    * Show info message
//    */
//   showInfo(message: string): void {
//     console.info(`ℹ️ INFO: ${message}`);

//     if ('Notification' in window && Notification.permission === 'granted') {
//       new Notification('Info', {
//         body: message,
//         icon: '/favicon.ico'
//       });
//     }

//     this.showToast(message, 'info');
//   }

//   /**
//    * Simple DOM toast notification
//    */
//   private showToast(message: string, type: 'success' | 'error' | 'info'): void {
//     const toast = document.createElement('div');
//     toast.className = `toast toast-${type}`;
//     toast.style.cssText = `
//       position: fixed;
//       top: 20px;
//       right: 20px;
//       background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8'};
//       color: white;
//       padding: 15px 20px;
//       border-radius: 5px;
//       z-index: 10000;
//       max-width: 300px;
//       box-shadow: 0 4px 6px rgba(0,0,0,0.1);
//       animation: slideIn 0.3s ease;
//     `;
//     toast.textContent = message;

//     // Add animation styles if not already added
//     if (!document.getElementById('toast-styles')) {
//       const style = document.createElement('style');
//       style.id = 'toast-styles';
//       style.textContent = `
//         @keyframes slideIn {
//           from { transform: translateX(100%); opacity: 0; }
//           to { transform: translateX(0); opacity: 1; }
//         }
//         @keyframes slideOut {
//           from { transform: translateX(0); opacity: 1; }
//           to { transform: translateX(100%); opacity: 0; }
//         }
//       `;
//       document.head.appendChild(style);
//     }

//     document.body.appendChild(toast);

//     // Auto-remove after 3 seconds
//     setTimeout(() => {
//       toast.style.animation = 'slideOut 0.3s ease';
//       setTimeout(() => {
//         if (toast.parentNode) {
//           toast.parentNode.removeChild(toast);
//         }
//       }, 300);
//     }, 3000);
//   }
// }