import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { OperacionesOfflinePage } from './operaciones-offline.page';
import { OfflineService } from '../../../../core/offline/offline.service';
import { AuthService } from '../../../autenticacion/services/auth.service';
import { OperacionOffline, VarianteOffline, CompraCambioOffline } from '../../../../core/offline/offline.model';

class PaginaPrueba extends OperacionesOfflinePage {
  compra() {this.cambiarModo(true);}
  agregar(v: VarianteOffline) {this.cambiarCantidad(v,1);}
  enviar() {this.guardar();}
  cambio(v: CompraCambioOffline) {this.solicitarCambio(v,v.detalles[0],'1','Me equivoqué de talla','');}
  max(v: VarianteOffline) {return this.maximo(v);}
}

describe('Operaciones extra offline',()=>{
  const registrar=vi.fn().mockResolvedValue(undefined);
  const offline={ identidad:signal({empresa:1,usuario:2}),copia:signal({sucursales:[{id:3,nombre:'Centro'}],catalogo:{},historial:[]}),
    puedeVender:()=>false, puedeReservar:()=>true,registrar,operaciones:()=>[] };
  const v: VarianteOffline={variante_id:8,producto_id:4,nombre:'Camisa',talla:'M',color:'Azul',stock:5,precio_centavos:5000};
  beforeEach(()=>{
    registrar.mockClear();
    TestBed.configureTestingModule({providers:[provideHttpClient(),
      {provide:OfflineService,useValue:offline},{provide:AuthService,useValue:{}}]});
    TestBed.overrideComponent(OperacionesOfflinePage,{set:{template:'',imports:[]}});
  });
  it('guarda una compra sin cita ni efectivo y permite más de dos unidades',async()=>{
    const c=TestBed.runInInjectionContext(()=>new PaginaPrueba());
    TestBed.tick();c.compra();expect(c.max(v)).toBe(5);
    c.agregar(v);c.agregar(v);c.agregar(v);c.enviar();
    await Promise.resolve();
    const op=registrar.mock.calls[0][0] as OperacionOffline;
    expect(op.tipo).toBe('COMPRA');expect(op.lineas[0].cantidad).toBe(3);
    expect(op.fechaCita).toBeUndefined();expect(op.efectivo).toBeUndefined();expect(op.estado).toBe('Pendiente');
  });
  it('no guarda un cambio cuyo plazo descargado venció',()=>{
    const c=TestBed.runInInjectionContext(()=>new PaginaPrueba());TestBed.tick();
    c.cambio({venta_id:7,venta_codigo:'V-7',sucursal_id:3,vence_cambio:'2000-01-01',detalles:[{venta_detalle_id:8,producto:'Camisa',talla:'M',color:'Azul',cantidad_disponible:1,producto_variante_id:8}]});
    expect(registrar).not.toHaveBeenCalled();
  });
});
