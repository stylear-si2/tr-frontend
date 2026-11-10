import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { AparienciaDatos, AparienciaEmpresa } from '../../../../core/services/apariencia.service';

@Service()
export class AparienciaAdminService {
  private readonly http = inject(HttpClient);
  private readonly base = `${API_BASE_URL}/api/v1/mi-empresa/apariencia`;
  obtener() {
    return this.http.get<AparienciaEmpresa>(this.base);
  }
  publicar(
    datos: AparienciaDatos,
    version: number,
    archivos: Partial<Record<'logo' | 'portada', File | null>>,
  ) {
    const form = new FormData();
    form.append('configuracion', JSON.stringify({ ...datos, version }));
    for (const tipo of ['logo', 'portada'] as const) {
      if (archivos[tipo] === null) form.append('quitar_' + tipo, 'true');
      else if (archivos[tipo]) form.append(tipo, archivos[tipo]!);
    }
    return this.http.post<AparienciaEmpresa>(`${this.base}/publicar`, form);
  }
  restablecer(version: number) {
    return this.http.post<AparienciaEmpresa>(`${this.base}/restablecer`, { version });
  }
}
