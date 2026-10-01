import { useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';

/**
 * Una foto que se cambia pulsando o soltando una imagen, y se guarda sola.
 *
 * Mientras sube se enseña la del propio equipo (un `blob:` de esta pestaña),
 * para no esperar la ida y vuelta al servidor; si el guardado falla, se quita.
 * `onCambiarFoto(archivo)` sube y guarda, y devuelve lo guardado o `null`.
 */
export const useFotoConPrevia = (onCambiarFoto) => {
  const [previa, setPrevia] = useState(null);
  const [subiendo, setSubiendo] = useState(false);

  // Se suelta la vista previa anterior al cambiarla, y la última al salir.
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa); }, [previa]);

  const onDrop = async ([archivo]) => {
    if (!archivo || subiendo) return;
    setPrevia(URL.createObjectURL(archivo));
    setSubiendo(true);
    const guardada = await onCambiarFoto(archivo);
    setSubiendo(false);
    if (!guardada) setPrevia(null);
  };

  const zona = useDropzone({ onDrop, accept: { 'image/*': [] }, multiple: false, disabled: subiendo });
  return { previa, subiendo, ...zona };
};

export default useFotoConPrevia;
