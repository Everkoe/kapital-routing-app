export const compressImage = (file, maxWidth = 600, quality = 0.5) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    // Use ObjectURL instead of FileReader to drastically reduce RAM usage
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;
    
    img.onload = () => {
      // Free up memory immediately
      URL.revokeObjectURL(objectUrl);
      
      const canvas = document.createElement('canvas');
      const scaleSize = maxWidth / img.width;
      
      let width = img.width;
      let height = img.height;
      
      // Resize only if wider than maxWidth
      if (scaleSize < 1) {
          width = maxWidth;
          height = img.height * scaleSize;
      }

      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Export to highly compressed JPEG base64
      const compressedBase64 = canvas.toDataURL('image/jpeg', quality); 
      resolve(compressedBase64);
    };
    
    img.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    };
  });
};

/**
 * Tamaños de compresión para documentos.
 *
 * Más conservadores que los de `compressImage` (600 px, calidad 0,5), pensados
 * para miniaturas: un DNI o una licencia hay que poder leerlos, así que se
 * conserva resolución suficiente para el texto pequeño.
 */
const DOC_ANCHO_MAX = 1400;
const DOC_CALIDAD = 0.72;

const leerComoBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target.result);
  reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
  reader.readAsDataURL(file);
});

/**
 * Convierte un documento a la forma que se guarda en el perfil, comprimiendo
 * si es una imagen.
 *
 * Existe porque los documentos se guardaban como base64 del archivo original:
 * un perfil con sus diecisiete documentos llegaba a 2 MB, y como todo el
 * estado vive en una sola fila, enviarlo tardaba doce segundos —por encima del
 * límite de diez de una función serverless—. El envío fallaba sin decir por qué.
 *
 * Un PDF se deja intacto: no se puede recomprimir por este camino y además
 * suele venir ya optimizado. Si la compresión falla por lo que sea, se guarda
 * el original antes que perder el documento.
 */
export const documentoABase64 = async (file) => {
  const base = { name: file.name, size: file.size, type: file.type };

  if (!file.type?.startsWith('image/')) {
    return { ...base, base64: await leerComoBase64(file) };
  }

  try {
    const base64 = await compressImage(file, DOC_ANCHO_MAX, DOC_CALIDAD);
    return { ...base, type: 'image/jpeg', base64, size: Math.round(base64.length * 0.75) };
  } catch {
    return { ...base, base64: await leerComoBase64(file) };
  }
};
