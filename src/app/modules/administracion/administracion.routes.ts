import { PreciosMayoristasPage } from './pages/precios-mayoristas/precios-mayoristas.page';
import { Routes } from '@angular/router';
import { roleGuard } from '../../core/guards/role.guard';
import { CategoriasPage } from './pages/categorias/categorias.page';
import { CiudadesPage } from './pages/ciudades/ciudades.page';
import { ColoresPage } from './pages/colores/colores.page';
import { EmpleadosPage } from './pages/empleados/empleados.page';
import { ProveedoresPage } from './pages/proveedores/proveedores.page';
import { SucursalesPage } from './pages/sucursales/sucursales.page';
import { TallasPage } from './pages/tallas/tallas.page';
import { TemporadasPage } from './pages/temporadas/temporadas.page';
import { ColeccionesPage } from './pages/colecciones/colecciones.page';
import { MarcasPage } from './pages/marcas/marcas.page';
import { ProductosPage } from './pages/productos/productos.page';
import { PromocionesPage } from './pages/promociones/promociones.page';
import { VariantesPage } from './pages/variantes/variantes.page';
import { PanelProveedorPage } from './pages/proveedores/panel-proveedor.page';

export const ADMINISTRACION_ROUTES: Routes = [
  {path:'personalizar-tienda',loadComponent:()=>import('./pages/personalizar-tienda/personalizar-tienda.page').then(m=>m.PersonalizarTiendaPage),canActivate:[roleGuard],data:{roles:['ADMINISTRADOR']}},
  {path:'precios-mayoristas',component:PreciosMayoristasPage,canActivate:[roleGuard],data:{roles:['ADMINISTRADOR']}},
  { path: 'saas/empresas', loadComponent: () => import('./pages/saas/empresas.page').then(m => m.EmpresasPage), canActivate: [roleGuard], data: { roles: ['ADMIN_SAAS'] } },
  { path: 'saas/planes', loadComponent: () => import('./pages/saas/planes.page').then(m => m.PlanesPage), canActivate: [roleGuard], data: { roles: ['ADMIN_SAAS'] } },
  { path: 'saas/respaldos', loadComponent: () => import('./pages/saas/respaldos.page').then(m => m.RespaldosPage), canActivate: [roleGuard], data: { roles: ['ADMIN_SAAS'], ambito: 'PLATAFORMA' } },
  { path: 'respaldos', loadComponent: () => import('./pages/saas/respaldos.page').then(m => m.RespaldosPage), canActivate: [roleGuard], data: { roles: ['ADMINISTRADOR'], ambito: 'EMPRESA' } },
  { path: 'saas/eventos', loadComponent: () => import('./pages/saas/eventos.page').then(m => m.EventosPage), canActivate: [roleGuard], data: { roles: ['ADMIN_SAAS'] } },
  { path: 'mi-plan', loadComponent: () => import('./pages/saas/mi-plan.page').then(m => m.MiPlanPage), canActivate: [roleGuard], data: { roles: ['ADMINISTRADOR'] } },
  {
    path: 'ciudades',
    component: CiudadesPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
      permiso: 'ciudades:ver',
    },
  },
  {
    path: 'sucursales',
    component: SucursalesPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
      permiso: 'sucursales:ver',
    },
  },
  {
    path: 'empleados',
    component: EmpleadosPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR', 'ENCARGADO_SUCURSAL'],
    },
  },
  {
    path: 'proveedores',
    component: ProveedoresPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'categorias',
    component: CategoriasPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'tallas',
    component: TallasPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'colores',
    component: ColoresPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'temporadas',
    component: TemporadasPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'colecciones',
    component: ColeccionesPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'marcas',
    component: MarcasPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'productos',
    component: ProductosPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'variantes',
    component: VariantesPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'promociones',
    component: PromocionesPage,
    canActivate: [roleGuard],
    data: {
      roles: ['ADMINISTRADOR'],
    },
  },
  {
    path: 'panel-proveedor',
    component: PanelProveedorPage,
    canActivate: [roleGuard],
    data: {
      roles: ['PROVEEDOR'],
    },
  },
];
