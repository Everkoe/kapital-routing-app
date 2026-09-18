import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENTOS_CONDUCTOR,
  DUENO_CONDUCTOR,
  DUENO_VEHICULO,
  TIPO_PAPEL,
  TIPO_TARJETA,
  admiteReverso,
  CARA_COMPLETO,
  caraDestinoParaArrastre,
  caraInicial,
  carasDeDocumento,
  claveCompleto,
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

  // La interfaz dice «delante» y «detrás»; la clave del campo conserva
  // «Reverso» para no dejar huérfano lo ya subido.
  assert.equal(etiquetaCara(dni, 'anverso'), 'DNI Escaneado · Delante');
  assert.equal(etiquetaCara(dni, 'reverso'), 'DNI Escaneado · Detrás');
  assert.equal(etiquetaCara(cv, 'anverso'), 'Currículum Vitae', 'un papel no tiene cara que anunciar');
  assert.equal(claveReverso('dniScaneado'), 'dniScaneadoReverso', 'la clave no cambia con el texto');
});

test('las lunas polarizadas son opcionales', () => {
  const lunas = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'lunasPolarizadas');

  assert.ok(lunas, 'el documento existe');
  assert.equal(lunas.opcional, true);
  assert.equal(lunas.tipo, TIPO_TARJETA);
});

test('un archivo arrastrado cae en el primer hueco libre', () => {
  const caras = [
    { campo: 'dniScaneado', tieneArchivo: false },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];

  assert.equal(caraDestinoParaArrastre(caras), 'dniScaneado', 'con todo vacío, al anverso');
});

test('con el anverso ya subido, el archivo arrastrado va al reverso', () => {
  const caras = [
    { campo: 'dniScaneado', tieneArchivo: true },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];

  assert.equal(caraDestinoParaArrastre(caras), 'dniScaneadoReverso');
});

test('con las dos caras llenas, reemplaza la primera', () => {
  // Cualquier otra regla obligaría a adivinar dónde cae lo que se suelta.
  const caras = [
    { campo: 'dniScaneado', tieneArchivo: true },
    { campo: 'dniScaneadoReverso', tieneArchivo: true },
  ];

  assert.equal(caraDestinoParaArrastre(caras), 'dniScaneado');
});

test('un documento de una sola cara siempre recibe en ella', () => {
  assert.equal(caraDestinoParaArrastre([{ campo: 'cv', tieneArchivo: true }]), 'cv');
  assert.equal(caraDestinoParaArrastre([]), null, 'sin caras no hay destino');
  assert.equal(caraDestinoParaArrastre(null), null);
});

test('un documento de tarjeta ofrece tres caras, completo la última', () => {
  // «Completo» es la alternativa para quien escanea ambas caras en una hoja:
  // va al final porque no se usa junto a las otras dos, sino en su lugar.
  const dni = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'dniScaneado');
  const caras = carasDeDocumento(dni);

  assert.deepEqual(caras.map((c) => c.campo), [
    'dniScaneado', 'dniScaneadoReverso', 'dniScaneadoCompleto',
  ]);
  assert.equal(caras.at(-1).nombre, CARA_COMPLETO);
  assert.equal(caras[0].opcional, undefined, 'la cara de delante no es opcional');
});

test('un documento de papel sigue teniendo una sola cara', () => {
  const cv = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'cv');
  const caras = carasDeDocumento(cv);

  assert.equal(caras.length, 1);
  assert.equal(caras[0].campo, 'cv');
  assert.equal(caras[0].nombre, 'Currículum Vitae', 'se nombra por el documento, no por una cara');
});

test('la clave del archivo completo no choca con ninguna otra', () => {
  const claves = todasLasClaves();

  assert.equal(new Set(claves).size, claves.length);
  assert.ok(claves.includes(claveCompleto('dniScaneado')));
  assert.equal(claveCompleto('dniScaneado'), 'dniScaneadoCompleto');
  assert.notEqual(claveCompleto('dniScaneado'), claveReverso('dniScaneado'));
});

test('con la imagen completa subida, la tarjeta abre por ella', () => {
  // Lo que se veía: subir «Completo» dejaba la tarjeta abierta en un anverso
  // vacío, pidiendo algo que el conductor ya había entregado.
  const caras = [
    { campo: 'dniScaneado', tieneArchivo: false },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
    { campo: 'dniScaneadoCompleto', tieneArchivo: true },
  ];

  assert.equal(caraInicial(caras), 'dniScaneadoCompleto');
  // El destino de un arrastre no cambia: ahí sigue mandando el primer hueco,
  // y de eso depende también la tarjeta del administrador.
  assert.equal(caraDestinoParaArrastre(caras), 'dniScaneado');
});

test('sin imagen completa, la tarjeta abre por donde falta', () => {
  const caras = [
    { campo: 'dniScaneado', tieneArchivo: true },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
    { campo: 'dniScaneadoCompleto', tieneArchivo: false },
  ];

  assert.equal(caraInicial(caras), 'dniScaneadoReverso');
  assert.equal(caraInicial([]), null);
  assert.equal(caraInicial(null), null);
});
