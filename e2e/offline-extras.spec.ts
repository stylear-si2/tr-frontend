import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const width of [1440,390]) {
 test(`compra y cambio offline persistentes a ${width}px`,async({page,context})=>{
  await page.setViewportSize({width,height:1000});
  const usuario={id:77,nombre:'Cliente',apellido:'Demo',username:'cliente',correo:'demo@example.invalid',empresa_id:2,empresa_codigo:'demo',roles:['CLIENTE']};
  const token=`e30.${Buffer.from(JSON.stringify({sub:'77',empresa_id:2,exp:4102444800,sid:'local'})).toString('base64url')}.ficticia`;
  await page.addInitScript(({usuario,token})=>{
    if(!localStorage.getItem('stylear_pwa_acceso_v1')) {
      localStorage.setItem('backend_tr_token',token);localStorage.setItem('backend_tr_usuario',JSON.stringify(usuario));
      localStorage.setItem('stylear_empresa_codigo_v1','demo');
    }
  },{usuario,token});
  let cotizaciones=0;
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());let data:unknown=[];
    if(url.pathname.includes('/empresas/publica/')) data={id:2,codigo:'demo',nombre:'Tienda Demo',estado:'ACTIVA'};
    else if(url.pathname.endsWith('/perfil')) data=usuario;
    else if(url.pathname.endsWith('/sucursales')) data=[{id:3,nombre:'Centro'}];
    else if(url.pathname.includes('/operacion-movil/catalogo')) data={items:[{variante_id:8,producto_id:4,nombre:'Camisa',talla:'M',color:'Azul',stock:5,precio_centavos:5000}],siguiente:null};
    else if(url.pathname.endsWith('/posventa/cambios/offline/descarga')) data={politica:{cambios_habilitados:true,plazo_cambios:30},ventas:[{venta_id:7,venta_codigo:'V-7',sucursal_id:3,vence_cambio:'2099-12-31T23:59:59Z',detalles:[{venta_detalle_id:9,producto:'Camisa',talla:'S',color:'Azul',cantidad_disponible:1,producto_variante_id:8}]}],cambios:[]};
    else if(url.pathname.endsWith('/pagos/offline/cotizar')) {cotizaciones++; data={id:0,codigo:'COMPRA',estado:'PENDIENTE_PAGO',total:'165.00',sucursal_id:3,items:[{producto_variante_id:8,cantidad:3,precio_centavos:5500}]};}
    else if(url.pathname.endsWith('/posventa/cambios') && route.request().method()==='POST') data={id:11,codigo:'CAM-11',estado:'SOLICITADO'};
    await route.fulfill({json:data});
  });
  await page.goto('/operaciones-offline');
  await page.getByRole('button',{name:'Generar frase nueva'}).click();
  const frase=await page.locator('#frase').inputValue();
  await page.getByRole('button',{name:'Preparar y descargar'}).click();
  await expect(page.getByRole('button',{name:'Compra pendiente',exact:true})).toBeVisible();
  await expect(page.getByText('Sincronización al día.')).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button',{name:'Compra pendiente',exact:true}).click();
  for(let i=0;i<3;i++) await page.getByRole('button',{name:'Agregar una unidad de Camisa'}).click();
  await page.getByRole('button',{name:'Guardar compra pendiente',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Compra pendiente de pago · Pendiente'})).toBeVisible();
  expect(cotizaciones).toBe(0);
  await page.getByRole('button',{name:'Cambios de prendas offline',exact:true}).click();
  await page.getByLabel('Motivo',{exact:true}).fill('Solicito otra talla');
  await page.getByRole('button',{name:'Guardar solicitud de cambio'}).click();
  await expect(page.getByText('Solicitud guardada.',{exact:false})).toBeVisible();
  const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.map(v=>v.id)).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await context.setOffline(false);
  await page.getByRole('button',{name:'Cambios de prendas offline',exact:true}).click();
  await page.getByRole('button',{name:'Historial y pendientes',exact:true}).click();
  await page.getByRole('button',{name:'Sincronizar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Aceptar total y pagar con Stripe'})).toBeVisible();
  await expect(page.getByText('Bs 165.00',{exact:false})).toBeVisible();
  expect(cotizaciones).toBe(1);
  await page.reload();
  await page.locator('#frase').fill(frase);
  await page.getByRole('button',{name:/Desbloquear|Preparar y descargar/,exact:true}).click();
  await page.getByRole('button',{name:'Historial y pendientes',exact:true}).click();
  await expect(page.getByRole('button',{name:'Aceptar total y pagar con Stripe'})).toBeVisible();
 });
}
