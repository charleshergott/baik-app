import { TestBed } from '@angular/core/testing';
import { ChronometerService } from './chronometer.service';



describe('ChronometerService', () => {
  let service: ChronometerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ChronometerService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
