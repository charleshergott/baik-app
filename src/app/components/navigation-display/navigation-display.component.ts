import { Component, OnDestroy, OnInit } from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { FlightAlert, NavigationData } from '../../interfaces/master';
import { AlertService } from '../../services/alert.service';
import { NavigationService } from '../../services/navigation.service';
import { CommonModule } from '@angular/common';
import { ChronometerComponent } from '../chronometer/chronometer.component';

@Component({
  selector: 'app-navigation-display',
  imports: [
    CommonModule,
    ChronometerComponent
  ],
  templateUrl: './navigation-display.component.html',
  styleUrl: './navigation-display.component.scss'
})

export class NavigationDisplayComponent implements OnInit, OnDestroy {

  navigationData$: Observable<NavigationData | null>;
  activeAlert$: Observable<FlightAlert | null>;
  private subscription = new Subscription();

  constructor(
    private navigationService: NavigationService,
    private alertService: AlertService
  ) {
    this.navigationData$ = this.navigationService.getNavigationData();
    this.activeAlert$ = this.alertService.getActiveAlert();
  }

  ngOnInit(): void {
    this.subscription.add(
      this.navigationData$.subscribe(navData => {
        if (navData) {
          this.alertService.checkAlerts(navData);
        }
      })
    );
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  advanceWaypoint(): void {
    this.navigationService.advanceToNextWaypoint();
  }

  dismissAlert(): void {
    this.alertService.dismissActiveAlert();
  }
}
