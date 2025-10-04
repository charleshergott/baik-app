import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-company-info',
  imports: [
    CommonModule
  ],
  standalone: true,
  templateUrl: './company-info.component.html',
  styleUrl: './company-info.component.scss'
})

export class CompanyInfoComponent {

  companyName = 'CHWMS';
  tagline = 'White Label Apps';
  description = 'We are a leading provider of innovative solutions, dedicated to helping businesses thrive in the digital age. With over 20 years of experience, we combine cutting-edge technology with personalized service to deliver exceptional results for our clients.';

  address = {
    street: 'rue du Grand Pré 28',
    city: 'Geneva',
    zip: '1202',
    country: 'Switzerland'
  };

  phone = '+41767337484';
  email = 'chwms.geneva@gmail.com';
  website = 'https://charleshergott.github.io/';
  businessHours = 'Monday - Friday: 9:00 AM - 6:00 PM CET';

  constructor(
    private _router: Router
  ) { }

  goBack() {
    this._router.navigate(['/home']);
  }
}
