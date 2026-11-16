import { HttpErrorResponse } from '@angular/common/http';

function registro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null;
}

export function detalleApi(error: unknown): unknown {
  const cuerpo: unknown = error instanceof HttpErrorResponse ? error.error : error;
  if (registro(cuerpo) && 'detalleOriginal' in cuerpo) return cuerpo['detalleOriginal'];
  return registro(cuerpo) && 'detail' in cuerpo ? cuerpo['detail'] : cuerpo;
}

export function mensajeApi(
  error: unknown,
  fallback = 'No se pudo completar la solicitud.',
): string {
  if (
    error instanceof Error &&
    !(error instanceof HttpErrorResponse) &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message;
  }
  const detalle = detalleApi(error);
  if (typeof detalle === 'string' && detalle.trim()) return detalle;
  if (registro(detalle) && typeof detalle['mensaje'] === 'string') return detalle['mensaje'];
  if (Array.isArray(detalle)) {
    const mensajes = detalle
      .filter(registro)
      .map((item) => item['msg'])
      .filter((msg): msg is string => typeof msg === 'string');
    if (mensajes.length) return mensajes.join(' ');
  }
  if (error instanceof HttpErrorResponse && error.status === 0)
    return 'No se pudo conectar. Revisa tu conexión e inténtalo nuevamente.';
  return fallback;
}

export function esErrorVigencia(error: unknown): boolean {
  const detalle = detalleApi(error);
  return (
    (registro(detalle) && detalle['codigo'] === 'SUSCRIPCION_NO_VIGENTE') ||
    /suscripci[oó]n no vigente/i.test(mensajeApi(error, ''))
  );
}

export function esOperacionNueva(metodo: string, ruta: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(metodo.toUpperCase())) return false;
  ruta = ruta.replace(/\/$/, '');
  if (ruta === '/api/v1/asistente/chat' || ruta === '/api/v1/catalogo/vestidor/pausar-realtime')
    return false;
  if (/^\/api\/v1\/respaldos\/[0-9a-fA-F-]+\/(previsualizar|restaurar)$/.test(ruta)) return false;
  if (
    metodo.toUpperCase() === 'PATCH' &&
    /^\/api\/v1\/reportes\/programados\/\d+\/estado$/.test(ruta)
  )
    return false;
  if (ruta === '/api/v1/usuarios' || ruta.startsWith('/api/v1/usuarios/')) return false;
  if (
    [
      '/api/v1/pagos-empresa',
      '/api/v1/notificaciones',
      '/api/v1/saas/',
      '/api/v1/perfil',
      '/api/v1/autenticacion/',
      '/api/v1/devoluciones',
      '/api/v1/posventa',
    ].some((prefijo) => ruta.startsWith(prefijo))
  )
    return false;
  if (/^\/api\/v1\/delivery\/\d+\/(estado|incidencias)$/.test(ruta)) return false;
  if (/^\/api\/v1\/pagos\/(qr\/confirmar|stripe\/confirmar-prueba)\/\d+$/.test(ruta)) return false;
  if (/^\/api\/v1\/ventas-presenciales\/\d+\/nota\/correo$/.test(ruta)) return false;
  if (
    /^\/api\/v1\/reservas\/\d+\/(cancelar|estado|anticipo\/stripe|finalizar|finalizar-venta)$/.test(
      ruta,
    )
  )
    return false;
  if (
    [
      '/api/v1/reportes/interpretar',
      '/api/v1/reportes/dashboard',
      '/api/v1/reportes/detalle',
      '/api/v1/reportes/generar',
      '/api/v1/reportes/exportar/pdf',
      '/api/v1/reportes/exportar/excel',
      '/api/v1/reportes/analitica/interpretar',
      '/api/v1/reportes/analitica/exportar/pdf',
      '/api/v1/reportes/analitica/exportar/excel',
    ].includes(ruta)
  )
    return false;
  if (/^\/api\/v1\/reportes\/programados\/\d+\/ejecutar$/.test(ruta)) return false;
  return metodo.toUpperCase() !== 'DELETE' && !ruta.endsWith('/desactivar');
}
