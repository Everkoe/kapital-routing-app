import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion } from 'framer-motion';
import { UploadCloud, File, X, CheckCircle } from 'lucide-react';

const FileUploadZone = ({ label, onFileSelect, file, accept = { 'image/*': [], 'application/pdf': [] }, maxFiles = 1 }) => {
  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      onFileSelect(acceptedFiles[0]);
    }
  }, [onFileSelect]);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept,
    maxFiles
  });

  const removeFile = (e) => {
    e.stopPropagation();
    onFileSelect(null);
  };

  return (
    <div className="file-upload-wrapper">
      <label className="upload-label">{label}</label>
      
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
            <span className="upload-hint">PDF o Imagen, máx 5MB</span>
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
              <span className="file-size">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
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

export default FileUploadZone;
