import { AparienciaService } from '../../../../core/services/apariencia.service';
import { OperacionNuevaDirective } from '../../../../core/directives/operacion-nueva.directive';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { TiendaProductoItem, TiendaStateService } from '../../../../core/services/tienda-state.service';
import { AuthService } from '../../../autenticacion/services/auth.service';
import { RecomendacionesService } from '../../../inteligencia/services/recomendaciones.service';
import { CatalogoPrendaItem } from '../../models/catalogo-publico.models';
import { CatalogoPublicoService } from '../../services/catalogo-publico.service';

@Component({
  imports: [OperacionNuevaDirective, RouterLink],
  selector: 'app-inicio-page',
  styleUrl: './inicio.page.css',
  templateUrl: './inicio.page.html',
})
export class InicioPage implements OnInit {
  protected readonly marca = inject(AparienciaService);
  private readonly authService = inject(AuthService);
  private readonly catalogoService = inject(CatalogoPublicoService);
  private readonly recomendacionesService = inject(RecomendacionesService);
  private readonly tiendaState = inject(TiendaStateService);
  private readonly router = inject(Router);

  protected readonly usuario = this.authService.usuarioActual;
  protected readonly esAdmin = computed(() => this.authService.tieneRol('ADMINISTRADOR'));
  protected readonly productosDestacados = signal<CatalogoPrendaItem[]>([]);
  protected readonly cargandoDestacados = signal(false);
  protected readonly errorDestacados = signal('');
  protected readonly favoritos = this.tiendaState.favoritos;

  protected readonly benefits = [
    { icon: 'pi pi-truck', title: 'Envios coordinados', detail: 'Entrega segun disponibilidad.' },
    { icon: 'pi pi-shield', title: 'Compra segura', detail: 'Tus datos se mantienen protegidos.' },
    { icon: 'pi pi-refresh', title: 'Cambios faciles', detail: 'Gestion de cambios desde tu cuenta.' },
  ];

  ngOnInit(): void {
    if (!this.esAdmin()) {
      this.cargarPrendasDestacadas();
    }
  }

  protected agregarAlCarrito(item: CatalogoPrendaItem): void {
    void this.router.navigate(['/producto', item.producto_id]);
  }

  protected alternarFavorito(item: CatalogoPrendaItem): void {
    if (!this.authService.estaAutenticado()) {
      void this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
      return;
    }

    const llamada = this.tiendaState.esFavorito(item.producto_id)
      ? this.recomendacionesService.quitarFavorito(item.producto_id)
      : this.recomendacionesService.guardarFavorito(item.producto_id);

    llamada.subscribe({
      next: (items) =>
        this.tiendaState.reemplazarFavoritos(
          items.map((prenda) => this.toTiendaItem(prenda))
        ),
      error: () => this.errorDestacados.set('No se pudo actualizar el favorito.'),
    });
  }

  protected esFavorito(productoId: number): boolean {
    return this.tiendaState.esFavorito(productoId);
  }

  protected etiquetaProducto(item: CatalogoPrendaItem): string {
    if (item.stock_total <= 0) {
      return 'Sin stock';
    }

    if (item.tiene_promocion) {
      return 'Oferta';
    }

    if (item.stock_total <= 5) {
      return 'Bajo stock';
    }

    return item.categoria;
  }

  protected formatPrecio(precio: number | string | null | undefined): string {
    const value = this.toNumber(precio);
    return value > 0 ? `Bs ${value.toFixed(2)}` : 'Precio pendiente';
  }

  protected inicialesCategoria(item: CatalogoPrendaItem): string {
    return (item.categoria || 'ST').slice(0, 2).toUpperCase();
  }

  private cargarPrendasDestacadas(): void {
    this.cargandoDestacados.set(true);
    this.errorDestacados.set('');

    this.catalogoService
      .listarPrendas({
        orden: 'relevancia',
        solo_disponibles: true,
        por_pagina: 6,
      })
      .pipe(finalize(() => this.cargandoDestacados.set(false)))
      .subscribe({
        next: (response) => this.productosDestacados.set(response.items),
        error: (error: HttpErrorResponse) => {
          this.errorDestacados.set(this.obtenerMensajeError(error));
        },
      });
  }

  private toTiendaItem(item: CatalogoPrendaItem): TiendaProductoItem {
    return {
      id: item.producto_id,
      nombre: item.nombre,
      categoria: item.categoria,
      precio: this.toNumber(item.precio_final ?? item.precio_vigente),
    };
  }

  private toNumber(value: number | string | null | undefined): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private obtenerMensajeError(error: HttpErrorResponse): string {
    if (typeof error.error === 'object' && error.error !== null && 'detail' in error.error) {
      const detail = error.error.detail;

      if (typeof detail === 'string') {
        return detail;
      }
    }

    return 'No se pudieron cargar las prendas destacadas.';
  }
}
