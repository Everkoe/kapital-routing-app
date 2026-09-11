import React, { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'react-hot-toast';
import { Camera, Truck, Edit3, X, FileText, Download } from 'lucide-react';
import DocumentResubmission from './components/DocumentResubmission';

const DOC_LABELS = {
  comprobanteDomicilio: 'Comprobante de Domicilio',
  dniScaneado: 'DNI Escaneado',
  licenciaConducir: 'Licencia de Conducir',
  recordConductor: 'Récord de Conductor',
  antecedentesPoliciales: 'Antecedentes Policiales',
  cv: 'Currículum Vitae',
  tarjetaPropiedad: 'Tarjeta de Propiedad',
  soat: 'SOAT',
  revisionTecnica: 'Revisión Técnica'
};

const VistaPerfil = ({ usuario, setUsuarioActual, onLogout }) => {
  const [activeTab, setActiveTab] = useState('personal');
  const [formData, setFormData] = useState({ nombre: usuario.nombre, current_password: '', new_password: '' });
  const [avatar, setAvatar] = useState(usuario.avatar || null);
  const [fotoVehiculo, setFotoVehiculo] = useState(usuario.perfil_conductor?.fotoVehiculo || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [viewingDoc, setViewingDoc] = useState(null);

  // Update Request State
  const [editingField, setEditingField] = useState(null);
  const [updateRequestValue, setUpdateRequestValue] = useState('');

  const handleRequestUpdate = async (e) => {
    e.preventDefault();
    if (!updateRequestValue.trim()) {
      toast.error('El valor no puede estar vacío');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/conductor/request-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: usuario.identifier,
          field: editingField.key,
          new_value: updateRequestValue.trim()
        })
      });
      const data = await res.json();
      const errDetail = typeof data.detail === 'string' ? data.detail
        : Array.isArray(data.detail) ? data.detail.map(e => e.msg || JSON.stringify(e)).join(', ')
        : data.detail ? JSON.stringify(data.detail) : 'Error al solicitar cambio';
      if (!res.ok) throw new Error(errDetail);

      toast.success('Solicitud enviada correctamente. En revisión por administrador.');
      setEditingField(null);
      setUpdateRequestValue('');

      // Update local state to reflect the pending request immediately
      const updatedUser = { ...usuario };
      if (!updatedUser.perfil_conductor) updatedUser.perfil_conductor = {};
      if (!updatedUser.perfil_conductor.solicitudes_cambio) updatedUser.perfil_conductor.solicitudes_cambio = {};
      updatedUser.perfil_conductor.solicitudes_cambio[editingField.key] = {
        new_value: updateRequestValue.trim(),
        status: 'pendiente',
        timestamp: new Date().toISOString()
      };
      setUsuarioActual(updatedUser);
      localStorage.setItem('kapital_user', JSON.stringify(updatedUser));

    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };


  const onDrop = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setAvatar(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleHabilitarVehiculo2 = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/conductor/request-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: usuario.identifier,
          field: 'vehiculo2_habilitado',
          new_value: 'true'
        })
      });
      const data = await res.json();
      const errDetail2 = typeof data.detail === 'string' ? data.detail
        : Array.isArray(data.detail) ? data.detail.map(e => e.msg || JSON.stringify(e)).join(', ')
        : data.detail ? JSON.stringify(data.detail) : 'Error al enviar solicitud';
      if (!res.ok) throw new Error(errDetail2);

      toast.success('Solicitud enviada correctamente. En revisión por administrador.');

      // Update local state
      const updatedUser = { ...usuario };
      if (!updatedUser.perfil_conductor) updatedUser.perfil_conductor = {};
      if (!updatedUser.perfil_conductor.solicitudes_cambio) updatedUser.perfil_conductor.solicitudes_cambio = {};
      updatedUser.perfil_conductor.solicitudes_cambio['vehiculo2_habilitado'] = {
        new_value: 'true',
        status: 'pendiente',
        timestamp: new Date().toISOString()
      };
      setUsuarioActual(updatedUser);
      localStorage.setItem('kapital_user', JSON.stringify(updatedUser));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: {'image/*': []}, maxFiles: 1 });

  const onDropVehiculo = (acceptedFiles) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => setFotoVehiculo(e.target.result);
      reader.readAsDataURL(file);
    }
  };
  const { getRootProps: getRootPropsVehiculo, getInputProps: getInputPropsVehiculo, isDragActive: isDragActiveVehiculo } = useDropzone({ onDrop: onDropVehiculo, accept: {'image/*': []}, maxFiles: 1 });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSave = async (e) => {
    e.preventDefault();
    setLoading(true);

    // Ensure identifier is always a valid string (never null/undefined)
    const identifier = usuario.identifier || usuario.email;
    if (!identifier) {
      toast.error('No se pudo identificar al usuario. Por favor vuelve a iniciar sesión.');
      setLoading(false);
      return;
    }

    try {
      const payload = {
        identifier,
        nombre: formData.nombre !== usuario.nombre ? formData.nombre : undefined,
        current_password: formData.current_password || undefined,
        new_password: formData.new_password || undefined,
        avatar: avatar !== usuario.avatar ? avatar : undefined,
        fotoVehiculo: fotoVehiculo !== usuario.perfil_conductor?.fotoVehiculo ? fotoVehiculo : undefined
      };

      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          toast.error('Sesión expirada. Inicia sesión nuevamente.');
          onLogout();
          return;
        }
        const errMsg = typeof data.detail === 'string' ? data.detail
          : Array.isArray(data.detail) ? data.detail.map(e => e.msg || JSON.stringify(e)).join(', ')
          : data.detail ? JSON.stringify(data.detail) : 'Error al actualizar perfil';
        throw new Error(errMsg);
      }

      setUsuarioActual(data);
      localStorage.setItem('kapital_user', JSON.stringify(data));
      toast.success('Perfil actualizado correctamente.');
      setFormData(prev => ({ ...prev, current_password: '', new_password: '' }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const renderEditableField = (label, key, defaultVal = '', suffix = '') => {
    const rawVal = usuario.perfil_conductor?.[key] || defaultVal;
    const displayVal = rawVal ? `${rawVal}${suffix}` : '—';
    const pendingRequest = usuario.perfil_conductor?.solicitudes_cambio?.[key];
    const isPending = pendingRequest && pendingRequest.status === 'pendiente';

    return (
      <div className="form-group" style={{ marginBottom: 0 }} key={key}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>{label}</label>
          {isPending ? (
            <span style={{ fontSize: '0.75rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '2px 6px', borderRadius: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }} title={`En revisión: ${pendingRequest.new_value}`}>
              Revisión
            </span>
          ) : (
            <button
              type="button"
              onClick={() => { setEditingField({ key, label }); setUpdateRequestValue(rawVal); }}
              style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '2px', display: 'flex' }}
              title="Solicitar cambio"
            >
              <Edit3 size={14} />
            </button>
          )}
        </div>
        <input type="text" value={displayVal} className="form-input disabled-input" style={{ fontSize: '0.95rem' }} disabled />
      </div>
    );
  };

  return (
    <div className="card profile-wrapper">
      <div className="profile-tabs">
        <button className={activeTab === 'personal' ? 'active' : ''} onClick={() => setActiveTab('personal')}>Perfil</button>
        {usuario.rol === 'Conductor' && (
          <button className={activeTab === 'documents' ? 'active' : ''} onClick={() => setActiveTab('documents')}>Información</button>
        )}
        <button className={activeTab === 'security' ? 'active' : ''} onClick={() => setActiveTab('security')}>Seguridad</button>
      </div>

      <div className="profile-content">
        {activeTab === 'personal' && (
          <div className="profile-layout-grid">
            <div className="profile-avatar-column">
              {/* Foto de Perfil */}
              <div className="photo-upload-card">
                <div className="photo-upload-label">Foto de Perfil</div>
                <div {...getRootProps()} className={`photo-upload-zone ${isDragActive ? 'drag-active' : ''}`}>
                  <input {...getInputProps()} />
                  <div className="photo-preview-circle">
                    {avatar ? (
                      <img src={avatar} alt="Avatar" className="photo-preview-img" />
                    ) : (
                      <div className="photo-placeholder-circle">
                        <span className="photo-placeholder-initial">{usuario.nombre.charAt(0).toUpperCase()}</span>
                      </div>
                    )}
                    <div className="photo-overlay">
                      <Camera size={22} color="white" />
                    </div>
                  </div>
                  <div className="photo-upload-meta">
                    <span className="photo-upload-action">{isDragActive ? 'Suelta aquí...' : 'Haz clic o arrastra'}</span>
                    <span className="photo-upload-hint">JPG, PNG · Máx 2MB</span>
                  </div>
                </div>
              </div>

              {/* Foto del Vehículo - solo conductores */}
              {usuario.rol === 'Conductor' && (
                <div className="photo-upload-card" style={{marginTop: '16px'}}>
                  <div className="photo-upload-label">Foto del Vehículo</div>
                  <div {...getRootPropsVehiculo()} className={`photo-upload-zone ${isDragActiveVehiculo ? 'drag-active' : ''}`}>
                    <input {...getInputPropsVehiculo()} />
                    <div className="photo-preview-rect">
                      {fotoVehiculo ? (
                        <img src={fotoVehiculo} alt="Vehículo" className="photo-preview-img-rect" />
                      ) : (
                        <div className="photo-placeholder-rect">
                          <Truck size={36} color="#38bdf8" />
                          <span style={{fontSize:'0.75rem', color:'#38bdf8', marginTop:'6px', fontWeight:600}}>Sin foto aún</span>
                        </div>
                      )}
                      <div className="photo-overlay-rect">
                        <Camera size={22} color="white" />
                      </div>
                    </div>
                    <div className="photo-upload-meta">
                      <span className="photo-upload-action">{isDragActiveVehiculo ? 'Suelta aquí...' : 'Haz clic o arrastra'}</span>
                      <span className="photo-upload-hint">JPG, PNG · Foto clara del exterior</span>
                    </div>
                  </div>
                </div>
              )}
            </div>


            <div className="profile-form-column">
              <h3 className="profile-section-title">Información Básica</h3>
              <form className="profile-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label>Nombre Completo</label>
                  <input type="text" name="nombre" value={formData.nombre} onChange={handleChange} className="form-input" required />
                </div>
                {usuario.rol === 'Conductor' && usuario.perfil_conductor?.numDoc && (
                  <div className="form-group">
                    <label>DNI</label>
                    <input type="text" value={usuario.perfil_conductor.numDoc} className="form-input disabled-input" disabled />
                    <span className="input-hint">Validado por RENIEC.</span>
                  </div>
                )}
                <div className="form-group">
                  <label>{(usuario.identifier || usuario.email || '').includes('@') ? 'Correo Electrónico' : 'Identificador de Cuenta'}</label>
                  <input type="text" value={usuario.identifier || usuario.email || ''} className="form-input disabled-input" disabled />
                  <span className="input-hint">No puede modificarse por seguridad.</span>
                </div>
                <div className="form-group">
                  <label>Rol de Usuario</label>
                  <input type="text" value={usuario.rol} className="form-input disabled-input" disabled />
                </div>

                <div className="profile-actions">
                  <button type="submit" className="btn-primary profile-save-btn" disabled={loading}>
                    {loading ? 'Guardando...' : 'Guardar Cambios'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="profile-layout-grid">
            <div className="profile-avatar-column">
               <div className="security-icon-wrapper">
                 <span className="security-icon">🔒</span>
               </div>
               <h4 className="security-title">Seguridad de la Cuenta</h4>
               <p className="security-desc">Usa una contraseña segura de al menos 6 caracteres que no uses en otros sitios web.</p>
            </div>
            <div className="profile-form-column">
              <h3 className="profile-section-title">Cambiar Contraseña</h3>
              <form className="profile-form" onSubmit={handleSave}>
                <div className="form-group">
                  <label>Contraseña Actual</label>
                  <input type="password" name="current_password" value={formData.current_password} onChange={handleChange} className="form-input" required />
                </div>
                <div className="form-group">
                  <label>Nueva Contraseña</label>
                  <input type="password" name="new_password" value={formData.new_password} onChange={handleChange} className="form-input" required />
                </div>

                <div className="profile-actions">
                  <button type="submit" className="btn-primary profile-save-btn" disabled={loading || !formData.new_password}>
                    {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'documents' && usuario.rol === 'Conductor' && (
          <div className="profile-layout-grid" style={{ gridTemplateColumns: '1fr' }}>
            <div className="profile-form-column" style={{ width: '100%' }}>

              {usuario.perfil_conductor && (
                <div style={{ marginBottom: '30px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <h3 className="profile-section-title" style={{ marginBottom: '20px' }}>Información Registrada</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '20px' }}>
                    {renderEditableField('Nacimiento', 'fechaNacimiento')}
                    {renderEditableField('Dirección', 'direccion')}
                    {renderEditableField('Teléfono Directo', 'telefonoDirecto')}
                    {renderEditableField('Teléfono de Emergencia', 'telefonoEmergencia')}

                    <div style={{ gridColumn: '1 / -1', height: '1px', background: 'var(--border-color, rgba(255,255,255,0.1))', margin: '10px 0' }} />
                    <h4 style={{ gridColumn: '1 / -1', margin: '0', color: 'var(--text-primary)' }}>Vehículo</h4>


                    {renderEditableField('Vehículo (Marca)', 'vehiculoMarca')}
                    {renderEditableField('Vehículo (Modelo)', 'vehiculoModelo')}
                    {renderEditableField('Año', 'vehiculoAnio')}
                    {renderEditableField('Color', 'vehiculoColor')}
                    {renderEditableField('Placa', 'placa')}

                    {renderEditableField('Capacidad Vehicular', 'capacidadVehiculo', '15', ' pax')}

                    {usuario.perfil_conductor?.vehiculo2_habilitado === 'true' || usuario.perfil_conductor?.vehiculo2_habilitado === true ? (
                      <>
                        <div style={{ gridColumn: '1 / -1', height: '1px', background: 'var(--border-color, rgba(255,255,255,0.1))', margin: '10px 0' }} />
                        <h4 style={{ gridColumn: '1 / -1', margin: '0', color: 'var(--text-primary)' }}>Vehículo 2</h4>
                        {renderEditableField('Vehículo 2 (Marca)', 'vehiculoMarca2')}
                        {renderEditableField('Vehículo 2 (Modelo)', 'vehiculoModelo2')}
                        {renderEditableField('Año (Vehículo 2)', 'vehiculoAnio2')}
                        {renderEditableField('Color (Vehículo 2)', 'vehiculoColor2')}
                        {renderEditableField('Placa (Vehículo 2)', 'placa2')}
                        {renderEditableField('Capacidad (Vehículo 2)', 'capacidadVehiculo2', '15', ' pax')}
                      </>
                    ) : (
                      <div style={{ gridColumn: '1 / -1', marginTop: '10px', textAlign: 'center' }}>
                        {usuario.perfil_conductor?.solicitudes_cambio?.vehiculo2_habilitado?.status === 'pendiente' ? (
                          <span style={{ color: '#f59e0b', fontSize: '0.9rem' }}>⏳ Solicitud de habilitación de Vehículo 2 en revisión</span>
                        ) : (
                          <button type="button" onClick={handleHabilitarVehiculo2} className="btn-secondary" disabled={loading}>
                            Solicitar Vehículo 2
                          </button>
                        )}
                      </div>
                    )}
                    {/* Separador y Documentos */}
                    <div style={{ gridColumn: '1 / -1', height: '1px', background: 'var(--border-color, rgba(255,255,255,0.1))', margin: '20px 0' }} />
                    <div style={{ gridColumn: '1 / -1' }}>
                      <DocumentResubmission
                        usuario={usuario}
                        onComplete={(updatedUser) => {
                          setUsuarioActual(updatedUser);
                          toast.success("Documentos enviados. Tu perfil está ahora en revisión.");
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>



      {editingField && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '16px',
          }}
          onClick={() => setEditingField(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--kapital-card-bg)',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '420px',
              boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
              border: '1px solid var(--kapital-border)',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 22px',
              borderBottom: '1px solid var(--kapital-border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '8px',
                  background: 'rgba(59,130,246,0.15)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Edit3 size={15} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <div style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--kapital-text-primary)' }}>
                    Solicitar cambio
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--kapital-text-secondary)', marginTop: '1px' }}>
                    {editingField.label}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setEditingField(null)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--kapital-text-secondary)', padding: '6px', borderRadius: '6px',
                  display: 'flex', alignItems: 'center',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.15)'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '22px' }}>
              <div style={{
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.2)',
                borderRadius: '8px',
                padding: '12px 14px',
                marginBottom: '20px',
                fontSize: '0.85rem',
                color: 'var(--kapital-text-secondary)',
                lineHeight: '1.55',
              }}>
                Tu solicitud será enviada al administrador para su revisión. El cambio se aplicará únicamente si es aprobado.
              </div>

              <form onSubmit={handleRequestUpdate}>
                <div style={{ marginBottom: '18px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    color: 'var(--kapital-text-secondary)',
                    marginBottom: '7px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>
                    Nuevo valor — {editingField.label}
                  </label>
                  <input
                    type="text"
                    value={updateRequestValue}
                    onChange={(e) => setUpdateRequestValue(e.target.value)}
                    autoFocus
                    placeholder={`Escribe el nuevo ${editingField.label.toLowerCase()}...`}
                    style={{
                      width: '100%',
                      padding: '10px 13px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--kapital-border)',
                      background: 'var(--kapital-bg)',
                      color: 'var(--kapital-text-primary)',
                      fontSize: '0.92rem',
                      outline: 'none',
                      transition: 'border-color 0.15s',
                      boxSizing: 'border-box',
                    }}
                    onFocus={e => e.target.style.borderColor = '#3b82f6'}
                    onBlur={e => e.target.style.borderColor = 'var(--kapital-border)'}
                  />
                </div>

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => setEditingField(null)}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--kapital-border)',
                      background: 'none',
                      color: 'var(--kapital-text-secondary)',
                      fontWeight: '500',
                      fontSize: '0.88rem',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      padding: '9px 20px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loading ? '#60a5fa' : '#3b82f6',
                      color: '#fff',
                      fontWeight: '600',
                      fontSize: '0.88rem',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      transition: 'background 0.15s',
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}
                    onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#2563eb'; }}
                    onMouseLeave={e => { if (!loading) e.currentTarget.style.background = '#3b82f6'; }}
                  >
                    {loading ? 'Enviando...' : 'Enviar solicitud'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}



      {viewingDoc && (() => {
        const src = viewingDoc.src || '';
        const hasData = src.startsWith('data:') || src.startsWith('http');
        const isPdf = src.toLowerCase().includes('.pdf') || src.startsWith('data:application/pdf');
        const downloadDoc = () => {
          if (!hasData) return;
          const a = document.createElement('a');
          a.href = src;
          a.download = viewingDoc.name;
          a.click();
        };
        return (
          <div onClick={() => setViewingDoc(null)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: isPdf ? '600px' : '900px', height: isPdf ? 'auto' : '80vh', minHeight: isPdf ? '300px' : 'auto', background: 'var(--bg-secondary, #1a1d2e)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '15px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: 'var(--text-primary, #fff)' }}>{viewingDoc.name}</h3>
                <button onClick={() => setViewingDoc(null)} style={{ background: 'transparent', border: 'none', color: '#aaa', cursor: 'pointer', padding: '4px' }}><X size={22} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '40px 30px' }}>
                {hasData ? (
                  isPdf ? (
                    <div style={{ padding: '20px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
                        <FileText size={72} color="#38BDF8" />
                      </div>
                      <h3 style={{ color: 'var(--text-primary)', marginBottom: '30px', fontSize: '1.4rem' }}>Archivo PDF</h3>
                      <button onClick={downloadDoc} style={{ padding: '12px 24px', background: 'var(--primary, #38BDF8)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', margin: '0 auto' }}>
                        <Download size={20} /> Descargar para visualizar
                      </button>
                    </div>
                  ) : (
                    <img src={src} style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', borderRadius: '8px' }} alt={viewingDoc.name} />
                  )
                ) : (
                  <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📄</div>
                    <h3 style={{ color: 'var(--text-primary, #fff)', marginBottom: '8px' }}>{viewingDoc.name}</h3>
                    <p style={{ color: '#aaa' }}>No hay archivo disponible para previsualizar.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default VistaPerfil;
