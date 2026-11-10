import { HttpBackend, HttpClient } from '@angular/common/http';
import { computed, effect, inject, Service, signal } from '@angular/core';
import { API_BASE_URL } from '../config/api.config';
import { EmpresaContextoService } from './empresa-contexto.service';

export interface AparienciaDatos {
  nombre_comercial: string;
  color_principal: string;
  color_secundario: string;
  titulo_bienvenida: string;
  mensaje_bienvenida: string;
  telefono: string;
  whatsapp: string;
  direccion: string;
  horarios: string;
  instagram: string;
  facebook: string;
  sitio_web: string;
}
export interface AparienciaEmpresa extends AparienciaDatos {
  empresa_id: number;
  version: number;
  logo_url: string | null;
  portada_url: string | null;
}
export const APARIENCIA_DEFAULT: AparienciaEmpresa = {
  empresa_id: 0,
  version: 0,
  nombre_comercial: '',
  color_principal: '#111111',
  color_secundario: '#485735',
  titulo_bienvenida: '',
  mensaje_bienvenida: '',
  telefono: '',
  whatsapp: '',
  direccion: '',
  horarios: '',
  instagram: '',
  facebook: '',
  sitio_web: '',
  logo_url: null,
  portada_url: null,
};
export function contrasteBlanco(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 0;
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 + 0.05);
}

@Service()
export class AparienciaService {
  private readonly empresa = inject(EmpresaContextoService);
  private readonly publico = new HttpClient(inject(HttpBackend));
  private revision = 0;
  private readonly datos = signal<AparienciaEmpresa>({ ...APARIENCIA_DEFAULT });
  readonly actual = this.datos.asReadonly();
  readonly nombre = computed(
    () => this.actual().nombre_comercial || this.empresa.empresa()?.nombre || 'StyleAR',
  );
  readonly logo = computed(() => this.imagen(this.actual().logo_url));
  readonly portada = computed(() => this.imagen(this.actual().portada_url));
  readonly whatsapp = computed(() =>
    this.actual().whatsapp ? 'https://wa.me/' + this.actual().whatsapp.replace('+', '') : '',
  );
  constructor() {
    effect(() => {
      const empresa = this.empresa.empresa();
      const revision = ++this.revision;
      this.datos.set({ ...APARIENCIA_DEFAULT });
      if (!empresa) return;
      this.publico
        .get<AparienciaEmpresa>(
          `${API_BASE_URL}/api/v1/empresas/publica/${encodeURIComponent(empresa.codigo)}/apariencia`,
        )
        .subscribe({
          next: (datos) => {
            if (revision === this.revision && datos.empresa_id === empresa.id)
              this.datos.set(datos);
          },
          error: () => {
            /* La tienda conserva su diseño base si el servicio no está disponible. */
          },
        });
    });
  }
  imagen(url: string | null): string | null {
    return url?.startsWith('/api/v1/empresas/publica/') ? API_BASE_URL + url : null;
  }
  aplicar(datos: AparienciaEmpresa): void {
    if (datos.empresa_id !== this.empresa.empresa()?.id) return;
    ++this.revision;
    this.datos.set(datos);
  }
}
