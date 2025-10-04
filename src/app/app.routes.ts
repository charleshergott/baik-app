import { Routes } from '@angular/router';
import { HomeComponent } from './components/home/home.component';
import { CompanyInfoComponent } from './components/company-info/company-info.component';


export const routes: Routes = [
    {
        path: '',
        component: HomeComponent,
        pathMatch: 'full',
    },
    {
        path: 'home',
        component: HomeComponent,
    },
    {
        path: 'info',
        component: CompanyInfoComponent,
    },
    // {
    //     path: '**',
    //     component: NotfoundComponent,
    //     canActivate: [iOSUpdateGuard],
    // },
];
