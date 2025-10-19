import { TestBed } from '@angular/core/testing';
import { MockRouteService } from './mock-route.service';



describe('MockRouteService', () => {
  let service: MockRouteService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(MockRouteService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
