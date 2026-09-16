import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENTOS_CONDUCTOR,
  DUENO_CONDUCTOR,
  DUENO_VEHICULO,
  TIPO_PAPEL,
  TIPO_TARJETA,
  admiteReverso,
  claveReverso,
  documentosPorDueno,
  etiquetaCara,
  todasLasClaves,
} from '../src/constants/documentosConductor.js';

test('ninguna clave se repite, ni siquiera contando los reversos', () => {
  // Una colisión haría que dos documentos escribieran en el mismo campo del
  // perfil y uno pisara al otro sin aviso.
  const claves = todasLasClaves();
  assert.equal(new Set(claves).size, claves.length);
});

test('un reverso nunca choca con la clave de otro documento', () => {
  const principales = new Set(DOCUMENTOS_CONDUCTOR.map((d) => d.key));
  for (const documento of DOCUMENTOS_CONDUCTOR.filter(admiteReverso)) {
    assert.ok(
      !principales.has(claveReverso(documento.key)),
      `${claveReverso(documento.key)} ya existe como documento propio`,
    );
  }
});

test('solo los documentos de tarjeta admiten segunda cara', () => {
  const conReverso = DOCUMENTOS_CONDUCTOR.filter(admiteReverso).map((d) => d.key);

  assert.deepEqual(
    conReverso.sort(),
    ['dniScaneado', 'licenciaConducir', 'lunasPolarizadas', 'tarjetaPropiedad'].sort(),
  );
  for (const documento of DOCUMENTOS_CONDUCTOR) {
    if (documento.tipo === TIPO_PAPEL) {
      assert.equal(admiteReverso(documento), false, `${documento.key} es papel, no lleva reverso`);
    }
  }
});

test('conserva los doce campos que el wizard ya manejaba', () => {
  // La revisión del administrador mostraba nueve de estos doce. El catálogo
  // existe para que ninguna pantalla vuelva a quedarse corta.
  const previos = [
    'comprobanteDomicilio', 'dniScaneado', 'licenciaConducir', 'recordConductor',
    'antecedentesPoliciales', 'cv', 'certificadosTrabajo', 'referenciasLaborales',
    'cuestionarioManejoDefensivo', 'tarjetaPropiedad', 'soat', 'revisionTecnica',
  ];
  const claves = new Set(DOCUMENTOS_CONDUCTOR.map((d) => d.key));

  for (const key of previos) {
    assert.ok(claves.has(key), `falta ${key}, que ya existía`);
  }
});

test('cada documento declara tipo y dueño válidos', () => {
  for (const documento of DOCUMENTOS_CONDUCTOR) {
    assert.ok([TIPO_TARJETA, TIPO_PAPEL].includes(documento.tipo), documento.key);
    assert.ok([DUENO_CONDUCTOR, DUENO_VEHICULO].includes(documento.dueno), documento.key);
    assert.ok(documento.label?.trim(), `${documento.key} sin etiqueta`);
  }
});

test('separa los documentos del conductor de los del vehículo', () => {
  const delVehiculo = documentosPorDueno(DUENO_VEHICULO).map((d) => d.key);

  assert.deepEqual(delVehiculo.sort(), ['revisionTecnica', 'soat', 'tarjetaPropiedad'].sort());
  assert.ok(
    documentosPorDueno(DUENO_CONDUCTOR).some((d) => d.key === 'lunasPolarizadas'),
    'las lunas polarizadas acompañan al conductor',
  );
});

test('la etiqueta nombra la cara solo cuando el documento tiene dos', () => {
  const dni = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'dniScaneado');
  const cv = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'cv');

  assert.equal(etiquetaCara(dni, 'anverso'), 'DNI Escaneado · Anverso');
  assert.equal(etiquetaCara(dni, 'reverso'), 'DNI Escaneado · Reverso');
  assert.equal(etiquetaCara(cv, 'anverso'), 'Currículum Vitae', 'un papel no tiene anverso que anunciar');
});

test('las lunas polarizadas son opcionales', () => {
  const lunas = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'lunasPolarizadas');

  assert.ok(lunas, 'el documento existe');
  assert.equal(lunas.opcional, true);
  assert.equal(lunas.tipo, TIPO_TARJETA);
});
