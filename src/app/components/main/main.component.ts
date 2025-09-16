import { Component, OnInit } from '@angular/core';
import { GpsService } from '../../services/gps.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { HomeComponent } from '../home/home.component';

@Component({
  selector: 'app-main',
  imports: [
    CommonModule,
    HomeComponent
  ],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})

export class MainComponent implements OnInit {

  activeTab = 'plan'; // Start with Flight Plan tab
  tabs = [
    { id: 'plan', label: 'Flight Plan' },
    { id: 'nav', label: 'Navigation' }
  ];

  constructor(
    private gpsService: GpsService,
    private alertService: AlertService
  ) { }

  async ngOnInit(): Promise<void> {
    this.gpsService.startTracking();
    this.alertService.requestNotificationPermission();
  }

  setActiveTab(tabId: string): void {
    this.activeTab = tabId;
  }
}
