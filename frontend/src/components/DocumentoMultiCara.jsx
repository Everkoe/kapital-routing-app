import { useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import FileUploadZone from './FileUploadZone';
import {
  CARA_COMPLETO,
  CARA_DETRAS,
  caraBloqueada,
  carasDeDocumento,
  caraInicial,
} from '../constants/documentosConductor';
import { tieneContenido } from '../utils/documentoArchivo';

/**
 * Un documento de varias caras en una sola tarjeta.
 *
 * El DNI ocupaba tres celdas del formulario —delante, detrás y completo—, cada
 * una con su zona de arrastre a tamaño completo. Entre las tres llenaban una
 * pantalla, y como sus etiquetas tenían largos distintos («DNI · Completo
 * (opcional, ambas caras en una imagen)» ocupa dos líneas) las filas de la
 * rejilla quedaban desalineadas.
 *
 * Aquí las tres son el mismo documento: se eligen con un selector y comparten
 * una única zona de arrastre, igual que en la revisión del administrador. Un
 * documento de papel no tiene caras que elegir, así que se muestra sin
 * selector y se comporta como la zona de siempre.
 */

/** Qué se espera en cada cara, dicho para quien está subiendo su documento. */
const PISTA_POR_CARA = {
  [CARA_DETRAS]: 'Opcional. Súbelo si tienes las caras en fotos separadas.',
  [CARA_COMPLETO]: 'Una sola imagen con las dos caras. Si la subes, las otras sobran.',
};
const PISTA_DELANTE = 'Si tienes las dos caras en una sola imagen, usa «Completo».';

const tieneArchivo = (valor) => {
  if (!valor) return false;
  if (typeof valor === 'string') return tieneContenido(valor);
  return Boolean(valor.name || valor.path || valor.base64 || valor.size);
};

const DocumentoMultiCara = ({
  documento,
  archivos,
  onArchivo,
  pendiente = false,
  aviso = '',
  // Si el alta lo exige. No se deduce del catálogo: allí `opcional` describe
  // el documento en general, no lo que hace falta para enviar el perfil.
  opcional = false,
  // Detalle que antes iba entre paréntesis en la etiqueta —«(Agua/Luz)»,
  // «(MTC)»—, donde alargaba el título y descuadraba la rejilla.
  pista = '',
}) => {
  const caras = carasDeDocumento(documento).map((cara) => ({
    ...cara,
    tieneArchivo: tieneArchivo(archivos?.[cara.campo]),
  }));

  // Se abre por la imagen completa, que es lo que se sube casi siempre; quien
  // ya empezó por caras sueltas, por la que le falta (`caraInicial`). Con la
  // imagen completa subida, delante y detrás se bloquean: si la cara elegida
  // queda bloqueada, se vuelve a la completa.
  const [activa, setActiva] = useState(() => caraInicial(caras));
  const cara = caras.find((c) => c.campo === activa && !caraBloqueada(c, caras))
    || caras.find((c) => !caraBloqueada(c, caras))
    || caras[0];
  const variasCaras = caras.length > 1;

  return (
    <div className={`documento-card${pendiente ? ' campo-pendiente' : ''}`}>
      <div className="documento-card-titulo">
        <span>{documento.label}</span>
        {opcional && <small className="documento-opcional">Opcional</small>}
      </div>

      {pendiente && aviso && (
        <small className="campo-aviso">
          <AlertCircle size={13} aria-hidden="true" /> {aviso}
        </small>
      )}

      {variasCaras && (
        <div className="documento-caras" role="tablist" aria-label={`Caras de ${documento.label}`}>
          {caras.map((opcion) => {
            const bloqueada = caraBloqueada(opcion, caras);
            return (
              <button
                key={opcion.campo}
                type="button"
                role="tab"
                aria-selected={opcion.campo === cara.campo}
                className={`documento-cara${opcion.campo === cara.campo ? ' activa' : ''}`}
                disabled={bloqueada}
                title={bloqueada ? 'Ya subiste la imagen completa: no hace falta por caras.' : undefined}
                onClick={() => setActiva(opcion.campo)}
              >
                {opcion.tieneArchivo && <Check size={12} aria-hidden="true" />}
                {opcion.nombre}
              </button>
            );
          })}
        </div>
      )}

      {/* El `key` remonta la zona al cambiar de cara: si no, la anterior
          seguiría mostrando el archivo que ya se había elegido. */}
      <FileUploadZone
        key={cara.campo}
        file={archivos?.[cara.campo]}
        onFileSelect={(archivo) => onArchivo(cara.campo, archivo)}
      />

      {(variasCaras || pista) && (
        <small className="documento-pista">
          {variasCaras ? (PISTA_POR_CARA[cara.nombre] || PISTA_DELANTE) : pista}
        </small>
      )}
    </div>
  );
};

export default DocumentoMultiCara;
