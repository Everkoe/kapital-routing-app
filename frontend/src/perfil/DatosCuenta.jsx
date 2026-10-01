import { useState } from 'react';
import { Lock, Pencil, UserRound } from 'lucide-react';
import { cuentaDe } from './modeloPerfil';
import { Fila, Tarjeta } from './piezas';

/**
 * Los datos de la cuenta. Solo el nombre se cambia desde aquí, y se edita en su
 * sitio: pulsar «Editar», escribir y guardar (Enter guarda, Escape cancela).
 * La cuenta con la que se entra no se toca desde el perfil: es la llave de la
 * cuenta, y cambiarla es cosa de Administración.
 */
const DatosCuenta = ({ usuario, onGuardarNombre }) => {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(usuario.nombre || '');
  const [guardando, setGuardando] = useState(false);
  const cuenta = cuentaDe(usuario);
  const limpio = nombre.trim();

  const empezar = () => {
    setNombre(usuario.nombre || '');
    setEditando(true);
  };

  const guardar = async (e) => {
    e.preventDefault();
    if (!limpio || limpio === usuario.nombre) {
      setEditando(false);
      return;
    }
    setGuardando(true);
    const hecho = await onGuardarNombre(limpio);
    setGuardando(false);
    if (hecho) setEditando(false);
  };

  return (
    <Tarjeta Icono={UserRound} titulo="Datos de la cuenta" subtitulo="Cómo te identificas en Kapital">
      <dl className="pf-filas">
        <Fila
          etiqueta="Nombre"
          accion={!editando && (
            <button type="button" className="pf-btn pf-btn-texto" onClick={empezar}>
              <Pencil size={14} aria-hidden="true" />
              Editar
            </button>
          )}
        >
          {editando ? (
            <form className="pf-edicion" onSubmit={guardar}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditando(false); }}>
              <input className="pf-input" value={nombre} onChange={(e) => setNombre(e.target.value)}
                aria-label="Nombre" autoFocus maxLength={80} disabled={guardando} />
              <button type="submit" className="pf-btn pf-btn-primario" disabled={guardando || !limpio}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
              <button type="button" className="pf-btn" onClick={() => setEditando(false)} disabled={guardando}>
                Cancelar
              </button>
            </form>
          ) : (
            <span className="pf-valor-fuerte">{usuario.nombre || 'Sin nombre'}</span>
          )}
        </Fila>

        <Fila etiqueta={cuenta.etiqueta}
          nota="Es con lo que entras. Solo Administración puede cambiarlo."
          accion={<Lock size={15} className="pf-candado" aria-label="No se puede cambiar desde aquí" />}>
          {cuenta.valor}
        </Fila>

        <Fila etiqueta="Rol"><span className="pf-chip">{usuario.rol}</span></Fila>

        {usuario.unidad_id && <Fila etiqueta="Unidad">{usuario.unidad_id}</Fila>}
        {usuario.empresa_id && <Fila etiqueta="Empresa">{usuario.empresa_id}</Fila>}
      </dl>
    </Tarjeta>
  );
};

export default DatosCuenta;
