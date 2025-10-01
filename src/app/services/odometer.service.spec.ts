import { TestBed } from '@angular/core/testing';
import { OdometerService } from './odometer.service';


describe('OdometerService', () => {
  let service: OdometerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OdometerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
