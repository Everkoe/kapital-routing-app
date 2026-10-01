import { useState } from 'react';
import { Camera, CarFront, Hourglass, IdCard, Info, Loader2, Pencil, Plus, Truck } from 'lucide-react';
import ImagenGuardada from '../components/ImagenGuardada';
import {
  CAMPOS_PERSONALES, CAMPOS_VEHICULO, CAMPOS_VEHICULO_2,
  solicitudPendiente, valorDelPerfil, vehiculo2Habilitado,
} from './modeloPerfil';
import { Fila, SinDato, Tarjeta } from './piezas';
import SolicitarCambio from './SolicitarCambio';
import { useFotoConPrevia } from './useFotoConPrevia';

/**
 * Los datos del conductor y de su vehículo, en «Mi perfil».
 *
 * Cada dato lleva «Solicitar cambio» o, si ya hay una solicitud, «En revisión»
 * con lo que se pidió. Un dato que no hay dice «Sin dato»: la pantalla anterior
 * rellenaba la capacidad con 15 pasajeros a quien no la tenía.
 */

const FilaSolicitable = ({ campo, perfil, onSolicitar }) => {
  const valor = valorDelPerfil(perfil, campo);
  const pendiente = solicitudPendiente(perfil, campo.clave);
  const accion = pendiente ? (
    <span className="pf-revision" title={`Pediste: ${pendiente.new_value}`}>
      <Hourglass size={13} aria-hidden="true" />
      En revisión
    </span>
  ) : (
    <button type="button" className="pf-btn pf-btn-texto" onClick={() => onSolicitar(campo)}>
      <Pencil size={14} aria-hidden="true" />
      Solicitar cambio
    </button>
  );
  return (
    <Fila etiqueta={campo.etiqueta} accion={accion}
      nota={pendiente ? `Pediste cambiarlo a «${pendiente.new_value}».` : undefined}>
      {valor ?? <SinDato />}
    </Fila>
  );
};

const FotoVehiculo = ({ foto, onCambiarFoto, limiteMb }) => {
  const {
    previa, subiendo, getRootProps, getInputProps, isDragActive,
  } = useFotoConPrevia(onCambiarFoto);

  let imagen = null;
  if (previa) imagen = <img src={previa} alt="" className="pf-vehiculo-img" />;
  else if (foto) imagen = <ImagenGuardada imagen={foto} alt="" className="pf-vehiculo-img" />;

  return (
    <div {...getRootProps({
      className: 'pf-vehiculo-foto',
      role: 'button',
      'aria-label': 'Cambiar foto del vehículo',
      title: `Cambiar foto · una foto clara del exterior, hasta ${limiteMb} MB`,
      'data-arrastrando': isDragActive || undefined,
    })}>
      <input {...getInputProps()} />
      <span className="pf-vehiculo-vacio" aria-hidden="true">
        <CarFront size={30} />
        Añadir foto del vehículo
      </span>
      {imagen}
      <span className="pf-vehiculo-camara" aria-hidden="true">
        {subiendo ? <Loader2 size={15} className="pf-girando" /> : <Camera size={15} />}
        {subiendo ? 'Subiendo…' : 'Cambiar foto'}
      </span>
    </div>
  );
};

const DatosConductor = ({ usuario, onSolicitarCambio, onCambiarFotoVehiculo, limiteMb }) => {
  const perfil = usuario.perfil_conductor || {};
  const [editando, setEditando] = useState(null);
  const [pidiendoVehiculo2, setPidiendoVehiculo2] = useState(false);
  const segundo = vehiculo2Habilitado(perfil);
  const segundoPendiente = solicitudPendiente(perfil, 'vehiculo2_habilitado');

  const pedirVehiculo2 = async () => {
    setPidiendoVehiculo2(true);
    await onSolicitarCambio('vehiculo2_habilitado', 'true');
    setPidiendoVehiculo2(false);
  };

  return (
    <div className="pf-columna">
      <p className="pf-nota pf-nota-destacada">
        <Info size={16} aria-hidden="true" />
        <span>
          Estos datos los revisa Administración: pide el cambio y se aplica cuando lo aprueben.
        </span>
      </p>

      <Tarjeta Icono={IdCard} titulo="Datos personales">
        <dl className="pf-filas">
          {CAMPOS_PERSONALES.map((campo) => (
            <FilaSolicitable key={campo.clave} campo={campo} perfil={perfil} onSolicitar={setEditando} />
          ))}
        </dl>
      </Tarjeta>

      <Tarjeta Icono={Truck} titulo="Vehículo" subtitulo={usuario.unidad_id ? `Unidad ${usuario.unidad_id}` : undefined}>
        <div className="pf-vehiculo">
          <FotoVehiculo foto={perfil.fotoVehiculo} onCambiarFoto={onCambiarFotoVehiculo} limiteMb={limiteMb} />
          <dl className="pf-filas">
            {CAMPOS_VEHICULO.map((campo) => (
              <FilaSolicitable key={campo.clave} campo={campo} perfil={perfil} onSolicitar={setEditando} />
            ))}
          </dl>
        </div>
      </Tarjeta>

      {segundo ? (
        <Tarjeta Icono={Truck} titulo="Segundo vehículo">
          <dl className="pf-filas">
            {CAMPOS_VEHICULO_2.map((campo) => (
              <FilaSolicitable key={campo.clave} campo={campo} perfil={perfil} onSolicitar={setEditando} />
            ))}
          </dl>
        </Tarjeta>
      ) : (
        <div className="pf-vehiculo2">
          <span>
            <strong>¿Trabajas también con un segundo vehículo?</strong>
            <small>Administración tiene que habilitarlo antes de que puedas registrar sus datos.</small>
          </span>
          {segundoPendiente ? (
            <span className="pf-revision"><Hourglass size={13} aria-hidden="true" />Solicitud en revisión</span>
          ) : (
            <button type="button" className="pf-btn" onClick={pedirVehiculo2} disabled={pidiendoVehiculo2}>
              <Plus size={15} aria-hidden="true" />
              {pidiendoVehiculo2 ? 'Enviando…' : 'Solicitar segundo vehículo'}
            </button>
          )}
        </div>
      )}

      {editando && (
        <SolicitarCambio
          campo={editando}
          valorActual={perfil[editando.clave] ? String(perfil[editando.clave]) : ''}
          onEnviar={(valor) => onSolicitarCambio(editando.clave, valor)}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
};

export default DatosConductor;
