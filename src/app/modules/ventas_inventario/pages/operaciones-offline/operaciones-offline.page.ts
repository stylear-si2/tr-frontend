import { mensajeApi } from '../../../../core/services/error-api';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../../../../core/config/api.config';
import * as QRCode from 'qrcode';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../autenticacion/services/auth.service';
import { generarFrase } from '../../../../core/offline/offline.crypto';
import {
  LineaOffline,
  CompraCambioOffline,
  CambioOffline,
  OperacionOffline,
  VarianteOffline,
} from '../../../../core/offline/offline.model';
import { OfflineService } from '../../../../core/offline/offline.service';

@Component({
  selector: 'app-operaciones-offline',
  imports: [CurrencyPipe, DatePipe, ReactiveFormsModule, RouterLink],
  templateUrl: './operaciones-offline.page.html',
  styleUrl: './operaciones-offline.page.css',
})
export class OperacionesOfflinePage {
  protected readonly offline = inject(OfflineService);
  private readonly http = inject(HttpClient);
  protected readonly modoCompra = signal(false);
  protected readonly modoCambios = signal(false);
  protected readonly qr = signal<{
    orden_id: number;
    confirmacion_prueba: boolean;
    imagen: string;
  } | null>(null);
  private readonly auth = inject(AuthService);
  protected readonly frase = new FormControl('', { nonNullable: true });
  protected readonly verFrase = signal(false);
  protected readonly sucursal = signal<number | null>(null);
  protected readonly seleccion = signal<LineaOffline[]>([]);
  protected readonly consulta = signal('');
  protected readonly limite = signal(60);
  protected readonly fechaCita = new FormControl('', { nonNullable: true });
  protected readonly efectivo = new FormControl(false, { nonNullable: true });
  protected readonly guardando = signal(false);
  protected readonly error = signal('');
  protected readonly aviso = signal('');
  protected readonly historialVisible = signal(false);
  protected readonly devolucion = signal<string | null>(null);
  private uuid?: string;
  private ambito?: string;

  protected readonly variantes = computed(() => {
    const items = this.offline.copia()?.catalogo[this.sucursal() ?? 0] ?? [];
    const consulta = this.consulta().trim().toLocaleLowerCase('es');
    return items.filter((v) =>
      `${v.nombre} ${v.talla ?? ''} ${v.color ?? ''}`.toLocaleLowerCase('es').includes(consulta),
    );
  });
  protected readonly cantidades = computed(
    () => new Map(this.seleccion().map((l) => [l.producto_variante_id, l.cantidad])),
  );
  protected readonly total = computed(() =>
    this.seleccion().reduce((suma, l) => suma + l.precio_centavos * l.cantidad, 0),
  );
  protected readonly colaVisible = computed(() => {
    const sucursales = new Set(this.offline.copia()?.sucursales.map((s) => s.id) ?? []);
    return this.offline.operaciones().filter((op) => !op.resultado || sucursales.has(op.sucursal));
  });
  protected readonly historial = computed(() => {
    const sincronizadas = new Set(
      this.colaVisible().flatMap((op) => (op.resultado ? [`${op.tipo}:${op.resultado.id}`] : [])),
    );
    return (this.offline.copia()?.historial ?? [])
      .filter((fila) => !sincronizadas.has(`${fila.tipo}:${fila.id}`))
      .sort((a, b) => b.fecha.localeCompare(a.fecha));
  });

  constructor() {
    effect(() => {
      const identidad = this.offline.identidad();
      const ambito = identidad && `${identidad.empresa}:${identidad.usuario}`;
      const sucursales = this.offline.copia()?.sucursales ?? [];
      if (ambito !== this.ambito) {
        this.ambito = ambito ?? undefined;
        this.reiniciar();
        this.qr.set(null);
        this.modoCambios.set(false);
        this.frase.reset('');
        this.verFrase.set(false);
        this.devolucion.set(null);
        this.aviso.set('');
      }
      if (!sucursales.some((s) => s.id === this.sucursal())) {
        this.sucursal.set(sucursales[0]?.id ?? null);
        this.reiniciar();
      }
    });
  }

  protected generar(): void {
    this.frase.setValue(generarFrase());
    this.verFrase.set(true);
    this.aviso.set(
      'Guarda la frase en un lugar privado. La necesitarás para recuperar tus operaciones.',
    );
  }

  protected abrir(): void {
    this.verFrase.set(false);
    void this.accion(async () => {
      const frase = this.frase.value;
      if (this.offline.usuario()) await this.offline.habilitar(frase);
      else await this.offline.desbloquear(frase);
      this.frase.reset('');
      this.aviso.set('');
    });
  }

  protected cambiarSucursal(id: string): void {
    this.sucursal.set(Number(id));
    this.reiniciar();
    this.limite.set(60);
  }

  protected filtrar(texto: string): void {
    this.consulta.set(texto);
    this.limite.set(60);
  }

  protected verMas(): void {
    this.limite.update((limite) => limite + 60);
  }

  protected maximo(variante: VarianteOffline): number {
    return this.offline.puedeVender() || this.modoCompra()
      ? variante.stock
      : Math.min(2, variante.stock);
  }

  protected cambiarCantidad(variante: VarianteOffline, cambio: number): void {
    if (this.guardando() || variante.precio_centavos === null) return;
    const anterior = this.seleccion().find((l) => l.producto_variante_id === variante.variante_id);
    const cantidad = (anterior?.cantidad ?? 0) + cambio;
    if (
      cantidad < 0 ||
      (cambio > 0 && cantidad > this.maximo(variante)) ||
      (!anterior && this.seleccion().length >= 100)
    )
      return;
    const lineas = this.seleccion().filter((l) => l.producto_variante_id !== variante.variante_id);
    if (cantidad > 0)
      lineas.push({
        producto_variante_id: variante.variante_id,
        cantidad,
        precio_centavos: anterior?.precio_centavos ?? variante.precio_centavos,
      });
    this.seleccion.set(lineas);
    this.efectivo.reset(false);
  }

  protected guardar(): void {
    const sucursal = this.sucursal();
    if (sucursal === null || !this.seleccion().length) return;
    const venta = this.offline.puedeVender();
    if (venta ? !this.efectivo.value : !this.modoCompra() && !this.fechaCita.value) return;
    void this.accion(async () => {
      const operacion: OperacionOffline = {
        uuid: (this.uuid ??= crypto.randomUUID()),
        tipo: venta ? 'VENTA' : this.modoCompra() ? 'COMPRA' : 'RESERVA',
        sucursal,
        fecha: Date.now(),
        lineas: this.seleccion(),
        estado: 'Pendiente',
        ...(venta
          ? { efectivo: this.total() }
          : this.modoCompra()
            ? {}
            : { fechaCita: this.fechaCita.value }),
      };
      await this.offline.registrar(operacion);
      this.reiniciar();
      this.aviso.set('Operación guardada. Puedes consultar su estado en el historial.');
      this.historialVisible.set(true);
    });
  }

  protected cambiarModo(compra: boolean): void {
    this.modoCompra.set(compra);
    this.reiniciar();
  }

  protected solicitarCambio(
    venta: CompraCambioOffline,
    linea: CompraCambioOffline['detalles'][number],
    cantidad: string,
    motivo: string,
    reemplazo: string,
  ): void {
    if (!venta.vence_cambio || Date.parse(venta.vence_cambio) < Date.now()) {
      this.error.set('El plazo conocido de cambio venció. Sincroniza para revisar la política.');
      return;
    }
    const n = Number(cantidad);
    if (
      !Number.isInteger(n) ||
      n < 1 ||
      n > linea.cantidad_disponible ||
      motivo.trim().length < 5
    ) {
      this.error.set('Revisa la cantidad y describe el motivo con al menos cinco caracteres.');
      return;
    }
    void this.accion(async () => {
      await this.offline.registrar({
        uuid: crypto.randomUUID(),
        tipo: 'CAMBIO',
        sucursal: venta.sucursal_id,
        fecha: Date.now(),
        lineas: [],
        estado: 'Pendiente',
        datosCambio: {
          venta_id: venta.venta_id,
          venta_detalle_id: linea.venta_detalle_id,
          cantidad: n,
          motivo: motivo.trim(),
          ...(reemplazo ? { reemplazo_id: Number(reemplazo) } : {}),
        },
      });
      this.aviso.set('Solicitud guardada. El plazo y el reemplazo se validarán al sincronizar.');
    });
  }

  protected revisarCambio(
    c: CambioOffline,
    aceptar: boolean,
    condicion: string,
    noVendibles: string,
    recibida: boolean,
  ): void {
    const n = Number(noVendibles);
    if (condicion.trim().length < 5 || !Number.isInteger(n) || n < 0 || (aceptar && !recibida)) {
      this.error.set('Describe la inspección y confirma la recepción física antes de aceptar.');
      return;
    }
    void this.accion(async () => {
      await this.offline.registrar({
        uuid: crypto.randomUUID(),
        tipo: 'REVISION_CAMBIO',
        sucursal: c.original.sucursal_id,
        fecha: Date.now(),
        lineas: [],
        estado: 'Pendiente',
        datosCambio: {
          id: c.id,
          version: c.version,
          aceptar,
          condicion: condicion.trim(),
          no_vendibles: n,
          recepcion_confirmada: recibida,
        },
      });
      this.aviso.set(
        'Inspección guardada. La aprobación definitiva y la cotización se validarán al reconectar.',
      );
    });
  }

  protected entregarCambio(c: CambioOffline, entregada: boolean): void {
    if (!entregada) {
      this.error.set('Confirma la entrega física del reemplazo.');
      return;
    }
    void this.accion(async () => {
      await this.offline.registrar({
        uuid: crypto.randomUUID(),
        tipo: 'ENTREGA_CAMBIO',
        sucursal: c.original.sucursal_id,
        fecha: Date.now(),
        lineas: [],
        estado: 'Pendiente',
        datosCambio: { id: c.id, version: c.version, entrega_confirmada: true },
      });
      this.aviso.set('Entrega guardada. El inventario se confirmará al sincronizar.');
    });
  }

  protected pagarCompra(op: OperacionOffline, medio: 'stripe' | 'qr'): void {
    if (!this.offline.conectado() || !this.offline.usuario() || !op.resultado?.items) return;
    void this.accion(async () => {
      const respuesta = await firstValueFrom(
        this.http.post<{
          orden_id: number;
          estado: string;
          checkout_url?: string;
          qr_payload?: string;
          confirmacion_prueba: boolean;
        }>(`${API_BASE_URL}/api/v1/pagos/${medio}/checkout`, {
          clave_operacion: op.uuid,
          sucursal_id: op.sucursal,
          items_offline: op.resultado!.items,
          total_esperado: String(op.resultado!.total),
          tipo_entrega: 'RECOJO_SUCURSAL',
        }),
      );
      await this.offline.actualizarCompra(op.uuid, {
        orden_id: respuesta.orden_id,
        medio,
        estado: respuesta.estado,
      });
      if (respuesta.estado === 'PAGADO') {
        this.aviso.set('Esta compra ya fue pagada. Consulta Mis pagos.');
        return;
      }
      if (respuesta.checkout_url) window.location.assign(respuesta.checkout_url);
      else if (respuesta.qr_payload)
        this.qr.set({ ...respuesta, imagen: await QRCode.toDataURL(respuesta.qr_payload) });
    });
  }

  protected recotizar(op: OperacionOffline): void {
    void this.accion(() => this.offline.actualizarCompra(op.uuid, {}, true));
  }

  protected confirmarQr(): void {
    const qr = this.qr();
    if (!qr?.confirmacion_prueba) return;
    void this.accion(async () => {
      await firstValueFrom(
        this.http.post(`${API_BASE_URL}/api/v1/pagos/qr/confirmar/${qr.orden_id}`, {}),
      );
      const op = this.offline.operaciones().find((o) => o.resultado?.orden_id === qr.orden_id);
      if (op) await this.offline.actualizarCompra(op.uuid, { estado: 'PAGADO' });
      this.qr.set(null);
      this.aviso.set('Pago confirmado. Puedes consultar la nota de venta en Mis pagos.');
    });
  }

  protected devolver(): void {
    const uuid = this.devolucion();
    if (uuid)
      void this.accion(async () => {
        await this.offline.registrarDevolucion(uuid);
        this.devolucion.set(null);
      });
  }

  protected salir(): void {
    void this.accion(async () => {
      await firstValueFrom(this.auth.logout());
      this.aviso.set(
        'Sesión cerrada. Las operaciones pendientes siguen guardadas para su titular.',
      );
    });
  }

  protected actualizar(): void {
    if (!this.seleccion().length && !this.guardando() && !this.offline.ocupada()) location.reload();
  }

  private reiniciar(): void {
    this.seleccion.set([]);
    this.fechaCita.reset('');
    this.efectivo.reset(false);
    this.uuid = undefined;
  }

  private async accion(operacion: () => Promise<void>): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.error.set('');
    try {
      await operacion();
    } catch (error) {
      this.error.set(mensajeApi(error, 'No se pudo completar. Revisa la conexión.'));
    } finally {
      this.guardando.set(false);
    }
  }
}
