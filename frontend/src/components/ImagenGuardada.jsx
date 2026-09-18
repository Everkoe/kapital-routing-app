import { useEffect, useState } from 'react';
import { urlFirmada } from '../utils/documentoStorage';
import { tieneContenido } from '../utils/documentoArchivo';

/**
 * Una imagen del perfil que puede venir incrustada o guardada en Storage.
 *
 * Las fotos se guardaban como base64 y ahora se suben al bucket, así que el
 * perfil conserva `{ name, path }` en vez de una cadena. Pasarle eso a
 * `<img src>` deja la imagen rota, que es lo que se veía: el archivo seguía en
 * su sitio y solo faltaba pedir su URL firmada, igual que hacen los documentos.
 *
 * Acepta las dos formas a propósito. Mientras queden fotos incrustadas de
 * antes, se ven igual que las migradas y sin distinguir cuál es cuál.
 *
 * Devuelve `null` mientras no hay nada que mostrar, para que quien la usa
 * dibuje su propio hueco sin tener que distinguir entre «cargando» y «vacío».
 */

const fuenteDirecta = (valor) => {
  if (typeof valor === 'string') return tieneContenido(valor) ? valor : '';
  if (valor && typeof valor === 'object') return valor.base64 || valor.url || '';
  return '';
};

const rutaEnStorage = (valor) => (
  valor && typeof valor === 'object' && valor.path ? valor.path : ''
);

const ImagenGuardada = ({ imagen, alt, className, style, onError }) => {
  const directa = fuenteDirecta(imagen);
  const ruta = rutaEnStorage(imagen);
  const [firmada, setFirmada] = useState('');

  useEffect(() => {
    if (!ruta) return undefined;
    let vigente = true;
    setFirmada('');
    urlFirmada(ruta)
      .then((url) => { if (vigente) setFirmada(url); })
      .catch(() => {});
    return () => { vigente = false; };
  }, [ruta]);

  const src = directa || firmada;
  if (!src) return null;

  return <img src={src} alt={alt} className={className} style={style} onError={onError} />;
};

export default ImagenGuardada;
