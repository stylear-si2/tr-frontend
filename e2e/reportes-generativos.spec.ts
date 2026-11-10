import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const ancho of [1440, 390, 320]) {
  test(`Reportes interpretados, filtros y accesibilidad a ${ancho}px`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 1000 });
    const usuario = { id: 77, nombre: 'Ana', apellido: 'Demo', username: 'admin', correo: 'ana@example.invalid', empresa_id: 2, empresa_codigo: 'demo', roles: ['ADMINISTRADOR'] };
    const token = `e30.${Buffer.from(JSON.stringify({ sub: '77', empresa_id: 2, exp: 4102444800, sid: 'demo-local' })).toString('base64url')}.ficticia`;
    await page.addInitScript(({ usuario, token }) => {
      localStorage.setItem('backend_tr_token', token);
      localStorage.setItem('backend_tr_usuario', JSON.stringify(usuario));
      localStorage.setItem('stylear_empresa_codigo_v1', 'demo');
    }, { usuario, token });
    let audios = 0;
    const filtros = { tipo: 'VENTAS_POR_SUCURSAL', fecha_desde: '2026-09-01', fecha_hasta: '2026-11-10', agrupacion: 'MES', sucursal_id: null, categoria_id: null, producto_id: null, solo_bajo_stock: false, limite: 10 };
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.includes('/api/v1/')) return ['localhost', '127.0.0.1'].includes(url.hostname) ? route.continue() : route.abort();
      let data: unknown = {};
      if (url.pathname.includes('/empresas/publica/')) data = { id: 2, codigo: 'demo', nombre: 'Tienda Demo', estado: 'ACTIVA' };
      else if (url.pathname.endsWith('/perfil')) data = usuario;
      else if (url.pathname.endsWith('/capacidades')) data = { empresa_id: 2, operaciones_habilitadas: true, cupos: {}, funciones: Object.fromEntries(['reportes', 'reportes_interpretacion', 'reportes_voz', 'reportes_pdf', 'reportes_excel'].map(k => [k, { habilitada: true }])) };
      else if (url.pathname.endsWith('/reportes/catalogo')) data = { tipos: [{ id: 'VENTAS_POR_SUCURSAL', nombre: 'Ventas por sucursal y período' }, { id: 'PRODUCTOS_MAS_VENDIDOS', nombre: 'Productos más vendidos' }], sucursales: [{ id: 3, nombre: 'Centro', ciudad: 'Santa Cruz' }], categorias: [{ id: 8, nombre: 'Poleras' }], productos: [{ id: 12, nombre: 'Polera básica', categoria_id: 8 }] };
      else if (url.pathname.endsWith('/reportes/analizar')) data = { id: 'b76ef1c1-a87a-4ad2-887a-c12a75687c91', narrativa: 'El reporte compara las ventas por sucursal durante los tres meses seleccionados. Octubre no presenta ventas registradas.', conclusiones: ['Consulta los importes completos en la tabla.'], grafico: 'BARRAS_AGRUPADAS', motivo_grafico: 'Permite comparar sucursales dentro de cada mes.', motor: 'GEMINI', advertencias: [], generado_en: '2026-11-10', audio_disponible: true };
      else if (url.pathname.endsWith('/reportes/audio')) {
        audios++;
        const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(4,40);
        return route.fulfill({ contentType: 'audio/wav', body: wav });
      }
      else if (url.pathname.endsWith('/reportes/interpretar')) data = { interpretado: true, filtros, advertencias: [] };
      else if (url.pathname.endsWith('/reportes/detalle')) {
        expect(route.request().postDataJSON().agrupacion).toBe('MES');
        data = { tipo: filtros.tipo, titulo: 'Ventas por sucursal y período', filtros_efectivos: filtros, generado_en: '2026-11-10T12:00:00-04:00', pagina: 1, tamano: 20, total_filas: 3, sin_datos: false, nota: 'Importes sin delivery.', columnas: [{ key: 'periodo', label: 'Período' }, { key: 'sucursal', label: 'Sucursal' }, { key: 'importe', label: 'Importe' }], filas: [{ periodo: '2026-09-01', sucursal: 'Centro', importe: '1500.50' }], serie_grafico: [{ label: '2026-09-01 · Centro', valor: '1500.50' }, { label: '2026-10-01 · Centro', valor: '0' }, { label: '2026-11-01 · Centro', valor: '500' }], resumen: { total_filas: 3, importe: '2000.50', unidades: 12, completadas: 0, bajo_stock: 0, activos: 0, costo_delivery: '0', importes_por_moneda: [{ moneda: 'BOB', importe: '2000.50' }] } };
      } else if (url.pathname.includes('/programados')) data = [];
      else if (url.pathname.includes('/notificaciones')) data = { items: [], total: 0, sin_leer: 0 };
      await route.fulfill({ json: data });
    });
    await page.goto('/reportes');
    await page.getByRole('button', { name: 'Preguntar a la IA' }).click();
    await page.getByRole('button', { name: 'Compará las ventas de las sucursales durante los últimos tres meses', exact: true }).click();
    await page.getByRole('button', { name: 'Interpretar consulta', exact: true }).click();
    await expect(page.locator('#reporte-desde')).toHaveValue('2026-09-01');
    await expect(page.locator('#reporte-agrupacion')).toHaveValue('MES');
    await expect(page.locator('#reporte-categoria')).toBeVisible();
    await page.getByRole('button', { name: /Generar reporte/ }).click();
    await expect(page.getByRole('heading', { name: 'Ventas por sucursal y período' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Centro', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Analizar con IA', exact: true }).click();
    await expect(page.getByText('El reporte compara las ventas por sucursal durante los tres meses seleccionados. Octubre no presenta ventas registradas.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Escuchar análisis', exact: true }).click();
    await expect(page.locator('audio')).toBeVisible();
    expect(audios).toBe(1);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/reportes-${ancho}.png`, fullPage: true });
  });
}
