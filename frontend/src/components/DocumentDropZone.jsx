import { useCallback, useEffect, useRef, useState } from 'react';
import { archivoDePortapapeles, pegadoEnCampoDeTexto } from '../utils/documentoArchivo';

/**
 * Envuelve una tarjeta de documento para aceptar archivos arrastrados o pegados.
 *
 * Se suma al botón de subida, no lo reemplaza: ni arrastrar ni pegar funcionan
 * con teclado, y en táctil no existen. Los tres caminos terminan en el mismo
 * `onFile`, que ya valida tamaño y formato y avisa por toast.
 *
 * El contador de profundidad existe porque `dragenter` y `dragleave` también se
 * disparan al pasar sobre los hijos de la tarjeta: sin él, el resaltado
 * parpadearía al mover el cursor por encima del botón o del texto.
 *
 * Una zona puede ir dentro de otra (la fila de caras dentro de la tarjeta, y
 * cada cara dentro de la fila): manda la más interior. Sus eventos no suben a
 * la de fuera, así que el archivo no se sube dos veces ni se ilumina la que no
 * lo va a recibir, y un Ctrl+V lo recoge solo la más interior bajo el cursor.
 */

const tieneArchivos = (event) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

/** La zona más interior que tiene el cursor encima: las de fuera también están en `:hover`. */
const zonaMasInterior = () => {
  const bajoElCursor = document.querySelectorAll('[data-zona-documento]:hover');
  return bajoElCursor[bajoElCursor.length - 1] || null;
};

const DocumentDropZone = ({
  onFile,
  disabled = false,
  className = '',
  children,
  label,
  // Sin el «Ctrl+V para pegar» de la esquina: en un botón no cabe.
  sinPista = false,
}) => {
  const [activa, setActiva] = useState(false);
  const [bajoCursor, setBajoCursor] = useState(false);
  const profundidad = useRef(0);
  const elemento = useRef(null);

  // El callback llega como función nueva en cada render. Guardarlo en una
  // referencia evita que el listener de pegado se desuscriba y resuscriba
  // continuamente, y que el efecto dependa de una identidad inestable.
  const onFileRef = useRef(onFile);
  // Se actualiza en un efecto, no durante el render: escribir en una `ref`
  // mientras se renderiza puede dejar al componente sin repintar.
  useEffect(() => { onFileRef.current = onFile; });

  const salir = useCallback(() => {
    profundidad.current = 0;
    setActiva(false);
  }, []);

  const handleDragEnter = useCallback((event) => {
    if (disabled || !tieneArchivos(event)) return;
    event.preventDefault();
    event.stopPropagation();
    profundidad.current += 1;
    setActiva(true);
  }, [disabled]);

  const handleDragOver = useCallback((event) => {
    if (disabled || !tieneArchivos(event)) return;
    // Sin `preventDefault` en `dragover` el navegador nunca emite `drop`.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const handleDragLeave = useCallback((event) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    profundidad.current = Math.max(profundidad.current - 1, 0);
    if (profundidad.current === 0) setActiva(false);
  }, [disabled]);

  const handleDrop = useCallback((event) => {
    if (disabled || !tieneArchivos(event)) return;
    event.preventDefault();
    event.stopPropagation();
    salir();
    // Solo el primero: cada tarjeta representa un documento concreto, y aceptar
    // varios obligaría a adivinar cuál quería el usuario.
    const archivo = event.dataTransfer.files?.[0];
    if (archivo) onFileRef.current(archivo);
  }, [disabled, salir]);

  /**
   * Pegar con Ctrl+V sobre la tarjeta que tiene el cursor encima.
   *
   * El listener se suscribe solo mientras el cursor está sobre esta tarjeta.
   * Con zonas anidadas hay uno por cada zona bajo el cursor, y solo actúa el de
   * la más interior (`zonaMasInterior`).
   */
  useEffect(() => {
    if (!bajoCursor || disabled) return undefined;

    const handlePaste = (event) => {
      // Escribir en el aviso al conductor o en el padrón mientras el cursor
      // reposa sobre una tarjeta no debe convertirse en una subida.
      if (pegadoEnCampoDeTexto(event.target)) return;
      // Con una zona dentro de otra, pega solo la de más adentro.
      const interior = zonaMasInterior();
      if (interior && interior !== elemento.current) return;

      const archivo = archivoDePortapapeles(event.clipboardData);
      if (!archivo) return;

      event.preventDefault();
      onFileRef.current(archivo);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [bajoCursor, disabled]);

  return (
    <div
      ref={elemento}
      data-zona-documento=""
      data-sin-pista={sinPista || undefined}
      className={`${className} doc-dropzone${activa ? ' doc-dropzone-activa' : ''}`.trim()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseEnter={() => setBajoCursor(true)}
      onMouseLeave={() => setBajoCursor(false)}
      data-arrastrando={activa || undefined}
      data-pegable={(bajoCursor && !disabled) || undefined}
    >
      {children}
      {activa && (
        <div className="doc-dropzone-aviso" aria-hidden="true">
          Suelta para subir{label ? ` ${label}` : ''}
        </div>
      )}
    </div>
  );
};

export default DocumentDropZone;
