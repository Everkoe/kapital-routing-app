import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { AlertCircle, UploadCloud, File, X, CheckCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';

const MAX_DOCUMENT_SIZE_BYTES = 5 * 1024 * 1024;

const DEFAULT_DOCUMENT_ACCEPT = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

const describeAcceptedTypes = (accept) => {
  const accepted = Object.keys(accept || {});
  if (accepted.includes('application/pdf')) return 'PNG, JPG, WebP o PDF';
  if (accepted.some(type => type.startsWith('image/'))) return 'PNG, JPG o WebP';
  return 'Archivos permitidos';
};

const describeRejection = (rejection, maxSize) => {
  const codes = new Set((rejection?.errors || []).map(error => error.code));
  if (codes.has('file-too-large')) {
    return `El archivo supera el límite de ${(maxSize / (1024 * 1024)).toFixed(0)} MB.`;
  }
  if (codes.has('file-invalid-type')) {
    return 'Formato no permitido. Usa PNG, JPG, WebP o PDF.';
  }
  return 'No se pudo aceptar el archivo. Revisa el formato y el tamaño.';
};

const FileUploadZone = ({
  label,
  onFileSelect,
  file,
  // Aviso del alta: este documento se pidió y todavía no está.
  pendiente = false,
  aviso = '',
  accept = DEFAULT_DOCUMENT_ACCEPT,
  maxFiles = 1,
  maxSize = MAX_DOCUMENT_SIZE_BYTES,
  onValidationError,
}) => {
  const reportValidationError = useCallback((message) => {
    if (onValidationError) {
      onValidationError(message);
      return;
    }
    toast.error(message);
  }, [onValidationError]);

  const onDrop = useCallback((acceptedFiles, fileRejections) => {
    if (fileRejections?.length > 0) {
      reportValidationError(describeRejection(fileRejections[0], maxSize));
      return;
    }

    const selectedFile = acceptedFiles?.[0];
    if (!selectedFile) return;

    // Keep this guard in addition to react-dropzone's maxSize option so a
    // programmatic drop or a browser with an incomplete File object cannot
    // bypass the real payload limit.
    if (selectedFile.size > maxSize) {
      reportValidationError(`El archivo supera el límite de ${(maxSize / (1024 * 1024)).toFixed(0)} MB.`);
      return;
    }

    onFileSelect(selectedFile);
  }, [maxSize, onFileSelect, reportValidationError]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept,
    maxFiles,
    maxSize,
    multiple: maxFiles > 1,
  });

  const removeFile = (e) => {
    e.stopPropagation();
    onFileSelect(null);
  };

  return (
    <div className={`file-upload-wrapper${pendiente ? ' campo-pendiente' : ''}`}>
      {label && <label className="upload-label">{label}</label>}
      {pendiente && aviso && (
        <small className="campo-aviso">
          <AlertCircle size={13} aria-hidden="true" /> {aviso}
        </small>
      )}
      
      {!file ? (
        <div 
          {...getRootProps()} 
          className={`dropzone-area ${isDragActive ? 'drag-active' : ''} ${isDragReject ? 'drag-reject' : ''}`}
        >
          <input {...getInputProps()} />
          <motion.div 
            initial={{ scale: 1 }}
            animate={{ scale: isDragActive ? 1.05 : 1 }}
            className="dropzone-content"
          >
            <UploadCloud className="upload-icon" size={32} />
            {isDragActive ? (
              <p>Suelta el archivo aquí...</p>
            ) : (
              <p>Arrastra tu archivo aquí o <span>haz clic para explorar</span></p>
            )}
            <span className="upload-hint">
              {describeAcceptedTypes(accept)}, máx {(maxSize / (1024 * 1024)).toFixed(0)} MB
            </span>
          </motion.div>
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="file-preview-card"
        >
          <div className="file-info">
            <File className="file-icon" size={24} />
            <div className="file-details">
              <span className="file-name">{file.name}</span>
              <span className="file-size">
                {file.size ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'Restaurado'}
                {file.isRestored && ' · Guardado ✓'}
              </span>
            </div>
          </div>
          <div className="file-actions">
            <CheckCircle className="status-icon success" size={20} />
            <button type="button" className="remove-btn" onClick={removeFile}>
              <X size={18} />
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};

FileUploadZone.MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_BYTES;
FileUploadZone.DEFAULT_DOCUMENT_ACCEPT = DEFAULT_DOCUMENT_ACCEPT;

export default FileUploadZone;
