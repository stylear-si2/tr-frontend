export type TipoReporte =
  | 'VENTAS'
  | 'VENTAS_POR_SUCURSAL'
  | 'INGRESOS_POR_CATEGORIA'
  | 'PRODUCTOS_MAS_VENDIDOS'
  | 'INVENTARIO'
  | 'RESERVAS'
  | 'MOVIMIENTOS'
  | 'TRANSFERENCIAS'
  | 'PAGOS'
  | 'DELIVERIES'
  | 'USUARIOS';

export interface ReporteFiltros {
  tipo: TipoReporte;
  tipo_venta?: 'PRESENCIAL' | 'DIGITAL' | null;
  fecha_desde: string;
  fecha_hasta: string;
  sucursal_id: number | null;
  agrupacion: 'DIA' | 'SEMANA' | 'MES';
  categoria_id?: number | null;
  producto_id?: number | null;
  limite?: number;
  solo_bajo_stock: boolean;
  estado?: string | null;
  metodo_pago?: string | null;
  proveedor_pago?: string | null;
  tipo_entrega?: 'RECOJO_SUCURSAL' | 'DELIVERY' | null;
  rol?: string | null;
  activo?: boolean | null;
}

export interface ReporteCatalogo {
  categorias?: { id: number; nombre: string }[];
  productos?: { id: number; nombre: string; categoria_id: number }[];
  tipos: { id: TipoReporte; nombre: string }[];
  sucursales: { id: number; nombre: string; ciudad: string }[];
}

export interface Interpretacion {
  interpretado: boolean;
  advertencias: string[];
  filtros: ReporteFiltros | null;
  texto_normalizado?: string;
}

export interface ReporteResultado {
  tipo: TipoReporte;
  titulo: string;
  nota: string | null;
  filtros_efectivos: ReporteFiltros & { sucursal: string };
  generado_en: string;
  indicadores: { label: string; valor: number }[];
  serie_grafico: { label: string; valor: number }[];
  columnas: { key: string; label: string }[];
  filas: Record<string, string | number | null>[];
  total_filas: number;
  sin_datos: boolean;
}

export interface ReporteDetalle {
  tipo: TipoReporte;
  titulo: string;
  nota: string | null;
  filtros_efectivos: ReporteFiltros;
  generado_en: string;
  pagina: number;
  tamano: number;
  total_filas: number;
  sin_datos: boolean;
  columnas: { key: string; label: string }[];
  filas: Record<string, string | number | boolean | null>[];
  serie_grafico: { label: string; valor: number | string }[];
  resumen: {
    total_filas: number;
    importe: string | null;
    unidades: number;
    completadas: number;
    bajo_stock: number;
    activos: number;
    costo_delivery: string;
    importes_por_moneda: { moneda: string; importe: string }[];
  };
}
export interface DashboardFiltros {
  fecha_desde: string;
  fecha_hasta: string;
  sucursal_id: number | null;
  tipo_venta: 'PRESENCIAL' | 'DIGITAL' | null;
  comparar: boolean;
}
export interface DashboardDatos {
  ventas: number;
  ventas_presenciales: number;
  ventas_digitales: number;
  importe_vendido: string;
  moneda_ventas: string;
  reservas_pendientes: number;
  reservas_vencidas: number;
  existencias_bajas: number;
  flujos: { moneda: string; cobrado: string; reembolsado: string; neto: string }[];
  productos_mas_vendidos: {
    id: number;
    nombre: string;
    sku: string;
    unidades: number;
    importe: string;
  }[];
  serie_ventas: { fecha: string; ventas: number; importe: string }[];
}
export interface DashboardResultado {
  filtros: DashboardFiltros;
  datos: DashboardDatos;
  generado_en: string;
  definiciones: Record<string, string>;
  comparacion?: {
    fecha_desde: string;
    fecha_hasta: string;
    datos_anteriores: DashboardDatos;
    indicadores: Record<
      string,
      {
        actual: string;
        anterior: string;
        diferencia: string;
        variacion_porcentual: string | null;
        motivo: string | null;
      }
    >;
  };
}
export interface ProgramadoDatos {
  titulo: string;
  tipo: TipoReporte;
  frecuencia: 'DIARIA' | 'SEMANAL' | 'MENSUAL';
  hora: string;
  dia: string | null;
  formato: 'PDF' | 'EXCEL';
  destinatario_email: string;
  sucursal_id: number | null;
  solo_bajo_stock: boolean;
  activo: boolean;
  zona_horaria: string;
  periodo: 'SEGUN_FRECUENCIA' | 'DIA_ANTERIOR' | 'SEMANA_ANTERIOR' | 'MES_ANTERIOR';
  filtros: Partial<
    Omit<ReporteFiltros, 'tipo' | 'fecha_desde' | 'fecha_hasta' | 'sucursal_id' | 'solo_bajo_stock'>
  >;
}
export interface ReporteProgramado extends ProgramadoDatos {
  id: number;
  revision: number;
  motivo_pausa: string | null;
  ultima_ejecucion: string | null;
  proxima_ejecucion: string | null;
}
export interface ReporteEjecucion {
  id: number;
  estado: 'INICIADO' | 'ENVIADO' | 'FALLIDO' | 'OMITIDO';
  detalle: string | null;
  iniciado_en: string;
  terminado_en: string | null;
  destinatario_email?: string;
  revision?: number;
  archivo_nombre?: string;
}
