import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const f = JSON.parse(readFileSync('e2e/.fixture.json', 'utf8')) as {
  a: { codigo: string };
  b: { codigo: string };
  clienteA: string;
  clienteB: string;
  notaVenta: number;
  notaB: number;
  reservaA: number;
};
const API = 'http://127.0.0.1:18127/api/v1';
test('CU27 páginas, contador global, marcado, preferencias parciales y destino autorizado', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.route('**/*', (r) => {
    const u = new URL(r.request().url());
    return u.hostname === '127.0.0.1' && u.port === '8000'
      ? r.continue({ url: r.request().url().replace(':8000', ':18127') })
      : ['127.0.0.1', 'localhost'].includes(u.hostname)
        ? r.continue()
        : r.abort();
  });
  const t = await request.post(API + '/autenticacion/login', {
    data: { identificador: f.clienteA, password: 'Prueba-aislada-123', empresa_codigo: f.a.codigo },
  });
  const h = {
    Authorization: 'Bearer ' + (await t.json()).access_token,
    'X-Empresa-Codigo': f.a.codigo,
  };
  const resumen = await (await request.get(API + '/notificaciones/resumen', { headers: h })).json();
  await page.goto('/e/' + f.a.codigo);
  await page.getByRole('link', { name: 'Ingresar', exact: true }).click();
  await page.getByLabel('Usuario o correo').fill(f.clienteA);
  await page.getByLabel('Contrasena', { exact: true }).fill('Prueba-aislada-123');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto('/notificaciones');
  await expect(page.getByText('Página 1 de 3', { exact: true })).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${resumen.no_leidas} sin leer en toda tu bandeja`)),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Abrir actualización #' + f.notaVenta, exact: true })
    .click();
  await expect(page).toHaveURL(/\/notificaciones$/);
  await expect(
    page.getByText('Esta actualización corresponde a una compra.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText('Página 2 de 3')).toBeVisible();
  await page.locator('#notas-categoria').selectOption('GENERAL');
  await expect(page.getByText('Página 1 de 2')).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${resumen.no_leidas} sin leer en toda tu bandeja`)),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preferencias de avisos', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Compra', exact: true }).uncheck();
  await request.put(API + '/notificaciones/preferencias', {
    headers: h,
    data: { categorias: { RESERVA: false } },
  });
  const guardado = page.waitForRequest(
    (r) => r.url().endsWith('/notificaciones/preferencias') && r.method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
  expect((await guardado).postDataJSON()).toEqual({ categorias: { COMPRA: false } });
  await expect(page.getByText('Preferencias guardadas.', { exact: false })).toBeVisible();
  const prefs = await (
    await request.get(API + '/notificaciones/preferencias', { headers: h })
  ).json();
  expect(prefs.categorias).toMatchObject({ COMPRA: false, RESERVA: false, GENERAL: true });
  expect(
    (await (await request.get(API + '/notificaciones/resumen', { headers: h })).json()).total,
  ).toBe(resumen.total);
  await page.getByRole('button', { name: 'Marcar todas como leídas', exact: true }).click();
  await expect(page.getByText(/0 sin leer en toda tu bandeja/)).toBeVisible();
  expect(
    (await (await request.get(API + '/notificaciones/resumen', { headers: h })).json()).no_leidas,
  ).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page
    .getByRole('button', { name: /Estado del aviso #/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Estado del aviso', exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: /Abrir actualización #/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp('/reservas/' + f.reservaA + '$'));
  expect(
    (await request.get(API + `/notificaciones/${f.notaB}/destino`, { headers: h })).status(),
  ).toBe(404);
  expect(
    (
      await request.patch(API + `/notificaciones/${f.notaB}/leer`, { headers: h, data: {} })
    ).status(),
  ).toBe(404);
  // Leave push enabled for the separate controlled physical test.
  await request.put(API + '/notificaciones/preferencias', {
    headers: h,
    data: { categorias: { COMPRA: true, RESERVA: true } },
  });
});
