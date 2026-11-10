import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NEVER, of } from 'rxjs';
import { vi } from 'vitest';
import { OfflineService } from '../../../../core/offline/offline.service';
import { EstadoPlanService } from '../../../../core/services/estado-plan.service';
import { TiendaStateService } from '../../../../core/services/tienda-state.service';
import { PerfilService } from '../../../autenticacion/services/perfil.service';
import { CatalogoPublicoService } from '../../../catalogo/services/catalogo-publico.service';
import { DeliveryService } from '../../../ventas_inventario/services/delivery.service';
import { PagoService } from '../../../ventas_inventario/services/pago.service';
import { CarritoResponse } from '../../models/carrito.models';
import { CarritoService } from '../../services/carrito.service';
import { ReservasService } from '../../services/reservas.service';
import { CarritoPage } from './carrito.page';

describe('Pago del carrito con recojo en sucursal', () => {
  it('envía el paquete mayorista a Stripe y mantiene deshabilitada la reserva gratuita', () => {
    const sucursal = { id: 3, nombre: 'Sucursal de prueba', ciudad: 'Santa Cruz' };
    const carrito: CarritoResponse = {
      id: 1,
      total: 467.4,
      sucursales_disponibles: [sucursal],
      items: [
        { talla: '32', color: 'Beige', cantidad: 2, precio_unitario: 151.05, subtotal: 302.1 },
        { talla: '34', color: 'Negro', cantidad: 1, precio_unitario: 165.3, subtotal: 165.3 },
      ].map((variante, index) => ({
        id: index + 1,
        producto_variante_id: index + 1,
        producto_id: 1,
        producto: 'Bermuda cargo',
        categoria: 'Bermudas',
        sucursal_id: sucursal.id,
        stock_disponible: 8,
        disponible_para_compra: true,
        paquete_id: 1,
        tipo_compra: 'CUARTA',
        descuento_mayorista: 5,
        ...variante,
      })),
    };
    const crearCheckoutStripe = vi.fn().mockReturnValue(NEVER);
    const crearDesdeCarrito = vi.fn().mockReturnValue(NEVER);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        TiendaStateService,
        { provide: OfflineService, useValue: { puedeActivar: () => false } },
        { provide: EstadoPlanService, useValue: { operacionesPermitidas: () => true } },
        { provide: PerfilService, useValue: { listarDirecciones: () => of({ direcciones: [] }) } },
        { provide: CarritoService, useValue: { obtenerCarrito: () => of(carrito) } },
        {
          provide: CatalogoPublicoService,
          useValue: { obtenerFiltros: () => of({ sucursales: [sucursal] }) },
        },
        { provide: ReservasService, useValue: { crearDesdeCarrito } },
        { provide: DeliveryService, useValue: {} },
        {
          provide: PagoService,
          useValue: { crearCheckoutStripe, obtenerPendiente: () => of(null) },
        },
      ],
    });

    const fixture = TestBed.createComponent(CarritoPage);
    const elemento: HTMLElement = fixture.nativeElement;
    const boton = (texto: string) => {
      const encontrado = Array.from(elemento.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === texto,
      );
      if (!encontrado) throw new Error(`Botón no encontrado: ${texto}`);
      return encontrado;
    };
    fixture.detectChanges();
    boton('Tarjeta / Stripe').click();
    fixture.detectChanges();

    expect(boton('Reservar gratis por 7 días').disabled).toBe(true);
    const pagar = boton('Pagar con Stripe y retirar');
    expect(pagar.disabled).toBe(false);
    pagar.click();

    expect(crearCheckoutStripe).toHaveBeenCalledExactlyOnceWith({
      sucursal_id: 3,
      tipo_entrega: 'RECOJO_SUCURSAL',
      delivery: null,
    });
    expect(crearDesdeCarrito).not.toHaveBeenCalled();
  });
});
