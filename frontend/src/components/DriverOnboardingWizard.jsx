import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Save, Send, AlertCircle, CheckCircle } from 'lucide-react';
import FileUploadZone from './FileUploadZone';
import { toast } from 'react-hot-toast';

const AccordionItem = ({ title, isOpen, onToggle, children, status }) => {
  return (
    <div className={`accordion-item ${isOpen ? 'open' : ''}`}>
      <button className="accordion-header" onClick={onToggle}>
        <div className="accordion-title-area">
          <span className="accordion-title">{title}</span>
          {status === 'complete' && <CheckCircle size={18} className="status-icon success" />}
          {status === 'incomplete' && <AlertCircle size={18} className="status-icon warning" />}
        </div>
        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ duration: 0.3 }}
        >
          <ChevronDown size={24} />
        </motion.div>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="accordion-content"
          >
            <div className="accordion-inner">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DriverOnboardingWizard = ({ usuario, onComplete }) => {
  const [openSection, setOpenSection] = useState('personales'); // 'personales', 'vehiculares', 'requisitos'
  const [isSaving, setIsSaving] = useState(false);

  // Check if the registered name is actually a DNI (digits only)
  const isRegisteredNameDni = usuario?.nombre && /^\d+$/.test(usuario.nombre);

  const [formData, setFormData] = useState({
    // Datos Personales
    nombres: isRegisteredNameDni ? '' : (usuario?.nombre || ''),
    tipoDoc: 'DNI',
    numDoc: isRegisteredNameDni ? usuario.nombre : '',
    fechaNacimiento: '',
    edad: '',
    direccion: '',
    telefonoDirecto: '',
    telefonoEmergencia: '',
    correo: usuario?.email || '',
    
    // Archivos (Files)
    comprobanteDomicilio: null,
    dniScaneado: null,
    licenciaConducir: null,
    recordConductor: null,
    antecedentesPoliciales: null,
    cv: null,
    certificadosTrabajo: null,
    referenciasLaborales: null,
    cuestionarioManejoDefensivo: null,

    // Datos Vehiculares
    vehiculoMarca: '',
    vehiculoModelo: '',
    vehiculoAnio: '',
    vehiculoPlaca: '',
    vehiculoColor: '',
    vehiculoCapacidad: '',
    tarjetaPropiedad: null,
    soat: null,
    revisionTecnica: null,

  });

  // Calculate age automatically
  useEffect(() => {
    if (formData.fechaNacimiento) {
      const birthDate = new Date(formData.fechaNacimiento);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      setFormData(prev => ({ ...prev, edad: age > 0 ? age.toString() : '' }));
    }
  }, [formData.fechaNacimiento]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (name, file) => {
    setFormData(prev => ({ ...prev, [name]: file }));
  };

  const toggleSection = (section) => {
    setOpenSection(openSection === section ? null : section);
  };

  const calculateProgress = () => {
    const totalFields = 16;
    let filled = 0;
    
    if (formData.nombres) filled++;
    if (formData.numDoc && formData.numDoc.length >= 8) filled++;
    if (formData.fechaNacimiento) filled++;
    if (formData.direccion) filled++;
    if (formData.telefonoDirecto) filled++;
    if (formData.comprobanteDomicilio) filled++;
    if (formData.dniScaneado) filled++;
    if (formData.licenciaConducir) filled++;
    if (formData.recordConductor) filled++;
    if (formData.antecedentesPoliciales) filled++;
    
    if (formData.cuestionarioManejoDefensivo) filled++;
    
    // Vehiculares
    if (formData.vehiculoMarca) filled++;
    if (formData.vehiculoPlaca) filled++;
    if (formData.vehiculoCapacidad) filled++;
    if (formData.tarjetaPropiedad) filled++;
    if (formData.soat) filled++;

    return Math.round((filled / totalFields) * 100);
  };

  const handleSaveDraft = () => {
    setIsSaving(true);
    localStorage.setItem('driver_onboarding_progress', JSON.stringify(formData));
    toast.success('Progreso guardado correctamente. Puedes volver más tarde.');
    setIsSaving(false);
  };

  const progress = Math.min(calculateProgress(), 100);

  return (
    <div className="onboarding-wizard">
      <div className="wizard-header">
        <h2>Completa tu Perfil de Conductor</h2>
        <p>Para activar tu cuenta, necesitamos validar tu información y documentos.</p>
        
        <div className="progress-container">
          <div className="progress-header">
            <span>Progreso del Perfil</span>
            <span className="progress-percentage">{progress}%</span>
          </div>
          <div className="progress-bar-bg">
            <motion.div 
              className="progress-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>
      </div>

      <div className="accordion-container">
        <AccordionItem 
          title="1. Identificación y Datos Personales" 
          isOpen={openSection === 'personales'} 
          onToggle={() => toggleSection('personales')}
          status={progress >= 30 ? 'complete' : 'incomplete'}
        >
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Nombres y Apellidos Completos</label>
              <input type="text" name="nombres" value={formData.nombres} onChange={handleChange} placeholder="Ej. Juan Pérez" />
            </div>

            <div className="form-group">
              <label>Tipo de Documento</label>
              <select name="tipoDoc" value={formData.tipoDoc} onChange={handleChange}>
                <option value="DNI">DNI</option>
                <option value="CE">Carnet de Extranjería (CE)</option>
                <option value="Pasaporte">Pasaporte</option>
              </select>
            </div>

            <div className="form-group">
              <label>Número de Documento</label>
              <input type="text" name="numDoc" value={formData.numDoc} onChange={handleChange} placeholder="Ej. 12345678" maxLength={formData.tipoDoc === 'DNI' ? 8 : 12} />
            </div>

            <div className="form-group">
              <label>Fecha de Nacimiento</label>
              <input type="date" name="fechaNacimiento" value={formData.fechaNacimiento} onChange={handleChange} />
            </div>

            <div className="form-group">
              <label>Edad</label>
              <input type="text" name="edad" value={formData.edad} readOnly className="readonly-input" placeholder="Se calcula auto." />
            </div>

            <div className="form-group full-width">
              <label>Dirección de Residencia Actual</label>
              <input type="text" name="direccion" value={formData.direccion} onChange={handleChange} placeholder="Ej. Av. Siempre Viva 123" />
            </div>

            <div className="form-group full-width">
              <FileUploadZone 
                label="Comprobante de Domicilio (Agua/Luz)" 
                file={formData.comprobanteDomicilio} 
                onFileSelect={(f) => handleFileChange('comprobanteDomicilio', f)} 
              />
            </div>

            <div className="form-group">
              <label>Teléfono Directo</label>
              <input type="tel" name="telefonoDirecto" value={formData.telefonoDirecto} onChange={handleChange} placeholder="Ej. 987654321" />
            </div>

            <div className="form-group">
              <label>Teléfono de Emergencia</label>
              <input type="tel" name="telefonoEmergencia" value={formData.telefonoEmergencia} onChange={handleChange} placeholder="Ej. 912345678" />
            </div>

            <div className="form-group full-width">
              <label>Correo Electrónico</label>
              <input type="email" name="correo" value={formData.correo} readOnly className="readonly-input" />
            </div>
          </div>

          <div className="section-divider">
            <h3>Documentación y Conducción</h3>
          </div>
          
          <div className="form-grid">
            <div className="form-group full-width">
              <FileUploadZone 
                label="DNI Escaneado (Ambos lados)" 
                file={formData.dniScaneado} 
                onFileSelect={(f) => handleFileChange('dniScaneado', f)} 
              />
            </div>
            <div className="form-group full-width">
              <FileUploadZone 
                label="Licencia de Conducir (Vigente)" 
                file={formData.licenciaConducir} 
                onFileSelect={(f) => handleFileChange('licenciaConducir', f)} 
              />
            </div>
            <div className="form-group full-width">
              <FileUploadZone 
                label="Récord o Historial del Conductor (MTC)" 
                file={formData.recordConductor} 
                onFileSelect={(f) => handleFileChange('recordConductor', f)} 
              />
            </div>
            <div className="form-group full-width">
              <FileUploadZone 
                label="Certificado de Antecedentes Policiales" 
                file={formData.antecedentesPoliciales} 
                onFileSelect={(f) => handleFileChange('antecedentesPoliciales', f)} 
              />
            </div>
          </div>

          <div className="section-divider">
            <h3>Experiencia y Perfil Profesional (Opcional)</h3>
          </div>

          <div className="form-grid">
            <div className="form-group full-width">
              <FileUploadZone 
                label="Curriculum Vitae (CV) Actualizado (Opcional)" 
                file={formData.cv} 
                onFileSelect={(f) => handleFileChange('cv', f)} 
              />
            </div>
            <div className="form-group full-width">
              <FileUploadZone 
                label="Certificados de Trabajo (Opcional)" 
                file={formData.certificadosTrabajo} 
                onFileSelect={(f) => handleFileChange('certificadosTrabajo', f)} 
              />
            </div>
            <div className="form-group full-width">
              <FileUploadZone 
                label="Referencias Laborales (Opcional)" 
                file={formData.referenciasLaborales} 
                onFileSelect={(f) => handleFileChange('referenciasLaborales', f)} 
              />
            </div>
          </div>
          
          <div className="wizard-actions">
            <button className="btn-secondary" onClick={() => toggleSection('vehiculares')}>Siguiente Sección</button>
          </div>
        </AccordionItem>

        <AccordionItem 
          title="2. Datos Vehiculares" 
          isOpen={openSection === 'vehiculares'} 
          onToggle={() => toggleSection('vehiculares')}
          status={progress >= 80 ? 'complete' : 'incomplete'}
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Marca del Vehículo</label>
              <input type="text" name="vehiculoMarca" value={formData.vehiculoMarca} onChange={handleChange} placeholder="Ej. Mercedes-Benz" />
            </div>
            <div className="form-group">
              <label>Modelo</label>
              <input type="text" name="vehiculoModelo" value={formData.vehiculoModelo} onChange={handleChange} placeholder="Ej. Sprinter" />
            </div>
            <div className="form-group">
              <label>Año de Fabricación</label>
              <input type="number" name="vehiculoAnio" value={formData.vehiculoAnio} onChange={handleChange} placeholder="Ej. 2022" />
            </div>
            <div className="form-group">
              <label>Placa del Vehículo</label>
              <input type="text" name="vehiculoPlaca" value={formData.vehiculoPlaca} onChange={handleChange} placeholder="Ej. ABC-123" />
            </div>
            <div className="form-group">
              <label>Color</label>
              <input type="text" name="vehiculoColor" value={formData.vehiculoColor} onChange={handleChange} placeholder="Ej. Blanco" />
            </div>
            <div className="form-group">
              <label>Capacidad de Pasajeros</label>
              <input type="number" name="vehiculoCapacidad" value={formData.vehiculoCapacidad} onChange={handleChange} placeholder="Ej. 15" />
            </div>

            <div className="form-group full-width">
              <FileUploadZone label="Tarjeta de Propiedad" file={formData.tarjetaPropiedad} onFileSelect={(f) => handleFileChange('tarjetaPropiedad', f)} />
            </div>
            <div className="form-group full-width">
              <FileUploadZone label="SOAT Vigente" file={formData.soat} onFileSelect={(f) => handleFileChange('soat', f)} />
            </div>
            <div className="form-group full-width">
              <FileUploadZone label="Revisión Técnica (Opcional)" file={formData.revisionTecnica} onFileSelect={(f) => handleFileChange('revisionTecnica', f)} />
            </div>
          </div>
          <div className="wizard-actions">
            <button className="btn-secondary" onClick={() => toggleSection('manejo')}>Siguiente Sección</button>
          </div>
        </AccordionItem>

        <AccordionItem 
          title="3. Cuestionario de Manejo Defensivo" 
          isOpen={openSection === 'manejo'} 
          onToggle={() => toggleSection('manejo')}
          status={formData.cuestionarioManejoDefensivo ? 'complete' : 'incomplete'}
        >
          <div className="form-grid">
            <div className="form-group full-width">
              <FileUploadZone 
                label="Certificado o Cuestionario de Manejo Defensivo" 
                file={formData.cuestionarioManejoDefensivo} 
                onFileSelect={(f) => handleFileChange('cuestionarioManejoDefensivo', f)} 
              />
            </div>
          </div>
        </AccordionItem>
      </div>

      <div className="wizard-footer">
        <button className="btn-draft" onClick={handleSaveDraft} disabled={isSaving}>
          <Save size={18} /> {isSaving ? 'Guardando...' : 'Guardar Progreso (Borrador)'}
        </button>
        <button className="btn-primary" onClick={() => onComplete && onComplete(formData)} disabled={progress < 100}>
          <Send size={18} /> Enviar para Revisión
        </button>
      </div>
    </div>
  );
};

export default DriverOnboardingWizard;
