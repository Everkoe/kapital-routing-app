import { useState } from 'react';
import { Check, Loader, Mail, Pencil, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiFetch } from '../utils/apiClient';

/**
 * Correo de un conductor, editable en el sitio donde se lee.
 *
 * Los 108 conductores que entraron por el Excel tienen un correo inventado
 * (`apellido@kapital.com`) que además es la clave de su cuenta. El correo real
 * se guarda al lado, como dato de contacto, así que corregirlo aquí no migra
 * ninguna cuenta ni invalida la sesión de nadie.
 *
 * No hay validación propia del formato: la hace el backend, que es quien tiene
 * que rechazarlo aunque la petición no venga de esta pantalla.
 */

const SIN_CORREO = 'Sin correo registrado';

const CorreoEditable = ({ identificador, correo, onGuardado }) => {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(correo || '');
  const [guardando, setGuardando] = useState(false);

  const abrir = () => {
    setBorrador(correo || '');
    setEditando(true);
  };

  const guardar = async () => {
    const limpio = borrador.trim();
    if (!limpio || limpio.toLowerCase() === (correo || '').toLowerCase()) {
      setEditando(false);
      return;
    }

    setGuardando(true);
    try {
      const { email } = await apiFetch('/api/conductor/correo', {
        method: 'PUT',
        json: { identificador, correo: limpio },
      });
      onGuardado?.(email);
      setEditando(false);
      toast.success('Correo actualizado.');
    } catch (error) {
      toast.error(error?.message || 'No se pudo actualizar el correo.');
    } finally {
      setGuardando(false);
    }
  };

  if (!editando) {
    return (
      <p className="correo-editable">
        <Mail size={13} aria-hidden="true" />
        <span className={correo ? '' : 'correo-vacio'}>{correo || SIN_CORREO}</span>
        <button type="button" className="btn-icon-sutil" onClick={abrir} title="Editar correo">
          <Pencil size={13} />
        </button>
      </p>
    );
  }

  return (
    <div className="correo-editable">
      <input
        type="email"
        value={borrador}
        autoFocus
        disabled={guardando}
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') guardar();
          if (e.key === 'Escape') setEditando(false);
        }}
        placeholder="correo@ejemplo.com"
      />
      <button type="button" className="btn-icon-sutil" onClick={guardar} disabled={guardando} title="Guardar">
        {guardando ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
      </button>
      <button type="button" className="btn-icon-sutil" onClick={() => setEditando(false)} disabled={guardando} title="Cancelar">
        <X size={13} />
      </button>
    </div>
  );
};

export default CorreoEditable;
