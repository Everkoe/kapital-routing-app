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
 */

const tieneArchivos = (event) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

const DocumentDropZone = ({ onFile, disabled = false, className = '', children, label }) => {
  const [activa, setActiva] = useState(false);
  const [bajoCursor, setBajoCursor] = useState(false);
  const profundidad = useRef(0);

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
    profundidad.current += 1;
    setActiva(true);
  }, [disabled]);

  const handleDragOver = useCallback((event) => {
    if (disabled || !tieneArchivos(event)) return;
    // Sin `preventDefault` en `dragover` el navegador nunca emite `drop`.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const handleDragLeave = useCallback((event) => {
    if (disabled) return;
    event.preventDefault();
    profundidad.current = Math.max(profundidad.current - 1, 0);
    if (profundidad.current === 0) setActiva(false);
  }, [disabled]);

  const handleDrop = useCallback((event) => {
    if (disabled || !tieneArchivos(event)) return;
    event.preventDefault();
    salir();
    // Solo el primero: cada tarjeta representa un documento concreto, y aceptar
    // varios obligaría a adivinar cuál quería el usuario.
    const archivo = event.dataTransfer.files?.[0];
    if (archivo) onFileRef.current(archivo);
  }, [disabled, salir]);

  /**
   * Pegar con Ctrl+V sobre la tarjeta que tiene el cursor encima.
   *
   * El listener se suscribe solo mientras el cursor está sobre esta tarjeta, de
   * modo que nunca hay más de uno activo y no hace falta un registro global que
   * decida a quién le toca el pegado.
   */
  useEffect(() => {
    if (!bajoCursor || disabled) return undefined;

    const handlePaste = (event) => {
      // Escribir en el aviso al conductor o en el padrón mientras el cursor
      // reposa sobre una tarjeta no debe convertirse en una subida.
      if (pegadoEnCampoDeTexto(event.target)) return;

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
