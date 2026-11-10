import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize, forkJoin } from 'rxjs';
import { mensajeApi } from '../../../../core/services/error-api';
import { PagoService } from '../../services/pago.service';
import { ConfiguracionPagosEmpresa, ReembolsoPago } from '../../models/pago.models';

@Component({
  selector: 'app-pagos-empresa',
  imports: [ReactiveFormsModule, RouterLink],
  styleUrl: './pagos-empresa.page.css',
  templateUrl: './pagos-empresa.page.html',
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
    this.mensaje.set('');
    this.api.guardarConfiguracion({...this.form.getRawValue(),version:cfg.version}).pipe(finalize(() => this.ocupado.set(false))).subscribe({
      next: actual => { this.config.set(actual); this.mensaje.set('Configuración guardada para tu empresa.'); },
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
