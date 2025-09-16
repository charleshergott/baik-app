import { Component, OnInit } from '@angular/core';
import { GpsService } from '../../services/gps.service';
import { AlertService } from '../../services/alert.service';
import { CommonModule } from '@angular/common';
import { HomeComponent } from '../home/home.component';
import { ItineraryComponent } from '../itinerary/itinerary.component';

@Component({
  selector: 'app-main',
  imports: [
    CommonModule,
    HomeComponent,
    ItineraryComponent
  ],
  templateUrl: './main.component.html',
  styleUrl: './main.component.scss'
})

export class MainComponent implements OnInit {

  activeTab = 'map'; // Start with Flight Plan tab
  tabs = [
    { id: 'map', label: 'Map' },
    { id: 'nav', label: 'Itinerary' }
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
