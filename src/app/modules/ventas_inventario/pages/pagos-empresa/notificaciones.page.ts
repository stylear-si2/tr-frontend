import { Component, DestroyRef, inject, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, Observable } from 'rxjs';
import { CambioContextoService } from '../../../../core/services/cambio-contexto.service';
import { mensajeApi } from '../../../../core/services/error-api';
import { PagoService } from '../../services/pago.service';
import {
  CATEGORIAS_NOTIFICACION,
  CategoriaNotificacion,
  NotificacionPropia,
  EstadoNotificacion,
  rutaNotificacion,
} from '../../models/pago.models';

@Component({
  selector: 'app-notificaciones',
  imports: [DatePipe],
  templateUrl: './notificaciones.page.html',
  styleUrl: './notificaciones.page.css',
})
export class NotificacionesPage {
  private readonly api = inject(PagoService);
  private readonly destroy = inject(DestroyRef);
  private readonly cambios = inject(CambioContextoService);
  private readonly router = inject(Router);
  protected readonly categorias = CATEGORIAS_NOTIFICACION;
  protected readonly tipoAviso: Record<CategoriaNotificacion, { nombre: string; icono: string }> = {
    GENERAL: { nombre: 'General', icono: 'pi-bell' },
    COMPRA: { nombre: 'Compra', icono: 'pi-shopping-bag' },
    PAGO: { nombre: 'Pago', icono: 'pi-credit-card' },
    RESERVA: { nombre: 'Reserva', icono: 'pi-calendar' },
    ENTREGA: { nombre: 'Entrega', icono: 'pi-truck' },
    CAMBIO: { nombre: 'Cambio', icono: 'pi-arrow-right-arrow-left' },
    DEVOLUCION: { nombre: 'Devolución', icono: 'pi-replay' },
    REEMBOLSO: { nombre: 'Reembolso', icono: 'pi-wallet' },
  };
  protected readonly notas = signal<NotificacionPropia[]>([]);
  protected readonly cargando = signal(false);
  protected readonly ocupado = signal(false);
  protected readonly error = signal('');
  protected readonly aviso = signal('');
  protected readonly pagina = signal(1);
  protected readonly total = signal(0);
  protected readonly noLeidas = signal(0);
  protected readonly paginas = computed(() => Math.max(1, Math.ceil(this.total() / 20)));
  protected readonly leida = signal<boolean | null>(null);
  protected readonly categoria = signal<CategoriaNotificacion | null>(null);
  protected readonly preferencias = signal<Partial<Record<CategoriaNotificacion, boolean>> | null>(
    null,
  );
  private originales: Partial<Record<CategoriaNotificacion, boolean>> = {};
  protected readonly estado = signal<{ id: number; datos: EstadoNotificacion } | null>(null);
  private revision = 0;
  constructor() {
    this.cambios.cambio$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.revision++;
      this.notas.set([]);
      this.preferencias.set(null);
      this.originales = {};
      this.estado.set(null);
      this.noLeidas.set(0);
      this.total.set(0);
      this.error.set('');
      this.aviso.set('');
      this.ocupado.set(false);
    });
    this.cargar();
  }
  protected cargar(pagina = this.pagina()): void {
    const revision = ++this.revision;
    this.cargando.set(true);
    this.error.set('');
    this.api
      .bandejaNotificaciones(pagina, this.leida(), this.categoria())
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          if (revision === this.revision) this.cargando.set(false);
        }),
      )
      .subscribe({
        next: (r) => {
          if (revision !== this.revision) return;
          this.noLeidas.set(r.no_leidas);
          this.total.set(r.total);
          const ultima = Math.max(1, Math.ceil(r.total / 20));
          if (pagina > ultima) {
            this.cargar(ultima);
            return;
          }
          this.pagina.set(r.pagina);
          this.notas.set(r.avisos);
        },
        error: (e) => {
          if (revision === this.revision) this.error.set(mensajeApi(e));
        },
      });
  }
  protected filtrar(campo: 'leida' | 'categoria', e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (campo === 'leida') this.leida.set(v === '' ? null : v === 'true');
    else this.categoria.set(v === '' ? null : (v as CategoriaNotificacion));
    this.cargar(1);
  }
  private operar<T>(solicitud: Observable<T>, siguiente: (r: T) => void): void {
    if (this.ocupado()) return;
    const gen = this.cambios.generacion();
    this.ocupado.set(true);
    this.error.set('');
    solicitud
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          if (gen === this.cambios.generacion()) this.ocupado.set(false);
        }),
      )
      .subscribe({
        next: (r) => {
          if (gen === this.cambios.generacion()) siguiente(r);
        },
        error: (e) => {
          if (gen === this.cambios.generacion()) this.error.set(mensajeApi(e));
        },
      });
  }
  protected leer(n: NotificacionPropia): void {
    this.operar(this.api.leerNotificacion(n.id), () => {
      this.estado.set(null);
      this.cargar();
    });
  }
  protected todas(): void {
    this.operar(this.api.leerTodasNotificaciones(), () => {
      this.estado.set(null);
      this.cargar();
      this.aviso.set(
        'Se marcaron como leídas todas las notificaciones de tu cuenta, incluidos otros filtros y páginas.',
      );
    });
  }
  protected verPreferencias(): void {
    this.operar(this.api.preferenciasNotificaciones(), (p) => {
      this.originales = { ...p.categorias };
      this.preferencias.set({ ...p.categorias });
    });
  }
  protected cambiarPreferencia(c: CategoriaNotificacion, e: Event): void {
    this.preferencias.update((p) => ({ ...p, [c]: (e.target as HTMLInputElement).checked }));
  }
  protected guardarPreferencias(): void {
    const p = this.preferencias();
    if (!p) return;
    const cambios = Object.fromEntries(
      this.categorias.filter((c) => p[c] !== this.originales[c]).map((c) => [c, p[c]]),
    );
    this.operar(this.api.guardarPreferenciasNotificaciones(cambios), (r) => {
      this.originales = { ...r.categorias };
      this.preferencias.set({ ...r.categorias });
      this.aviso.set('Preferencias guardadas. La bandeja conserva todas las actualizaciones.');
    });
  }
  protected trazabilidad(n: NotificacionPropia): void {
    if (this.estado()?.id === n.id) {
      this.estado.set(null);
      return;
    }
    this.operar(this.api.estadoNotificacion(n.id), (datos) => this.estado.set({ id: n.id, datos }));
  }
  protected abrir(n: NotificacionPropia): void {
    this.operar(this.api.destinoNotificacion(n.id), (d) => {
      const ruta = rutaNotificacion(d);
      if (!ruta) {
        this.aviso.set(
          d.recurso_tipo === 'VENTA'
            ? 'Esta actualización corresponde a una compra. Puedes consultar su información en la bandeja; no se abrirá otro pago.'
            : 'El recurso ya no está disponible para esta cuenta. Puedes consultar la actualización en la bandeja.',
        );
        return;
      }
      this.router.navigate([ruta], {
        queryParams: ['CAMBIO', 'DEVOLUCION'].includes(d.recurso_tipo ?? '')
          ? { seleccion: d.recurso_id }
          : undefined,
      });
      if (!n.leida)
        this.api
          .leerNotificacion(n.id)
          .pipe(takeUntilDestroyed(this.destroy))
          .subscribe({ next: () => this.cargar(), error: () => {} });
    });
  }
}
