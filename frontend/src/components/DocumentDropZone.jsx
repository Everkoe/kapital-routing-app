import { useCallback, useRef, useState } from 'react';

/**
 * Envuelve una tarjeta de documento para aceptar archivos arrastrados.
 *
 * Se suma al botón de subida, no lo reemplaza: arrastrar no es accesible por
 * teclado ni funciona en táctil, así que quitar el botón dejaría fuera a parte
 * de los usuarios. Ambos caminos terminan en el mismo `onFile`, que ya valida
 * tamaño y formato y avisa por toast.
 *
 * El contador de profundidad existe porque `dragenter` y `dragleave` también se
 * disparan al pasar sobre los hijos de la tarjeta: sin él, el resaltado
 * parpadearía al mover el cursor por encima del botón o del texto.
 */

const tieneArchivos = (event) =>
  Array.from(event.dataTransfer?.types || []).includes('Files');

const DocumentDropZone = ({ onFile, disabled = false, className = '', children, label }) => {
  const [activa, setActiva] = useState(false);
  const profundidad = useRef(0);

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
    if (archivo) onFile(archivo);
  }, [disabled, onFile, salir]);

  return (
    <div
      className={`${className} doc-dropzone${activa ? ' doc-dropzone-activa' : ''}`.trim()}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-arrastrando={activa || undefined}
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
