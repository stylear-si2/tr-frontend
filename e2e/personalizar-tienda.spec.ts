import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for(const width of [1440,390,320]) {
 test(`personalización con vista previa, publicación y restablecimiento a ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1050});
  const usuario={id:77,nombre:'Ana',apellido:'Demo',username:'admin',correo:'ana@example.invalid',empresa_id:2,empresa_codigo:'demo',roles:['ADMINISTRADOR']};
  const token=`e30.${Buffer.from(JSON.stringify({sub:'77',empresa_id:2,exp:4102444800,sid:'local'})).toString('base64url')}.ficticia`;
  await page.addInitScript(({usuario,token})=>{localStorage.setItem('backend_tr_token',token);localStorage.setItem('backend_tr_usuario',JSON.stringify(usuario));localStorage.setItem('stylear_empresa_codigo_v1','demo');},{usuario,token});
  const defecto={empresa_id:2,version:0,nombre_comercial:'',color_principal:'#111111',color_secundario:'#485735',titulo_bienvenida:'',mensaje_bienvenida:'',telefono:'',whatsapp:'',direccion:'',horarios:'',instagram:'',facebook:'',sitio_web:'',logo_url:null,portada_url:null};
  let estado:Record<string,unknown>={...defecto};let publicaciones=0;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(!url.pathname.includes('/api/v1/'))return ['localhost','127.0.0.1'].includes(url.hostname)?route.continue():route.abort();
    let data:unknown={};
    if(url.pathname.endsWith('/apariencia/publicar')) {
      publicaciones++;const body=route.request().postData()??'';
      const config=body.match(/name="configuracion"\r\n\r\n([^\r]+)/)?.[1];expect(config).toBeTruthy();
      estado={...estado,...JSON.parse(config!),version:Number(estado['version'])+1};data=estado;
    }else if(url.pathname.endsWith('/apariencia/restablecer')) {estado={...estado,color_principal:defecto.color_principal,color_secundario:defecto.color_secundario,logo_url:null,portada_url:null,version:Number(estado['version'])+1};data=estado;}
    else if(url.pathname.endsWith('/apariencia'))data=estado;
    else if(url.pathname.includes('/empresas/publica/'))data={id:2,codigo:'demo',nombre:'Tienda Demo',estado:'ACTIVA'};
    else if(url.pathname.endsWith('/perfil'))data=usuario;
    else if(url.pathname.endsWith('/capacidades'))data={empresa_id:2,operaciones_habilitadas:true,cupos:{},funciones:{},permisos:[]};
    else if(url.pathname.includes('/notificaciones'))data={items:[],total:0,sin_leer:0};
    else data=[];
    await route.fulfill({json:data});
  });
  await page.goto('/personalizar-tienda');
  await expect(page.getByRole('heading',{name:'Tu tienda, a tu estilo.'})).toBeVisible();
  await page.getByLabel('Nombre comercial',{exact:true}).fill('Atelier del Bosque');
  await page.locator('#color-principal').fill('#143A52');
  await page.locator('#color-secundario').fill('#5B285E');
  await page.getByLabel('Título de bienvenida',{exact:true}).fill('Tu próxima historia empieza aquí.');
  await page.getByLabel('Mensaje de bienvenida',{exact:true}).fill('Prendas pensadas para acompañarte todos los días.');
  await page.getByLabel('WhatsApp',{exact:true}).fill('59170000000');
  await expect(page.locator('.preview-navbar')).toContainText('Atelier del Bosque');
  expect(publicaciones).toBe(0);
  await page.getByRole('button',{name:'Guardar y publicar',exact:true}).click();
  await expect(page.getByText('Personalización guardada.',{exact:false})).toBeVisible();
  expect(publicaciones).toBe(1);
  expect(await page.locator('app-main-layout').evaluate(e=>getComputedStyle(e).getPropertyValue('--color-primary').trim())).toBe('#143A52');
  const axe=await new AxeBuilder({page}).analyze();expect(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('.main-content').evaluate(e=>e.scrollTop=0);
  await page.screenshot({path:`test-results/personalizacion-${width}.png`,fullPage:true});
  await page.reload();await expect(page.getByLabel('Nombre comercial',{exact:true})).toHaveValue('Atelier del Bosque');
  await page.getByRole('button',{name:'Restablecer diseño',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar restablecimiento',exact:true}).click();
  await expect(page.locator('#color-principal')).toHaveValue('#111111');
  await expect(page.getByLabel('WhatsApp',{exact:true})).toHaveValue('59170000000');
 });
}

test('el visitante ve la identidad y el contacto publicados',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 await page.addInitScript(()=>localStorage.setItem('stylear_empresa_codigo_v1','demo'));
 const imagen=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(!url.pathname.includes('/api/v1/'))return ['localhost','127.0.0.1'].includes(url.hostname)?route.continue():route.abort();
  let data:unknown=[];
  if(url.pathname.includes('/apariencia/imagen/'))return route.fulfill({contentType:'image/png',body:imagen});
  if(url.pathname.endsWith('/apariencia'))data={empresa_id:2,version:3,nombre_comercial:'Atelier del Bosque',color_principal:'#143A52',color_secundario:'#5B285E',titulo_bienvenida:'Diseñado para tus días.',mensaje_bienvenida:'Descubre tu próxima prenda favorita.',telefono:'+591 70000000',whatsapp:'59170000000',direccion:'Santa Cruz de la Sierra',horarios:'Lunes a sábado',instagram:'https://www.instagram.com/atelier',facebook:'',sitio_web:'',logo_url:'/api/v1/empresas/publica/demo/apariencia/imagen/logo?v=1',portada_url:'/api/v1/empresas/publica/demo/apariencia/imagen/portada?v=1'};
  else if(url.pathname.includes('/empresas/publica/'))data={id:2,codigo:'demo',nombre:'Empresa registrada',estado:'ACTIVA'};
  else if(url.pathname.includes('/catalogo/prendas'))data={items:[],total:0,pagina:1,paginas:0};
  else if(url.pathname.endsWith('/capacidades'))data={empresa_id:2,operaciones_habilitadas:true,cupos:{},funciones:{}};
  await route.fulfill({json:data});
 });
 await page.goto('/inicio');
 await expect(page.getByRole('heading',{name:'Diseñado para tus días.'})).toBeVisible();
 await expect(page.locator('.shop-brand')).toContainText('Atelier del Bosque');
 await expect(page.locator('.shop-brand img')).toBeVisible();
 await expect(page.getByRole('link',{name:'WhatsApp',exact:true})).toHaveAttribute('href','https://wa.me/59170000000');
 await expect(page.locator('.tenant-footer')).toContainText('Santa Cruz de la Sierra');
 await expect(page.locator('.tenant-cover img')).toBeVisible();
 await expect(page.getByRole('link',{name:'Personalizar tienda',exact:true})).toHaveCount(0);
 await page.screenshot({path:'test-results/tienda-personalizada.png',fullPage:true});
});
