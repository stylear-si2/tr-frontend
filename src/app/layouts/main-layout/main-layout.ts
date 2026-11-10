import { AparienciaService } from '../../core/services/apariencia.service';
import { EstadoEmpresaComponent } from '../../shared/components/estado-empresa/estado-empresa.component';
import { EmpresaContextoService } from '../../core/services/empresa-contexto.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { TiendaStateService } from '../../core/services/tienda-state.service';
import { AuthService } from '../../modules/autenticacion/services/auth.service';
import { AsistenteChatComponent } from '../../modules/inteligencia/components/asistente-chat/asistente-chat.component';
import { RecomendacionesService } from '../../modules/inteligencia/services/recomendaciones.service';
import { CarritoService } from '../../modules/reservas/services/carrito.service';
import { OfflineService } from '../../core/offline/offline.service';

interface MenuItem {
  label: string;
  path: string;
  icon: string;
  roles?: string[];
}

interface MenuGroup {
  title: string;
  icon: string;
  items: MenuItem[];
}

const ADMIN = ['ADMINISTRADOR'];
const ADMIN_O_ENCARGADO = ['ADMINISTRADOR', 'ENCARGADO_SUCURSAL'];
const ADMIN_ENCARGADO_CAJERO = ['ADMINISTRADOR', 'ENCARGADO_SUCURSAL', 'CAJERO'];
const PROVEEDOR = ['PROVEEDOR'];

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    AsistenteChatComponent,
    EstadoEmpresaComponent,
  ],
  selector: 'app-main-layout',
  host: {
    '[style.--color-primary]': 'marca.actual().color_principal',
    '[style.--color-accent]': 'marca.actual().color_secundario',
    '[style.--color-primary-hover]': 'hoverMarca',
    '[style.--color-accent-soft]': 'suaveMarca',
  },
  styleUrl: './main-layout.css',
  templateUrl: './main-layout.html',
})
export class MainLayout {
  protected readonly marca = inject(AparienciaService);
  protected readonly hoverMarca = 'color-mix(in srgb, var(--color-primary), black 20%)';
  protected readonly suaveMarca = 'color-mix(in srgb, var(--color-accent) 15%, white)';
  protected readonly offline = inject(OfflineService);
  protected readonly empresa = inject(EmpresaContextoService).empresa;
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly tiendaState = inject(TiendaStateService);
  private readonly recomendacionesService = inject(RecomendacionesService);
  private readonly carritoService = inject(CarritoService);

  protected readonly usuario = this.authService.usuarioActual;
  protected readonly sidebarAbierto = signal(false);
  protected readonly cuentaAbierta = signal(false);
  protected readonly busquedaTienda = signal('');
  protected readonly autenticado = computed(() => this.authService.estaAutenticado());
  protected readonly esAdmin = computed(() => this.authService.tieneRol('ADMINISTRADOR'));
  protected readonly usaPanelAdmin = computed(
    () =>
      this.authService.tieneRol('ADMIN_SAAS') ||
      this.authService.tieneRol('ADMINISTRADOR') ||
      this.authService.tieneRol('ENCARGADO_SUCURSAL') ||
      this.authService.tieneRol('CAJERO') ||
      this.authService.tieneRol('PROVEEDOR'),
  );
  protected readonly totalCarrito = computed(() =>
    this.tiendaState.carrito().reduce((total, item) => total + item.cantidad, 0),
  );

  protected readonly tiendaMenu: MenuItem[] = [
    { label: 'Inicio', path: '/inicio', icon: 'pi pi-home' },
    { label: 'Catalogo', path: '/catalogo', icon: 'pi pi-shopping-bag' },
    { label: 'Para ti', path: '/para-ti', icon: 'pi pi-sparkles' },
    { label: 'Reservas', path: '/reservas', icon: 'pi pi-calendar-check' },
    { label: 'Notificaciones', path: '/notificaciones', icon: 'pi pi-bell', roles: ['CLIENTE'] },
    { label: 'Mis pagos', path: '/mis-pagos', icon: 'pi pi-credit-card', roles: ['CLIENTE'] },
    {
      label: 'Mis devoluciones y cambios',
      path: '/mis-devoluciones',
      icon: 'pi pi-refresh',
      roles: ['CLIENTE'],
    },
    {
      label: 'Mis deliveries',
      path: '/mis-deliveries',
      icon: 'pi pi-map-marker',
      roles: ['CLIENTE'],
    },
  ];

  private readonly todosLosMenus: MenuGroup[] = [
    {
      title: 'PLATAFORMA',
      icon: 'pi pi-building',
      items: [
        {
          label: 'Cuentas de acceso',
          path: '/saas/usuarios',
          icon: 'pi pi-users',
          roles: ['ADMIN_SAAS'],
        },
        {
          label: 'Bitácora de plataforma',
          path: '/saas/bitacora',
          icon: 'pi pi-history',
          roles: ['ADMIN_SAAS'],
        },
        {
          label: 'Empresas',
          path: '/saas/empresas',
          icon: 'pi pi-building',
          roles: ['ADMIN_SAAS'],
        },
        { label: 'Planes', path: '/saas/planes', icon: 'pi pi-list', roles: ['ADMIN_SAAS'] },
        {
          label: 'Respaldos',
          path: '/saas/respaldos',
          icon: 'pi pi-database',
          roles: ['ADMIN_SAAS'],
        },
        {
          label: 'Eventos de plataforma',
          path: '/saas/eventos',
          icon: 'pi pi-history',
          roles: ['ADMIN_SAAS'],
        },
      ],
    },
    {
      title: 'PANEL',
      icon: 'pi pi-th-large',
      items: [
        { label: 'Mi plan', path: '/mi-plan', icon: 'pi pi-list', roles: ADMIN },
        {
          label: 'Dashboard',
          path: '/dashboard',
          icon: 'pi pi-chart-line',
          roles: ADMIN_O_ENCARGADO,
        },
        { label: 'Perfil', path: '/perfil', icon: 'pi pi-user' },
        {
          label: 'Panel proveedor',
          path: '/panel-proveedor',
          icon: 'pi pi-truck',
          roles: PROVEEDOR,
        },
      ],
    },
    {
      title: 'SEGURIDAD',
      icon: 'pi pi-shield',
      items: [
        { label: 'Usuarios', path: '/usuarios', icon: 'pi pi-users', roles: ADMIN },
        {
          label: 'Roles y permisos',
          path: '/roles',
          icon: 'pi pi-shield',
          roles: ['ADMINISTRADOR', 'ADMIN_SAAS'],
        },
        { label: 'Bitacora', path: '/bitacora', icon: 'pi pi-history', roles: ADMIN },
      ],
    },
    {
      title: 'ADMINISTRACION',
      icon: 'pi pi-briefcase',
      items: [
        {
          label: 'Personalizar tienda',
          path: '/personalizar-tienda',
          icon: 'pi pi-palette',
          roles: ADMIN,
        },
        {
          label: 'Respaldos de mi empresa',
          path: '/respaldos',
          icon: 'pi pi-database',
          roles: ADMIN,
        },
        { label: 'Productos', path: '/productos', icon: 'pi pi-shopping-bag', roles: ADMIN },
        { label: 'Proveedores', path: '/proveedores', icon: 'pi pi-truck', roles: ADMIN },
        { label: 'Ciudades', path: '/ciudades', icon: 'pi pi-map-marker', roles: ADMIN },
        { label: 'Sucursales', path: '/sucursales', icon: 'pi pi-building', roles: ADMIN },
        { label: 'Empleados', path: '/empleados', icon: 'pi pi-id-card', roles: ADMIN_O_ENCARGADO },
        {
          label: 'Reservas',
          path: '/reservas-admin',
          icon: 'pi pi-calendar-check',
          roles: ADMIN_ENCARGADO_CAJERO,
        },
      ],
    },
    {
      title: 'VENTAS E INVENTARIO',
      icon: 'pi pi-warehouse',
      items: [
        {
          label: 'Inventario',
          path: '/inventario',
          icon: 'pi pi-box',
          roles: ADMIN_ENCARGADO_CAJERO,
        },
        {
          label: 'Movimientos',
          path: '/movimientos-inventario',
          icon: 'pi pi-arrow-right-arrow-left',
          roles: ADMIN_O_ENCARGADO,
        },
        {
          label: 'Transferencias',
          path: '/transferencias-stock',
          icon: 'pi pi-truck',
          roles: ADMIN_O_ENCARGADO,
        },
        {
          label: 'Venta presencial',
          path: '/venta-presencial',
          icon: 'pi pi-receipt',
          roles: ADMIN_ENCARGADO_CAJERO,
        },
        { label: 'Notificaciones', path: '/notificaciones', icon: 'pi pi-bell' },
        { label: 'Pagos', path: '/pagos', icon: 'pi pi-credit-card', roles: ADMIN_O_ENCARGADO },
        {
          label: 'Devoluciones y cambios',
          path: '/devoluciones',
          icon: 'pi pi-replay',
          roles: ADMIN_ENCARGADO_CAJERO,
        },
        {
          label: 'Delivery',
          path: '/delivery',
          icon: 'pi pi-map-marker',
          roles: ADMIN_ENCARGADO_CAJERO,
        },
      ],
    },
    {
      title: 'REPORTES',
      icon: 'pi pi-chart-bar',
      items: [
        {
          label: 'Reportes',
          path: '/reportes',
          icon: 'pi pi-file-chart',
          roles: ADMIN_O_ENCARGADO,
        },
        {
          label: 'Analítica inteligente',
          path: '/analitica',
          icon: 'pi pi-chart-line',
          roles: ADMIN_O_ENCARGADO,
        },
      ],
    },
  ];

  protected readonly menuGroups = computed(() => {
    return this.todosLosMenus
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => this.puedeVerItemTienda(item)),
      }))
      .filter((group) => group.items.length > 0);
  });

  protected readonly gruposAbiertos = signal<Set<string>>(new Set(['PANEL', 'PLATAFORMA']));

  constructor() {
    if (
      this.authService.estaAutenticado() &&
      (this.authService.tieneRol('ADMINISTRADOR') || this.authService.tieneRol('ADMIN_SAAS'))
    )
      this.authService.cargarCapacidades().subscribe({ error: () => {} });
    if (this.authService.tieneRol('CLIENTE')) {
      this.carritoService.obtenerCarrito().subscribe({
        next: (carrito) => this.tiendaState.reemplazarCarritoDesdeBackend(carrito.items),
        error: () => this.tiendaState.vaciarCarrito(),
      });

      this.recomendacionesService.listarFavoritos().subscribe({
        next: (items) =>
          this.tiendaState.reemplazarFavoritos(
            items.map((item) => ({
              id: item.producto_id,
              nombre: item.nombre,
              categoria: item.categoria,
              precio: Number(item.precio_final ?? item.precio_vigente ?? 0),
            })),
          ),
        error: () => this.tiendaState.reemplazarFavoritos([]),
      });
    } else {
      this.tiendaState.vaciarCarrito();
      this.tiendaState.reemplazarFavoritos([]);
    }

    queueMicrotask(() => {
      const grupoActivo = this.menuGroups().find((group) =>
        group.items.some(
          (item) => this.router.url === item.path || this.router.url.startsWith(`${item.path}/`),
        ),
      );

      if (grupoActivo) {
        this.gruposAbiertos.update((actuales) => new Set(actuales).add(grupoActivo.title));
      }

      this.sincronizarBusquedaNavbar();
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.sincronizarBusquedaNavbar());
  }

  protected grupoAbierto(title: string): boolean {
    return this.gruposAbiertos().has(title);
  }

  protected alternarGrupo(title: string): void {
    this.gruposAbiertos.update((actuales) => {
      const siguiente = new Set(actuales);
      if (siguiente.has(title)) {
        siguiente.delete(title);
      } else {
        siguiente.add(title);
      }
      return siguiente;
    });
  }

  protected cerrarSesion(): void {
    this.tiendaState.vaciarCarrito();
    this.tiendaState.seleccionarSucursalCarrito(null);
    this.tiendaState.reemplazarFavoritos([]);
    const destino = this.authService.tieneRol('ADMIN_SAAS') ? '/saas/login' : '/login';
    this.authService.logout().subscribe({ next: () => void this.router.navigateByUrl(destino) });
  }

  protected alternarCuenta(): void {
    this.cuentaAbierta.update((abierta) => !abierta);
  }

  protected irPerfil(): void {
    this.cuentaAbierta.set(false);
    this.cerrarSidebar();
    void this.router.navigateByUrl('/perfil');
  }

  protected alternarSidebar(): void {
    this.sidebarAbierto.update((abierto) => !abierto);
  }

  protected cerrarSidebar(): void {
    this.sidebarAbierto.set(false);
  }

  protected puedeVerItemTienda(item: MenuItem): boolean {
    const permiso = (
      { '/usuarios': 'usuarios:ver', '/roles': 'roles:ver', '/bitacora': 'bitacora:ver' } as Record<
        string,
        string
      >
    )[item.path];
    if (permiso && !this.authService.puede(permiso)) return false;
    const rolesItem = item.roles;
    if (rolesItem === undefined) return true;
    const rolesUsuario = this.usuario()?.roles ?? [];
    return rolesItem.some((rol) => rolesUsuario.includes(rol));
  }

  protected actualizarBusquedaTienda(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.busquedaTienda.set(input.value);
  }

  protected buscarDesdeNavbar(event: Event): void {
    event.preventDefault();
    const busqueda = this.busquedaTienda().trim();

    void this.router.navigate(['/catalogo'], {
      queryParams: busqueda === '' ? {} : { q: busqueda },
    });
  }

  private sincronizarBusquedaNavbar(): void {
    const urlTree = this.router.parseUrl(this.router.url);
    const query = urlTree.queryParams['q'];
    this.busquedaTienda.set(typeof query === 'string' ? query : '');
  }
}
