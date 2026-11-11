import { ReactiveFormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ReportesPage } from './reportes.page';
import { ReportesService } from '../../services/reportes.service';
import { AuthService } from '../../../autenticacion/services/auth.service';
import { EstadoPlanService } from '../../../../core/services/estado-plan.service';
import { CambioContextoService } from '../../../../core/services/cambio-contexto.service';
import { ReporteCatalogo, ReporteDetalle, ReporteFiltros } from '../../models/reporte.models';

describe('Detalle remoto de reportes', () => {
  const detalle = vi.fn();
  const analizar = vi.fn();
  const interpretar = vi.fn();
  const plan = { habilita: () => true, refrescar: () => of(null) };
  const catalogo: ReporteCatalogo = {
    tipos: [{ id: 'VENTAS', nombre: 'Ventas' }],
    sucursales: [{ id: 7, nombre: 'Centro', ciudad: 'La Paz' }],
  };
  const filtros: ReporteFiltros = {
    tipo: 'VENTAS',
    fecha_desde: '2026-11-01',
    fecha_hasta: '2026-11-06',
    sucursal_id: 7,
    agrupacion: 'DIA',
    solo_bajo_stock: false,
  };
  const resultado: ReporteDetalle = {
    tipo: 'VENTAS',
    titulo: 'Ventas',
    nota: null,
    filtros_efectivos: filtros,
    generado_en: '',
    pagina: 1,
    tamano: 20,
    total_filas: 5200,
    sin_datos: false,
    columnas: [],
    filas: [{ codigo: 'A' }],
    serie_grafico: [],
    resumen: {
      total_filas: 5200,
      importe: '10400.00',
      unidades: 0,
      completadas: 5200,
      bajo_stock: 0,
      activos: 0,
      costo_delivery: '0.00',
      importes_por_moneda: [{ moneda: 'BOB', importe: '10400.00' }],
    },
  };
  beforeEach(() => {
    interpretar.mockReset().mockReturnValue(of({interpretado: true, filtros, advertencias: []}));
    analizar.mockReset();
    detalle.mockReset().mockImplementation((_f, pagina: number) => of({ ...resultado, pagina }));
    TestBed.configureTestingModule({
      providers: [
        CambioContextoService,
        { provide: ReportesService, useValue: { catalogo: () => of(catalogo), detalle, analizar, interpretar } },
        { provide: AuthService, useValue: { tieneRol: () => false } },
        { provide: EstadoPlanService, useValue: plan },
      ],
    });
    TestBed.overrideComponent(ReportesPage, { set: { template: '', imports: [] } });
  });
  it('conserva filtros consultados al paginar aunque se edite el formulario', () => {
    const c = TestBed.createComponent(ReportesPage).componentInstance;
    c.ngOnInit();
    c['filtros'].set(filtros);
    c['generar']();
    c['filtros'].set({ ...filtros, tipo: 'PAGOS', fecha_desde: '2025-01-01' });
    c['cambiarPagina'](1);
    expect(detalle).toHaveBeenLastCalledWith(filtros, 2, 20);
    expect(c['filasPagina']()).toHaveLength(1);
    expect(c['totalPaginas']()).toBe(260);
    expect(c['indicadores']()).toContainEqual({ label: 'Importe BOB', valor: '10400.00' });
    expect(c['filtros']().sucursal_id).toBe(7);
  });
  it('descarta el análisis si cambió la sesión antes de recibirlo', () => {
    const pendiente = new Subject();
    analizar.mockReturnValue(pendiente);
    const c = TestBed.createComponent(ReportesPage).componentInstance;
    c['generar']();
    c['analizarReporte']();
    TestBed.inject(CambioContextoService).invalidar();
    pendiente.next({ id: 'anterior', narrativa: 'No debe mostrarse' });
    expect(c['analisis']()).toBeNull();
    expect(c['analizando']()).toBe(false);
  });
  it('descarta una respuesta tardía después de cambiar de sesión', () => {
    const pendiente = new Subject<ReporteDetalle>();
    detalle.mockReturnValue(pendiente);
    const c = TestBed.createComponent(ReportesPage).componentInstance;
    c['generar']();
    TestBed.inject(CambioContextoService).invalidar();
    pendiente.next(resultado);
    expect(c['resultado']()).toBeNull();
  });
  it('selecciona en el DOM la sucursal devuelta por la interpretación', async () => {
    TestBed.overrideComponent(ReportesPage, { set: { template: `<select id="sucursal" [formControl]="sucursalControl"><option [ngValue]="null">Todas</option>@for (s of catalogo()?.sucursales ?? []; track s.id) {<option [ngValue]="s.id">{{s.nombre}}</option>}</select>`, imports: [ReactiveFormsModule] } });
    const fixture = TestBed.createComponent(ReportesPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance['filtros'].update(f => ({...f, sucursal_id: null}));
    fixture.detectChanges();
    fixture.componentInstance['textoVoz'].set('Ventas de la sucursal Centro');
    fixture.componentInstance['interpretar']();
    fixture.detectChanges();
    await fixture.whenStable();
    const select = fixture.nativeElement.querySelector('select') as HTMLSelectElement;
    expect(fixture.componentInstance['filtros']().sucursal_id).toBe(7);
    expect(fixture.componentInstance['sucursalControl'].value).toBe(7);
    expect(select.selectedOptions[0].textContent).toBe('Centro');
    fixture.componentInstance['generar']();
    expect(detalle).toHaveBeenLastCalledWith(expect.objectContaining({sucursal_id:7}),1,20);
    // Las opciones pueden llegar después que la interpretación.
    fixture.componentInstance['catalogo'].set({...catalogo,sucursales:[]});
    fixture.detectChanges();
    fixture.componentInstance['catalogo'].set(catalogo);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(select.selectedOptions[0].textContent).toBe('Centro');
    select.selectedIndex = 0;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance['filtros']().sucursal_id).toBeNull();
  });

});
