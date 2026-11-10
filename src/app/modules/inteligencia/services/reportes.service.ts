import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '../../../core/config/api.config';
import {
  Interpretacion,
  AnalisisReporte,
  ReporteCatalogo,
  ReporteFiltros,
  ReporteResultado,
  ReporteDetalle,
  DashboardFiltros,
  DashboardResultado,
  ProgramadoDatos,
  ReporteProgramado,
  ReporteEjecucion,
} from '../models/reporte.models';

@Injectable({ providedIn: 'root' })
export class ReportesService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/v1/reportes`;

  catalogo() {
    return this.http.get<ReporteCatalogo>(`${this.base}/catalogo`);
  }
  interpretar(texto: string, origen: 'TEXTO' | 'VOZ' = 'TEXTO') {
    return this.http.post<Interpretacion>(`${this.base}/interpretar`, { texto, origen });
  }
  generar(filtros: ReporteFiltros) {
    return this.http.post<ReporteResultado>(`${this.base}/generar`, filtros);
  }
  analizar(filtros: ReporteFiltros, firmaResultado?: string) {
    return this.http.post<AnalisisReporte>(`${this.base}/analizar`, { ...filtros, firma_resultado: firmaResultado });
  }
  audio(analisisId: string) {
    return this.http.post(`${this.base}/audio`, { analisis_id: analisisId }, { responseType: 'blob' });
  }
  exportar(filtros: ReporteFiltros, formato: 'pdf' | 'excel', analisisId?: string) {
    return this.http.post(`${this.base}/exportar/${formato}`, { ...filtros, analisis_id: analisisId }, { responseType: 'blob' });
  }
  detalle(filtros: ReporteFiltros, pagina = 1, tamano = 20) {
    return this.http.post<ReporteDetalle>(`${this.base}/detalle`, { ...filtros, pagina, tamano });
  }
  dashboard(filtros: DashboardFiltros) {
    return this.http.post<DashboardResultado>(`${this.base}/dashboard`, filtros);
  }
  programados() {
    return this.http.get<ReporteProgramado[]>(`${this.base}/programados`);
  }
  crearProgramado(datos: ProgramadoDatos) {
    return this.http.post<ReporteProgramado>(`${this.base}/programados`, datos);
  }
  editarProgramado(id: number, revision: number, cambios: Partial<ProgramadoDatos>) {
    return this.http.patch<ReporteProgramado>(`${this.base}/programados/${id}`, {
      revision,
      cambios,
    });
  }
  estadoProgramado(id: number, activo: boolean) {
    return this.http.patch<ReporteProgramado>(`${this.base}/programados/${id}/estado`, { activo });
  }
  eliminarProgramado(id: number) {
    return this.http.delete(`${this.base}/programados/${id}`);
  }
  ejecutarProgramado(id: number) {
    return this.http.post<{ mensaje?: string; estado?: string; destinatario?: string }>(
      `${this.base}/programados/${id}/ejecutar`,
      {},
    );
  }
  ejecuciones(id: number) {
    return this.http.get<ReporteEjecucion[]>(`${this.base}/programados/${id}/ejecuciones`);
  }
}
