import { EmpresaContextoService } from '../services/empresa-contexto.service';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { filter, firstValueFrom, switchMap, take, timeout, timer } from 'rxjs';
import { AuthService } from '../../modules/autenticacion/services/auth.service';
import { PerfilResponse } from '../../modules/autenticacion/models/perfil.models';
import { API_BASE_URL } from '../config/api.config';
import { CambioContextoService } from '../services/cambio-contexto.service';
import { mensajeApi } from '../services/error-api';
import { abrir, abrirCuenta, crearCuenta, sellar } from './offline.crypto';
import { OfflineDb } from './offline.db';
import {
  ACCESO_OFFLINE,
  CIERRE_COMPARTIDO,
  CuentaOffline,
  DescargaOffline,
  DescargaCambios,
  EQUIPO_COMPARTIDO,
  HistorialOffline,
  IdentidadOffline,
  OperacionOffline,
  ROLES_VENTA,
  rolesOffline,
  SucursalOffline,
  TipoOperacion,
  VarianteOffline,
} from './offline.model';

const API = `${API_BASE_URL}/api/v1`;
const VIGENCIA = 24 * 60 * 60_000;
const INACTIVIDAD = 5 * 60_000;
interface AccesoAbierto {
  ambito: string;
  clave: CryptoKey;
  identidad: IdentidadOffline;
}
interface FilaRemota {
  id?: number;
  orden_id?: number;
  codigo?: string;
  venta_codigo?: string;
  estado: string;
  total?: string | number;
  monto_total?: string | number;
  fecha_venta?: string;
  fecha_reserva?: string;
  fecha_creacion?: string;
  sucursal_id?: number;
  detalles?: HistorialOffline['detalles'];
}
function historial(tipo: HistorialOffline['tipo'], fila: FilaRemota): HistorialOffline {
  const id = fila.id ?? fila.orden_id;
  if (!Number.isSafeInteger(id) || id == null)
    throw new Error('Respuesta sin identificador verificable.');
  return {
    id,
    tipo,
    codigo: fila.codigo ?? fila.venta_codigo ?? String(id),
    estado: fila.estado,
    total: fila.total ?? fila.monto_total ?? 0,
    fecha: fila.fecha_venta ?? fila.fecha_reserva ?? fila.fecha_creacion ?? '',
    sucursal: fila.sucursal_id,
    detalles: fila.detalles,
  };
}

@Service()
export class OfflineService {
  private readonly auth = inject(AuthService);
  private readonly empresa = inject(EmpresaContextoService);
  private readonly http = inject(HttpClient);
  private readonly db = inject(OfflineDb);
  private readonly router = inject(Router);
  private readonly cambios = inject(CambioContextoService);
  private readonly sw = inject(SwUpdate, { optional: true });
  private abierta?: AccesoAbierto;
  private revision = 0;
  private ultimaActividad = Date.now();
  private intentoDesbloqueo = 0;
  private descargando?: Promise<void>;

  readonly soportado =
    globalThis.isSecureContext === true && !!globalThis.indexedDB && !!globalThis.crypto?.subtle;
  readonly identidad = signal<IdentidadOffline | null>(null);
  readonly copia = signal<DescargaOffline | null>(null);
  readonly operaciones = signal<OperacionOffline[]>([]);
  readonly ocupada = signal(false);
  readonly mensaje = signal('');
  readonly conectado = signal(navigator.onLine);
  readonly accesoGuardado = signal(!!localStorage.getItem(ACCESO_OFFLINE));
  private readonly interfazGuardada = signal(false);
  readonly listaOffline = computed(() => this.interfazGuardada() && this.copia() !== null);
  readonly actualizacion = signal(false);
  readonly usuario = this.auth.usuarioActual;
  readonly puedeActivar = computed(
    () => this.soportado && !!this.usuario()?.empresa_id && rolesOffline(this.usuario()!.roles),
  );
  readonly puedeVender = computed(
    () => this.identidad()?.roles.some((rol) => ROLES_VENTA.includes(rol)) ?? false,
  );
  readonly puedeReservar = computed(
    () => !this.puedeVender() && !!this.identidad()?.roles.includes('CLIENTE'),
  );

  constructor() {
    this.cambios.cambio$.subscribe(() => this.cerrarMemoria());
    this.sw?.versionUpdates.subscribe((evento) => {
      if (evento.type === 'VERSION_READY') this.actualizacion.set(true);
    });
    if (this.sw?.isEnabled && typeof caches !== 'undefined') {
      // El Service Worker guarda este recurso después de precargar la interfaz.
      timer(0, 1500)
        .pipe(
          filter(() => !!navigator.serviceWorker.controller),
          switchMap(() =>
            caches.match('/pwa-lista.txt', { ignoreVary: true }).catch(() => undefined),
          ),
          filter((respuesta) => respuesta?.ok === true),
          take(1),
        )
        .subscribe(() => this.interfazGuardada.set(true));
    }
    window.addEventListener('online', () => {
      this.conectado.set(true);
      if (this.abierta) void this.sincronizar();
    });
    window.addEventListener('offline', () => this.conectado.set(false));
    window.addEventListener('storage', (evento) => {
      if (
        evento.key === ACCESO_OFFLINE ||
        evento.key === CIERRE_COMPARTIDO ||
        evento.key === null
      ) {
        this.accesoGuardado.set(!!localStorage.getItem(ACCESO_OFFLINE));
        if (this.abierta && localStorage.getItem(ACCESO_OFFLINE) !== this.abierta.ambito)
          this.cerrarMemoria();
      }
    });
    if (this.soportado) {
      effect(() => {
        if (this.usuario()) this.ultimaActividad = Date.now();
      });
      const actividad = () => {
        this.ultimaActividad = Date.now();
      };
      window.addEventListener('pointerdown', actividad);
      window.addEventListener('keydown', actividad);
      window.setInterval(() => {
        const sesionCompartida =
          this.auth.estaAutenticado() && localStorage.getItem(EQUIPO_COMPARTIDO) === '1';
        if (
          (this.abierta && Date.now() >= this.abierta.identidad.vence) ||
          ((this.abierta || sesionCompartida) && Date.now() - this.ultimaActividad >= INACTIVIDAD)
        ) {
          this.bloquear();
        } else if (
          this.abierta &&
          this.conectado() &&
          this.auth.estaAutenticado() &&
          this.operaciones().some((op) => op.estado === 'Pendiente')
        ) {
          void this.sincronizar(false, false);
        }
      }, 30_000);
    }
  }

  async habilitar(frase: string): Promise<void> {
    const usuario = this.usuario();
    if (!usuario?.empresa_id || !usuario.empresa_codigo || !this.puedeActivar()) {
      throw new Error('Inicia sesión en una empresa con permisos de operación.');
    }
    if (this.empresa.empresa()?.id !== usuario.empresa_id || this.empresa.empresa()?.codigo !== usuario.empresa_codigo) {
      await firstValueFrom(this.empresa.restaurar(usuario.empresa_codigo));
    }
    const revision = this.revision;
    const perfil = await this.verificarPerfil(revision);
    this.comprobar(revision);
    if (
      perfil.id !== usuario.id ||
      perfil.empresa_id !== usuario.empresa_id ||
      !rolesOffline(perfil.roles)
    ) {
      throw new Error('Tu cuenta ya no tiene acceso a estas operaciones.');
    }
    const ambito = `${usuario.empresa_id}:${usuario.id}`;
    let cuenta = await this.db.cuenta(ambito);
    if (!cuenta) {
      cuenta = await crearCuenta(ambito, frase);
      this.comprobar(revision);
      try {
        await this.db.agregarCuenta(cuenta);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'ConstraintError') throw error;
        cuenta = await this.db.cuenta(ambito);
        if (!cuenta) throw error;
      }
    }
    const clave = await this.abrirConFrase(cuenta, frase);
    const identidad: IdentidadOffline = {
      usuario: usuario.id,
      empresa: usuario.empresa_id,
      codigo: usuario.empresa_codigo,
      roles: perfil.roles,
      vence: Date.now() + VIGENCIA,
    };
    this.comprobar(revision);
    const anterior = await this.db.leer('accesos', ambito);
    if (anterior) {
      const previo = await abrir<IdentidadOffline>(clave, `acceso:${ambito}`, anterior);
      if (!this.mismosRoles(previo.roles, identidad.roles)) {
        await this.db.guardar(
          'descargas',
          ambito,
          await sellar(clave, `descarga:${ambito}`, {
            fecha: 0,
            sucursales: [],
            catalogo: {},
            posventa: await this.obtener<DescargaCambios>('/posventa/cambios/offline/descarga'),
            historial: [],
          } satisfies DescargaOffline),
        );
      }
    }
    await this.db.guardar('accesos', ambito, await sellar(clave, `acceso:${ambito}`, identidad));
    this.comprobar(revision);
    this.auth.activarEquipoCompartido();
    localStorage.setItem(ACCESO_OFFLINE, ambito);
    this.accesoGuardado.set(true);
    await this.publicar({ ambito, clave, identidad }, revision);
    await this.sincronizar();
  }

  async desbloquear(frase: string): Promise<void> {
    const ambito = localStorage.getItem(ACCESO_OFFLINE);
    if (!ambito || this.auth.estaAutenticado())
      throw new Error('Inicia sesión para habilitar el acceso local.');
    if (Date.now() < this.intentoDesbloqueo)
      throw new Error('Espera un momento antes de volver a intentar.');
    this.intentoDesbloqueo = Date.now() + 1500;
    const revision = this.revision;
    const cuenta = await this.db.cuenta(ambito);
    const sobre = await this.db.leer('accesos', ambito);
    if (!cuenta || !sobre) throw new Error('Inicia sesión para volver a preparar el acceso local.');
    const clave = await this.abrirConFrase(cuenta, frase);
    const identidad = await abrir<IdentidadOffline>(clave, `acceso:${ambito}`, sobre);
    if (identidad.vence <= Date.now())
      throw new Error('El acceso local venció. Conéctate e inicia sesión.');
    this.comprobar(revision);
    if (localStorage.getItem(ACCESO_OFFLINE) !== ambito)
      throw new Error('El acceso local se cerró.');
    await this.publicar({ ambito, clave, identidad }, revision);
  }

  private async abrirConFrase(cuenta: CuentaOffline, frase: string) {
    try {
      return await abrirCuenta(cuenta, frase);
    } catch {
      throw new Error('La frase de acceso no es correcta.');
    }
  }

  bloquear(): void {
    this.cerrarMemoria();
    this.auth.pausarSesionCompartida();
    void this.router.navigateByUrl('/empresa');
  }

  private cerrarMemoria(): void {
    this.revision++;
    this.abierta = undefined;
    this.identidad.set(null);
    this.copia.set(null);
    this.operaciones.set([]);
    this.mensaje.set('');
    this.accesoGuardado.set(!!localStorage.getItem(ACCESO_OFFLINE));
  }

  private async publicar(acceso: AccesoAbierto, revision: number): Promise<void> {
    const sobre = await this.db.leer('descargas', acceso.ambito);
    const copia = sobre
      ? await abrir<DescargaOffline>(acceso.clave, `descarga:${acceso.ambito}`, sobre)
      : null;
    const operaciones = await this.leerCola(acceso);
    this.comprobar(revision);
    this.abierta = acceso;
    this.ultimaActividad = Date.now();
    this.identidad.set(acceso.identidad);
    this.copia.set(copia?.fecha ? copia : null);
    this.operaciones.set(operaciones);
  }

  async registrar(operacion: OperacionOffline): Promise<void> {
    const acceso = this.requerir();
    const revision = this.revision;
    if (
      !this.copia()?.sucursales.some((s) => s.id === operacion.sucursal) ||
      (['VENTA', 'REVISION_CAMBIO', 'ENTREGA_CAMBIO'].includes(operacion.tipo)
        ? !this.puedeVender()
        : !this.puedeReservar())
    ) {
      throw new Error('La sucursal o la operación no está autorizada.');
    }
    const contenido = await sellar(acceso.clave, this.etiqueta(acceso, operacion.uuid), operacion);
    this.comprobar(revision);
    await this.db.encolar({
      ambito: acceso.ambito,
      uuid: operacion.uuid,
      orden: operacion.fecha,
      contenido,
      intentos: 0,
      siguiente: 0,
    });
    await this.actualizarCola(acceso, revision);
    if (this.conectado() && this.auth.estaAutenticado()) void this.sincronizar();
  }

  async actualizarCompra(
    uuid: string,
    cambios: Partial<HistorialOffline>,
    recotizar = false,
  ): Promise<void> {
    const acceso = this.requerir();
    const revision = this.revision;
    const fila = await this.db.reclamar(acceso.ambito, uuid, crypto.randomUUID(), true);
    if (!fila) throw new Error('La compra está sincronizando. Inténtalo nuevamente.');
    const op = await abrir<OperacionOffline>(
      acceso.clave,
      this.etiqueta(acceso, uuid),
      fila.contenido,
    );
    this.comprobar(revision);
    if (op.tipo !== 'COMPRA') throw new Error('Operación inválida.');
    if (recotizar) {
      if (op.resultado?.orden_id)
        throw new Error('Consulta o cancela el pago existente en Mis pagos.');
      op.estado = 'Pendiente';
      op.resultado = undefined;
    } else if (op.resultado) op.resultado = { ...op.resultado, ...cambios };
    await this.db.resultado(fila, await sellar(acceso.clave, this.etiqueta(acceso, uuid), op));
    await this.actualizarCola(acceso, revision);
    if (recotizar) await this.sincronizar(true);
  }

  async registrarDevolucion(uuid: string): Promise<void> {
    const acceso = this.requerir();
    const revision = this.revision;
    const fila = await this.db.reclamar(acceso.ambito, uuid, crypto.randomUUID(), true);
    if (!fila) return;
    const operacion = await abrir<OperacionOffline>(
      acceso.clave,
      this.etiqueta(acceso, uuid),
      fila.contenido,
    );
    this.comprobar(revision);
    if (
      operacion.tipo === 'VENTA' &&
      ['En conflicto', 'Rechazada'].includes(operacion.estado) &&
      !operacion.efectivoDevuelto
    )
      operacion.efectivoDevuelto = Date.now();
    await this.db.resultado(
      fila,
      await sellar(acceso.clave, this.etiqueta(acceso, uuid), operacion),
      fila.siguiente,
    );
    await this.actualizarCola(acceso, revision);
  }

  sincronizar(manual = false, descargar = true): Promise<void> {
    if (this.descargando) return this.descargando;
    if (!this.abierta || !this.auth.estaAutenticado() || !this.conectado()) {
      if (manual)
        this.mensaje.set('Conéctate e inicia sesión con la misma cuenta para sincronizar.');
      return Promise.resolve();
    }
    if (
      this.abierta.identidad.vence <= Date.now() ||
      localStorage.getItem(ACCESO_OFFLINE) !== this.abierta.ambito
    ) {
      this.bloquear();
      return Promise.resolve();
    }
    const revision = this.revision;
    this.ocupada.set(true);
    this.descargando = this.enviar(this.abierta, revision, manual, descargar)
      .catch((error: unknown) => {
        if (revision === this.revision) {
          this.mensaje.set(
            mensajeApi(
              error,
              'La sincronización quedó pendiente. Revisa la conexión e inténtalo otra vez.',
            ),
          );
        }
      })
      .finally(() => {
        this.ocupada.set(false);
        this.descargando = undefined;
      });
    return this.descargando;
  }

  private async enviar(
    acceso: AccesoAbierto,
    revision: number,
    manual: boolean,
    descargar: boolean,
  ) {
    const perfil = await this.verificarPerfil(revision);
    this.comprobar(revision);
    if (
      perfil.id !== acceso.identidad.usuario ||
      perfil.empresa_id !== acceso.identidad.empresa ||
      !this.mismosRoles(perfil.roles, acceso.identidad.roles)
    ) {
      this.auth.limpiarSesion();
      void this.router.navigateByUrl('/empresa');
      return;
    }
    const sucursales = await this.obtener<SucursalOffline[]>('/operacion-movil/sucursales');
    this.comprobar(revision);
    const ids = new Set(sucursales.map((s) => s.id));
    const previa = this.copia();
    if (previa && previa.sucursales.some((s) => !ids.has(s.id))) {
      await this.guardarCopia(acceso, revision, {
        ...previa,
        sucursales: previa.sucursales.filter((s) => ids.has(s.id)),
        catalogo: Object.fromEntries(
          Object.entries(previa.catalogo).filter(([id]) => ids.has(Number(id))),
        ),
        posventa: previa.posventa
          ? {
              ...previa.posventa,
              ventas: previa.posventa.ventas.filter((v) => ids.has(v.sucursal_id)),
              cambios: previa.posventa.cambios.filter((c) => ids.has(c.original.sucursal_id)),
            }
          : undefined,
        historial: previa.historial.filter((h) => h.sucursal !== undefined && ids.has(h.sucursal)),
      });
    }
    const cola = (await this.db.cola(acceso.ambito)).sort((a, b) => a.orden - b.orden);
    for (const original of cola) {
      const etiqueta = this.etiqueta(acceso, original.uuid);
      const operacion = await abrir<OperacionOffline>(acceso.clave, etiqueta, original.contenido);
      if (operacion.estado !== 'Pendiente') continue;
      this.comprobar(revision);
      const fila = await this.db.reclamar(
        acceso.ambito,
        original.uuid,
        crypto.randomUUID(),
        manual,
      );
      if (!fila) continue;
      try {
        this.comprobar(revision);
        // Una pestaña puede haber terminado la operación antes de que este reclamo se adquiriera.
        const vigente = await abrir<OperacionOffline>(acceso.clave, etiqueta, fila.contenido);
        this.comprobar(revision);
        if (vigente.estado !== 'Pendiente') {
          await this.db.resultado(fila, fila.contenido);
          continue;
        }
        if (!ids.has(vigente.sucursal)) {
          vigente.estado = 'Rechazada';
          vigente.motivo = 'La sucursal ya no está autorizada para esta cuenta.';
        } else {
          try {
            const esVenta = vigente.tipo === 'VENTA';
            const respuesta = await firstValueFrom(
              this.http
                .request<FilaRemota>(
                  vigente.tipo === 'REVISION_CAMBIO' ? 'PATCH' : 'POST',
                  `${API}${vigente.tipo === 'COMPRA' ? '/pagos/offline/cotizar' : vigente.tipo === 'CAMBIO' ? '/posventa/cambios' : vigente.tipo === 'ENTREGA_CAMBIO' ? '/posventa/cambios/' + String(vigente.datosCambio?.['id']) + '/completar' : vigente.tipo === 'REVISION_CAMBIO' ? '/posventa/cambios/' + String(vigente.datosCambio?.['id']) + '/revision' : '/' + (esVenta ? 'ventas-presenciales' : 'reservas') + '/offline'}`,
                  {
                    body: vigente.datosCambio
                      ? {
                          ...Object.fromEntries(
                            Object.entries(vigente.datosCambio).filter(([k]) => k !== 'id'),
                          ),
                          ...(vigente.tipo === 'CAMBIO' ? { clave_operacion: vigente.uuid } : {}),
                        }
                      : {
                          clave_operacion: vigente.uuid,
                          sucursal_id: vigente.sucursal,
                          items:
                            esVenta || vigente.tipo === 'COMPRA'
                              ? vigente.lineas
                              : vigente.lineas.map(({ producto_variante_id, cantidad }) => ({
                                  producto_variante_id,
                                  cantidad,
                                })),
                          ...(esVenta
                            ? { metodo_pago: 'EFECTIVO', efectivo_centavos: vigente.efectivo }
                            : vigente.tipo === 'COMPRA'
                              ? {}
                              : { fecha_cita: vigente.fechaCita }),
                        },
                  },
                )
                .pipe(timeout(25_000)),
            );
            vigente.resultado = {
              ...historial(vigente.tipo, respuesta),
              items: (respuesta as FilaRemota & { items?: OperacionOffline['lineas'] }).items,
            };
            if (vigente.tipo === 'COMPRA')
              vigente.motivo =
                'Cotización actualizada. Revisa el total y continúa al pago; todavía no es una venta.';
            vigente.estado = 'Confirmada';
            if (vigente.tipo !== 'COMPRA') vigente.motivo = undefined;
          } catch (error) {
            if (!(error instanceof HttpErrorResponse) || ![400, 409, 422].includes(error.status))
              throw error;
            vigente.estado = error.status === 422 ? 'Rechazada' : 'En conflicto';
            vigente.motivo = mensajeApi(error);
          }
        }
        this.comprobar(revision);
        await this.db.resultado(fila, await sellar(acceso.clave, etiqueta, vigente));
      } catch (error) {
        await this.db.resultado(
          fila,
          fila.contenido,
          Date.now() + Math.min(300_000, 5000 * 2 ** Math.min(fila.intentos, 6)),
        );
        throw error;
      } finally {
        if (revision === this.revision) await this.actualizarCola(acceso, revision);
      }
    }
    this.comprobar(revision);
    if (!descargar && cola.length === 0) return;
    const catalogo: DescargaOffline['catalogo'] = {};
    for (const sucursal of sucursales) {
      const items: VarianteOffline[] = [];
      let cursor: number | null = 0;
      while (cursor !== null && items.length < 1000) {
        this.comprobar(revision);
        const pagina: { items: VarianteOffline[]; siguiente: number | null } = await this.obtener(
          `/operacion-movil/catalogo?sucursal_id=${sucursal.id}&desde=${cursor}`,
        );
        items.push(...pagina.items);
        cursor = pagina.siguiente;
      }
      catalogo[sucursal.id] = items;
    }
    const personal = acceso.identidad.roles.some((rol) => ROLES_VENTA.includes(rol));
    const reservas = await this.obtener<FilaRemota[]>(
      personal
        ? '/reservas?limite=30&incluir_finalizadas=true'
        : '/reservas/mis-reservas?limite=30',
    );
    this.comprobar(revision);
    const otras = await this.obtener<FilaRemota[]>(
      personal ? '/ventas-presenciales?limite=30' : '/pagos/mis-pagos?limite=30',
    );
    await this.guardarCopia(acceso, revision, {
      fecha: Date.now(),
      sucursales,
      catalogo,
      posventa: await this.obtener<DescargaCambios>('/posventa/cambios/offline/descarga'),
      historial: [
        ...reservas.map((fila) => historial('RESERVA', fila)),
        ...otras.map((fila) => historial(personal ? 'VENTA' : 'PAGO', fila)),
      ],
    });
    this.comprobar(revision);
    const identidad = { ...acceso.identidad, vence: Date.now() + VIGENCIA };
    const sobre = await sellar(acceso.clave, `acceso:${acceso.ambito}`, identidad);
    this.comprobar(revision);
    await this.db.guardar('accesos', acceso.ambito, sobre);
    this.comprobar(revision);
    acceso.identidad = identidad;
    this.identidad.set(identidad);
    this.mensaje.set('Sincronización al día.');
  }

  private obtener<T>(ruta: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${API}${ruta}`).pipe(timeout(25_000)));
  }

  private async verificarPerfil(revision: number): Promise<PerfilResponse> {
    try {
      return await this.obtener<PerfilResponse>('/perfil');
    } catch (error) {
      if (
        revision === this.revision &&
        error instanceof HttpErrorResponse &&
        [401, 403].includes(error.status)
      ) {
        this.auth.limpiarSesion();
        void this.router.navigateByUrl('/empresa');
      }
      throw error;
    }
  }

  private mismosRoles(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((rol) => b.includes(rol));
  }

  private etiqueta(acceso: AccesoAbierto, uuid: string): string {
    return `operacion:${acceso.ambito}:${uuid}`;
  }

  private async guardarCopia(acceso: AccesoAbierto, revision: number, copia: DescargaOffline) {
    const sobre = await sellar(acceso.clave, `descarga:${acceso.ambito}`, copia);
    this.comprobar(revision);
    await this.db.guardar('descargas', acceso.ambito, sobre);
    this.comprobar(revision);
    this.copia.set(copia);
  }

  private async leerCola(acceso: AccesoAbierto): Promise<OperacionOffline[]> {
    const filas = await this.db.cola(acceso.ambito);
    return Promise.all(
      filas
        .sort((a, b) => b.orden - a.orden)
        .map((fila) =>
          abrir<OperacionOffline>(acceso.clave, this.etiqueta(acceso, fila.uuid), fila.contenido),
        ),
    );
  }

  private async actualizarCola(acceso: AccesoAbierto, revision: number): Promise<void> {
    const operaciones = await this.leerCola(acceso);
    this.comprobar(revision);
    this.operaciones.set(operaciones);
  }

  private comprobar(revision: number): void {
    if (revision !== this.revision) throw new Error('La cuenta activa cambió.');
  }

  private requerir(): AccesoAbierto {
    if (
      !this.abierta ||
      this.abierta.identidad.vence <= Date.now() ||
      localStorage.getItem(ACCESO_OFFLINE) !== this.abierta.ambito
    ) {
      throw new Error('El acceso local está bloqueado o venció.');
    }
    return this.abierta;
  }
}
