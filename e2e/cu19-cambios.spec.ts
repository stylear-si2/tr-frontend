import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('e2e/.fixture.json', 'utf8')) as {
  a: { codigo: string };
  clienteA: string;
  cajero: string;
  sucursalA: number;
  varianteA: number;
  reemplazoA: number;
};
const api = 'http://127.0.0.1:18127/api/v1';
test.use({ actionTimeout: 10000 });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === '127.0.0.1' && u.port === '8000')
      return r.continue({ url: r.request().url().replace(':8000', ':18127') });
    if (['127.0.0.1', 'localhost'].includes(u.hostname)) return r.continue();
    return r.abort();
  });
  page.on('dialog', (r) => r.accept());
});
async function entrar(page: Page, u: string) {
  await page.goto('/e/' + d.a.codigo);
  await expect(page).toHaveURL(/\/inicio$/);
  await page.goto('/login');
  await page.getByLabel('Usuario o correo').fill(u);
  await page.getByLabel('Contrasena', { exact: true }).fill('Prueba-aislada-123');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}
async function cambiar(page: Page, u: string) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await entrar(page, u);
}
async function axe(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}
test('CU19 aplica el saldo a otra prenda y completa el cambio con comprobante', async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  async function acceso(u: string) {
    const r = await request.post(api + '/autenticacion/login', {
      data: { identificador: u, password: 'Prueba-aislada-123', empresa_codigo: d.a.codigo },
    });
    expect(r.ok()).toBeTruthy();
    return {
      Authorization: 'Bearer ' + (await r.json()).access_token,
      'X-Empresa-Codigo': d.a.codigo,
    };
  }
  const ha = await acceso(d.a.codigo),
    h = await acceso(d.clienteA);
  await entrar(page, d.a.codigo);
  await page.goto('/productos');
  const catalogo=page.getByRole('navigation',{name:'Administración de productos'});
  await expect(catalogo.getByRole('link')).toHaveCount(8);
  await expect(page.locator('.product-action').first()).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await axe(page);
  await page.screenshot({path:'../tr-backend/.private/productos_tarjetas.png',fullPage:true});
  await page.goto('/pagos');
  await expect(page.getByRole('link',{name:'Configurar pagos',exact:true})).toBeVisible();
  await page.goto('/devoluciones');
  await expect(page.getByRole('navigation',{name:'Opciones de posventa'}).getByRole('link')).toHaveCount(3);
  await axe(page);
  await page.getByRole('link',{name:'Políticas posventa',exact:true}).click();
  await expect(
    page.getByRole('button', { name: 'Actualizar política', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Habilitar política de cambios').check();
  await page.getByLabel('Plazo de cambios (días)').fill('15');
  await page
    .getByLabel('Condiciones de cambios', { exact: true })
    .fill('Con recepción e inspección en sucursal.');
  await page.getByRole('button', { name: 'Guardar política', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Política guardada');
  await axe(page);
  const cfg = await (
    await request.get(api + '/pagos-empresa/configuracion', { headers: ha })
  ).json();
  expect(
    (
      await request.put(api + '/pagos-empresa/configuracion', {
        headers: ha,
        data: { version: cfg.version, qr_habilitado: true },
      })
    ).ok(),
  ).toBeTruthy();
  const inv = await (
    await request.get(api + `/inventario?producto_variante_id=${d.varianteA}`, { headers: ha })
  ).json();
  if (inv[0].stock_disponible < 10)
    expect(
      (
        await request.post(api + '/movimientos-inventario', {
          headers: ha,
          data: {
            sucursal_id: d.sucursalA,
            producto_variante_id: d.varianteA,
            tipo: 'AJUSTE_POSITIVO',
            cantidad: 10 - inv[0].stock_disponible,
            motivo: 'Existencias de la prueba CU19 desechable',
          },
        })
      ).ok(),
    ).toBeTruthy();
  await request.delete(api + '/carrito', { headers: h });
  expect(
    (
      await request.post(api + '/carrito/items', {
        headers: h,
        data: { producto_variante_id: d.varianteA, sucursal_id: d.sucursalA, cantidad: 1 },
      })
    ).ok(),
  ).toBeTruthy();
  const r = await request.post(api + '/pagos/qr/checkout', {
    headers: h,
    data: { sucursal_id: d.sucursalA, clave_operacion: crypto.randomUUID() },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const o = await r.json();
  expect(
    (await request.post(api + '/pagos/qr/confirmar/' + o.orden_id, { headers: h })).ok(),
  ).toBeTruthy();
  await cambiar(page, d.clienteA);
  await page.goto('/mis-devoluciones');
  await expect(page.getByRole('navigation',{name:'Opciones de posventa'}).getByRole('link')).toHaveCount(2);
  await page.getByRole('link',{name:'Cambios',exact:true}).click();
  await page.getByRole('button', { name: 'Solicitar cambio', exact: true }).first().click();
  await page.getByLabel('Motivo del cambio', { exact: true }).fill('La costura necesita revisión');
  const linea=(await (await request.get(api+'/posventa/cambios/elegibles',{headers:h})).json())[0].detalles[0];
  const inicial=await (await request.get(api+`/posventa/cambios/opciones-solicitud?venta_id=${o.venta_id}&venta_detalle_id=${linea.venta_detalle_id}&cantidad=1`,{headers:h})).json();
  const reemplazo=inicial.opciones.find((v:{id:number})=>v.id===d.reemplazoA);
  const selector=page.getByRole('group',{name:'Prenda de reemplazo',exact:true});
  await selector.getByRole('combobox',{name:'Producto',exact:true}).selectOption(String(reemplazo.producto_id));
  await selector.getByRole('combobox',{name:'Talla',exact:true}).selectOption(reemplazo.talla);
  await selector.getByRole('combobox',{name:'Color',exact:true}).selectOption(reemplazo.color);
  await expect(page.getByRole('status')).toContainText('Reintegro estimado a tu favor: Bs 20.00');
  await axe(page);
  await page.screenshot({path:'../tr-backend/.private/cambio_talla_color.png',fullPage:true});
  await page.getByRole('button', { name: 'Enviar solicitud de cambio', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('SOLICITADO');
  await axe(page);
  const cambios = await (await request.get(api + '/posventa/cambios', { headers: h })).json();
  const cid = cambios[0].id;
  await cambiar(page, d.cajero);
  await page.goto('/cambios');
  await page.getByRole('button', { name: 'Ver cambio ' + cid, exact: true }).click();
  await page
    .getByLabel('Condición de la prenda / motivo del rechazo')
    .fill('Costura dañada; prenda no vendible');
  await page.getByLabel('Unidades no vendibles', { exact: true }).fill('1');
  await page.getByLabel('Confirmo la recepción física y la inspección').check();
  await page.getByRole('button', { name: 'Aceptar cambio inspeccionado', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('COTIZADO');
  await axe(page);
  await cambiar(page, d.clienteA);
  await page.goto('/cambios');
  await page.getByRole('button', { name: 'Ver cambio ' + cid, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirmar reintegro a mi favor', exact: true })).toBeEnabled();
  await expect(page.getByRole('group', { name: 'Prenda de reemplazo', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Modificar reemplazo o agregar otra prenda (opcional)', exact: true }).click();
  await page.getByRole('group',{name:'Prenda de reemplazo',exact:true}).getByRole('combobox',{name:'Producto',exact:true}).selectOption(String(reemplazo.producto_id));
  await page.getByRole('button', { name: 'Cotizar reemplazo', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('COTIZADO');
  const detalle = page.getByRole('region', { name: 'Detalle del cambio' });
  await expect(detalle).toContainText('Bs -20.00');
  await page.getByLabel('Usar el saldo en una prenda adicional').selectOption(String(d.varianteA));
  await expect(page.getByRole('button', { name: 'Confirmar reintegro a mi favor', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cotizar reemplazo', exact: true }).click();
  await expect(detalle).toContainText('Prenda adicional: Prenda Empresa A');
  await expect(detalle).toContainText('Bs 30.00');
  await axe(page);
  await page.getByRole('button', { name: 'Confirmar diferencia y continuar al pago', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('ESPERA_PAGO');
  await page.getByRole('button', { name: 'Pagar diferencia con QR', exact: true }).click();
  await expect(
    page.getByText('Pago simulado de prueba. No mueve dinero real.', { exact: true }),
  ).toBeVisible();
  await axe(page);
  await page
    .getByRole('button', { name: 'Simular pago de diferencia aprobado', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Detalle del cambio' })).toContainText('LISTO');
  await cambiar(page, d.cajero);
  await page.goto('/cambios');
  await page.getByRole('button', { name: 'Ver cambio ' + cid, exact: true }).click();
  const completar = page.getByRole('button', {
    name: 'Completar cambio y emitir comprobante',
    exact: true,
  });
  await expect(completar).toBeDisabled();
  await page.getByLabel('Confirmo la entrega física del reemplazo').check();
  await completar.click();
  await expect(
    page.getByRole('heading', { name: 'Comprobante CAM-' + cid, exact: true }),
  ).toBeVisible();
  await expect(detalle).toContainText('Diferencia liquidada: Bs 30.00');
  await axe(page);
  await cambiar(page, d.clienteA);
  await page.goto('/cambios');
  await page.getByRole('button', { name: 'Ver cambio ' + cid, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Comprobante CAM-' + cid, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Completar cambio y emitir comprobante', exact: true }),
  ).not.toBeVisible();
  await axe(page);
});
