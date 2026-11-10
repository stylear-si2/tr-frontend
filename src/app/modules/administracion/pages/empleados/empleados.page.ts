import { mensajeApi } from '../../../../core/services/error-api';
import { AuthService } from '../../../autenticacion/services/auth.service';
import { EstadoPlanService } from '../../../../core/services/estado-plan.service';
import { OperacionNuevaDirective } from '../../../../core/directives/operacion-nueva.directive';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, afterNextRender, ElementRef, Injector, viewChild, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { finalize } from 'rxjs';
import { SucursalResponse } from '../../models/ciudad-sucursal.models';
import { CuentaEmpleadoDisponible, EmpleadoResponse } from '../../models/empleado.models';
import { CiudadSucursalService } from '../../services/ciudad-sucursal.service';
import { EmpleadoService } from '../../services/empleado.service';
import { AppModalComponent } from '../../../../shared/components/app-modal/app-modal.component';

@Component({
  imports: [OperacionNuevaDirective, ReactiveFormsModule, AppModalComponent],
  selector: 'app-empleados-page',
  styleUrls: ['./empleados.page.css', '../../../../shared/styles/grupos-acceso.css'],
  templateUrl: './empleados.page.html',
})
export class EmpleadosPage {
  private readonly focoInjector = inject(Injector);
  private readonly tituloGrupo = viewChild<ElementRef<HTMLElement>>('tituloGrupo');
  private readonly hubGrupos = viewChild<ElementRef<HTMLElement>>('hubGrupos');
  private enfocarGrupo(abierto: boolean): void {
    afterNextRender(() => (abierto ? this.tituloGrupo() : this.hubGrupos())?.nativeElement.focus(), { injector: this.focoInjector });
  }

  protected readonly auth = inject(AuthService);
  protected readonly soloConsulta = computed(() => !this.auth.tieneRol('ADMINISTRADOR'));
  protected readonly modoNuevo = signal(true);
  protected readonly cuentas = signal<CuentaEmpleadoDisponible[]>([]);
  protected readonly empleadoActivando = signal<EmpleadoResponse | null>(null);
  protected readonly rolReactivacion = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  protected readonly planEstado = inject(EstadoPlanService);
  private readonly empleadoService = inject(EmpleadoService);
  private readonly ciudadSucursalService = inject(CiudadSucursalService);

  protected readonly grupoEmpleado = signal<string | null>(null);
  protected elegirGrupoEmpleado(rol: string | null): void {
    this.grupoEmpleado.set(rol);
    this.enfocarGrupo(rol !== null);
    this.busqueda.set('');
  }
  protected readonly empleados = signal<EmpleadoResponse[]>([]);
  protected readonly sucursales = signal<SucursalResponse[]>([]);
  protected readonly busqueda = signal('');
  protected readonly cargando = signal(false);
  protected readonly procesando = signal(false);
  protected readonly empleadoEditandoId = signal<number | null>(null);
  protected readonly formularioAbierto = signal(false);
  protected readonly mensaje = signal('');
  protected readonly error = signal('');

  protected readonly rolesDisponibles = [
    { valor: 'ENCARGADO_SUCURSAL', etiqueta: 'Encargado de Sucursal' },
    { valor: 'CAJERO', etiqueta: 'Cajero' },
    { valor: 'PERSONAL_VENTAS', etiqueta: 'Personal de Ventas' },
  ];

  protected readonly empleadosFiltrados = computed(() => {
    const busqueda = this.busqueda().trim().toLowerCase();

    const grupo = this.grupoEmpleado();
    const empleados = this.empleados().filter(e => grupo === 'TODOS' || grupo === null || (grupo === 'SIN_ROL' ? e.roles.length === 0 : e.roles.includes(grupo)));
    if (busqueda === '') return empleados;

    return empleados.filter((empleado) => {
      const texto = [
        empleado.nombre,
        empleado.apellido,
        empleado.username,
        empleado.correo,
        empleado.cargo,
        empleado.sucursal_nombre,
        empleado.codigo_empleado,
      ]
        .join(' ')
        .toLowerCase();

      return texto.includes(busqueda);
    });
  });

  protected readonly empleadoForm = new FormGroup({
    nombre: new FormControl('', { nonNullable: true }),
    apellido: new FormControl('', { nonNullable: true }),
    username: new FormControl('', { nonNullable: true }),
    correo: new FormControl('', { nonNullable: true }),
    password: new FormControl('', { nonNullable: true }),
    usuarioId: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(1)],
    }),
    sucursalId: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(1)],
    }),
    codigoEmpleado: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    cargo: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    rol: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
  });

  constructor() {
    this.configurarModo(true);
    this.cargarDatos();
  }

  protected actualizarBusqueda(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.busqueda.set(input.value);
  }

  protected seleccionarEmpleado(empleado: EmpleadoResponse): void {
    this.empleadoEditandoId.set(empleado.empleado_id);
    this.empleadoForm.patchValue({
      usuarioId: empleado.usuario_id,
      sucursalId: empleado.sucursal_id,
      codigoEmpleado: empleado.codigo_empleado,
      cargo: empleado.cargo,
      rol: empleado.rol_laboral ?? '',
    });
    this.configurarModo(false);
    this.empleadoForm.controls.usuarioId.disable();
    this.formularioAbierto.set(true);
    this.limpiarMensajes();
  }


  protected abrirNuevoEmpleado(): void {
    this.cancelarEdicion();
    this.formularioAbierto.set(true);
    this.limpiarMensajes();
  }

  protected cerrarFormulario(): void {
    this.cancelarEdicion();
    this.formularioAbierto.set(false);
  }

  protected cancelarEdicion(): void {
    this.empleadoEditandoId.set(null);
    this.empleadoForm.reset();
    this.empleadoForm.controls.usuarioId.enable();
    this.configurarModo(true);
  }

  protected cambiarModo(event: Event): void {
    this.configurarModo((event.target as HTMLSelectElement).value === 'nuevo');
  }

  private configurarModo(nuevo: boolean): void {
    this.modoNuevo.set(nuevo);
    const crear = nuevo && this.empleadoEditandoId() === null;
    for (const key of ['nombre', 'apellido', 'username', 'correo', 'password'] as const) {
      const control = this.empleadoForm.controls[key];
      control.setValidators(crear ? [Validators.required] : []);
      if (crear && key === 'correo') control.addValidators(Validators.email);
      if (crear && key === 'username') control.addValidators([Validators.minLength(4), Validators.maxLength(80)]);
      if (crear && key === 'password') control.addValidators(Validators.minLength(8));
      control.updateValueAndValidity();
    }
    this.empleadoForm.controls.usuarioId.setValidators(!crear && this.empleadoEditandoId() === null ? [Validators.required] : []);
    this.empleadoForm.controls.usuarioId.updateValueAndValidity();
  }

  protected guardarEmpleado(): void {
    if (this.soloConsulta()) return;
    this.limpiarMensajes();

    if (this.empleadoForm.invalid) {
      this.empleadoForm.markAllAsTouched();
      return;
    }

    const { usuarioId, sucursalId, codigoEmpleado, cargo, rol } =
      this.empleadoForm.getRawValue();

    if (sucursalId === null || (usuarioId === null && !this.modoNuevo() && this.empleadoEditandoId() === null)) {
      this.error.set('Debes indicar usuario y sucursal.');
      return;
    }

    this.procesando.set(true);
    const empleadoId = this.empleadoEditandoId();
    const request = {
      sucursal_id: sucursalId,
      codigo_empleado: codigoEmpleado.trim(),
      cargo: cargo.trim(),
      rol: rol.trim().toUpperCase(),
    };
    const operacion =
      empleadoId === null
        ? (this.modoNuevo()
            ? this.empleadoService.crearUsuarioEmpleado({ ...request,
                nombre: this.empleadoForm.controls.nombre.value.trim(), apellido: this.empleadoForm.controls.apellido.value.trim(),
                username: this.empleadoForm.controls.username.value.trim(), correo: this.empleadoForm.controls.correo.value.trim(),
                password: this.empleadoForm.controls.password.value })
            : this.empleadoService.crearEmpleado({ usuario_id: Number(usuarioId), ...request }))
        : this.empleadoService.actualizarEmpleado(empleadoId, request);

    operacion.pipe(finalize(() => this.procesando.set(false))).subscribe({
      next: () => {
        this.mensaje.set(
          empleadoId === null
            ? 'Empleado creado correctamente.'
            : 'Empleado actualizado correctamente.'
        );
        this.cerrarFormulario();
        this.cargarDatos();
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(this.obtenerMensajeError(error));
      },
    });
  }

  protected cambiarEstadoEmpleado(empleado: EmpleadoResponse): void {
    if (this.soloConsulta() || this.procesando()) return;
    this.limpiarMensajes();
    if (!empleado.activo) {
      this.rolReactivacion.setValue(empleado.rol_laboral ?? '');
      this.empleadoActivando.set(empleado);
      return;
    }
    if (!window.confirm(`Desactivar a ${empleado.nombre} ${empleado.apellido}? Se cerrarán sus sesiones laborales.`)) return;
    this.procesando.set(true);
    this.empleadoService.desactivarEmpleado(empleado.empleado_id).pipe(finalize(() => this.procesando.set(false))).subscribe({
      next: () => { this.mensaje.set('Empleado desactivado. Se cerraron sus sesiones.'); this.cargarDatos(); },
      error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
    });
  }

  protected reactivarEmpleado(): void {
    const empleado = this.empleadoActivando();
    if (!empleado || this.rolReactivacion.invalid || this.soloConsulta()) return;
    this.procesando.set(true);
    this.empleadoService.activarEmpleado(empleado.empleado_id, { rol: this.rolReactivacion.value })
      .pipe(finalize(() => this.procesando.set(false))).subscribe({
        next: () => { this.empleadoActivando.set(null); this.mensaje.set('Empleado reactivado. Debe ingresar nuevamente.'); this.cargarDatos(); },
        error: (error: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(error)),
      });
  }

  private cargarDatos(): void {
    this.cargarEmpleados();
    if (this.soloConsulta()) return;
    this.empleadoService.cuentasDisponibles().subscribe({ next: (cuentas) => this.cuentas.set(cuentas), error: (e: HttpErrorResponse) => this.error.set(this.obtenerMensajeError(e)) });
    this.ciudadSucursalService.listarSucursales().subscribe({
      next: (sucursales) => {
        this.sucursales.set(sucursales);
      },
      error: (error: HttpErrorResponse) => {
        this.error.set(this.obtenerMensajeError(error));
      },
    });
  }

  private cargarEmpleados(): void {
    this.cargando.set(true);
    this.error.set('');

    this.empleadoService
      .listarEmpleados(true)
      .pipe(finalize(() => this.cargando.set(false)))
      .subscribe({
        next: (empleados) => {
          this.empleados.set(empleados);
        },
        error: (error: HttpErrorResponse) => {
          this.error.set(this.obtenerMensajeError(error));
        },
      });
  }

  private limpiarMensajes(): void {
    this.mensaje.set('');
    this.error.set('');
  }

  private obtenerMensajeError(error: HttpErrorResponse): string {
    return mensajeApi(error);
  }
}
