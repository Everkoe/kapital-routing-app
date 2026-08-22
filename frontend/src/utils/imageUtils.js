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
