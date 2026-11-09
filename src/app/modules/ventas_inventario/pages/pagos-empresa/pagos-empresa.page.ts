import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { mensajeApi } from '../../../../core/services/error-api';
import { PagoService } from '../../services/pago.service';
import { ConfiguracionPagosEmpresa, ReembolsoPago, NotificacionPropia } from '../../models/pago.models';

@Component({
  selector: 'app-pagos-empresa',
  imports: [ReactiveFormsModule, RouterLink],
  styleUrl: './pagos-empresa.page.css',
  template: `
    <a routerLink="/pagos">Volver a pagos</a>
    <h1>Pagos de prueba por empresa</h1>
    <p>Configura los medios de tu comercio. Este bloque no habilita cobros reales ni transferencias bancarias.</p>
    @if (error()) { <p role="alert">{{ error() }}</p> }
    @if (mensaje()) { <p role="status">{{ mensaje() }}</p> }
    <button type="button" (click)="cargar()" [disabled]="ocupado()">Actualizar configuración y reembolsos</button>
    @if (config(); as cfg) {
      <section aria-labelledby="config-title">
        <h2 id="config-title">Medios del comercio</h2>
        <p>Stripe: {{ cfg.stripe_conexion }}. QR: simulación; conexión BCP pendiente de credenciales e integración bancaria.</p>
        <p>Los secretos se configuran en el servidor para cada empresa y no se muestran en esta pantalla.</p>
        <form [formGroup]="form" (ngSubmit)="guardar()">
          <label for="titular-pago">Nombre del comercio para las pruebas</label>
          <input id="titular-pago" formControlName="titular" maxlength="180" />
          <label><input type="checkbox" formControlName="stripe_habilitado" /> Stripe</label>
          <label><input type="checkbox" formControlName="qr_habilitado" /> Habilitar QR simulado</label>
          <button type="submit" [disabled]="form.invalid || ocupado()">Guardar medios de prueba</button>
        </form>
      </section>
      <section aria-labelledby="reembolsos-title">
        <h2 id="reembolsos-title">Reembolsos de compras no completadas</h2>
        <p>Pendiente o fallido no significa que el dinero ya fue devuelto. En una simulación no se mueve dinero real.</p>
        @for (r of reembolsos(); track r.id) {
          <article>
            <h3>Reembolso #{{ r.id }} · Orden #{{ r.orden_id }}</h3>
            <p>{{ r.monto }} {{ r.moneda }} · {{ r.metodo }} · {{ r.estado }}</p>
            <p>{{ r.motivo }}</p>
            @if (r.referencia) { <p>Referencia: {{ r.referencia }}</p> }
            @if (r.estado !== 'CONFIRMADO') {
              @if (cfg.confirmacion_prueba) { <button type="button" (click)="simular(r)" [disabled]="ocupado()">Simular reembolso #{{ r.id }}</button> }
              <button type="button" (click)="reintentar(r)" [disabled]="ocupado()">Consultar o reintentar con Stripe #{{ r.id }}</button>
            }
          </article>
        } @empty { <p>No hay reembolsos registrados en este bloque.</p> }
      </section>
    }
  `,
})
export class PagosEmpresaPage {
  private readonly api = inject(PagoService);
  protected readonly config = signal<ConfiguracionPagosEmpresa | null>(null);
  protected readonly reembolsos = signal<ReembolsoPago[]>([]);
  protected readonly ocupado = signal(false);
  protected readonly mensaje = signal('');
  protected readonly error = signal('');
  protected readonly form = new FormGroup({
    titular: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(180)] }),
    stripe_habilitado: new FormControl(false, { nonNullable: true }),
    qr_habilitado: new FormControl(false, { nonNullable: true }),
  });
  constructor() { this.cargar(); }
  protected cargar(): void {
    this.ocupado.set(true); this.error.set('');
    forkJoin({config:this.api.configuracion(),reembolsos:this.api.reembolsos()}).pipe(finalize(() => this.ocupado.set(false))).subscribe({
      next: datos => { this.config.set(datos.config); this.reembolsos.set(datos.reembolsos); this.form.setValue({titular:datos.config.titular,stripe_habilitado:datos.config.stripe_habilitado,qr_habilitado:datos.config.qr_habilitado}); },
      error: (error: unknown) => { this.config.set(null); this.reembolsos.set([]); this.error.set(mensajeApi(error)); },
    });
  }
  protected guardar(): void {
    const cfg = this.config(); if (!cfg || this.ocupado() || this.form.invalid) return;
    this.ocupado.set(true); this.error.set('');
    this.api.guardarConfiguracion({...this.form.getRawValue(),version:cfg.version}).pipe(finalize(() => this.ocupado.set(false))).subscribe({
      next: actual => { this.config.set(actual); this.mensaje.set('Configuración de pruebas guardada para tu empresa.'); },
      error: (error: unknown) => this.error.set(mensajeApi(error)),
    });
  }
  protected simular(r: ReembolsoPago): void {
    if (this.ocupado() || !window.confirm('¿Confirmar esta simulación? No se devolverá dinero real.')) return;
    this.ocupado.set(true); this.error.set('');
    this.api.simularReembolso(r.id).pipe(finalize(() => this.ocupado.set(false))).subscribe({next:actual => this.reembolsos.update(rs => rs.map(x => x.id === actual.id ? actual : x)), error:(error:unknown) => this.error.set(mensajeApi(error))});
  }
  protected reintentar(r: ReembolsoPago): void {
    if (this.ocupado()) return;
    this.ocupado.set(true); this.error.set('');
    this.api.reintentarReembolso(r.id).pipe(finalize(() => this.ocupado.set(false))).subscribe({next:() => this.cargar(),error:(error:unknown) => this.error.set(mensajeApi(error))});
  }
}

export {NotificacionesPage} from './notificaciones.page';
