import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import '@khmyznikov/pwa-install';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';


@Component({
  selector: 'app-root',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [
    RouterOutlet,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})

export class AppComponent {

  title = 'baik-app';
}
