import { TestBed } from '@angular/core/testing';
import { MockGpsService } from './mock-gps.service';


describe('MockGpsService', () => {
  let service: MockGpsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MockGpsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
