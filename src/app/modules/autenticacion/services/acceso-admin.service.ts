import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { API_BASE_URL } from '../../../core/config/api.config';

export interface CuentaAcceso {
  id: number;
  nombre: string;
  apellido: string;
  username: string;
  correo: string;
  activo: boolean;
  roles: string[];
  empresa_id: number | null;
  es_cliente: boolean;
  es_empleado: boolean;
}
export interface PaginaAccesos {
  registros: CuentaAcceso[];
  total: number;
  pagina: number;
  por_pagina: number;
  total_paginas: number;
}
export interface RolAcceso {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  protegido: boolean;
  configurable: boolean;
  permiso_ids: number[];
  cantidad_permisos: number;
}
export interface PermisoAcceso {
  id: number;
  nombre: string;
  modulo: string;
  accion: string;
  descripcion: string | null;
  activo: boolean;
  configurable: boolean;
  motivo: string;
}
export interface CatalogoAcceso {
  roles: RolAcceso[];
  permisos: PermisoAcceso[];
}
export interface DatosCuenta {
  nombre: string;
  apellido: string;
  username: string;
  correo: string;
  password?: string;
  rol_id?: number;
  telefono?: string | null;
}

@Service()
export class AccesoAdminService {
  private readonly http = inject(HttpClient);
  private readonly base = API_BASE_URL + '/api/v1';
  catalogos(estado = 'ACTIVOS') {
    return this.http.get<CatalogoAcceso>(this.base + '/acceso/catalogos', { params: { estado } });
  }
  cuentas(
    plataforma: boolean,
    empresa: number | null,
    estado: string,
    busqueda: string,
    pagina: number,
    rol: string | null = null,
  ) {
    let params = new HttpParams()
      .set('estado', estado)
      .set('busqueda', busqueda)
      .set('pagina', pagina)
      .set('por_pagina', 25);
    if (rol) params = params.set('rol', rol);
    if (plataforma && empresa !== null) params = params.set('empresa_id', empresa);
    return this.http.get<PaginaAccesos>(
      this.base + (plataforma ? '/saas/usuarios' : '/usuarios/paginados'),
      { params },
    );
  }
  guardar(plataforma: boolean, empresa: number | null, id: number | null, datos: DatosCuenta) {
    const url =
      this.base + (plataforma ? '/saas/usuarios' : '/usuarios') + (id === null ? '' : '/' + id);
    const params: Record<string, string | number> =
      plataforma && empresa !== null ? { empresa_id: empresa } : {};
    return id === null
      ? this.http.post<CuentaAcceso>(url, datos, { params })
      : this.http.put<CuentaAcceso>(url, datos, { params });
  }
  estado(plataforma: boolean, empresa: number | null, id: number, activo: boolean) {
    return this.http.patch<{ mensaje: string }>(
      this.base +
        (plataforma ? '/saas/usuarios' : '/usuarios') +
        '/' +
        id +
        (activo ? '/activar' : '/desactivar'),
      {},
      {
        params:
          plataforma && empresa !== null
            ? new HttpParams().set('empresa_id', empresa)
            : new HttpParams(),
      },
    );
  }
  rol(plataforma: boolean, empresa: number | null, id: number, rol: number, activo: boolean) {
    const url =
      this.base + (plataforma ? '/saas/usuarios' : '/usuarios') + '/' + id + '/roles/' + rol;
    const params: Record<string, string | number> =
      plataforma && empresa !== null ? { empresa_id: empresa } : {};
    return activo
      ? this.http.post<{ mensaje: string }>(url, {}, { params })
      : this.http.patch<{ mensaje: string }>(url + '/desactivar', {}, { params });
  }
  plantilla(
    id: number,
    datos: {
      descripcion?: string;
      activo?: boolean;
      permiso_ids?: number[];
      confirmar_global?: boolean;
    },
  ) {
    return this.http.put<{ mensaje: string }>(this.base + '/roles/' + id, datos);
  }
}
