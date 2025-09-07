import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';

@Component({
  selector: 'app-chronometer',
  imports: [
    CommonModule
  ],
  templateUrl: './chronometer.component.html',
  styleUrl: './chronometer.component.scss'
})

export class ChronometerComponent implements OnInit, OnDestroy {

  elapsedTime = 0;
  isRunning = false;
  startTime = 0;
  lapTimes: number[] = [];
  private intervalId: any;

  ngOnInit(): void {
    // Auto-start interval for smooth updates
    this.intervalId = setInterval(() => {
      if (this.isRunning) {
        this.elapsedTime = Date.now() - this.startTime;
      }
    }, 10); // Update every 10ms for smooth display
  }

  ngOnDestroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
  }

  startStop(): void {
    if (this.isRunning) {
      // Stop
      this.isRunning = false;
    } else {
      // Start
      this.startTime = Date.now() - this.elapsedTime;
      this.isRunning = true;
    }
  }

  reset(): void {
    if (!this.isRunning) {
      this.elapsedTime = 0;
      this.startTime = 0;
      this.lapTimes = [];
    }
  }

  lap(): void {
    if (this.isRunning) {
      this.lapTimes.unshift(this.elapsedTime); // Add to beginning of array
      // Keep only last 5 lap times
      if (this.lapTimes.length > 5) {
        this.lapTimes = this.lapTimes.slice(0, 5);
      }
    }
  }

  formatTime(milliseconds: number): string {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${seconds.toString().padStart(2, '0')}`;
    }
  }

  formatMilliseconds(milliseconds: number): string {
    const ms = Math.floor((milliseconds % 1000) / 10);
    return ms.toString().padStart(2, '0');
  }
}