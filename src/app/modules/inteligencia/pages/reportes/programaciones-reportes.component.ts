import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize, Observable } from 'rxjs';
import {
  ReporteCatalogo,
  ReporteProgramado,
  ReporteEjecucion,
  ProgramadoDatos,
  TipoReporte,
} from '../../models/reporte.models';
import { ReportesService } from '../../services/reportes.service';
import { EstadoPlanService } from '../../../../core/services/estado-plan.service';
import { CambioContextoService } from '../../../../core/services/cambio-contexto.service';
import { FocoService } from '../../../../core/services/foco.service';
import { mensajeApi } from '../../../../core/services/error-api';
const texto = (valor = '', requerido = false) =>
  new FormControl(valor, { nonNullable: true, validators: requerido ? [Validators.required] : [] });
@Component({
  selector: 'app-programaciones-reportes',
  imports: [ReactiveFormsModule, DatePipe],
  styleUrl: '../../../administracion/pages/saas/saas.css',
  template: ` <section class="panel">
    <h2>Programación de reportes</h2>
    <p>
      Los envíos usan el transporte de correo configurado. Consulta su resultado e historial; el
      destinatario efectivo puede estar fijado en el servidor.
    </p>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (aviso()) {
      <p role="status">{{ aviso() }}</p>
    }
    <button type="button" class="secundario" (click)="cargar()" [disabled]="ocupado()">
      Actualizar programaciones
    </button>
    @if (!plan.habilita('reportes_programacion')) {
      <p class="aviso">
        {{ plan.motivo('reportes_programacion') }} Puedes consultar el historial y pausar
        programaciones.
      </p>
    }
    @for (p of items(); track p.id) {
      <article class="panel">
        <h3>{{ p.titulo }}</h3>
        <p>
          {{ p.activo ? 'Activa' : 'Pausada' }} · {{ p.frecuencia }} · {{ p.hora }} ·
          {{ p.zona_horaria }} · {{ p.periodo }} · {{ p.formato }}
        </p>
        <p>
          {{ p.destinatario_email }} · Próxima:
          {{ p.proxima_ejecucion | date: 'dd/MM/yyyy HH:mm' }} · {{ p.motivo_pausa }}
        </p>
        <div class="acciones">
          <button
            type="button"
            class="secundario"
            (click)="editar(p)"
            [disabled]="ocupado() || !plan.habilita('reportes_programacion')"
          >
            Editar {{ p.titulo }}
          </button>
          <button
            type="button"
            class="secundario"
            (click)="estado(p)"
            [disabled]="ocupado() || (!p.activo && !puedeActivar(p))"
          >
            {{ p.activo ? 'Pausar' : 'Activar' }} {{ p.titulo }}
          </button>
          <button
            type="button"
            (click)="ejecutar(p)"
            [disabled]="ocupado() || !p.activo || bloqueados().has(p.id) || !puedeEjecutar(p)"
          >
            Ejecutar {{ p.titulo }}
          </button>
          <button type="button" class="secundario" (click)="verHistorial(p)" [disabled]="ocupado()">
            Historial {{ p.titulo }}
          </button>
          <button type="button" class="peligro" (click)="eliminar(p)" [disabled]="ocupado()">
            Eliminar {{ p.titulo }}
          </button>
        </div>
      </article>
    } @empty {
      <p>No hay programaciones.</p>
    }
    @if (historial(); as h) {
      <section>
        <h3 id="historial-reportes" tabindex="-1">Historial de {{ tituloHistorial() }}</h3>
        <p>INICIADO o FALLIDO puede dejar incierta la entrega. No se reenvía automáticamente.</p>
        <ul>
          @for (e of h; track e.id) {
            <li>
              {{ e.estado }} · {{ e.iniciado_en | date: 'dd/MM/yyyy HH:mm' }} · {{ e.detalle }}
            </li>
          } @empty {
            <li>Sin ejecuciones.</li>
          }
        </ul>
        @if (historialId() !== null && bloqueados().has(historialId()!)) {
          <button type="button" class="secundario" (click)="autorizarReintento()">
            Permitir otra ejecución tras revisar
          </button>
        }
      </section>
    }
    <h3 id="programado-editor" tabindex="-1">
      {{ edicion() ? 'Editar programación' : 'Nueva programación' }}
    </h3>
    <form [formGroup]="form" (ngSubmit)="guardar()">
      <fieldset [disabled]="ocupado() || !plan.habilita('reportes_programacion')">
        <legend>Configuración del envío</legend>
        <div class="grid">
          <label for="prog-titulo"
            >Título<input
              id="prog-titulo"
              formControlName="titulo"
              minlength="3"
              maxlength="150"
              required
          /></label>
          <label for="prog-tipo"
            >Tipo<select id="prog-tipo" formControlName="tipo">
              @for (t of catalogo().tipos; track t.id) {
                <option [value]="t.id">{{ t.nombre }}</option>
              }
            </select></label
          >
          <label for="prog-sucursal"
            >Sucursal<select id="prog-sucursal" formControlName="sucursal_id">
              <option [ngValue]="null">Todas</option>
              @for (s of catalogo().sucursales; track s.id) {
                <option [ngValue]="s.id">{{ s.nombre }}</option>
              }
            </select></label
          >
          <label for="prog-frecuencia"
            >Frecuencia<select id="prog-frecuencia" formControlName="frecuencia">
              <option value="DIARIA">Diaria</option>
              <option value="SEMANAL">Semanal</option>
              <option value="MENSUAL">Mensual</option>
            </select></label
          >
          <label for="prog-dia"
            >Día (LUNES a DOMINGO o 1 a 31)<input
              id="prog-dia"
              formControlName="dia"
              maxlength="20"
            /><small
              >Diaria no usa día; en meses cortos el servidor ajusta al último día.</small
            ></label
          >
          <label for="prog-hora"
            >Hora<input id="prog-hora" type="time" formControlName="hora" required
          /></label>
          <label for="prog-zona"
            >Zona horaria<input
              id="prog-zona"
              formControlName="zona_horaria"
              maxlength="80"
              required
          /></label>
          <label for="prog-periodo"
            >Período<select id="prog-periodo" formControlName="periodo">
              <option value="SEGUN_FRECUENCIA">Según frecuencia</option>
              <option value="DIA_ANTERIOR">Día anterior</option>
              <option value="SEMANA_ANTERIOR">Semana anterior</option>
              <option value="MES_ANTERIOR">Mes anterior</option>
            </select></label
          >
          <label for="prog-formato"
            >Formato<select id="prog-formato" formControlName="formato">
              <option value="PDF" [disabled]="!plan.habilita('reportes_pdf')">PDF</option>
              <option value="EXCEL" [disabled]="!plan.habilita('reportes_excel')">Excel</option>
            </select></label
          >
          <label for="prog-correo"
            >Correo destinatario<input
              id="prog-correo"
              type="email"
              formControlName="destinatario_email"
              maxlength="200"
              required
          /></label>
          <label class="check"
            ><input type="checkbox" formControlName="solo_bajo_stock" />Solo bajo stock</label
          ><label class="check"
            ><input type="checkbox" formControlName="activo" />Programación activa</label
          >
          <label for="prog-agrupacion"
            >Agrupación<select id="prog-agrupacion" formControlName="agrupacion">
              <option value="DIA">Día</option>
              <option value="SEMANA">Semana</option><option value="MES">Mes</option>
            </select></label
          >
          <label for="prog-estado"
            >Estado del reporte<input
              id="prog-estado"
              formControlName="estado"
              maxlength="40" /></label
          ><label for="prog-metodo"
            >Método de pago<input
              id="prog-metodo"
              formControlName="metodo_pago"
              maxlength="40" /></label
          ><label for="prog-proveedor"
            >Proveedor de pago<input
              id="prog-proveedor"
              formControlName="proveedor_pago"
              maxlength="40"
          /></label>
          <label for="prog-entrega"
            >Entrega<select id="prog-entrega" formControlName="tipo_entrega">
              <option value="">Todas</option>
              <option value="RECOJO_SUCURSAL">Recojo</option>
              <option value="DELIVERY">Delivery</option>
            </select></label
          >
          <label for="prog-canal"
            >Canal<select id="prog-canal" formControlName="tipo_venta">
              <option value="">Todos</option>
              <option value="PRESENCIAL">Presencial</option>
              <option value="DIGITAL">Digital</option>
            </select></label
          >
          <label for="prog-rol"
            >Rol para reporte de usuarios<input id="prog-rol" formControlName="rol" maxlength="80"
          /></label>
          <label for="prog-cuentas"
            >Estado de cuentas<select id="prog-cuentas" formControlName="cuentas">
              <option value="">Todos</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select></label
          >
        </div>
        <button [disabled]="form.invalid || conflicto()">Guardar programación</button>
      </fieldset>
      @if (conflicto()) {
        <p class="aviso">
          La revisión cambió. Conservamos el formulario; revisa la versión vigente antes de guardar.
        </p>
        <button type="button" (click)="actualizarRevision()" [disabled]="ocupado()">
          Revisar versión vigente
        </button>
      }
      <button type="button" class="secundario" (click)="nuevo()" [disabled]="ocupado()">
        Cancelar edición
      </button>
    </form>
  </section>`,
})
export class ProgramacionesReportesComponent {
  readonly catalogo = input.required<ReporteCatalogo>();
  protected readonly plan = inject(EstadoPlanService);
  private readonly api = inject(ReportesService);
  private readonly destroy = inject(DestroyRef);
  private readonly foco = inject(FocoService);
  protected readonly items = signal<ReporteProgramado[]>([]);
  protected readonly edicion = signal<ReporteProgramado | null>(null);
  protected readonly historial = signal<ReporteEjecucion[] | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly error = signal('');
  protected readonly aviso = signal('');
  protected readonly conflicto = signal(false);
  protected readonly bloqueados = signal(new Set<number>());
  protected readonly tituloHistorial = signal('');
  protected readonly historialId = signal<number | null>(null);
  protected readonly form = new FormGroup({
    titulo: texto('', true),
    tipo: new FormControl<TipoReporte>('VENTAS', { nonNullable: true }),
    frecuencia: new FormControl<ProgramadoDatos['frecuencia']>('DIARIA', { nonNullable: true }),
    hora: texto('08:00', true),
    dia: texto(),
    formato: new FormControl<'PDF' | 'EXCEL'>('PDF', { nonNullable: true }),
    destinatario_email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    sucursal_id: new FormControl<number | null>(null),
    solo_bajo_stock: new FormControl(false, { nonNullable: true }),
    activo: new FormControl(true, { nonNullable: true }),
    zona_horaria: texto('America/La_Paz', true),
    periodo: new FormControl<ProgramadoDatos['periodo']>('SEGUN_FRECUENCIA', { nonNullable: true }),
    agrupacion: new FormControl<'DIA' | 'SEMANA' | 'MES'>('DIA', { nonNullable: true }),
    estado: texto(),
    metodo_pago: texto(),
    proveedor_pago: texto(),
    tipo_entrega: new FormControl<'' | 'RECOJO_SUCURSAL' | 'DELIVERY'>('', { nonNullable: true }),
    tipo_venta: new FormControl<'' | 'PRESENCIAL' | 'DIGITAL'>('', { nonNullable: true }),
    rol: texto(),
    cuentas: texto(),
  });
  constructor() {
    inject(CambioContextoService)
      .cambio$.pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.items.set([]);
        this.historial.set(null);
        this.edicion.set(null);
        this.form.reset();
        this.bloqueados.set(new Set());
      });
    this.cargar();
  }
  protected cargar(): void {
    this.api
      .programados()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({ next: (r) => this.items.set(r), error: (e) => this.error.set(mensajeApi(e)) });
  }
  protected nuevo(): void {
    this.edicion.set(null);
    this.conflicto.set(false);
    this.form.reset({
      tipo: 'VENTAS',
      frecuencia: 'DIARIA',
      hora: '08:00',
      formato: this.plan.habilita('reportes_pdf') ? 'PDF' : 'EXCEL',
      activo: true,
      zona_horaria: 'America/La_Paz',
      periodo: 'SEGUN_FRECUENCIA',
      agrupacion: 'DIA',
    });
  }
  protected editar(p: ReporteProgramado): void {
    this.edicion.set(p);
    this.conflicto.set(false);
    const f = p.filtros;
    this.form.reset({
      ...p,
      dia: p.dia ?? '',
      hora: p.hora.slice(0, 5),
      agrupacion: f.agrupacion ?? 'DIA',
      estado: f.estado ?? '',
      metodo_pago: f.metodo_pago ?? '',
      proveedor_pago: f.proveedor_pago ?? '',
      tipo_entrega: f.tipo_entrega ?? '',
      tipo_venta: f.tipo_venta ?? '',
      rol: f.rol ?? '',
      cuentas: f.activo == null ? '' : String(f.activo),
    });
    this.foco.llevar('programado-editor');
  }
  protected guardar(): void {
    if (
      this.ocupado() ||
      this.conflicto() ||
      this.form.invalid ||
      !this.plan.habilita('reportes_programacion')
    )
      return;
    const f = this.form.getRawValue();
    if (!this.plan.habilita(f.formato === 'PDF' ? 'reportes_pdf' : 'reportes_excel')) {
      this.error.set('El formato no está habilitado en tu plan.');
      return;
    }
    if (
      f.frecuencia === 'SEMANAL' &&
      !/^(LUNES|MARTES|MIERCOLES|JUEVES|VIERNES|SABADO|DOMINGO|[0-6])$/.test(f.dia.toUpperCase())
    ) {
      this.error.set('Indica un día semanal válido.');
      return;
    }
    if (
      f.frecuencia === 'MENSUAL' &&
      (!/^\d+$/.test(f.dia) || Number(f.dia) < 1 || Number(f.dia) > 31)
    ) {
      this.error.set('Indica un día de mes de 1 a 31.');
      return;
    }
    const datos: ProgramadoDatos = {
      titulo: f.titulo,
      tipo: f.tipo,
      frecuencia: f.frecuencia,
      hora: f.hora,
      dia: f.frecuencia === 'DIARIA' ? null : f.dia.toUpperCase(),
      formato: f.formato,
      destinatario_email: f.destinatario_email,
      sucursal_id: f.sucursal_id,
      solo_bajo_stock: f.solo_bajo_stock,
      activo: f.activo,
      zona_horaria: f.zona_horaria,
      periodo: f.periodo,
      filtros: {
        agrupacion: f.agrupacion,
        estado: f.estado || null,
        metodo_pago: f.metodo_pago || null,
        proveedor_pago: f.proveedor_pago || null,
        tipo_entrega: f.tipo_entrega || null,
        tipo_venta: f.tipo_venta || null,
        rol: f.rol || null,
        activo: f.cuentas === '' ? null : f.cuentas === 'true',
      },
    };
    const p = this.edicion();
    const cambios: Partial<ProgramadoDatos> = {};
    for (const k of [
      'titulo',
      'tipo',
      'frecuencia',
      'hora',
      'dia',
      'formato',
      'destinatario_email',
      'sucursal_id',
      'solo_bajo_stock',
      'activo',
      'zona_horaria',
      'periodo',
    ] as const) {
      if (this.form.controls[k].dirty) Object.assign(cambios, { [k]: datos[k] });
    }
    if (this.form.controls.frecuencia.dirty) cambios.dia = datos.dia;
    const filtros: ProgramadoDatos['filtros'] = {};
    for (const k of [
      'agrupacion',
      'estado',
      'metodo_pago',
      'proveedor_pago',
      'tipo_entrega',
      'tipo_venta',
      'rol',
    ] as const) {
      if (this.form.controls[k].dirty) Object.assign(filtros, { [k]: datos.filtros[k] });
    }
    if (this.form.controls.cuentas.dirty) filtros.activo = datos.filtros.activo;
    if (Object.keys(filtros).length) cambios.filtros = { ...p?.filtros, ...filtros };
    this.operar(
      p ? this.api.editarProgramado(p.id, p.revision, cambios) : this.api.crearProgramado(datos),
      'Programación guardada.',
      true,
    );
  }
  private operar(o: Observable<unknown>, mensaje: string, limpiar = false): void {
    if (this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set('');
    o.pipe(
      takeUntilDestroyed(this.destroy),
      finalize(() => this.ocupado.set(false)),
    ).subscribe({
      next: () => {
        this.aviso.set(mensaje);
        if (limpiar) this.nuevo();
        this.cargar();
        this.plan.refrescar().subscribe({ error: () => {} });
      },
      error: (e) => {
        this.error.set(mensajeApi(e));
        if (e instanceof HttpErrorResponse && e.status === 409 && this.edicion())
          this.conflicto.set(true);
      },
    });
  }
  protected actualizarRevision(): void {
    const id = this.edicion()?.id;
    if (!id) return;
    this.api
      .programados()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (r) => {
          this.items.set(r);
          const p = r.find((x) => x.id === id);
          if (p) {
            this.edicion.set(p);
            this.conflicto.set(false);
            this.aviso.set(
              'Revisión actualizada. Revisa el formulario conservado antes de guardar.',
            );
          } else this.error.set('La programación ya no está disponible.');
        },
        error: (e) => this.error.set(mensajeApi(e)),
      });
  }
  protected puedeEjecutar(p: ReporteProgramado): boolean {
    return (
      this.plan.habilita('reportes_programacion') &&
      this.plan.habilita(p.formato === 'PDF' ? 'reportes_pdf' : 'reportes_excel')
    );
  }
  protected puedeActivar(p: ReporteProgramado): boolean {
    return (
      this.puedeEjecutar(p) && !this.plan.capacidades()?.cupos['reportes_programados']?.agotado
    );
  }
  protected estado(p: ReporteProgramado): void {
    if (!p.activo && !this.puedeActivar(p)) return;
    this.operar(this.api.estadoProgramado(p.id, !p.activo), 'Estado actualizado.');
  }
  protected eliminar(p: ReporteProgramado): void {
    if (globalThis.confirm('¿Eliminar esta programación y su historial?'))
      this.operar(this.api.eliminarProgramado(p.id), 'Programación eliminada.');
  }
  protected ejecutar(p: ReporteProgramado): void {
    if (
      this.ocupado() ||
      this.bloqueados().has(p.id) ||
      !p.activo ||
      !this.puedeEjecutar(p) ||
      !globalThis.confirm(
        '¿Ejecutar un envío manual? Revisa el historial para evitar repetir una entrega anterior.',
      )
    )
      return;
    this.ocupado.set(true);
    this.api
      .ejecutarProgramado(p.id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.ocupado.set(false)),
      )
      .subscribe({
        next: (r) => {
          this.aviso.set(r.mensaje ?? 'Consulta el historial para verificar el resultado.');
          this.cargar();
          this.verHistorial(p);
        },
        error: (e) => {
          this.bloqueados.update((s) => new Set([...s, p.id]));
          this.error.set(
            mensajeApi(e) + ' No se repetirá el envío automáticamente. Revisa el historial.',
          );
        },
      });
  }
  protected verHistorial(p: ReporteProgramado): void {
    this.api
      .ejecuciones(p.id)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (h) => {
          this.historial.set(h);
          this.historialId.set(p.id);
          this.tituloHistorial.set(p.titulo);
          this.foco.llevar('historial-reportes');
        },
        error: (e) => this.error.set(mensajeApi(e)),
      });
  }
  protected autorizarReintento(): void {
    const id = this.historialId();
    if (
      id !== null &&
      globalThis.confirm(
        'La entrega anterior podría haberse realizado. ¿Permitir que solicites una nueva ejecución manual después de revisar el historial?',
      )
    )
      this.bloqueados.update((s) => {
        const r = new Set(s);
        r.delete(id);
        return r;
      });
  }
}
