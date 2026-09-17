import FileUploadZone from '../components/FileUploadZone';

/**
 * Comprueba un archivo antes de subirlo, con el mismo criterio en todas partes.
 *
 * Vivía dentro de `FlotaView`, así que cualquier otra pantalla que aceptara
 * documentos tenía que reescribirlo o quedarse sin validar.
 *
 * Mira el tipo MIME y la extensión, no uno solo: Windows manda a veces un
 * `type` vacío para archivos que sí son válidos, y un `.jpg` renombrado a mano
 * conserva un tipo que no corresponde. Basta con que uno de los dos encaje.
 *
 * Devuelve el motivo del rechazo, o cadena vacía si el archivo sirve.
 */

const MAXIMO = FileUploadZone.MAX_DOCUMENT_SIZE_BYTES;
const ACEPTADOS = FileUploadZone.DEFAULT_DOCUMENT_ACCEPT;

export const validarArchivoDocumento = (file) => {
  if (!file) return 'Selecciona un archivo.';

  if (file.size > MAXIMO) {
    return `El archivo supera el límite de ${(MAXIMO / (1024 * 1024)).toFixed(0)} MB.`;
  }

  const extension = `.${file.name?.split('.').pop()?.toLowerCase() || ''}`;
  const tipoValido = Object.keys(ACEPTADOS).some((tipo) => (
    tipo.endsWith('/*') ? file.type?.startsWith(tipo.slice(0, -1)) : file.type === tipo
  ));
  const extensionValida = Object.values(ACEPTADOS).flat().includes(extension);

  if (!tipoValido && !extensionValida) {
    return 'Formato no permitido. Usa PNG, JPG, WebP o PDF.';
  }
  return '';
};
