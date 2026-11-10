import { Component, afterNextRender, ElementRef, Injector, viewChild, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize, Subscription } from 'rxjs';
import { AppDrawerComponent } from '../../../../shared/components/app-drawer/app-drawer.component';
import { mensajeApi } from '../../../../core/services/error-api';
import { AuthService } from '../../services/auth.service';
import {
  AccesoAdminService,
  CuentaAcceso,
  DatosCuenta,
  PaginaAccesos,
  RolAcceso,
} from '../../services/acceso-admin.service';
import { SaasService } from '../../../administracion/services/saas.service';
import { Empresa } from '../../../administracion/models/saas.models';
import { EstadoPlanService } from '../../../../core/services/estado-plan.service';

@Component({
  selector: 'app-usuarios-page',
  imports: [ReactiveFormsModule, AppDrawerComponent, RouterLink],
  templateUrl: './usuarios.page.html',
  styleUrls: ['../acceso-admin.css', '../../../../shared/styles/grupos-acceso.css'],
})
export class UsuariosPage {
  private readonly focoInjector = inject(Injector);
  private readonly tituloGrupo = viewChild<ElementRef<HTMLElement>>('tituloGrupo');
  private readonly hubGrupos = viewChild<ElementRef<HTMLElement>>('hubGrupos');
  private enfocarGrupo(abierto: boolean): void {
    afterNextRender(() => (abierto ? this.tituloGrupo() : this.hubGrupos())?.nativeElement.focus(), { injector: this.focoInjector });
  }

  protected readonly auth = inject(AuthService);
  private readonly api = inject(AccesoAdminService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly plan = inject(EstadoPlanService);
  private readonly saas = inject(SaasService);
  protected readonly plataforma = inject(ActivatedRoute).snapshot.data['plataforma'] === true;
  protected readonly puedeOtorgar = computed(
    () => this.plataforma || this.plan.operacionesPermitidas(),
  );
  protected readonly grupo = signal<string | null>(null);
  protected readonly grupos = computed(() => [
    { valor: 'TODOS', etiqueta: 'Todos los usuarios', icono: 'pi-users' },
    ...this.roles().filter(r => r.activo && r.nombre !== 'ADMIN_SAAS').map(r => ({
      valor: r.nombre, etiqueta: this.nombreRol(r.nombre), icono: r.nombre === 'CLIENTE' ? 'pi-shopping-bag' : r.nombre === 'PROVEEDOR' ? 'pi-truck' : 'pi-id-card',
    })),
    { valor: 'SIN_ROL', etiqueta: 'Sin roles activos', icono: 'pi-user-minus' },
  ]);
  protected nombreRol(nombre: string): string {
    const nombres: Record<string, string> = { CLIENTE: 'Clientes', ADMINISTRADOR: 'Administradores', PROVEEDOR: 'Proveedores', CAJERO: 'Cajeros', ENCARGADO_SUCURSAL: 'Encargados de sucursal', PERSONAL_VENTAS: 'Personal de ventas', TODOS: 'Todos los usuarios', SIN_ROL: 'Sin roles activos' };
    return nombres[nombre] ?? nombre.replaceAll('_', ' ').toLowerCase();
  }
  protected elegirGrupo(grupo: string | null): void {
    this.grupo.set(grupo);
    this.enfocarGrupo(grupo !== null);
    this.filtros.controls.busqueda.setValue('');
    if (grupo !== null) this.cargar(1);
  }
  private carga?: Subscription;
  protected readonly ambito = signal<number | null>(null);
  protected readonly empresa = new FormControl<number | null>(null);
  protected readonly empresas = signal<Empresa[]>([]);
  protected readonly roles = signal<RolAcceso[]>([]);
  protected readonly pagina = signal<PaginaAccesos>({
    registros: [],
    total: 0,
    pagina: 1,
    por_pagina: 25,
    total_paginas: 1,
  });
  protected readonly cargando = signal(false);
  protected readonly procesando = signal(false);
  protected readonly error = signal('');
  protected readonly mensaje = signal('');
  protected readonly tipo = signal<'nuevo' | 'editar' | 'roles' | 'estado' | null>(null);
  protected readonly seleccion = signal<CuentaAcceso | null>(null);
  protected readonly catalogoDisponible = signal(false);
  protected readonly rolElegido = new FormControl<number | null>(null, Validators.required);
  protected readonly filtros = new FormGroup({
    busqueda: new FormControl('', { nonNullable: true }),
    estado: new FormControl('ACTIVOS', { nonNullable: true }),
  });
  protected readonly form = new FormGroup({
    nombre: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    apellido: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(100)],
    }),
    username: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/^[a-zA-Z0-9_.-]{4,80}$/)],
    }),
    correo: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true }),
    rol: new FormControl<number | null>(null),
  });
  protected readonly rolesAsignables = computed(() => {
    const scope = this.plataforma ? this.ambito() : 1;
    return this.roles().filter(
      (r) =>
        r.activo &&
        (scope === null
          ? r.nombre === 'ADMIN_SAAS'
          : this.plataforma
            ? r.nombre === 'ADMINISTRADOR'
            : r.nombre !== 'ADMIN_SAAS' && r.protegido),
    );
  });
  constructor() {
    this.auth
      .cargarCapacidades()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.catalogos(), error: (e) => this.error.set(mensajeApi(e)) });
    if (this.plataforma)
      this.saas
        .empresas()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (r) => this.empresas.set(r),
          error: (e) => this.error.set(mensajeApi(e)),
        });
    this.empresa.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => {
      this.ambito.set(value);
      this.tipo.set(null);
      this.seleccion.set(null);
      this.mensaje.set('');
      this.pagina.update((p) => ({ ...p, registros: [], total: 0, pagina: 1, total_paginas: 1 }));
      this.catalogos();
      this.cargar(1);
    });
    this.cargar();
  }
  protected puede(p: string) {
    return this.auth.puede(p);
  }
  protected cargar(n = 1) {
    if (!this.plataforma && this.grupo() === null) return;
    const v = this.filtros.getRawValue();
    this.carga?.unsubscribe();
    this.cargando.set(true);
    this.error.set('');
    this.carga = this.api
      .cuentas(this.plataforma, this.empresa.value, v.estado, v.busqueda, n, this.grupo() === 'TODOS' ? null : this.grupo())
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.cargando.set(false)),
      )
      .subscribe({ next: (r) => this.pagina.set(r), error: (e) => this.error.set(mensajeApi(e)) });
  }
  private catalogos() {
    this.api
      .catalogos()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (c) => {
          this.roles.set(c.roles);
          this.catalogoDisponible.set(true);
        },
        error: (e) => {
          this.catalogoDisponible.set(false);
          this.error.set(mensajeApi(e));
        },
      });
  }
  protected abrir(tipo: 'nuevo' | 'editar' | 'roles' | 'estado', u: CuentaAcceso | null = null) {
    this.error.set('');
    this.mensaje.set('');
    this.seleccion.set(u);
    this.rolElegido.reset();
    this.form.reset({
      nombre: u?.nombre ?? '',
      apellido: u?.apellido ?? '',
      username: u?.username ?? '',
      correo: u?.correo ?? '',
      password: '',
      rol: null,
    });
    this.tipo.set(tipo);
  }
  protected cerrar() {
    if (!this.procesando()) {
      this.tipo.set(null);
      this.form.controls.password.reset();
      this.error.set('');
    }
  }
  protected guardar() {
    if (this.procesando()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const f = this.form.getRawValue(),
      nuevo = this.tipo() === 'nuevo';
    const datos: DatosCuenta = {
      nombre: f.nombre,
      apellido: f.apellido,
      username: f.username,
      correo: f.correo,
    };
    if (nuevo) {
      if (
        !f.rol ||
        f.password.length < 8 ||
        !/[A-Z]/.test(f.password) ||
        !/[a-z]/.test(f.password) ||
        !/\d/.test(f.password) ||
        !/[^A-Za-z0-9]/.test(f.password)
      ) {
        this.error.set(
          'Selecciona un rol e ingresa una contraseña de al menos 8 caracteres con mayúscula, minúscula, número y símbolo.',
        );
        return;
      }
      datos.password = f.password;
      datos.rol_id = f.rol;
    }
    this.procesando.set(true);
    this.error.set('');
    this.api
      .guardar(this.plataforma, this.empresa.value, nuevo ? null : this.seleccion()!.id, datos)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.procesando.set(false)),
      )
      .subscribe({
        next: () => {
          this.tipo.set(null);
          this.form.controls.password.reset();
          this.mensaje.set('Cuenta guardada correctamente.');
          this.cargar(this.pagina().pagina);
        },
        error: (e) => this.error.set(mensajeApi(e)),
      });
  }
  protected cambiarEstado() {
    const u = this.seleccion();
    if (!u || this.procesando()) return;
    this.procesando.set(true);
    this.error.set('');
    this.api
      .estado(this.plataforma, this.empresa.value, u.id, !u.activo)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.procesando.set(false)),
      )
      .subscribe({
        next: (r) => {
          this.tipo.set(null);
          this.mensaje.set(r.mensaje);
          this.cargar(this.pagina().pagina);
        },
        error: (e) => this.error.set(mensajeApi(e)),
      });
  }
  protected cambiarRol(activo: boolean) {
    const u = this.seleccion(),
      rol = this.rolElegido.value;
    if (!u || !rol || this.procesando()) return;
    this.procesando.set(true);
    this.error.set('');
    this.api
      .rol(this.plataforma, this.empresa.value, u.id, rol, activo)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.procesando.set(false)),
      )
      .subscribe({
        next: (r) => {
          this.tipo.set(null);
          this.mensaje.set(r.mensaje);
          this.cargar(this.pagina().pagina);
        },
        error: (e) => this.error.set(mensajeApi(e)),
      });
  }
}
