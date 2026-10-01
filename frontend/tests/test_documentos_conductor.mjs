import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENTOS_CONDUCTOR,
  DUENO_CONDUCTOR,
  DUENO_VEHICULO,
  TIPO_PAPEL,
  TIPO_TARJETA,
  TIPO_DOS_HOJAS,
  admiteReverso,
  CARA_COMPLETO,
  campoDeVencimiento,
  caraBloqueada,
  caraDestinoParaArrastre,
  caraInicial,
  carasDeDocumento,
  conDocumentoNuevo,
  claveCompleto,
  claveReverso,
  documentoPorClave,
  documentosDeLaRevision,
  documentosPorDueno,
  documentosQueEntregaElConductor,
  esDeAdministracion,
  textosDeCaras,
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

test('solo las tarjetas y los de dos hojas admiten segunda cara', () => {
  const conReverso = DOCUMENTOS_CONDUCTOR.filter(admiteReverso).map((d) => d.key);

  assert.deepEqual(
    conReverso.sort(),
    ['camo', 'dniScaneado', 'licenciaConducir', 'lunasPolarizadas', 'tarjetaPropiedad'].sort(),
  );
  for (const documento of DOCUMENTOS_CONDUCTOR) {
    if (documento.tipo === TIPO_PAPEL) {
      assert.equal(admiteReverso(documento), false, `${documento.key} es papel, no lleva reverso`);
    }
  }
});

test('conserva los campos que el wizard ya manejaba', () => {
  // La revisión del administrador mostraba nueve de estos. El catálogo existe
  // para que ninguna pantalla vuelva a quedarse corta. El cuestionario de
  // manejo defensivo salió a propósito: es el test del alta, no un papel.
  const previos = [
    'comprobanteDomicilio', 'dniScaneado', 'licenciaConducir', 'recordConductor',
    'antecedentesPoliciales', 'cv', 'certificadosTrabajo', 'referenciasLaborales',
    'tarjetaPropiedad', 'soat', 'revisionTecnica',
  ];
  const claves = new Set(DOCUMENTOS_CONDUCTOR.map((d) => d.key));

  for (const key of previos) {
    assert.ok(claves.has(key), `falta ${key}, que ya existía`);
  }
  assert.equal(claves.has('cuestionarioManejoDefensivo'), false);
});

test('cada documento declara tipo y dueño válidos', () => {
  for (const documento of DOCUMENTOS_CONDUCTOR) {
    assert.ok([TIPO_TARJETA, TIPO_PAPEL, TIPO_DOS_HOJAS].includes(documento.tipo), documento.key);
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

test('sin nada subido, lo arrastrado o pegado va a la imagen completa', () => {
  // Es lo que se sube casi siempre; iba a «Delante» y ahí acababa el DNI entero.
  const caras = [
    { campo: 'dniScaneadoCompleto', tieneArchivo: false },
    { campo: 'dniScaneado', tieneArchivo: false },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];

  assert.equal(caraDestinoParaArrastre(caras), 'dniScaneadoCompleto');
});

test('con la imagen completa subida, lo arrastrado la reemplaza', () => {
  const caras = [
    { campo: 'dniScaneadoCompleto', tieneArchivo: true },
    { campo: 'dniScaneado', tieneArchivo: false },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];

  assert.equal(caraDestinoParaArrastre(caras), 'dniScaneadoCompleto');
});

test('delante y detrás se bloquean mientras haya imagen completa', () => {
  const vacias = [
    { campo: 'dniScaneadoCompleto', tieneArchivo: false },
    { campo: 'dniScaneado', tieneArchivo: false },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];
  assert.deepEqual(vacias.map((c) => caraBloqueada(c, vacias)), [false, false, false]);

  const conCompleta = vacias.map((c) => ({ ...c, tieneArchivo: c.campo === 'dniScaneadoCompleto' }));
  // La completa se puede reemplazar siempre; las otras, no.
  assert.deepEqual(conCompleta.map((c) => caraBloqueada(c, conCompleta)), [false, true, true]);
  assert.equal(caraBloqueada({ campo: 'cv' }, [{ campo: 'cv', tieneArchivo: true }]), false);
});

test('reemplazar un documento lo deja pendiente de revisar', () => {
  const perfil = {
    recordConductor: { path: 'K-027/recordConductor-aaaa.pdf' },
    revision_docs: { recordConductor: { estado: 'aprobado', fecha: 'x' }, soat: { estado: 'aprobado' } },
  };
  const nuevo = conDocumentoNuevo(perfil, 'recordConductor', { path: 'K-027/recordConductor-bbbb.pdf' });

  assert.equal(nuevo.recordConductor.path, 'K-027/recordConductor-bbbb.pdf');
  assert.deepEqual(nuevo.revision_docs.recordConductor, { estado: 'pendiente', fecha: 'x' });
  assert.equal(nuevo.revision_docs.soat.estado, 'aprobado', 'los demás no se tocan');
  assert.equal(perfil.revision_docs.recordConductor.estado, 'aprobado', 'sin mutar el perfil de antes');
  assert.equal(conDocumentoNuevo({}, 'cv', { path: 'x' }).revision_docs, undefined);
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

test('un documento de tarjeta ofrece tres caras, completo la primera', () => {
  // Iba al final, como la alternativa, y la gente subía el DNI entero en «Delante».
  const dni = DOCUMENTOS_CONDUCTOR.find((d) => d.key === 'dniScaneado');
  const caras = carasDeDocumento(dni);

  assert.deepEqual(caras.map((c) => c.campo), [
    'dniScaneadoCompleto', 'dniScaneado', 'dniScaneadoReverso',
  ]);
  assert.equal(caras[0].nombre, CARA_COMPLETO);
  assert.equal(caras[1].opcional, undefined, 'la cara de delante no es opcional');
});

test('los documentos que vencen piden su fecha, por cualquiera de sus caras', () => {
  assert.equal(campoDeVencimiento('soat'), 'soatVence');
  assert.equal(campoDeVencimiento('licenciaConducirReverso'), 'licenciaConducirVence');
  assert.equal(campoDeVencimiento('revisionTecnica'), 'revisionTecnicaVence');
  assert.equal(campoDeVencimiento('tarjetaPropiedad'), null, 'la tarjeta de propiedad no vence');
  assert.equal(campoDeVencimiento('dniScaneadoCompleto'), null);
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
    { campo: 'dniScaneadoCompleto', tieneArchivo: true },
    { campo: 'dniScaneado', tieneArchivo: false },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];

  assert.equal(caraInicial(caras), 'dniScaneadoCompleto');
});

test('empezado por caras sueltas, la tarjeta abre por la que falta', () => {
  const caras = [
    { campo: 'dniScaneadoCompleto', tieneArchivo: false },
    { campo: 'dniScaneado', tieneArchivo: true },
    { campo: 'dniScaneadoReverso', tieneArchivo: false },
  ];

  assert.equal(caraInicial(caras), 'dniScaneadoReverso');
  assert.equal(caraInicial([]), null);
  assert.equal(caraInicial(null), null);
});

test('el CAMO lo sube Administración y al conductor no se le ofrece', () => {
  const camo = documentoPorClave('camo');

  assert.ok(camo, 'el documento existe');
  assert.equal(camo.tipo, TIPO_DOS_HOJAS, 'dos hojas, cada una en su foto o su PDF');
  assert.equal(camo.dueno, DUENO_CONDUCTOR, 'va con los del conductor en la ficha');
  assert.equal(esDeAdministracion(camo), true);
  assert.match(camo.detalle, /Aptitud Médico Ocupacional/);
  // La revisión de Administración lo enseña; las pantallas del conductor, no.
  assert.ok(documentosPorDueno(DUENO_CONDUCTOR).includes(camo));
  assert.equal(documentosQueEntregaElConductor().includes(camo), false);
});

test('el resto de documentos los sigue entregando el conductor', () => {
  const deAdministracion = DOCUMENTOS_CONDUCTOR.filter(esDeAdministracion).map((d) => d.key);
  assert.deepEqual(deAdministracion, ['camo']);
  assert.equal(documentosQueEntregaElConductor().length, DOCUMENTOS_CONDUCTOR.length - 1);
  assert.equal(esDeAdministracion(documentoPorClave('dniScaneado')), false);
  assert.equal(esDeAdministracion(null), false);
});

test('el CAMO son dos hojas sueltas, cada una en su sitio', () => {
  // Pedido del usuario: la clínica entrega dos hojas, y cada foto o PDF se
  // sube en la suya. Sin «las dos juntas»: lo arrastrado a la hoja 1 va a la
  // hoja 1, y lo de la hoja 2 a la hoja 2.
  const camo = documentoPorClave('camo');
  const caras = carasDeDocumento(camo);

  assert.deepEqual(caras.map((c) => c.campo), ['camo', 'camoReverso']);
  assert.deepEqual(caras.map((c) => c.nombre), ['Hoja 1', 'Hoja 2']);
  assert.equal(etiquetaCara(camo, 'reverso'), 'CAMO · Hoja 2');
  assert.equal(textosDeCaras(camo).separadas, 'Hoja 1 y hoja 2 subidas');
  assert.equal(todasLasClaves().includes('camoCompleto'), false);
  // Ninguna bloquea a la otra.
  const llenas = caras.map((cara) => ({ ...cara, tieneArchivo: true }));
  assert.equal(llenas.some((cara) => caraBloqueada(cara, llenas)), false);
});

test('un carnet sigue con delante, detrás y completo', () => {
  const dni = documentoPorClave('dniScaneado');
  assert.deepEqual(carasDeDocumento(dni).map((c) => c.nombre), [CARA_COMPLETO, 'Delante', 'Detrás']);
  assert.equal(etiquetaCara(dni, 'reverso'), 'DNI Escaneado · Detrás');
  assert.equal(textosDeCaras(documentoPorClave('cv')), null, 'un papel no tiene caras');
});

test('la revisión sigue el orden que pidió el usuario, con el CAMO al final', () => {
  const { enOrden, deAdministracion } = documentosDeLaRevision();
  const claves = enOrden.map((d) => d.key);

  // De tres en tres, como se ven en la ficha.
  assert.deepEqual(claves.slice(0, 8), [
    'recordConductor', 'comprobanteDomicilio', 'dniScaneado',
    'licenciaConducir', 'antecedentesPoliciales', 'tarjetaPropiedad',
    'revisionTecnica', 'soat',
  ]);
  // Después, lo demás; y el CAMO, que es lo último que se añade y su tarjeta
  // de dos hojas descolocaba las de al lado, aparte y al final.
  assert.deepEqual(new Set(claves.slice(8)),
    new Set(['lunasPolarizadas', 'cv', 'certificadosTrabajo', 'referenciasLaborales']));
  assert.deepEqual(deAdministracion.map((d) => d.key), ['camo']);
  assert.equal(claves.includes('camo'), false);
  assert.equal(enOrden.length + deAdministracion.length, DOCUMENTOS_CONDUCTOR.length);
});
