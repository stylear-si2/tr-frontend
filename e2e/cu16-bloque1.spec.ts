import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const datos=JSON.parse(readFileSync('e2e/.fixture.json','utf8')) as {a:{codigo:string};b:{codigo:string};clienteA:string;clienteB:string;varianteA:number;sucursalA:number};
test.beforeEach(async({page})=>{
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.hostname==='127.0.0.1'&&u.port==='8000')return route.continue({url:route.request().url().replace(':8000',':18127')});
    if(['127.0.0.1','localhost'].includes(u.hostname))return route.continue();
    return route.abort();
  });
  page.on('dialog',d=>d.accept());
});
async function entrar(page:Page,usuario:string,codigo=datos.a.codigo){
  await page.goto(`/e/${codigo}`);await expect(page).toHaveURL(/\/inicio$/);
  await page.goto('/login');await page.getByLabel('Usuario o correo').fill(usuario);
  await page.getByLabel('Contrasena',{exact:true}).fill('Prueba-aislada-123');
  await page.getByRole('button',{name:'Ingresar',exact:true}).click();await expect(page).not.toHaveURL(/\/login$/);
}
async function axe(page:Page){expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);}
test('CU16 administrador configura sólo su empresa y cliente prueba QR e inbox',async({page,request})=>{
  test.setTimeout(90000);
  await entrar(page,datos.a.codigo);await page.goto('/pagos-empresa');
  await expect(page.getByRole('heading',{name:'Configuración de pagos'})).toBeVisible();await axe(page);
  await page.getByLabel('Stripe',{exact:true}).check();await page.getByLabel('Pago por QR',{exact:true}).check();
  const guardado=page.waitForResponse(r=>r.url().includes('/pagos-empresa/configuracion')&&r.request().method()==='PUT');
  await page.getByRole('button',{name:'Guardar configuración'}).click();expect((await guardado).status()).toBe(200);await expect(page.getByRole('status')).toContainText('guardada');await axe(page);
  const login=await request.post('http://127.0.0.1:18127/api/v1/autenticacion/login',{data:{identificador:datos.clienteA,password:'Prueba-aislada-123',empresa_codigo:datos.a.codigo}});expect(login.ok()).toBeTruthy();
  const headers={'Authorization':'Bearer '+(await login.json()).access_token,'X-Empresa-Codigo':datos.a.codigo};
  const pendiente=await (await request.get('http://127.0.0.1:18127/api/v1/pagos-empresa/pendiente',{headers})).json();
  if(pendiente)expect((await request.post(`http://127.0.0.1:18127/api/v1/pagos-empresa/ordenes/${pendiente.orden_id}/cancelar`,{headers,data:{}})).ok()).toBeTruthy();
  expect((await request.delete('http://127.0.0.1:18127/api/v1/carrito',{headers})).ok()).toBeTruthy();
  expect((await request.post('http://127.0.0.1:18127/api/v1/carrito/items',{headers,data:{producto_variante_id:datos.varianteA,sucursal_id:datos.sucursalA,cantidad:1}})).ok()).toBeTruthy();
  // Otra cuenta y navegador de autenticación, sin reutilizar almacenamiento del administrador.
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
  await entrar(page,datos.clienteA);await page.goto('/carrito');
  await page.getByRole('button',{name:'Pagar con QR de prueba y retirar',exact:true}).click();
  await expect(page.getByText('QR DE PRUEBA.',{exact:false})).toBeVisible();await axe(page);
  await page.getByRole('link',{name:'Consultar estado o cancelar intento'}).click();
  await expect(page.getByRole('heading',{name:'Resultado del pago'})).toBeVisible();
  await expect(page.getByText('Entorno de pruebas.',{exact:false})).toBeVisible();await axe(page);
  await page.getByRole('button',{name:'Simular pago aprobado',exact:true}).click();
  await expect(page.locator('.status-pill')).toContainText('Aprobado');await axe(page);
  await page.goto('/notificaciones');await expect(page.getByRole('heading',{name:'Mis notificaciones',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/Marcar como leída/})).toBeVisible();await axe(page);
  const marcar=page.getByRole('button',{name:/^Marcar como leída #/});
  await marcar.click();
  await expect(marcar).toHaveCount(0);
  await expect(page.getByRole('status').filter({hasText:'0 sin leer en toda tu bandeja'})).toBeVisible();
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
  await entrar(page,datos.clienteB,datos.b.codigo);await page.goto('/notificaciones');
  await expect(page.getByText('No hay notificaciones con estos filtros.')).toBeVisible();await axe(page);
});

test('CU16 pago sin stock conserva reintegro pendiente hasta confirmación',async({page,request})=>{
  test.setTimeout(90000);
  async function acceso(usuario:string){
    const r=await request.post('http://127.0.0.1:18127/api/v1/autenticacion/login',{data:{identificador:usuario,password:'Prueba-aislada-123',empresa_codigo:datos.a.codigo}});expect(r.ok()).toBeTruthy();
    return {'Authorization':'Bearer '+(await r.json()).access_token,'X-Empresa-Codigo':datos.a.codigo};
  }
  const admin=await acceso(datos.a.codigo),cliente=await acceso(datos.clienteA);
  const api='http://127.0.0.1:18127/api/v1';
  expect((await request.post(api+'/movimientos-inventario',{headers:admin,data:{sucursal_id:datos.sucursalA,producto_variante_id:datos.varianteA,tipo:'AJUSTE_POSITIVO',cantidad:1,motivo:'Preparación de prueba desechable'}})).ok()).toBeTruthy();
  expect((await request.post(api+'/carrito/items',{headers:cliente,data:{producto_variante_id:datos.varianteA,sucursal_id:datos.sucursalA,cantidad:1}})).ok()).toBeTruthy();
  const checkout=await request.post(api+'/pagos/qr/checkout',{headers:cliente,data:{clave_operacion:crypto.randomUUID(),sucursal_id:datos.sucursalA,total_esperado:50}});expect(checkout.ok()).toBeTruthy();const o=await checkout.json();
  const stock=await (await request.get(api+`/inventario?producto_variante_id=${datos.varianteA}`,{headers:admin})).json();
  expect((await request.post(api+'/movimientos-inventario',{headers:admin,data:{sucursal_id:datos.sucursalA,producto_variante_id:datos.varianteA,tipo:'AJUSTE_NEGATIVO',cantidad:stock[0].stock_disponible,motivo:'Agotar stock después del checkout en prueba desechable'}})).ok()).toBeTruthy();
  await entrar(page,datos.clienteA);await page.goto('/pago/resultado?orden_id='+o.orden_id);
  await page.getByRole('button',{name:'Simular pago aprobado',exact:true}).click();
  await expect(page.locator('.status-pill')).toHaveText('Reembolso pendiente');await axe(page);
  const reintegros=await (await request.get(api+'/pagos-empresa/reembolsos',{headers:cliente})).json();const rid=reintegros.find((r:{orden_id:number})=>r.orden_id===o.orden_id).id;
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await entrar(page,datos.a.codigo);await page.goto('/pagos-empresa');
  await expect(page.getByRole('button',{name:`Simular reembolso #${rid}`,exact:true})).toBeVisible();await axe(page);
  await page.getByRole('button',{name:`Simular reembolso #${rid}`,exact:true}).click();
  await expect(page.getByText('Referencia: reembolso_simulado_'+rid,{exact:true})).toBeVisible();await axe(page);
  await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});await entrar(page,datos.clienteA);await page.goto('/pago/resultado?orden_id='+o.orden_id);
  await expect(page.locator('.status-pill')).toHaveText('Reembolsado');await axe(page);
});
