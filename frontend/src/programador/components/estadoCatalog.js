import { AlertTriangle, CheckCircle2, CircleDashed, Info, MapPin, UserPlus } from 'lucide-react';

/**
 * Catálogo de estados.
 *
 * Vive separado de los componentes que lo pintan porque un módulo que exporta
 * componentes y constantes a la vez rompe el recargado en caliente de React.
 *
 * Regla del proyecto: un estado nunca se comunica solo con color. Cada entrada
 * lleva icono, texto y tono, y el badge los pinta siempre juntos, de modo que
 * siga siendo legible en escala de grises o con daltonismo.
 *
 * Solo figuran aquí los estados que el backend puede respaldar hoy. Los del
 * flujo de revisión —modificado, pendiente, aprobado, rechazado— llegarán con
 * el contrato que los produzca; ponerlos ahora sería dibujar una función que
 * no existe.
 */

export const FALLBACK_STATE = { label: 'Desconocido', tone: 'neutral', Icon: CircleDashed };

export const SERVICE_STATES = {
  programado: { label: 'Programado', tone: 'ok', Icon: CheckCircle2 },
  completo: { label: 'Unidad completa', tone: 'warn', Icon: AlertTriangle },
  excedido: { label: 'Capacidad excedida', tone: 'danger', Icon: AlertTriangle },
  sin_asignar: { label: 'Sin unidad asignada', tone: 'danger', Icon: UserPlus },
  vacio: { label: 'Sin agentes', tone: 'neutral', Icon: CircleDashed },
};

export const NOVELTY_REASONS = {
  sin_ubicacion: { label: 'Sin ubicación', tone: 'danger', Icon: MapPin },
  direccion_incompleta: { label: 'Dirección incompleta', tone: 'warn', Icon: Info },
  sin_unidad: { label: 'Sin unidad disponible', tone: 'warn', Icon: UserPlus },
  // Los dos motivos con los que una novedad deja a alguien pendiente. Decir
  // «sin unidad» de un alta sería describir la consecuencia y callar la causa.
  alta: { label: 'Alta del cliente', tone: 'ok', Icon: UserPlus },
  // «de zona u horario» se quedaba corto: también entra aquí quien se mudó, y
  // una etiqueta que dice «horario» a alguien que cambió de casa confunde. Lo
  // que cambió lo dice la línea de detalle, con las palabras de la novedad.
  cambio: { label: 'Cambio del cliente', tone: 'warn', Icon: Info },
};

export const SERVICE_STATE_KEYS = Object.keys(SERVICE_STATES);

export const serviceStateLabel = (key) => (SERVICE_STATES[key] || FALLBACK_STATE).label;

export const noveltyReasonLabel = (key) => (NOVELTY_REASONS[key] || FALLBACK_STATE).label;
