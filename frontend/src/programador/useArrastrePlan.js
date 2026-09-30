import { useCallback, useState } from 'react';
import {
  cambiosParaDejarPendiente,
  cambiosParaSoltar,
  comprobarDestino,
  personaDePendiente,
  personaDeServicio,
  textoDeLaPosicion,
} from './model/arrastrePlan.js';

/**
 * Lo que pasa mientras alguien arrastra gente por el plan, y al soltarla.
 *
 * Qué se deja soltar dónde es de `model/arrastrePlan.js`; aquí solo el estado
 * —quién se arrastra, qué espera confirmación, a quién se está moviendo sin
 * arrastrar— y el guardado, que va por el mismo `editar` que el resto de la
 * mesa: cada cambio se guarda al momento.
 *
 * Empezar y terminar un arrastre se aplazan un instante: marcarlo vuelve a
 * pintar las doscientas tarjetas, y hacerlo dentro del propio `dragstart` puede
 * cancelar el arrastre en Chrome. Los dos van por la misma cola, así que
 * terminar nunca adelanta a empezar.
 */
const aplazar = (hacer) => setTimeout(hacer, 0);

export const useArrastrePlan = ({ editar, pendientesMotor }) => {
  const [arrastre, setArrastre] = useState(null);
  const [porConfirmar, setPorConfirmar] = useState(null);
  const [moviendo, setMoviendo] = useState(null);

  const empezarDesdeServicio = useCallback((service, agente) => {
    const persona = agente ? personaDeServicio(service, agente) : null;
    aplazar(() => setArrastre(persona));
  }, []);

  const empezarDesdePendiente = useCallback((clave) => {
    const pendiente = pendientesMotor.find((p) => p.clave === clave);
    aplazar(() => setArrastre(pendiente ? personaDePendiente(pendiente) : null));
  }, [pendientesMotor]);

  const terminar = useCallback(() => aplazar(() => setArrastre(null)), []);

  const aplicar = useCallback((persona, destino, posicion = null) => {
    const { cambios, posicion: donde } = cambiosParaSoltar(persona, destino, posicion);
    return editar(cambios, `${persona.nombre} va en ${textoDeLaPosicion(destino, donde)}.`);
  }, [editar]);

  const soltarEn = useCallback((destino) => {
    const persona = arrastre;
    setArrastre(null);
    const comprobado = comprobarDestino(persona, destino);
    if (!comprobado.permitido) return;
    if (comprobado.avisos.length > 0) {
      setPorConfirmar({ persona, destino, avisos: comprobado.avisos });
      return;
    }
    aplicar(persona, destino);
  }, [arrastre, aplicar]);

  const confirmar = useCallback(async () => {
    if (!porConfirmar) return;
    await aplicar(porConfirmar.persona, porConfirmar.destino);
    setPorConfirmar(null);
  }, [porConfirmar, aplicar]);

  const cancelarConfirmacion = useCallback(() => setPorConfirmar(null), []);

  const dejarPendiente = useCallback((persona) => {
    if (!persona?.origen) return Promise.resolve(false);
    return editar(cambiosParaDejarPendiente(persona),
      `${persona.nombre} sale de ${persona.origen.conductor} y queda pendiente. No es una baja.`);
  }, [editar]);

  // Soltada sobre «Novedades y pendientes».
  const soltarEnPendientes = useCallback(() => {
    const persona = arrastre;
    setArrastre(null);
    dejarPendiente(persona);
  }, [arrastre, dejarPendiente]);

  const abrirMover = useCallback(
    (service, agente) => setMoviendo(personaDeServicio(service, agente)), []);
  const cerrarMover = useCallback(() => setMoviendo(null), []);

  const moverA = useCallback(async (candidato) => {
    if (!moviendo) return;
    if (await aplicar(moviendo, candidato.service, candidato.posicion)) setMoviendo(null);
  }, [moviendo, aplicar]);

  const moverAPendientes = useCallback(async () => {
    if (await dejarPendiente(moviendo)) setMoviendo(null);
  }, [moviendo, dejarPendiente]);

  return {
    arrastre,
    porConfirmar,
    moviendo,
    empezarDesdeServicio,
    empezarDesdePendiente,
    terminar,
    soltarEn,
    soltarEnPendientes,
    confirmar,
    cancelarConfirmacion,
    abrirMover,
    cerrarMover,
    moverA,
    moverAPendientes,
  };
};

export default useArrastrePlan;
