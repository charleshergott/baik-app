import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NavigationDisplayComponent } from './navigation-display.component';

describe('NavigationDisplayComponent', () => {
  let component: NavigationDisplayComponent;
  let fixture: ComponentFixture<NavigationDisplayComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NavigationDisplayComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NavigationDisplayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
