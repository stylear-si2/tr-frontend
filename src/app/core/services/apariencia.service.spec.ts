import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AparienciaService, APARIENCIA_DEFAULT, contrasteBlanco } from './apariencia.service';
import { EmpresaContextoService, EmpresaPublica } from './empresa-contexto.service';

describe('Identidad visual por empresa', () => {
  const empresa = signal<EmpresaPublica | null>(null);
  beforeEach(() => {
    empresa.set({ id: 1, codigo: 'tienda-a', nombre: 'Tienda A', estado: 'ACTIVA' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: EmpresaContextoService, useValue: { empresa } },
      ],
    });
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());
  it('ignora respuestas anteriores cuando se cambia de tienda', () => {
    const service = TestBed.inject(AparienciaService);
    const http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    const anterior = http.expectOne((r) => r.url.includes('/tienda-a/apariencia'));
    empresa.set({ id: 2, codigo: 'tienda-b', nombre: 'Tienda B', estado: 'ACTIVA' });
    TestBed.tick();
    expect(service.actual().empresa_id).toBe(0);
    http
      .expectOne((r) => r.url.includes('/tienda-b/apariencia'))
      .flush({ ...APARIENCIA_DEFAULT, empresa_id: 2, nombre_comercial: 'Marca B' });
    anterior.flush({ ...APARIENCIA_DEFAULT, empresa_id: 1, nombre_comercial: 'Marca A' });
    expect(service.nombre()).toBe('Marca B');
    empresa.set(null);
    TestBed.tick();
    expect(service.logo()).toBeNull();
    expect(service.nombre()).toBe('StyleAR');
  });
  it('una publicación local no es reemplazada por una lectura pública anterior', () => {
    const service = TestBed.inject(AparienciaService);
    TestBed.tick();
    const r = TestBed.inject(HttpTestingController).expectOne((v) => v.url.includes('/apariencia'));
    service.aplicar({
      ...APARIENCIA_DEFAULT,
      empresa_id: 1,
      nombre_comercial: 'Nueva marca',
      version: 2,
    });
    r.flush({ ...APARIENCIA_DEFAULT, empresa_id: 1, nombre_comercial: 'Anterior' });
    expect(service.nombre()).toBe('Nueva marca');
    expect(service.imagen('https://externo.test/logo.png')).toBeNull();
  });
  it('calcula el contraste antes de permitir un color', () => {
    expect(contrasteBlanco('#000000')).toBe(21);
    expect(contrasteBlanco('#ffffff')).toBe(1);
    expect(contrasteBlanco('url(x)')).toBe(0);
    expect(contrasteBlanco('#143A52')).toBeGreaterThan(4.5);
  });
});
