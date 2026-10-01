import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { FileText, IdCard, UserRound } from 'lucide-react';
import DocumentResubmission from './components/DocumentResubmission';
import FileUploadZone from './components/FileUploadZone';
import { apiFetch } from './utils/apiClient';
import { subirDocumento, sinPrevisualizacion } from './utils/documentoStorage';
import { validarArchivoDocumento } from './utils/validacionDocumento';
import CabeceraPerfil from './perfil/CabeceraPerfil';
import DatosConductor from './perfil/DatosConductor';
import DatosCuenta from './perfil/DatosCuenta';
import SeguridadCuenta from './perfil/SeguridadCuenta';
import { mensajeDeError } from './perfil/modeloPerfil';
import './perfil/perfil.css';

/**
 * «Mi perfil», para todos los roles.
 *
 * Arriba, quién eres (foto, nombre, rol, cuenta y estado); debajo, los datos de
 * la cuenta y la contraseña. Al conductor se le añaden sus datos y su vehículo,
 * y sus documentos, en secciones aparte porque son largos. Todo se guarda al
 * momento, como en el resto de la aplicación.
 *
 * Lo que se arregló al rehacerla (2026-10-01), además del aspecto: equivocarse
 * con la contraseña actual cerraba la sesión (el servidor respondía 401); las
 * solicitudes de cambio iban con `fetch` directo, sin el manejo de sesión
 * caducada; se modificaba el usuario en el sitio en vez de copiarlo; y la
 * capacidad del vehículo salía como «15 pax» a quien no la tenía.
 */

const LIMITE_MB = Math.round(FileUploadZone.MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024));

const SECCIONES_CONDUCTOR = [
  { id: 'cuenta', etiqueta: 'Cuenta', Icono: UserRound },
  { id: 'datos', etiqueta: 'Datos y vehículo', Icono: IdCard },
  { id: 'documentos', etiqueta: 'Documentos', Icono: FileText },
];

const VistaPerfil = ({ usuario, setUsuarioActual, onLogout }) => {
  const [seccion, setSeccion] = useState('cuenta');
  const esConductor = usuario.rol === 'Conductor';
  const identificador = usuario.identifier || usuario.email || usuario.dni;

  const recordar = (actualizado) => {
    setUsuarioActual(actualizado);
    localStorage.setItem('kapital_user', JSON.stringify(actualizado));
  };

  /**
   * Guarda en el servidor y devuelve `{ ok, error }`. `ademas` es lo que el
   * servidor cambia y no devuelve (que la contraseña ya no es provisional).
   */
  const guardar = async (cambios, mensajeHecho, ademas = {}) => {
    try {
      const respuesta = await apiFetch('/api/user/profile', {
        method: 'PUT', json: { identifier: identificador, ...cambios },
      });
      recordar({ ...usuario, ...respuesta, ...ademas });
      if (mensajeHecho) toast.success(mensajeHecho);
      return { ok: true };
    } catch (error) {
      // Un 404 es que la cuenta ya no existe; el 401 lo atiende el cliente.
      if (error?.status === 404) {
        toast.error('Tu cuenta ya no está disponible. Vuelve a iniciar sesión.');
        onLogout();
      }
      return { ok: false, error: mensajeDeError(error, 'No se pudo guardar el cambio.') };
    }
  };

  const guardarNombre = async (nombre) => {
    const resultado = await guardar({ nombre }, 'Nombre actualizado.');
    if (!resultado.ok) toast.error(resultado.error);
    return resultado.ok;
  };

  const cambiarContrasena = (actual, nueva) => guardar(
    { current_password: actual, new_password: nueva }, 'Contraseña cambiada.',
    { needs_password_change: false });

  /** Sube una foto al bucket, la guarda en el perfil y devuelve lo guardado. */
  const cambiarFoto = (campo, mensaje) => async (archivo) => {
    const problema = validarArchivoDocumento(archivo);
    if (problema) {
      toast.error(problema);
      return null;
    }
    try {
      const guardada = sinPrevisualizacion(
        await subirDocumento(archivo, { campo, fotoDePerfil: campo === 'avatar' }));
      const resultado = await guardar({ [campo]: guardada }, mensaje);
      if (!resultado.ok) toast.error(resultado.error);
      return resultado.ok ? guardada : null;
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo subir la foto.'));
      return null;
    }
  };

  const solicitarCambio = async (campo, valor) => {
    try {
      await apiFetch('/api/conductor/request-update', {
        method: 'POST', json: { email: identificador, field: campo, new_value: valor },
      });
    } catch (error) {
      toast.error(mensajeDeError(error, 'No se pudo enviar la solicitud.'));
      return false;
    }
    const perfil = usuario.perfil_conductor || {};
    recordar({
      ...usuario,
      perfil_conductor: {
        ...perfil,
        solicitudes_cambio: {
          ...(perfil.solicitudes_cambio || {}),
          [campo]: { new_value: valor, status: 'pendiente', timestamp: new Date().toISOString() },
        },
      },
    });
    toast.success('Solicitud enviada. Administración la revisará.');
    return true;
  };

  const cuenta = (
    <div className="pf-rejilla">
      <DatosCuenta usuario={usuario} onGuardarNombre={guardarNombre} />
      <SeguridadCuenta usuario={usuario} onCambiarContrasena={cambiarContrasena} />
    </div>
  );

  return (
    <div className="pf">
      <CabeceraPerfil usuario={usuario} limiteMb={LIMITE_MB}
        onCambiarFoto={cambiarFoto('avatar', 'Foto de perfil actualizada.')} />

      {esConductor ? (
        <>
          <nav className="pf-secciones" role="tablist" aria-label="Secciones del perfil">
            {SECCIONES_CONDUCTOR.map(({ id, etiqueta, Icono }) => (
              <button key={id} type="button" role="tab" aria-selected={seccion === id}
                className="pf-seccion" onClick={() => setSeccion(id)}>
                <Icono size={15} aria-hidden="true" />
                {etiqueta}
              </button>
            ))}
          </nav>
          {seccion === 'cuenta' && cuenta}
          {seccion === 'datos' && (
            <DatosConductor usuario={usuario} limiteMb={LIMITE_MB}
              onSolicitarCambio={solicitarCambio}
              onCambiarFotoVehiculo={cambiarFoto('fotoVehiculo', 'Foto del vehículo actualizada.')} />
          )}
          {seccion === 'documentos' && (
            <div className="pf-tarjeta">
              <DocumentResubmission
                usuario={usuario}
                onComplete={(actualizado) => {
                  setUsuarioActual(actualizado);
                  toast.success('Documentos enviados. Tu perfil está ahora en revisión.');
                }}
              />
            </div>
          )}
        </>
      ) : cuenta}
    </div>
  );
};

export default VistaPerfil;
