import { PerfilService } from '../../../autenticacion/services/perfil.service';
import { DireccionResponse } from '../../../autenticacion/models/perfil.models';
import { AppModalComponent } from '../../../../shared/components/app-modal/app-modal.component';
import { OperacionNuevaDirective } from '../../../../core/directives/operacion-nueva.directive';
import { OfflineService } from '../../../../core/offline/offline.service';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  ViewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import * as L from 'leaflet';
import QRCode from 'qrcode';
import { finalize, forkJoin } from 'rxjs';
import { CarritoItemResponse, CarritoResponse } from '../../models/carrito.models';
import { CatalogoSucursal } from '../../../catalogo/models/catalogo-publico.models';
import { ReservaResponse } from '../../models/reservas.models';
import { CarritoService } from '../../../reservas/services/carrito.service';
import { CatalogoPublicoService } from '../../../catalogo/services/catalogo-publico.service';
import { ReservasService } from '../../services/reservas.service';
import {
  DeliveryCheckoutRequest,
  DeliveryCotizacionResponse,
} from '../../../ventas_inventario/models/delivery.models';
import {
  CheckoutQrResponse,
  OrdenPagoResponse,
} from '../../../ventas_inventario/models/pago.models';
import { DeliveryService } from '../../../ventas_inventario/services/delivery.service';
import { PagoService } from '../../../ventas_inventario/services/pago.service';
import { TiendaStateService } from '../../../../core/services/tienda-state.service';

@Component({
  imports: [OperacionNuevaDirective, RouterLink, AppModalComponent],
  selector: 'app-carrito-page',
  styleUrl: './carrito.page.css',
  templateUrl: './carrito.page.html',
})
export class CarritoPage implements OnInit, OnDestroy {
  protected readonly offline = inject(OfflineService);
  private readonly carritoService = inject(CarritoService);
  private readonly perfil = inject(PerfilService);
  protected readonly direcciones = signal<DireccionResponse[]>([]);
  protected readonly direccionGuardada = signal<number | null>(null);
  protected readonly cotizacionAceptada = signal(false);
  private solicitudCotizacion = 0;
  private invalidarCotizacion(): void {
    this.solicitudCotizacion++;
    this.cotizacionDelivery.set(null);
    this.cotizacionAceptada.set(false);
    this.cotizandoDelivery.set(false);
    if (this.deliveryLine) {
      this.deliveryLine.remove();
      this.deliveryLine = undefined;
    }
  }
  protected venceCotizacion(): string {
    const fecha = this.cotizacionDelivery()?.vence_en;
    return fecha ? new Date(fecha).toLocaleString('es-BO') : '';
  }
  protected aceptarCotizacion(event: Event): void {
    this.cotizacionAceptada.set((event.target as HTMLInputElement).checked);
  }
  protected elegirDireccion(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value) || null;
    this.direccionGuardada.set(id);
    this.invalidarCotizacion();
    const d = this.direcciones().find((x) => x.id === id);
    if (d) {
      this.direccionEntrega.set(d.direccion);
      this.referenciaEntrega.set(d.referencia || '');
      this.buscarDireccion();
    }
  }
  private readonly catalogoService = inject(CatalogoPublicoService);
  private readonly reservasService = inject(ReservasService);
  private readonly deliveryService = inject(DeliveryService);
  private readonly pagoService = inject(PagoService);
  private readonly tiendaState = inject(TiendaStateService);
  private readonly router = inject(Router);

  @ViewChild('deliveryMap')
  set deliveryMapRef(ref: ElementRef<HTMLDivElement> | undefined) {
    if (!ref && this.deliveryMap) {
      this.deliveryMap.remove();
      this.deliveryMap = undefined;
      this.deliveryMarker = undefined;
      this.sucursalMarker = undefined;
      this.deliveryLine = undefined;
    }
    this.deliveryMapElement = ref?.nativeElement;
    if (this.deliveryMapElement && this.tipoEntrega() === 'DELIVERY') {
      this.programarMapa();
    }
  }

  private deliveryMapElement?: HTMLDivElement;
  private deliveryMap?: L.Map;
  private deliveryMarker?: L.Marker;
  private sucursalMarker?: L.Marker;
  private deliveryLine?: L.Polyline;

  protected readonly carrito = signal<CarritoResponse | null>(null);
  protected readonly sucursales = signal<CatalogoSucursal[]>([]);
  protected readonly sucursalId = signal<number | null>(null);
  protected readonly cargando = signal(false);
  protected readonly guardando = signal(false);
  protected readonly mostrandoDelivery = signal(false);
  protected abrirDelivery(): void {
    this.mostrandoDelivery.set(true);
  }
  protected cerrarDelivery(): void {
    this.mostrandoDelivery.set(false);
  }

  protected readonly cotizandoDelivery = signal(false);
  protected readonly error = signal('');
  protected readonly mensaje = signal('');
  protected readonly tipoEntrega = signal<'RECOJO_SUCURSAL' | 'DELIVERY'>('RECOJO_SUCURSAL');
  protected readonly direccionEntrega = signal('');
  protected readonly referenciaEntrega = signal('');
  protected readonly fechaCita = signal(this.fechaLocalDesdeHoy(0));
  protected readonly latitudEntrega = signal(-17.783327);
  protected readonly longitudEntrega = signal(-63.18214);
  protected readonly cotizacionDelivery = signal<DeliveryCotizacionResponse | null>(null);

  protected readonly metodoPagoDigital = signal<'QR' | 'STRIPE'>('QR');
  protected readonly mostrandoModalQr = signal(false);
  protected readonly intentoPendiente = signal<OrdenPagoResponse | null>(null);
  protected readonly checkoutQr = signal<CheckoutQrResponse | null>(null);
  protected readonly qrDataUrl = signal('');
  protected readonly copiadoQr = signal<string | null>(null);
  protected readonly errorQr = signal('');

  protected readonly items = computed(() => this.carrito()?.items ?? []);
  protected readonly subtotal = computed(() => this.toNumber(this.carrito()?.total));
  protected readonly costoDelivery = computed(() =>
    this.tipoEntrega() === 'DELIVERY'
      ? this.toNumber(this.cotizacionDelivery()?.costo_delivery)
      : 0,
  );
  protected readonly totalCompra = computed(() => this.subtotal() + this.costoDelivery());
  protected readonly montoReserva = computed(() => 0);
  protected readonly totalItems = computed(() =>
    this.items().reduce((total, item) => total + item.cantidad, 0),
  );
  protected readonly bloqueoReserva = computed(() => {
    if (this.tipoEntrega() !== 'RECOJO_SUCURSAL') return '';
    const items = this.items();
    if (items.some((item) => item.paquete_id)) {
      return 'Los paquetes mayoristas son para compra directa. Para reservar, agrega prendas por unidad.';
    }
    if (items.some((item) => Number(item.cantidad) > 2)) {
      return 'Reduce a 2 unidades como máximo por variante para reservar.';
    }
    return '';
  });

  ngOnInit(): void {
    this.perfil
      .listarDirecciones()
      .subscribe({
        next: (d) => this.direcciones.set(d.direcciones),
        error: () => this.direcciones.set([]),
      });
    this.cargarCarrito();
    this.pagoService.obtenerPendiente().subscribe({
      next: (orden) => this.intentoPendiente.set(orden),
      error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
    });
  }

  protected cambiarCantidad(item: CarritoItemResponse, cantidad: number): void {
    if (cantidad < 1) {
      return;
    }

    this.guardando.set(true);
    this.error.set('');

    this.carritoService
      .actualizarItem(item.id, { cantidad })
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: (carrito) => this.aplicarCarrito(carrito),
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected quitar(item: CarritoItemResponse): void {
    this.guardando.set(true);
    this.error.set('');

    this.carritoService
      .eliminarItem(item.id)
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: (carrito) => this.aplicarCarrito(carrito),
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected vaciar(): void {
    this.guardando.set(true);
    this.error.set('');

    this.carritoService
      .vaciar()
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: (carrito) => this.aplicarCarrito(carrito),
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected actualizarSucursal(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const sucursalId = value === '' ? null : Number(value);
    this.sucursalId.set(sucursalId);
    this.tiendaState.seleccionarSucursalCarrito(sucursalId);
    this.invalidarCotizacion();
    this.sincronizarMapa(this.latitudEntrega(), this.longitudEntrega());
  }

  protected cambiarTipoEntrega(tipo: 'RECOJO_SUCURSAL' | 'DELIVERY'): void {
    this.tipoEntrega.set(tipo);
    this.error.set('');
    if (tipo === 'RECOJO_SUCURSAL') {
      this.cerrarDelivery();
      this.invalidarCotizacion();
      return;
    }
    this.abrirDelivery();
    this.programarMapa();
  }

  protected actualizarDireccion(event: Event): void {
    this.direccionEntrega.set((event.target as HTMLInputElement).value);
    this.invalidarCotizacion();
  }

  protected actualizarReferencia(event: Event): void {
    this.referenciaEntrega.set((event.target as HTMLInputElement).value);
    this.invalidarCotizacion();
  }

  protected actualizarFechaCita(event: Event): void {
    this.fechaCita.set((event.target as HTMLInputElement).value);
  }

  protected buscarDireccion(): void {
    const direccion = this.direccionEntrega().trim();
    if (direccion.length < 5) {
      this.error.set('Ingresa una dirección de delivery más completa.');
      return;
    }
    this.cotizandoDelivery.set(true);
    this.error.set('');
    this.deliveryService
      .geocodificar(direccion)
      .pipe(finalize(() => this.cotizandoDelivery.set(false)))
      .subscribe({
        next: (resultado) => {
          if (this.direccionEntrega().trim() !== direccion) return;
          this.direccionEntrega.set(resultado.direccion);
          this.actualizarUbicacion(
            this.toNumber(resultado.latitud),
            this.toNumber(resultado.longitud),
          );
          this.cotizarDelivery();
        },
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected usarUbicacionActual(): void {
    if (!navigator.geolocation) {
      this.error.set('Tu navegador no permite obtener la ubicación actual.');
      return;
    }

    this.cotizandoDelivery.set(true);
    this.error.set('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        this.cotizandoDelivery.set(false);
        this.actualizarUbicacion(position.coords.latitude, position.coords.longitude);
        if (!this.direccionEntrega().trim()) {
          this.direccionEntrega.set('Ubicación seleccionada en el mapa');
        }
        this.cotizarDelivery();
      },
      () => {
        this.cotizandoDelivery.set(false);
        this.error.set(
          'No se pudo obtener tu ubicación. Puedes buscar tu dirección o mover el marcador en el mapa.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  protected cotizarDelivery(): void {
    const request = this.deliveryRequest();
    if (!request) {
      this.error.set('Selecciona sucursal e ingresa una dirección de al menos cinco caracteres.');
      return;
    }
    this.invalidarCotizacion();
    const n = this.solicitudCotizacion;
    this.cotizandoDelivery.set(true);
    this.error.set('');
    this.deliveryService
      .cotizar(request)
      .pipe(
        finalize(() => {
          if (n === this.solicitudCotizacion) this.cotizandoDelivery.set(false);
        }),
      )
      .subscribe({
        next: (cotizacion) => {
          if (n !== this.solicitudCotizacion) return;
          this.cotizacionDelivery.set(cotizacion);
          if (this.deliveryMap && cotizacion.ruta?.length) {
            this.deliveryLine = L.polyline(
              cotizacion.ruta.map((p) => [p[1], p[0]] as L.LatLngTuple),
              { color: '#36552c', weight: 4 },
            ).addTo(this.deliveryMap);
          }
          if (!cotizacion.disponible) {
            this.error.set(cotizacion.mensaje || 'La direccion esta fuera del rango de delivery.');
          }
        },
        error: (error: HttpErrorResponse) => {
          if (n === this.solicitudCotizacion) this.error.set(this.obtenerMensajeError(error));
        },
      });
  }

  protected confirmarReserva(): void {
    if (this.guardando()) return;
    const sucursalId = this.sucursalId();

    if (sucursalId === null) {
      this.error.set('Selecciona una sucursal para confirmar la reserva.');
      return;
    }
    if (!this.fechaCita()) {
      this.error.set('Selecciona la fecha en la que pasaras por la sucursal.');
      return;
    }
    const bloqueo = this.bloqueoReserva();
    if (bloqueo) {
      this.error.set(bloqueo);
      return;
    }

    this.guardando.set(true);
    this.error.set('');
    this.mensaje.set('');

    this.reservasService
      .crearDesdeCarrito({ sucursal_id: sucursalId, fecha_cita: this.fechaCita() })
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: (reserva: ReservaResponse) => {
          this.mensaje.set(`Reserva ${reserva.codigo} creada correctamente.`);
          void this.router.navigate(['/reservas', reserva.id]);
        },
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected pagarConQr(): void {
    const sucursalId = this.sucursalId();

    if (sucursalId === null) {
      this.error.set('Selecciona una sucursal para pagar con QR.');
      return;
    }
    const delivery = this.deliveryCheckout();
    if (this.tipoEntrega() === 'DELIVERY' && delivery === null) {
      this.error.set('Completa y cotiza la direccion de delivery antes de pagar.');
      return;
    }

    this.guardando.set(true);
    this.error.set('');
    this.mensaje.set('');

    this.pagoService
      .crearCheckoutQr({
        sucursal_id: sucursalId,
        tipo_entrega: this.tipoEntrega(),
        delivery,
      })
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: async (checkout) => {
          this.checkoutQr.set(checkout);
          try {
            const dataUrl = await QRCode.toDataURL(checkout.qr_payload, {
              errorCorrectionLevel: 'M',
              margin: 2,
              scale: 8,
              color: { dark: '#0f172a', light: '#ffffff' },
            });
            this.qrDataUrl.set(dataUrl);
            this.mostrandoModalQr.set(true);
          } catch {
            this.error.set('No se pudo generar la imagen del código QR.');
          }
        },
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected confirmarPagoQr(): void {
    const checkout = this.checkoutQr();
    if (!checkout || this.guardando() || !checkout.confirmacion_prueba) return;

    this.guardando.set(true);
    this.errorQr.set('');

    this.pagoService
      .confirmarPagoQr(checkout.orden_id)
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: () => {
          this.cerrarModalQr();
          // Navegar al comprobante en Mis Pagos
          void this.router.navigate(['/mis-pagos', checkout.orden_id]);
        },
        error: (error: HttpErrorResponse) => {
          this.errorQr.set(this.obtenerMensajeError(error));
        },
      });
  }

  protected cerrarModalQr(): void {
    this.mostrandoModalQr.set(false);
    this.qrDataUrl.set('');
    this.checkoutQr.set(null);
    this.errorQr.set('');
  }

  protected reintentarCarga(): void {
    this.error.set('');
    this.cargarCarrito();
  }

  protected copiarQr(texto: string, campo: string): void {
    void navigator.clipboard.writeText(texto);
    this.copiadoQr.set(campo);
    setTimeout(() => {
      if (this.copiadoQr() === campo) {
        this.copiadoQr.set(null);
      }
    }, 2000);
  }

  protected pagarConStripe(): void {
    if (this.guardando()) return;

    const sucursalId = this.sucursalId();

    if (sucursalId === null) {
      this.error.set('Selecciona una sucursal para pagar la compra digital.');
      return;
    }
    const delivery = this.deliveryCheckout();
    if (this.tipoEntrega() === 'DELIVERY' && delivery === null) {
      this.error.set('Completa y cotiza la direccion de delivery antes de pagar.');
      return;
    }

    this.guardando.set(true);
    this.error.set('');
    this.mensaje.set('');

    this.pagoService
      .crearCheckoutStripe({
        sucursal_id: sucursalId,
        tipo_entrega: this.tipoEntrega(),
        delivery,
      })
      .pipe(finalize(() => this.guardando.set(false)))
      .subscribe({
        next: (checkout) => {
          window.location.href = checkout.checkout_url;
        },
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  protected formatPrecio(precio: number | string | null | undefined): string {
    const value = this.toNumber(precio);
    return value > 0 ? `Bs ${value.toFixed(2)}` : 'Precio pendiente';
  }

  protected formatMonto(monto: number | string | null | undefined): string {
    return `Bs ${this.toNumber(monto).toFixed(2)}`;
  }

  protected entregaLista(): boolean {
    if (!this.items().length || this.items().some((i) => i.disponible_para_compra === false))
      return false;
    if (this.tipoEntrega() === 'RECOJO_SUCURSAL') {
      return this.sucursalId() !== null;
    }
    return Boolean(this.deliveryCheckout());
  }

  protected fechaMaximaCita(): string {
    return this.fechaLocalDesdeHoy(7);
  }

  protected fechaMinimaCita(): string {
    return this.fechaLocalDesdeHoy(0);
  }

  protected esSucursalSeleccionada(sucursalId: number): boolean {
    return Number(this.sucursalId()) === Number(sucursalId);
  }

  private cargarCarrito(): void {
    this.cargando.set(true);
    this.error.set('');

    forkJoin({
      carrito: this.carritoService.obtenerCarrito(),
      filtros: this.catalogoService.obtenerFiltros(),
    })
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: ({ carrito, filtros }) => {
          const sucursales = this.filtrarSucursalesDisponibles(filtros.sucursales, carrito);
          this.aplicarCarrito(carrito, sucursales);
          this.sucursales.set(sucursales);
          this.sucursalId.set(this.resolverSucursalInicial(carrito, sucursales));
        },
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  private toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private fechaLocalDesdeHoy(dias: number): string {
    const fecha = new Date();
    fecha.setHours(0, 0, 0, 0);
    fecha.setDate(fecha.getDate() + dias);
    const year = fecha.getFullYear();
    const month = String(fecha.getMonth() + 1).padStart(2, '0');
    const day = String(fecha.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private deliveryRequest(): DeliveryCheckoutRequest | null {
    const sucursalId = this.sucursalId();
    const direccion = this.direccionEntrega().trim();
    if (sucursalId === null || direccion.length < 5) {
      return null;
    }
    return {
      direccion_id: this.direccionGuardada(),
      sucursal_id: sucursalId,
      direccion_entrega: direccion,
      referencia: this.referenciaEntrega().trim() || null,
      latitud_entrega: this.latitudEntrega(),
      longitud_entrega: this.longitudEntrega(),
    };
  }

  private deliveryCheckout(): DeliveryCheckoutRequest | null {
    if (this.tipoEntrega() !== 'DELIVERY') {
      return null;
    }
    const base = this.deliveryRequest();
    const cotizacion = this.cotizacionDelivery();
    if (
      !base ||
      !cotizacion?.disponible ||
      !cotizacion.cotizacion_id ||
      !this.cotizacionAceptada()
    ) {
      return null;
    }
    return {
      ...base,
      cotizacion_id: cotizacion.cotizacion_id,
      distancia_km: cotizacion.distancia_km,
      tiempo_estimado_min: cotizacion.tiempo_estimado_min,
      costo_delivery: cotizacion.costo_delivery,
    };
  }

  private aplicarCarrito(
    carrito: CarritoResponse,
    sucursalesBase: CatalogoSucursal[] | null = null,
  ): void {
    this.carrito.set(carrito);
    this.tiendaState.reemplazarCarritoDesdeBackend(carrito.items);
    const sucursalesDisponibles = this.sucursalesDesdeCarrito(carrito);
    if (sucursalesDisponibles.length > 0 || carrito.items.length > 0) {
      const sucursales = sucursalesDisponibles.length > 0 ? sucursalesDisponibles : [];
      this.sucursales.set(sucursales);
      const sucursalActual = this.sucursalId();
      const idsDisponibles = new Set(sucursales.map((sucursal) => Number(sucursal.id)));
      if (sucursalActual === null || !idsDisponibles.has(Number(sucursalActual))) {
        this.sucursalId.set(this.resolverSucursalInicial(carrito, sucursales));
      }
      return;
    }
    if (sucursalesBase) {
      this.sucursales.set(sucursalesBase);
    }
  }

  private resolverSucursalInicial(
    carrito: CarritoResponse,
    sucursales: CatalogoSucursal[],
  ): number | null {
    const sucursalGuardada = this.tiendaState.sucursalCarrito();
    const idsDisponibles = new Set(sucursales.map((sucursal) => Number(sucursal.id)));

    if (sucursalGuardada !== null && idsDisponibles.has(Number(sucursalGuardada))) {
      return sucursalGuardada;
    }

    const sucursalDelCarrito =
      carrito.items
        .map((item) => item.sucursal_id)
        .find((sucursalId) => sucursalId !== null && sucursalId !== undefined) ?? null;

    if (sucursalDelCarrito !== null && idsDisponibles.has(Number(sucursalDelCarrito))) {
      this.tiendaState.seleccionarSucursalCarrito(sucursalDelCarrito);
      return sucursalDelCarrito;
    }

    const primeraSucursal = sucursales[0]?.id ?? null;
    this.tiendaState.seleccionarSucursalCarrito(primeraSucursal);
    return primeraSucursal;
  }

  private filtrarSucursalesDisponibles(
    sucursales: CatalogoSucursal[],
    carrito: CarritoResponse,
  ): CatalogoSucursal[] {
    const sucursalesDelCarrito = this.sucursalesDesdeCarrito(carrito);
    if (sucursalesDelCarrito.length > 0 || carrito.items.length > 0) {
      return sucursalesDelCarrito;
    }

    const sucursalesPorId = new Map<number, CatalogoSucursal>();
    sucursales.forEach((sucursal) => sucursalesPorId.set(Number(sucursal.id), sucursal));

    const itemsConSucursal = carrito.items.filter(
      (item) => item.sucursal_id !== null && item.sucursal_id !== undefined,
    );

    if (itemsConSucursal.length === 0) {
      return sucursales;
    }

    const conteoPorSucursal = new Map<number, number>();

    itemsConSucursal.forEach((item) => {
      if (Number(item.stock_disponible) < Number(item.cantidad)) {
        return;
      }
      const sucursalId = Number(item.sucursal_id);
      conteoPorSucursal.set(sucursalId, (conteoPorSucursal.get(sucursalId) ?? 0) + 1);

      if (!sucursalesPorId.has(sucursalId)) {
        sucursalesPorId.set(sucursalId, {
          id: sucursalId,
          nombre: item.sucursal ?? 'Sucursal seleccionada',
          ciudad: item.ciudad ?? '',
        });
      }
    });

    return Array.from(conteoPorSucursal.entries())
      .filter(([, totalItems]) => totalItems === itemsConSucursal.length)
      .map(([sucursalId]) => sucursalesPorId.get(sucursalId))
      .filter((sucursal): sucursal is CatalogoSucursal => Boolean(sucursal));
  }

  private sucursalesDesdeCarrito(carrito: CarritoResponse): CatalogoSucursal[] {
    return (carrito.sucursales_disponibles ?? []).map((sucursal) => ({
      id: sucursal.id,
      nombre: sucursal.nombre,
      ciudad: sucursal.ciudad,
      latitud: sucursal.latitud,
      longitud: sucursal.longitud,
    }));
  }

  private obtenerMensajeError(error: HttpErrorResponse): string {
    if (typeof error.error === 'object' && error.error !== null && 'detail' in error.error) {
      const detail = error.error.detail;

      if (typeof detail === 'string') {
        return detail;
      }
    }

    return 'No se pudo procesar el carrito.';
  }

  private programarMapa(): void {
    setTimeout(() => this.inicializarMapa(), 0);
  }

  private inicializarMapa(): void {
    const mapElement = this.deliveryMapElement;
    if (!mapElement) {
      return;
    }

    const lat = this.latitudEntrega();
    const lng = this.longitudEntrega();

    if (this.deliveryMap) {
      this.deliveryMap.invalidateSize();
      this.sincronizarMapa(lat, lng);
      return;
    }

    this.deliveryMap = L.map(mapElement, {
      center: [lat, lng],
      zoom: 14,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.deliveryMap);

    this.deliveryMarker = L.marker([lat, lng], {
      draggable: true,
      title: 'Ubicación de entrega. Arrastra el marcador para ajustar el destino.',
      icon: L.divIcon({
        className: 'delivery-map-marker delivery-map-marker-client',
        html: '<span></span>',
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      }),
    }).addTo(this.deliveryMap);
    this.deliveryMarker.on('dragend', () => {
      const position = this.deliveryMarker?.getLatLng();
      if (!position) {
        return;
      }
      this.latitudEntrega.set(position.lat);
      this.longitudEntrega.set(position.lng);
      this.invalidarCotizacion();
      this.dibujarRutaVisual();
      if (!this.direccionEntrega().trim()) {
        this.direccionEntrega.set('Ubicación seleccionada en el mapa');
      }
    });

    this.deliveryMap.on('click', (event: L.LeafletMouseEvent) => {
      this.actualizarUbicacion(event.latlng.lat, event.latlng.lng);
      if (!this.direccionEntrega().trim()) {
        this.direccionEntrega.set('Ubicación seleccionada en el mapa');
      }
    });

    setTimeout(() => this.deliveryMap?.invalidateSize(), 150);
    this.dibujarRutaVisual();
    const ruta = this.cotizacionDelivery()?.ruta;
    if (ruta?.length) {
      this.deliveryLine = L.polyline(
        ruta.map((p) => [p[1], p[0]] as L.LatLngTuple),
        { color: '#36552c', weight: 4 },
      ).addTo(this.deliveryMap);
    }
  }

  private actualizarUbicacion(latitud: number, longitud: number): void {
    this.latitudEntrega.set(latitud);
    this.longitudEntrega.set(longitud);
    this.invalidarCotizacion();
    this.sincronizarMapa(latitud, longitud);
  }

  private sincronizarMapa(latitud: number, longitud: number): void {
    if (!this.deliveryMap || !this.deliveryMarker) {
      return;
    }
    this.deliveryMarker.setLatLng([latitud, longitud]);
    this.dibujarRutaVisual();
    this.ajustarVistaRuta(latitud, longitud);
  }

  private dibujarRutaVisual(): void {
    if (!this.deliveryMap || !this.deliveryMarker) {
      return;
    }

    const sucursal = this.sucursalSeleccionada();
    const sucursalLat = this.toNumber(sucursal?.latitud);
    const sucursalLng = this.toNumber(sucursal?.longitud);
    const clienteLat = this.latitudEntrega();
    const clienteLng = this.longitudEntrega();

    if (!sucursal || sucursalLat === 0 || sucursalLng === 0) {
      this.sucursalMarker?.remove();
      this.deliveryLine?.remove();
      this.sucursalMarker = undefined;
      this.deliveryLine = undefined;
      return;
    }

    const sucursalPoint: L.LatLngExpression = [sucursalLat, sucursalLng];
    const clientePoint: L.LatLngExpression = [clienteLat, clienteLng];

    if (!this.sucursalMarker) {
      this.sucursalMarker = L.marker(sucursalPoint, {
        title: 'Sucursal de origen',
        icon: L.divIcon({
          className: 'delivery-map-marker delivery-map-marker-branch',
          html: '<span></span>',
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        }),
      }).addTo(this.deliveryMap);
    } else {
      this.sucursalMarker.setLatLng(sucursalPoint);
    }

    const etiqueta = document.createElement('span');
    etiqueta.textContent = `Sale desde: ${sucursal.ciudad} - ${sucursal.nombre}`;
    this.sucursalMarker.bindTooltip(etiqueta, { direction: 'top' });
  }

  private ajustarVistaRuta(clienteLat: number, clienteLng: number): void {
    if (!this.deliveryMap) {
      return;
    }

    const sucursal = this.sucursalSeleccionada();
    const sucursalLat = this.toNumber(sucursal?.latitud);
    const sucursalLng = this.toNumber(sucursal?.longitud);

    if (sucursal && sucursalLat !== 0 && sucursalLng !== 0) {
      const bounds = L.latLngBounds([
        [sucursalLat, sucursalLng],
        [clienteLat, clienteLng],
      ]);
      this.deliveryMap.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 });
      return;
    }

    this.deliveryMap.setView([clienteLat, clienteLng], Math.max(this.deliveryMap.getZoom(), 14));
  }

  private sucursalSeleccionada(): CatalogoSucursal | null {
    const sucursalId = this.sucursalId();
    if (sucursalId === null) {
      return null;
    }
    return this.sucursales().find((sucursal) => Number(sucursal.id) === Number(sucursalId)) ?? null;
  }

  ngOnDestroy(): void {
    if (this.deliveryMap) {
      this.deliveryMap.remove();
      this.deliveryMap = undefined;
    }
  }
}
