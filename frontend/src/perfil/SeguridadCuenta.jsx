import { useState } from 'react';
import { AlertTriangle, Check, Circle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { fortalezaDe, problemaDelCambio } from './modeloPerfil';
import { Tarjeta } from './piezas';

/**
 * Cambiar la contraseña.
 *
 * Pide la nueva dos veces —una errata en una contraseña que no se ve deja a
 * alguien fuera de su cuenta—, deja ver lo escrito y orienta sobre lo segura
 * que es sin bloquear más de lo que bloquea el servidor. El error del
 * servidor («la actual no es correcta») se enseña aquí, junto al formulario,
 * y no en un aviso que se va solo.
 */

const CampoContrasena = ({ id, etiqueta, valor, onCambiar, autoComplete, deshabilitado }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="pf-campo">
      <label htmlFor={id} className="pf-campo-etiqueta">{etiqueta}</label>
      <div className="pf-contrasena">
        <input id={id} className="pf-input" type={visible ? 'text' : 'password'} value={valor}
          onChange={(e) => onCambiar(e.target.value)} autoComplete={autoComplete}
          disabled={deshabilitado} />
        <button type="button" className="pf-contrasena-ojo" onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={visible}>
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};

const Fortaleza = ({ fortaleza }) => (
  <div className="pf-fortaleza" aria-live="polite">
    <div className="pf-fortaleza-barra" data-nivel={fortaleza.nivel || undefined} aria-hidden="true">
      {[1, 2, 3, 4].map((n) => <span key={n} data-lleno={n <= fortaleza.puntos || undefined} />)}
    </div>
    {fortaleza.nivel && <span className="pf-fortaleza-etiqueta">{fortaleza.etiqueta}</span>}
    <ul className="pf-requisitos">
      {fortaleza.requisitos.map((r) => (
        <li key={r.id} data-cumple={r.cumple || undefined}>
          {r.cumple ? <Check size={13} aria-hidden="true" /> : <Circle size={13} aria-hidden="true" />}
          {r.texto}
          {!r.obligatorio && <span className="pf-requisito-tipo"> · recomendado</span>}
        </li>
      ))}
    </ul>
  </div>
);

const VACIO = { actual: '', nueva: '', confirmacion: '' };

const SeguridadCuenta = ({ usuario, onCambiarContrasena }) => {
  const [campos, setCampos] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const problema = problemaDelCambio(campos);
  const fortaleza = fortalezaDe(campos.nueva);
  const empezado = Boolean(campos.nueva || campos.confirmacion);

  const cambiar = (campo) => (valor) => {
    setCampos((anteriores) => ({ ...anteriores, [campo]: valor }));
    setError('');
  };

  const enviar = async (e) => {
    e.preventDefault();
    if (problema) return;
    setGuardando(true);
    const resultado = await onCambiarContrasena(campos.actual, campos.nueva);
    setGuardando(false);
    if (resultado.ok) setCampos(VACIO);
    else setError(resultado.error || 'No se pudo cambiar la contraseña.');
  };

  return (
    <Tarjeta Icono={KeyRound} titulo="Seguridad" subtitulo="La contraseña con la que entras">
      {usuario.needs_password_change && (
        <p className="pf-aviso">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>Tu contraseña es provisional. Cámbiala por una que solo sepas tú.</span>
        </p>
      )}
      <form className="pf-formulario" onSubmit={enviar}>
        <CampoContrasena id="pf-actual" etiqueta="Contraseña actual" valor={campos.actual}
          onCambiar={cambiar('actual')} autoComplete="current-password" deshabilitado={guardando} />
        <CampoContrasena id="pf-nueva" etiqueta="Nueva contraseña" valor={campos.nueva}
          onCambiar={cambiar('nueva')} autoComplete="new-password" deshabilitado={guardando} />
        <Fortaleza fortaleza={fortaleza} />
        <CampoContrasena id="pf-confirmacion" etiqueta="Repite la nueva contraseña"
          valor={campos.confirmacion} onCambiar={cambiar('confirmacion')} autoComplete="new-password"
          deshabilitado={guardando} />

        {error && <p className="pf-error" role="alert">{error}</p>}
        {!error && empezado && problema && <p className="pf-pista">{problema}</p>}

        <div className="pf-acciones">
          <button type="submit" className="pf-btn pf-btn-primario" disabled={guardando || Boolean(problema)}>
            <KeyRound size={15} aria-hidden="true" />
            {guardando ? 'Cambiando…' : 'Cambiar contraseña'}
          </button>
        </div>
      </form>
    </Tarjeta>
  );
};

export default SeguridadCuenta;
