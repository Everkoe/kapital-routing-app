import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Save, Send, AlertCircle, CheckCircle, Award } from 'lucide-react';
import DocumentoMultiCara from './DocumentoMultiCara';
import { documentoPorClave } from '../constants/documentosConductor';
import QuizManejoDefensivo from './QuizManejoDefensivo';
import { toast } from 'react-hot-toast';
import { subirDocumento } from '../utils/documentoStorage';
import {
  ESTADO_OK,
  ayudaDeCampo,
  camposPendientes,
  estadoDeCampo,
  esRequerido,
  progresoDe,
  seccionCompleta,
} from '../constants/camposOnboarding';

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

/** Campos del formulario que guardan un archivo. */
const FILE_FIELDS = [
  'comprobanteDomicilio',
  'dniScaneado', 'dniScaneadoReverso', 'dniScaneadoCompleto',
  'licenciaConducir', 'licenciaConducirReverso', 'licenciaConducirCompleto',
  'lunasPolarizadas', 'lunasPolarizadasReverso', 'lunasPolarizadasCompleto',
  'recordConductor', 'antecedentesPoliciales', 'cv',
  'certificadosTrabajo', 'referenciasLaborales', 'cuestionarioManejoDefensivo',
  'tarjetaPropiedad', 'tarjetaPropiedadReverso', 'tarjetaPropiedadCompleto',
  'soat', 'revisionTecnica',
];

const DriverOnboardingWizard = ({ usuario, onComplete }) => {
  const [openSection, setOpenSection] = useState('personales');
  const [isSaving, setIsSaving] = useState(false);
  // Campos por los que el conductor ya pasó: hasta entonces no se le avisa
  // de nada, para no recibirle con el formulario en amarillo.
  const [tocados, setTocados] = useState({});
  const [intentoDeEnvio, setIntentoDeEnvio] = useState(false);

  // Load quiz result from localStorage
  const loadQuizFromStorage = () => {
    try {
      const saved = localStorage.getItem(`driver_quiz_${usuario?.identifier}`);
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  };
  const [quizResult, setQuizResultState] = useState(() => loadQuizFromStorage());

  const setQuizResult = (result) => {
    setQuizResultState(result);
    if (result) {
      localStorage.setItem(`driver_quiz_${usuario?.identifier}`, JSON.stringify(result));
    }
  };

  // Check if the registered name is actually a DNI (digits only)
  const isRegisteredNameDni = usuario?.nombre && /^\d+$/.test(usuario.nombre);

  // Draft keys unique per user
  const draftKey = `driver_onboarding_draft_${usuario?.identifier || 'unknown'}`;
  const filesKey = `driver_onboarding_files_${usuario?.identifier || 'unknown'}`;

  // Los documentos de dos caras guardan la segunda en un campo hermano
  // (`dniScaneado` + `dniScaneadoReverso`), de modo que lo ya subido sigue
  // siendo válido y cada cara conserva su propia revisión.

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
    correo: usuario?.perfil_conductor?.correo || usuario?.email || '',
    
    // Archivos (Files)
    comprobanteDomicilio: null,
    dniScaneado: null,
    dniScaneadoReverso: null,
    dniScaneadoCompleto: null,
    licenciaConducir: null,
    licenciaConducirReverso: null,
    licenciaConducirCompleto: null,
    lunasPolarizadas: null,
    lunasPolarizadasReverso: null,
    lunasPolarizadasCompleto: null,
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
    tarjetaPropiedadReverso: null,
    tarjetaPropiedadCompleto: null,
    soat: null,
    revisionTecnica: null,
  });

  // Draft key unique per user so different users don't share drafts
  // (now declared above formData)

  useEffect(() => {
    // Restore text fields
    const savedText = localStorage.getItem(draftKey);
    if (savedText) {
      try {
        const parsed = JSON.parse(savedText);
        setFormData(prev => ({ ...prev, ...parsed }));
      } catch (e) { console.error('Error loading draft', e); }
    }
    // Lo ya guardado en el perfil se muestra aunque este navegador no tenga
    // borrador: el conductor puede volver desde otro equipo, y ver el
    // formulario vacío le haría subirlo todo otra vez sin necesidad.
    const guardados = usuario?.perfil_conductor;
    if (guardados && typeof guardados === 'object') {
      const delPerfil = {};
      FILE_FIELDS.forEach((campo) => {
        const valor = guardados[campo];
        if (valor && typeof valor === 'object' && (valor.path || valor.base64)) {
          delPerfil[campo] = { ...valor, isRestored: true };
        } else if (typeof valor === 'string' && valor.startsWith('data:')) {
          delPerfil[campo] = { name: campo, base64: valor, isRestored: true };
        }
      });
      if (Object.keys(delPerfil).length > 0) {
        setFormData(prev => ({ ...prev, ...delPerfil }));
      }
    }

    // Restore file fields from Base64
    const savedFiles = localStorage.getItem(filesKey);
    if (savedFiles) {
      try {
        const parsedFiles = JSON.parse(savedFiles);
        // Convert each Base64 entry back to a fake file-like object
        const restored = {};
        Object.entries(parsedFiles).forEach(([key, val]) => {
          if (val) {
            // Se conserva el objeto entero. Antes se reconstruía campo a campo
            // —`name`, `size`, `type`, `base64`— y eso perdía `path`, que es lo
            // único que traen los documentos guardados en Storage: al reenviar
            // el perfil, la ficha vacía sustituía al documento bueno y el
            // archivo quedaba huérfano en el bucket.
            restored[key] = { ...val, isRestored: true };
          }
        });
        setFormData(prev => ({ ...prev, ...restored }));
      } catch (e) { console.error('Error loading files', e); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Auto-save text fields on every formData change
  useEffect(() => {
    const toSave = { ...formData };
    // Remove file fields (saved separately)
    FILE_FIELDS.forEach(f => delete toSave[f]);
    localStorage.setItem(draftKey, JSON.stringify(toSave));
  }, [formData, draftKey]);

  // Convert File to Base64 and store; or store fake file-like object as-is
  const handleFileChange = (name, file) => {
    if (!file) {
      setFormData(prev => ({ ...prev, [name]: null }));
      // Remove from files store
      try {
        const existing = JSON.parse(localStorage.getItem(filesKey) || '{}');
        delete existing[name];
        localStorage.setItem(filesKey, JSON.stringify(existing));
      } catch {}
      return;
    }
    if (file.isRestored) {
      // Already a fake object, nothing to convert
      setFormData(prev => ({ ...prev, [name]: file }));
      return;
    }
    // El archivo viaja a Storage y aquí solo queda su ruta: guardar diecisiete
    // documentos en base64 dentro del perfil es lo que hacía que «Enviar para
    // Revisión» superara el límite de tiempo y fallara sin explicar por qué.
    subirDocumento(file, { unidadId: usuario?.unidad_id || '', campo: name })
      .then(documento => {
        const fileObj = { ...documento, isRestored: false };
        setFormData(prev => ({ ...prev, [name]: fileObj }));
        try {
          const existing = JSON.parse(localStorage.getItem(filesKey) || '{}');
          existing[name] = fileObj;
          localStorage.setItem(filesKey, JSON.stringify(existing));
        } catch (err) { console.error('Error saving file to storage', err); }
      })
      .catch(err => {
        console.error('Error al subir el documento', err);
        toast.error(err?.message || 'No se pudo subir el documento. Intenta de nuevo.');
      });
  };

  // Calculate age automatically
  useEffect(() => {
    if (formData.fechaNacimiento) {
      const today = new Date();
      const birthDate = new Date(formData.fechaNacimiento);
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      const ageStr = age > 0 ? age.toString() : '';
      if (formData.edad !== ageStr) {
        setFormData(prev => ({ ...prev, edad: ageStr }));
      }
    }
  }, [formData.fechaNacimiento]);

  // Las reglas se evalúan sobre el alta entera: el cuestionario no está en
  // `formData`, pero cuenta igual que cualquier otro requisito.
  const datosDelAlta = { ...formData, quizManejoDefensivo: quizResult };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  /**
   * Un campo se marca en ámbar cuando el conductor ya pasó por él y lo dejó
   * a medias, o cuando intenta enviar. Marcarlos todos desde el principio
   * pintaría el formulario entero de amarillo antes de que escriba nada.
   */
  const marcarComoVisitado = (campo) =>
    setTocados(prev => (prev[campo] ? prev : { ...prev, [campo]: true }));

  const debeAvisar = (campo) =>
    (tocados[campo] || intentoDeEnvio) && estadoDeCampo(campo, datosDelAlta) !== ESTADO_OK;

  const propsDeCampo = (campo) => ({
    id: `campo-${campo}`,
    onBlur: () => marcarComoVisitado(campo),
    className: debeAvisar(campo) ? 'campo-pendiente' : undefined,
  });

  // Detalle que antes vivía entre paréntesis en la etiqueta. Fuera del título
  // no alarga la tarjeta ni descuadra la rejilla.
  const PISTAS = {
    comprobanteDomicilio: 'Recibo de agua o luz a tu nombre.',
    recordConductor: 'El historial que emite el MTC.',
    cv: 'Tu currículum actualizado.',
    soat: 'Debe estar vigente.',
  };

  // `completa` la extiende a toda la fila. Se usa cuando la tarjeta cae entre
  // campos de texto: en media columna quedaba como un bloque alto y estrecho
  // que empujaba hacia abajo el campo de al lado.
  const tarjetaDocumento = (clave, { completa = false } = {}) => (
    <div className={`form-group${completa ? ' full-width' : ''}`} key={clave}>
      <DocumentoMultiCara
        documento={documentoPorClave(clave)}
        archivos={formData}
        onArchivo={handleFileChange}
        opcional={!esRequerido(clave)}
        pista={PISTAS[clave] || ''}
        pendiente={debeAvisar(clave)}
        aviso={ayudaDeCampo(clave, datosDelAlta)}
      />
    </div>
  );

  const avisoDe = (campo) => (debeAvisar(campo) ? (
    <small className="campo-aviso">
      <AlertCircle size={13} aria-hidden="true" /> {ayudaDeCampo(campo, datosDelAlta)}
    </small>
  ) : null);


  const toggleSection = (section) => {
    setOpenSection(openSection === section ? null : section);
  };


  /**
   * Envío del alta.
   *
   * El botón ya no está deshabilitado. Antes lo estaba hasta llegar al 100% y
   * no explicaba nada: el conductor veía un botón muerto y un porcentaje, sin
   * forma de saber qué le faltaba. Ahora al pulsarlo se marcan en ámbar todos
   * los campos pendientes, se abre la sección del primero y se sube hasta él.
   */
  const handleEnviar = () => {
    const pendientes = camposPendientes(datosDelAlta);
    if (pendientes.length === 0) {
      onComplete?.(datosDelAlta);
      return;
    }

    setIntentoDeEnvio(true);
    const [primero] = pendientes;
    setOpenSection(primero.seccion);
    toast.error(pendientes.length === 1
      ? `Falta un dato: ${primero.etiqueta}.`
      : `Faltan ${pendientes.length} datos. El primero es ${primero.etiqueta}.`);

    // El acordeón se abre con una animación de 300 ms; sin esperar, el campo
    // todavía no ocupa sitio en la página y el desplazamiento no va a ninguna.
    setTimeout(() => {
      document.getElementById(`campo-${primero.campo}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 350);
  };

  const handleSaveDraft = () => {
    setIsSaving(true);
    // formData is already auto-saved, just show confirmation
    if (quizResult) {
      localStorage.setItem(`driver_quiz_${usuario?.identifier}`, JSON.stringify(quizResult));
    }
    toast.success('Progreso guardado correctamente. Puedes volver más tarde.');
    setIsSaving(false);
  };

  const progress = Math.min(progresoDe(datosDelAlta), 100);

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
          status={seccionCompleta('personales', datosDelAlta) ? 'complete' : 'incomplete'}
        >
          <div className="form-grid">
            <div className="form-group full-width">
              <label>Nombres y Apellidos Completos</label>
              <input type="text" name="nombres" value={formData.nombres} onChange={handleChange} placeholder="Ej. Juan Pérez" {...propsDeCampo('nombres')} />
              {avisoDe('nombres')}
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
              <input type="text" name="numDoc" value={formData.numDoc} onChange={handleChange} placeholder="Ej. 12345678" maxLength={formData.tipoDoc === 'DNI' ? 8 : 12} {...propsDeCampo('numDoc')} />
              {avisoDe('numDoc')}
            </div>

            <div className="form-group">
              <label>Fecha de Nacimiento</label>
              <input type="date" name="fechaNacimiento" value={formData.fechaNacimiento} onChange={handleChange} {...propsDeCampo('fechaNacimiento')} />
              {avisoDe('fechaNacimiento')}
            </div>

            <div className="form-group">
              <label>Edad</label>
              <input type="text" name="edad" value={formData.edad} readOnly className="readonly-input" placeholder="Se calcula auto." />
            </div>

            <div className="form-group full-width">
              <label>Dirección de Residencia Actual</label>
              <input type="text" name="direccion" value={formData.direccion} onChange={handleChange} placeholder="Ej. Av. Siempre Viva 123" {...propsDeCampo('direccion')} />
              {avisoDe('direccion')}
            </div>

            {tarjetaDocumento('comprobanteDomicilio', { completa: true })}

            <div className="form-group">
              <label>Teléfono Directo</label>
              <input type="tel" name="telefonoDirecto" value={formData.telefonoDirecto} onChange={handleChange} placeholder="Ej. 987654321" {...propsDeCampo('telefonoDirecto')} />
              {avisoDe('telefonoDirecto')}
            </div>

            <div className="form-group">
              <label>Teléfono de Emergencia</label>
              <input type="tel" name="telefonoEmergencia" value={formData.telefonoEmergencia} onChange={handleChange} placeholder="Ej. 912345678" />
            </div>

            <div className="form-group full-width">
              <label>Correo Electrónico</label>
              {/* Estaba en solo lectura con el correo que inventó la importación
                  del Excel. El conductor es quien sabe cuál es el suyo. */}
              <input
                type="email"
                name="correo"
                value={formData.correo}
                onChange={handleChange}
                placeholder="Ej. juan.perez@gmail.com"
                {...propsDeCampo('correo')}
              />
              {avisoDe('correo')}
            </div>
          </div>

          <div className="section-divider">
            <h3>Documentación y Conducción</h3>
          </div>
          
          <div className="form-grid">
            {/* Todos los documentos son la misma tarjeta. Los de dos caras
                traen selector; los de papel, no. Mezclar tarjetas con zonas de
                arrastre sueltas era lo que rompía la rejilla. */}
            {['dniScaneado', 'licenciaConducir', 'lunasPolarizadas',
              'recordConductor', 'antecedentesPoliciales'].map(tarjetaDocumento)}
          </div>

          <div className="section-divider">
            <h3>Experiencia y Perfil Profesional (Opcional)</h3>
          </div>

          <div className="form-grid">
            {tarjetaDocumento('cv')}
            {tarjetaDocumento('certificadosTrabajo')}
            {tarjetaDocumento('referenciasLaborales')}
          </div>
          
          <div className="wizard-actions">
            <button className="btn-secondary" onClick={() => toggleSection('vehiculares')}>Siguiente Sección</button>
          </div>
        </AccordionItem>

        <AccordionItem 
          title="2. Datos Vehiculares" 
          isOpen={openSection === 'vehiculares'} 
          onToggle={() => toggleSection('vehiculares')}
          status={seccionCompleta('vehiculares', datosDelAlta) ? 'complete' : 'incomplete'}
        >
          <div className="form-grid">
            <div className="form-group">
              <label>Marca del Vehículo</label>
              <input type="text" name="vehiculoMarca" value={formData.vehiculoMarca} onChange={handleChange} placeholder="Ej. Mercedes-Benz" {...propsDeCampo('vehiculoMarca')} />
              {avisoDe('vehiculoMarca')}
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
              <input type="text" name="vehiculoPlaca" value={formData.vehiculoPlaca} onChange={handleChange} placeholder="Ej. ABC-123" {...propsDeCampo('vehiculoPlaca')} />
              {avisoDe('vehiculoPlaca')}
            </div>
            <div className="form-group">
              <label>Color</label>
              <input type="text" name="vehiculoColor" value={formData.vehiculoColor} onChange={handleChange} placeholder="Ej. Blanco" />
            </div>
            <div className="form-group">
              <label>Capacidad de Pasajeros</label>
              <input type="number" name="vehiculoCapacidad" value={formData.vehiculoCapacidad} onChange={handleChange} placeholder="Ej. 15" {...propsDeCampo('vehiculoCapacidad')} />
              {avisoDe('vehiculoCapacidad')}
            </div>

            <div className="form-group">
              <DocumentoMultiCara
                documento={documentoPorClave('tarjetaPropiedad')}
                archivos={formData}
                onArchivo={handleFileChange}
                pendiente={debeAvisar('tarjetaPropiedad')}
                aviso={ayudaDeCampo('tarjetaPropiedad', datosDelAlta)}
              />
            </div>
            {tarjetaDocumento('soat')}
            {tarjetaDocumento('revisionTecnica')}
          </div>
          <div className="wizard-actions">
            <button className="btn-secondary" onClick={() => toggleSection('manejo')}>Siguiente Sección</button>
          </div>
        </AccordionItem>

        <AccordionItem 
          title="3. Cuestionario de Manejo Defensivo" 
          isOpen={openSection === 'manejo'} 
          onToggle={() => toggleSection('manejo')}
          status={seccionCompleta('manejo', datosDelAlta) ? 'complete' : 'incomplete'}
        >
          <QuizManejoDefensivo
            initialData={quizResult}
            onComplete={(result) => {
              setQuizResult(result);
              toast.success(`Evaluación completada: ${result.puntaje}/20 – ${result.estado}`);
            }}
          />
        </AccordionItem>
      </div>

      <div className="wizard-footer">
        <button className="btn-draft" onClick={handleSaveDraft} disabled={isSaving}>
          <Save size={18} /> {isSaving ? 'Guardando...' : 'Guardar Progreso (Borrador)'}
        </button>
        <button className="btn-primary" onClick={handleEnviar}>
          <Send size={18} /> Enviar para Revisión
        </button>
      </div>
    </div>
  );
};

export default DriverOnboardingWizard;
