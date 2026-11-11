import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../../autenticacion/services/auth.service';
import { CambioContextoService } from '../../../../core/services/cambio-contexto.service';
import { EstadoPlanService } from '../../../../core/services/estado-plan.service';
import { ProgramacionesReportesComponent } from './programaciones-reportes.component';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  DestroyRef,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import Chart from 'chart.js/auto';
import { finalize } from 'rxjs';
import {
  ReporteCatalogo,
  AnalisisReporte,
  ReporteFiltros,
  ReporteDetalle,
  TipoReporte,
} from '../../models/reporte.models';
import { ReportesService } from '../../services/reportes.service';

interface SpeechResult {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
interface SpeechEngine {
  lang: string;
  interimResults: boolean;
  onresult: ((event: SpeechResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechFactory = new () => SpeechEngine;

@Component({
  selector: 'app-reportes-page',
  imports: [ProgramacionesReportesComponent, ReactiveFormsModule],
  templateUrl: './reportes.page.html',
  styleUrl: './reportes.page.css',
})
export class ReportesPage implements OnInit, OnDestroy {
  private readonly destroy = inject(DestroyRef);
  private readonly cambios = inject(CambioContextoService);
  protected readonly plan = inject(EstadoPlanService);
  protected readonly esAdmin = inject(AuthService).tieneRol('ADMINISTRADOR');
  protected readonly origen = signal<'TEXTO' | 'VOZ'>('TEXTO');
  protected readonly sucursalControl = new FormControl<number | null>(null);
  private revision = 0;
  constructor() {
    effect(() => {
      this.sucursalControl.setValue(this.filtros().sucursal_id ?? null, { emitEvent: false });
    });
    this.sucursalControl.valueChanges.pipe(takeUntilDestroyed()).subscribe(sucursal_id => {
      this.filtros.update(f => ({ ...f, sucursal_id }));
    });
    this.cambios.cambio$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.revision++;
      this.limpiarAnalisis();
      this.resultado.set(null);
      this.filtrosResultado.set(null);
      this.catalogo.set(null);
      this.textoVoz.set('');
      this.speech?.stop();
      this.chart?.destroy();
    });
  }
  private readonly service = inject(ReportesService);
  private readonly chartCanvas = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');
  private chart?: Chart;
  private speech?: SpeechEngine;
  private readonly audioElement = viewChild<ElementRef<HTMLAudioElement>>('audioAnalisis');
  protected readonly analisis = signal<AnalisisReporte | null>(null);
  protected readonly analizando = signal(false);
  protected readonly generandoAudio = signal(false);
  protected readonly audioUrl = signal('');
  protected readonly errorAnalisis = signal('');
  private analisisRevision = 0;

  private limpiarAnalisis(): void {
    this.analisisRevision++;
    this.analisis.set(null);
    this.analizando.set(false);
    this.generandoAudio.set(false);
    this.errorAnalisis.set('');
    this.audioElement()?.nativeElement.pause();
    if (this.audioUrl()) URL.revokeObjectURL(this.audioUrl());
    this.audioUrl.set('');
  }
  protected analizarReporte(): void {
    const filtros = this.filtrosResultado();
    if (!filtros || this.analizando() || !this.plan.habilita('reportes_interpretacion')) return;
    this.limpiarAnalisis();
    const revision = this.analisisRevision;
    this.analizando.set(true);
    this.service.analizar(filtros, this.resultado()?.firma_resultado).pipe(takeUntilDestroyed(this.destroy), finalize(() => {
      if (revision === this.analisisRevision) this.analizando.set(false);
    })).subscribe({
      next: resultado => {
        if (revision !== this.analisisRevision) return;
        this.analisis.set(resultado);
        const reporte = this.resultado();
        if (reporte) this.dibujarGrafico(reporte);
      },
      error: (e: HttpErrorResponse) => { if (revision === this.analisisRevision) this.errorAnalisis.set(this.mensajeError(e)); },
    });
  }
  protected escucharAnalisis(): void {
    const analisis = this.analisis();
    if (!analisis || this.generandoAudio() || this.audioUrl()) return;
    const revision = this.analisisRevision;
    this.generandoAudio.set(true);
    this.errorAnalisis.set('');
    this.service.audio(analisis.id).pipe(takeUntilDestroyed(this.destroy), finalize(() => {
      if (revision === this.analisisRevision) this.generandoAudio.set(false);
    })).subscribe({
      next: blob => { if (revision === this.analisisRevision) this.audioUrl.set(URL.createObjectURL(blob)); },
      error: () => { if (revision === this.analisisRevision) this.errorAnalisis.set('No se pudo preparar la voz. El análisis escrito sigue disponible.'); },
    });
  }

  protected readonly catalogo = signal<ReporteCatalogo | null>(null);
  protected readonly modo = signal<'filtros' | 'voz'>('filtros');
  protected readonly soportaVoz = signal(false);
  protected readonly escuchando = signal(false);
  protected readonly textoVoz = signal('');
  protected readonly interpretado = signal(false);
  protected readonly filtros = signal<ReporteFiltros>({
    tipo: 'VENTAS',
    fecha_desde: this.fechaMes(),
    fecha_hasta: this.fechaHoy(),
    sucursal_id: null,
    agrupacion: 'DIA',
    solo_bajo_stock: false,
    estado: null,
    metodo_pago: null,
    proveedor_pago: null,
    tipo_entrega: null,
    rol: null,
    activo: null,
  });
  protected readonly resultado = signal<ReporteDetalle | null>(null);
  private readonly filtrosResultado = signal<ReporteFiltros | null>(null);
  protected readonly cargando = signal(false);
  protected readonly descargando = signal(false);
  protected readonly error = signal('');
  protected readonly aviso = signal('');
  protected readonly pagina = signal(1);
  private readonly tiposBase: { id: TipoReporte; nombre: string }[] = [
    { id: 'VENTAS', nombre: 'Ventas registradas' },
    { id: 'VENTAS_POR_SUCURSAL', nombre: 'Ventas por sucursal y período' },
    { id: 'INGRESOS_POR_CATEGORIA', nombre: 'Ingresos por categoría' },
    { id: 'PRODUCTOS_MAS_VENDIDOS', nombre: 'Productos más vendidos' },
    { id: 'INVENTARIO', nombre: 'Inventario por sucursal' },
    { id: 'RESERVAS', nombre: 'Reservas' },
    { id: 'MOVIMIENTOS', nombre: 'Movimientos de inventario' },
    { id: 'TRANSFERENCIAS', nombre: 'Transferencias de stock' },
    { id: 'PAGOS', nombre: 'Historial de pagos' },
    { id: 'DELIVERIES', nombre: 'Pedidos con delivery' },
    { id: 'USUARIOS', nombre: 'Usuarios registrados' },
  ];
  protected readonly permiteProducto = computed(() => ['VENTAS', 'VENTAS_POR_SUCURSAL', 'INGRESOS_POR_CATEGORIA', 'PRODUCTOS_MAS_VENDIDOS', 'INVENTARIO'].includes(this.filtros().tipo));
  protected readonly productosDisponibles = computed(() => (this.catalogo()?.productos ?? []).filter(p => !this.filtros().categoria_id || p.categoria_id === this.filtros().categoria_id));
  protected readonly ejemplos = ['Ventas de septiembre agrupadas por sucursal', 'Los diez productos más vendidos este mes', 'Gráfico de ventas por semana', 'Compará las ventas de las sucursales durante los últimos tres meses', 'Ingresos por categoría este mes'];
  protected nombreSucursal(id: number): string {
    return this.catalogo()?.sucursales.find(s => s.id === id)?.nombre ?? 'Sucursal seleccionada';
  }
  protected usarEjemplo(texto: string): void {
    this.textoVoz.set(texto);
    this.origen.set('TEXTO');
    this.interpretado.set(false);
    this.modo.set('voz');
  }
  protected formatear(valor: string | number | boolean | null, campo: string): string {
    if (valor === null) return '—';
    if (['importe', 'total', 'subtotal', 'descuento', 'monto_total', 'costo_delivery'].includes(campo)) return new Intl.NumberFormat('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(valor));
    return String(valor);
  }
  protected readonly filasPagina = computed(() => this.resultado()?.filas ?? []);
  protected readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil((this.resultado()?.total_filas ?? 0) / (this.resultado()?.tamano ?? 20))),
  );
  protected readonly tiposCatalogo = computed(() => this.catalogo()?.tipos ?? []);
  protected readonly indicadores = computed(() => {
    const r = this.resultado();
    if (!r) return [];
    const s = r.resumen;
    return [
      { label: 'Registros del resultado completo', valor: s.total_filas },
      ...(r.tipo === 'VENTAS' ? [{ label: 'Ventas completadas', valor: s.completadas }] : []),
      ...(['VENTAS', 'VENTAS_POR_SUCURSAL', 'INGRESOS_POR_CATEGORIA', 'PRODUCTOS_MAS_VENDIDOS', 'INVENTARIO'].includes(r.tipo)
        ? [{ label: 'Unidades', valor: s.unidades }]
        : []),
      ...s.importes_por_moneda.map((m) => ({ label: 'Importe ' + m.moneda, valor: m.importe })),
    ];
  });

  ngOnInit(): void {
    const host = window as typeof window & {
      SpeechRecognition?: SpeechFactory;
      webkitSpeechRecognition?: SpeechFactory;
    };
    this.soportaVoz.set(Boolean(host.SpeechRecognition || host.webkitSpeechRecognition));
    this.plan.refrescar().subscribe({ error: () => {} });
    this.service
      .catalogo()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (items) => {
          this.catalogo.set(items);
          if (!this.esAdmin)
            this.filtros.update((f) => ({ ...f, sucursal_id: items.sucursales[0]?.id ?? null }));
        },
        error: (error: HttpErrorResponse) => this.error.set(this.mensajeError(error)),
      });
  }

  ngOnDestroy(): void {
    this.limpiarAnalisis();
    this.speech?.stop();
    this.chart?.destroy();
  }

  protected cambiarModo(modo: 'filtros' | 'voz'): void {
    this.modo.set(modo);
    this.error.set('');
  }
  protected cambiarRankingSucursal(event: Event): void {
    const por_sucursal = (event.target as HTMLSelectElement).value === 'SI';
    this.filtros.update(f => ({ ...f, por_sucursal }));
  }

  protected actualizarFiltro(campo: keyof ReporteFiltros, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    const siguiente =
      ['sucursal_id', 'categoria_id', 'producto_id', 'limite'].includes(campo)
        ? value
          ? Number(value)
          : null
        : campo === 'activo'
          ? value === ''
            ? null
            : value === 'true'
          : value || null;
    this.filtros.update((actual) => {
      const base = { ...actual, [campo]: siguiente } as ReporteFiltros;
      if (campo === 'categoria_id') base.producto_id = null;
      return campo === 'tipo'
        ? {
            ...base,
            categoria_id: null,
            producto_id: null,
            por_sucursal: false,
            solo_bajo_stock: false,
            estado: null,
            metodo_pago: null,
            proveedor_pago: null,
            tipo_entrega: null,
            rol: null,
            activo: null,
          }
        : base;
    });
  }
  protected actualizarTexto(event: Event): void {
    this.origen.set('TEXTO');
    this.textoVoz.set((event.target as HTMLTextAreaElement).value);
    this.interpretado.set(false);
  }
  protected cambiarBajoStock(event: Event): void {
    this.filtros.update((actual) => ({
      ...actual,
      solo_bajo_stock: (event.target as HTMLInputElement).checked,
    }));
  }

  protected dictar(): void {
    if (!this.plan.habilita('reportes_voz') || !this.plan.habilita('reportes_interpretacion'))
      return;
    const generacion = this.cambios.generacion();
    if (this.escuchando()) {
      this.speech?.stop();
      return;
    }
    const host = window as typeof window & {
      SpeechRecognition?: SpeechFactory;
      webkitSpeechRecognition?: SpeechFactory;
    };
    const Factory = host.SpeechRecognition || host.webkitSpeechRecognition;
    if (!Factory) {
      this.error.set('Tu navegador no admite dictado. Usa los filtros manuales.');
      return;
    }
    this.speech = new Factory();
    this.speech.lang = 'es-BO';
    this.speech.interimResults = false;
    this.speech.onresult = (event) => {
      if (generacion !== this.cambios.generacion()) return;
      this.origen.set('VOZ');
      this.textoVoz.set(event.results[0]?.[0]?.transcript ?? '');
      this.interpretado.set(false);
    };
    this.speech.onerror = () =>
      this.error.set('No se pudo usar el micrófono. Revisa el permiso o usa los filtros.');
    this.speech.onend = () => this.escuchando.set(false);
    try {
      this.speech.start();
      this.escuchando.set(true);
      this.error.set('');
    } catch {
      this.error.set('No se pudo iniciar el dictado.');
    }
  }

  protected interpretar(): void {
    if (
      this.cargando() ||
      !this.plan.habilita('reportes_interpretacion') ||
      (this.origen() === 'VOZ' && !this.plan.habilita('reportes_voz'))
    )
      return;
    if (this.textoVoz().trim().length < 3) {
      this.error.set('Dicta o escribe una consulta primero.');
      return;
    }
    const generacion = this.cambios.generacion();
    this.cargando.set(true);
    this.error.set('');
    this.aviso.set('');
    this.service
      .interpretar(this.textoVoz(), this.origen())
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.cargando.set(false)),
      )
      .subscribe({
        next: (respuesta) => {
          if (generacion !== this.cambios.generacion()) return;
          if (!respuesta.interpretado || !respuesta.filtros) {
            this.error.set(respuesta.advertencias.join(' '));
            return;
          }
          this.filtros.set(respuesta.filtros);
          this.interpretado.set(true);
          this.aviso.set(
            'Consulta interpretada. Revisa los filtros y confirma para generar el reporte. ' + respuesta.advertencias.join(' '),
          );
        },
        error: (error: HttpErrorResponse) => this.error.set(this.mensajeError(error)),
      });
  }

  protected generar(): void {
    if (this.cargando()) return;
    const f = this.filtros();
    if (!f.fecha_desde || !f.fecha_hasta || f.fecha_desde > f.fecha_hasta) {
      this.error.set('Revisa el rango de fechas.');
      return;
    }
    this.cargando.set(true);
    this.error.set('');
    this.aviso.set('');
    this.consultar(f, 1);
  }
  private consultar(f: ReporteFiltros, pagina: number): void {
    const revision = ++this.revision;
    this.cargando.set(true);
    this.service
      .detalle(f, pagina, 20)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => {
          if (revision === this.revision) this.cargando.set(false);
        }),
      )
      .subscribe({
        next: (r) => {
          if (revision !== this.revision) return;
          const anterior = this.resultado();
          if (JSON.stringify(anterior?.resumen) !== JSON.stringify(r.resumen) || JSON.stringify(anterior?.serie_grafico) !== JSON.stringify(r.serie_grafico) || JSON.stringify(this.filtrosResultado()) !== JSON.stringify(f)) this.limpiarAnalisis();
          this.resultado.set(r);
          this.filtrosResultado.set({ ...f });
          this.pagina.set(r.pagina);
          setTimeout(() => {
            if (revision === this.revision) this.dibujarGrafico(r);
          }, 0);
        },
        error: (e: HttpErrorResponse) => {
          if (revision === this.revision) this.error.set(this.mensajeError(e));
        },
      });
  }

  protected descargar(formato: 'pdf' | 'excel'): void {
    if (
      !this.resultado() ||
      this.descargando() ||
      !this.plan.habilita('reportes_' + formato) ||
      this.resultado()!.total_filas > 5000
    )
      return;
    this.descargando.set(true);
    this.error.set('');
    const consulta = this.filtrosResultado();
    if (!consulta) {
      this.descargando.set(false);
      return;
    }
    this.service
      .exportar(consulta, formato, this.analisis()?.id)
      .pipe(
        takeUntilDestroyed(this.destroy),
        finalize(() => this.descargando.set(false)),
      )
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const enlace = document.createElement('a');
          enlace.href = url;
          enlace.download = `${consulta.tipo.toLowerCase()}_${consulta.fecha_desde}_${consulta.fecha_hasta}.${formato === 'pdf' ? 'pdf' : 'xlsx'}`;
          enlace.click();
          URL.revokeObjectURL(url);
        },
        error: (error: HttpErrorResponse) => this.error.set(this.mensajeError(error)),
      });
  }

  protected cambiarPagina(delta: number): void {
    const f = this.filtrosResultado();
    const pagina = this.pagina() + delta;
    if (f && !this.cargando() && pagina >= 1 && pagina <= this.totalPaginas())
      this.consultar(f, pagina);
  }

  private dibujarGrafico(reporte: ReporteDetalle): void {
    this.chart?.destroy();
    const canvas = this.chartCanvas()?.nativeElement;
    if (!canvas || reporte.serie_grafico.length === 0) return;
    const tipoIA = this.analisis()?.grafico;
    const circular = tipoIA === 'PASTEL' || tipoIA === 'DONA';
    const comparacion = reporte.tipo === 'VENTAS_POR_SUCURSAL' && (!tipoIA || tipoIA === 'BARRAS_AGRUPADAS');
    const serie = comparacion ? reporte.serie_grafico : reporte.serie_grafico.slice(0, 100);
    const periodos = [...new Set(serie.map(s => s.label.slice(0,10)))];
    const sucursales = [...new Set(serie.map(s => s.label.slice(13)))];
    const colores = ['#465934','#315b7a','#975032','#6e4d81','#946900','#236b67'];
    const datasets = comparacion ? sucursales.map((sucursal, i) => ({
      label: sucursal,
      data: periodos.map(periodo => Number(serie.find(s => s.label === periodo + ' · ' + sucursal)?.valor ?? 0)),
      borderColor: colores[i % colores.length], backgroundColor: colores[i % colores.length], fill: false,
    })) : [{ label: reporte.titulo, data: serie.map(item => Number(item.valor)), borderColor: '#465934', backgroundColor: circular ? serie.map((_,i) => colores[i % colores.length]) : 'rgba(70,89,52,.22)', fill: !circular }];
    this.chart = new Chart(canvas, {
      type: tipoIA ? ({ BARRAS: 'bar', LINEAS: 'line', PASTEL: 'pie', DONA: 'doughnut', BARRAS_AGRUPADAS: 'bar' } as const)[tipoIA] : ['PRODUCTOS_MAS_VENDIDOS', 'INGRESOS_POR_CATEGORIA', 'VENTAS_POR_SUCURSAL', 'INVENTARIO'].includes(reporte.tipo) ? 'bar' : 'line',
      data: {
        labels: comparacion ? periodos : serie.map((item) => item.label),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: comparacion || circular, position: 'bottom' } },
        scales: circular ? {} : { y: { beginAtZero: true } },
        indexAxis: !circular && reporte.tipo === 'PRODUCTOS_MAS_VENDIDOS' ? 'y' : 'x',
      },
    });
  }

  private mensajeError(error: HttpErrorResponse): string {
    return typeof error.error?.detail === 'string'
      ? error.error.detail
      : 'No se pudo procesar el reporte.';
  }
  private fechaHoy(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
  private fechaMes(): string {
    return `${this.fechaHoy().slice(0, 7)}-01`;
  }
  protected nombreTipo(tipo: TipoReporte): string {
    return this.tiposBase.find((item) => item.id === tipo)?.nombre ?? tipo;
  }
}
