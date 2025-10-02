import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MockGpsControlComponent } from './mock-gps-control.component';

describe('MockGpsControlComponent', () => {
  let component: MockGpsControlComponent;
  let fixture: ComponentFixture<MockGpsControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MockGpsControlComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MockGpsControlComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
