import { AparienciaAdminService } from './apariencia-admin.service';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AparienciaService,
  AparienciaDatos,
  AparienciaEmpresa,
  contrasteBlanco,
} from '../../../../core/services/apariencia.service';
import { EmpresaContextoService } from '../../../../core/services/empresa-contexto.service';
import { CambioContextoService } from '../../../../core/services/cambio-contexto.service';
import { mensajeApi } from '../../../../core/services/error-api';

const colorValido = (c: AbstractControl<string>) =>
  contrasteBlanco(c.value) >= 4.5 ? null : { contraste: true };

@Component({
  selector: 'app-personalizar-tienda',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './personalizar-tienda.page.html',
  styleUrl: './personalizar-tienda.page.css',
})
export class PersonalizarTiendaPage {
  protected readonly marca = inject(AparienciaService);
  private readonly admin = inject(AparienciaAdminService);
  private readonly contexto = inject(EmpresaContextoService);
  private readonly cambios = inject(CambioContextoService);
  private readonly destroy = inject(DestroyRef);
  private generacion = this.cambios.generacion();
  private destruida = false;
  protected readonly cargando = signal(true);
  protected readonly ocupada = signal(false);
  protected readonly error = signal('');
  protected readonly aviso = signal('');
  protected readonly confirmarReset = signal(false);
  protected readonly guardado = signal<AparienciaEmpresa | null>(null);
  protected readonly archivos = signal<Partial<Record<'logo' | 'portada', File | null>>>({});
  protected readonly previews = signal<Partial<Record<'logo' | 'portada', string | null>>>({});
  protected readonly formulario = new FormGroup({
    nombre_comercial: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    color_principal: new FormControl('#111111', { nonNullable: true, validators: [colorValido] }),
    color_secundario: new FormControl('#485735', { nonNullable: true, validators: [colorValido] }),
    titulo_bienvenida: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(100)],
    }),
    mensaje_bienvenida: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(400)],
    }),
    telefono: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    whatsapp: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^\+?[0-9]{7,15}$/)],
    }),
    direccion: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(240)] }),
    horarios: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(300)] }),
    instagram: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.maxLength(300),
        Validators.pattern(/^https:\/\/(www\.)?instagram\.com(?:[/?#].*)?$/i),
      ],
    }),
    facebook: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.maxLength(300),
        Validators.pattern(/^https:\/\/(www\.)?(facebook\.com|fb\.com)(?:[/?#].*)?$/i),
      ],
    }),
    sitio_web: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(300), Validators.pattern(/^https:\/\/[^\s]+$/i)],
    }),
  });
  protected readonly borrador = signal<AparienciaDatos>(this.formulario.getRawValue());
  protected readonly nombre = computed(
    () => this.borrador().nombre_comercial.trim() || this.contexto.empresa()?.nombre || 'Tu tienda',
  );
  protected readonly principal = computed(() =>
    contrasteBlanco(this.borrador().color_principal) >= 4.5
      ? this.borrador().color_principal
      : '#111111',
  );
  protected readonly secundario = computed(() =>
    contrasteBlanco(this.borrador().color_secundario) >= 4.5
      ? this.borrador().color_secundario
      : '#485735',
  );
  protected readonly logo = computed(() =>
    this.previews().logo !== undefined
      ? this.previews().logo
      : this.marca.imagen(this.guardado()?.logo_url ?? null),
  );
  protected readonly portada = computed(() =>
    this.previews().portada !== undefined
      ? this.previews().portada
      : this.marca.imagen(this.guardado()?.portada_url ?? null),
  );
  protected readonly contactos: {
    clave:
      'telefono' | 'whatsapp' | 'direccion' | 'horarios' | 'instagram' | 'facebook' | 'sitio_web';
    titulo: string;
    ejemplo: string;
  }[] = [
    { clave: 'telefono', titulo: 'Teléfono', ejemplo: '+591 70000000' },
    { clave: 'whatsapp', titulo: 'WhatsApp', ejemplo: '59170000000' },
    {
      clave: 'direccion',
      titulo: 'Dirección de contacto',
      ejemplo: 'Santa Cruz de la Sierra, Bolivia',
    },
    { clave: 'horarios', titulo: 'Horarios de atención', ejemplo: 'Lunes a sábado, 09:00 a 20:00' },
    { clave: 'instagram', titulo: 'Instagram', ejemplo: 'https://www.instagram.com/tutienda' },
    { clave: 'facebook', titulo: 'Facebook', ejemplo: 'https://www.facebook.com/tutienda' },
    { clave: 'sitio_web', titulo: 'Sitio web', ejemplo: 'https://tutienda.com' },
  ];
  constructor() {
    this.formulario.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.borrador.set(this.formulario.getRawValue()));
    this.cambios.cambio$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.generacion = -1;
      this.limpiarPreviews();
      this.guardado.set(null);
      this.formulario.disable();
      this.error.set('La empresa o la sesión cambió. Vuelve a abrir esta pantalla.');
    });
    this.destroy.onDestroy(() => {
      this.destruida = true;
      this.limpiarPreviews();
    });
    void this.cargar();
  }
  private vigente(): boolean {
    return !this.destruida && this.generacion === this.cambios.generacion();
  }
  protected async cargar(): Promise<void> {
    if (!this.vigente()) return;
    this.cargando.set(true);
    this.error.set('');
    try {
      const d = await firstValueFrom(this.admin.obtener());
      if (this.vigente()) this.aceptar(d);
    } catch (e) {
      if (this.vigente()) this.error.set(mensajeApi(e, 'No se pudo cargar la personalización.'));
    } finally {
      if (this.vigente()) this.cargando.set(false);
    }
  }
  private aceptar(datos: AparienciaEmpresa): void {
    this.guardado.set(datos);
    this.formulario.reset(datos);
    this.borrador.set(this.formulario.getRawValue());
    this.limpiarPreviews();
    this.marca.aplicar(datos);
  }
  protected elegirColor(campo: 'color_principal' | 'color_secundario', evento: Event): void {
    this.formulario.controls[campo].setValue((evento.target as HTMLInputElement).value);
    this.formulario.markAsDirty();
  }
  protected seleccionar(tipo: 'logo' | 'portada', evento: Event): void {
    const input = evento.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.ocupada()) return;
    if (file.size > 5 * 1048576 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.error.set('Elige una imagen PNG, JPG o WebP de hasta 5 MB.');
      return;
    }
    const previa = this.previews()[tipo];
    if (previa) URL.revokeObjectURL(previa);
    this.archivos.update((v) => ({ ...v, [tipo]: file }));
    this.previews.update((v) => ({ ...v, [tipo]: URL.createObjectURL(file) }));
    this.formulario.markAsDirty();
    this.error.set('');
    this.aviso.set('Imagen preparada. Se publicará cuando guardes los cambios.');
  }
  protected quitar(tipo: 'logo' | 'portada'): void {
    const previa = this.previews()[tipo];
    if (previa) URL.revokeObjectURL(previa);
    this.archivos.update((v) => ({ ...v, [tipo]: null }));
    this.previews.update((v) => ({ ...v, [tipo]: null }));
    this.formulario.markAsDirty();
  }
  private limpiarPreviews(): void {
    for (const url of Object.values(this.previews())) if (url) URL.revokeObjectURL(url);
    this.previews.set({});
    this.archivos.set({});
  }
  protected async guardar(): Promise<void> {
    if (this.ocupada() || !this.guardado() || !this.vigente()) return;
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid) {
      this.error.set('Revisa los campos marcados antes de guardar.');
      return;
    }
    this.ocupada.set(true);
    this.error.set('');
    this.aviso.set('');
    try {
      const d = await firstValueFrom(
        this.admin.publicar(
          this.formulario.getRawValue(),
          this.guardado()!.version,
          this.archivos(),
        ),
      );
      if (this.vigente()) {
        this.aceptar(d);
        this.aviso.set('Personalización guardada. Tu tienda ya muestra los cambios.');
      }
    } catch (e) {
      if (this.vigente())
        this.error.set(mensajeApi(e, 'No se pudo guardar. Tus cambios siguen en la vista previa.'));
    } finally {
      if (this.vigente()) this.ocupada.set(false);
    }
  }
  protected descartar(): void {
    const d = this.guardado();
    if (d) this.aceptar(d);
    this.aviso.set('Vista previa descartada.');
  }
  protected async restablecer(): Promise<void> {
    if (this.ocupada() || !this.guardado() || !this.vigente()) return;
    this.ocupada.set(true);
    this.error.set('');
    try {
      const d = await firstValueFrom(this.admin.restablecer(this.guardado()!.version));
      if (this.vigente()) {
        this.aceptar(d);
        this.confirmarReset.set(false);
        this.aviso.set('Diseño restablecido. Se conservaron el nombre y los datos de contacto.');
      }
    } catch (e) {
      if (this.vigente()) this.error.set(mensajeApi(e));
    } finally {
      if (this.vigente()) this.ocupada.set(false);
    }
  }
}
