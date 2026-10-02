import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCog, CalendarRange, Loader, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { apiFetch } from '../../utils/apiClient';
import { fleetKey } from '../model/serviceModel.js';
import {
  DIAS_SEMANA, cambiosDelEditor, diaIso, diasDesde, diasProgramadosAfectados,
  etiquetaDeFecha, indexarDisponibilidad, textoDeRegla,
} from '../model/disponibilidad.js';
import SelectorDeTurnos from './SelectorDeTurnos.jsx';

/**
 * Cuándo descansa una unidad y en qué turnos trabaja (pedido del usuario,
 * 2026-10-02). La configura solo el Programador; los demás la ven.
 *
 * Arriba, su semana habitual; abajo, los próximos días, donde una fecha manda
 * sobre su semana; y un descanso de varios días de una vez (vacaciones). Nada
 * se guarda hasta «Guardar». Si toca un día ya programado, al guardar sus
 * pasajeros en los turnos que no trabaje pasan solos a pendientes: se avisa
 * antes.
 */

const DIAS_A_LA_VISTA = 14;

const VACIO = { semana: {}, fechas: {} };

const copiar = (deLaUnidad) => ({
  semana: { ...(deLaUnidad?.semana || {}) },
  fechas: { ...(deLaUnidad?.fechas || {}) },
});

const DisponibilidadUnidad = ({ unidad, chofer = '', fechaFoco = '', onCerrar, onGuardado }) => {
  const clave = fleetKey(unidad);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [editado, setEditado] = useState(VACIO);
  const [guardando, setGuardando] = useState(false);
  const [rango, setRango] = useState({ desde: '', hasta: '', nota: '' });

  useEffect(() => {
    let vivo = true;
    apiFetch('/api/programador/disponibilidad')
      .then((respuesta) => {
        if (!vivo) return;
        setDatos(respuesta);
        setEditado(copiar(indexarDisponibilidad(respuesta)[clave]));
      })
      .catch((fallo) => {
        if (vivo) setError(fallo?.message || 'No se pudo leer la disponibilidad.');
      });
    return () => { vivo = false; };
  }, [clave]);

  const inicial = useMemo(
    () => (datos ? indexarDisponibilidad(datos)[clave] || VACIO : VACIO), [datos, clave]);
  const cambios = useMemo(() => cambiosDelEditor(inicial, editado), [inicial, editado]);
  const hayCambios = Boolean(cambios.semana) || cambios.fechas.length > 0;
  const afectados = useMemo(
    () => diasProgramadosAfectados(cambios, datos?.dias_con_plan), [cambios, datos]);
  const puedeEditar = Boolean(datos?.puede_editar);
  const conPlan = useMemo(() => new Set(datos?.dias_con_plan || []), [datos]);

  // Los próximos días y, además, los que ya tengan algo apuntado más adelante.
  const dias = useMemo(() => {
    if (!datos?.hoy) return [];
    const proximos = diasDesde(datos.hoy, DIAS_A_LA_VISTA);
    const masAdelante = Object.keys(editado.fechas).filter((f) => !proximos.includes(f));
    const foco = fechaFoco && fechaFoco >= datos.hoy && !proximos.includes(fechaFoco)
      ? [fechaFoco] : [];
    return [...new Set([...proximos, ...masAdelante, ...foco])].sort();
  }, [datos, editado.fechas, fechaFoco]);

  const cambiarSemana = (iso, turnos) => setEditado((previo) => {
    const semana = { ...previo.semana };
    if (turnos === null) delete semana[iso];
    else semana[iso] = turnos;
    return { ...previo, semana };
  });

  const cambiarFecha = (fecha, turnos) => setEditado((previo) => {
    const fechas = { ...previo.fechas };
    if (turnos === undefined) delete fechas[fecha];
    else fechas[fecha] = { turnos, nota: previo.fechas[fecha]?.nota || null };
    return { ...previo, fechas };
  });

  const marcarRango = () => {
    const { desde, hasta, nota } = rango;
    if (!desde || !hasta || hasta < desde) {
      toast.error('Elige desde qué día y hasta qué día descansa.');
      return;
    }
    if (desde < datos.hoy || hasta > datos.hasta) {
      toast.error(`Solo se puede apuntar del ${etiquetaDeFecha(datos.hoy)} al ${etiquetaDeFecha(datos.hasta)}.`);
      return;
    }
    const cuantos = Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;
    setEditado((previo) => {
      const fechas = { ...previo.fechas };
      for (const fecha of diasDesde(desde, cuantos)) {
        fechas[fecha] = { turnos: [], nota: nota.trim() || null };
      }
      return { ...previo, fechas };
    });
    setRango({ desde: '', hasta: '', nota: '' });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const resultado = await apiFetch('/api/programador/disponibilidad', {
        method: 'POST',
        json: { unidad, ...cambios },
      });
      const personas = Number(resultado?.personas) || 0;
      toast.success(personas
        ? `Disponibilidad guardada. ${personas} ${personas === 1 ? 'pasajero pasó' : 'pasajeros pasaron'} `
          + 'a pendientes para ir en otra unidad.'
        : 'Disponibilidad guardada.');
      onGuardado?.(resultado);
      onCerrar();
    } catch (fallo) {
      toast.error(fallo?.message || 'No se pudo guardar la disponibilidad.');
    } finally {
      setGuardando(false);
    }
  };

  const textoDeSuSemana = (fecha) => {
    const turnos = editado.semana[diaIso(fecha)];
    return textoDeRegla(turnos === undefined ? null : turnos);
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-disp-titulo">
      <div className="modal-content pw-confirmar pw-disp">
        <button type="button" className="pw-confirmar-cerrar" onClick={onCerrar}
          aria-label="Cerrar" disabled={guardando}>
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pw-confirmar-icono pw-disp-icono">
          <CalendarCog size={22} aria-hidden="true" />
        </div>
        <h3 id="pw-disp-titulo">Disponibilidad de {unidad}</h3>
        {chofer && <p>{chofer}</p>}

        {error && (
          <p className="pw-confirmar-aviso" role="alert">
            <AlertTriangle size={16} aria-hidden="true" /> {error}
          </p>
        )}
        {!datos && !error && (
          <p className="pw-disp-cargando"><Loader size={16} className="pw-ia-girando" aria-hidden="true" /> Cargando…</p>
        )}

        {datos && (
          <>
            {!puedeEditar && (
              <p className="pw-disp-ayuda">Solo el Programador de rutas puede cambiarla.</p>
            )}

            <section className="pw-disp-seccion" aria-labelledby="pw-disp-semana">
              <h4 id="pw-disp-semana">Su semana habitual</h4>
              <p className="pw-disp-ayuda">Se repite cada semana. Un día concreto, abajo, manda sobre esto.</p>
              {DIAS_SEMANA.map(({ iso, largo }) => (
                <div className="pw-disp-fila" key={iso}>
                  <span className="pw-disp-dia">{largo}</span>
                  <SelectorDeTurnos
                    valor={editado.semana[iso] === undefined ? null : editado.semana[iso]}
                    turnos={datos.turnos}
                    etiqueta={largo}
                    deshabilitado={!puedeEditar || guardando}
                    onCambiar={(turnos) => cambiarSemana(iso, turnos)}
                  />
                </div>
              ))}
            </section>

            <section className="pw-disp-seccion" aria-labelledby="pw-disp-fechas">
              <h4 id="pw-disp-fechas">Días concretos</h4>
              <p className="pw-disp-ayuda">Un día suelto en que descansa, trabaja otros turnos o sí trabaja aunque su semana diga que no.</p>
              {dias.map((fecha) => (
                <div className="pw-disp-fila" key={fecha} data-foco={fecha === fechaFoco || undefined}>
                  <span className="pw-disp-dia">
                    {etiquetaDeFecha(fecha)}
                    {conPlan.has(fecha) && <small className="pw-tag">Programado</small>}
                    {editado.fechas[fecha]?.nota && (
                      <small className="pw-disp-nota">{editado.fechas[fecha].nota}</small>
                    )}
                  </span>
                  <SelectorDeTurnos
                    valor={editado.fechas[fecha] ? editado.fechas[fecha].turnos : undefined}
                    turnos={datos.turnos}
                    etiqueta={etiquetaDeFecha(fecha)}
                    conSemana
                    textoSemana={textoDeSuSemana(fecha)}
                    deshabilitado={!puedeEditar || guardando}
                    onCambiar={(turnos) => cambiarFecha(fecha, turnos)}
                  />
                </div>
              ))}

              {puedeEditar && (
                <div className="pw-disp-rango">
                  <CalendarRange size={16} aria-hidden="true" />
                  <span>Descanso de varios días:</span>
                  <label>
                    del
                    <input type="date" className="pw-input pw-input-fecha" value={rango.desde}
                      min={datos.hoy} max={datos.hasta} disabled={guardando}
                      onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))} />
                  </label>
                  <label>
                    al
                    <input type="date" className="pw-input pw-input-fecha" value={rango.hasta}
                      min={rango.desde || datos.hoy} max={datos.hasta} disabled={guardando}
                      onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))} />
                  </label>
                  <input type="text" className="pw-input pw-input-nota" value={rango.nota}
                    placeholder="Motivo (opcional), p. ej. vacaciones" maxLength={200} disabled={guardando}
                    onChange={(e) => setRango((r) => ({ ...r, nota: e.target.value }))} />
                  <button type="button" className="pw-btn pw-btn-sm" onClick={marcarRango} disabled={guardando}>
                    Marcar descanso
                  </button>
                </div>
              )}
            </section>

            {afectados.length > 0 && (
              <p className="pw-confirmar-aviso">
                <AlertTriangle size={16} aria-hidden="true" />
                <span>
                  {afectados.map(etiquetaDeFecha).join(', ')}{' '}
                  {afectados.length === 1 ? 'ya está programado' : 'ya están programados'}: al
                  guardar, los pasajeros de {unidad} en los turnos que no trabaje pasan a
                  pendientes para ir en otra unidad.
                </span>
              </p>
            )}

            <div className="pw-confirmar-botones">
              <button type="button" className="pw-btn" onClick={onCerrar} disabled={guardando}>
                {puedeEditar ? 'Cancelar' : 'Cerrar'}
              </button>
              {puedeEditar && (
                <button type="button" className="pw-btn pw-btn-primary" onClick={guardar}
                  disabled={!hayCambios || guardando}>
                  {guardando ? <Loader size={16} className="pw-ia-girando" aria-hidden="true" />
                    : <CalendarCog size={16} aria-hidden="true" />}
                  Guardar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DisponibilidadUnidad;
