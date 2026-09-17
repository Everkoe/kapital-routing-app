/**
 * Cómo se presenta cada tipo de evento del historial.
 *
 * El icono y el color acompañan, pero nunca son lo único que distingue un
 * evento: cada fila lleva además su nombre escrito y su estado en texto, para
 * que se entienda sin depender de ver el color.
 *
 * Un tipo que no esté aquí no rompe nada: se muestra con el aspecto neutro y su
 * propio nombre. Preferible a esconder un evento porque falte una entrada.
 */

export const ESTADOS_ACTIVIDAD = {
  success: { etiqueta: 'Éxito', clase: 'act-exito' },
  info: { etiqueta: 'Información', clase: 'act-info' },
  warning: { etiqueta: 'Advertencia', clase: 'act-aviso' },
  error: { etiqueta: 'Error', clase: 'act-error' },
};

/** Nombre del icono de lucide-react que ilustra cada tipo. */
export const ICONO_POR_TIPO = {
  'Usuario inició sesión': 'UserCircle',
  'Usuario desactivado': 'UserX',
  'Usuario reactivado': 'UserCheck',
  'Unidad creada': 'Truck',
  'Unidad actualizada': 'Truck',
  'Documento cargado': 'FileText',
  'Documento aprobado': 'FileCheck',
  'Documento rechazado': 'FileX',
  'Acceso aprobado': 'ShieldCheck',
  'Acceso denegado': 'ShieldX',
};

export const estadoDeActividad = (estado) =>
  ESTADOS_ACTIVIDAD[estado] || ESTADOS_ACTIVIDAD.info;

/**
 * Fecha legible: lo reciente en palabras y lo antiguo con su fecha completa.
 *
 * «Hoy, 12:45» se entiende de un vistazo; «17/09/2026, 12:45» hace falta en
 * cuanto el evento deja de ser de esta semana. Se usa la zona horaria del
 * equipo, que es la del administrador que está auditando.
 */
export const fechaLegible = (iso, ahora = new Date()) => {
  if (!iso) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';

  const hora = fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diferencia = Math.round((dia(ahora) - dia(fecha)) / 86400000);

  if (diferencia === 0) return `Hoy, ${hora}`;
  if (diferencia === 1) return `Ayer, ${hora}`;
  return `${fecha.toLocaleDateString('es-PE')}, ${hora}`;
};

/** Marca lo que va entre números de página cuando no caben todos. */
export const SALTO_DE_PAGINAS = '…';

/**
 * Números de página que se muestran, con saltos cuando son demasiados.
 *
 * Siempre se ven la primera y la última —son las dos que más se buscan— más
 * una ventana alrededor de la actual. Con pocas páginas se listan todas, sin
 * saltos que no aportan nada.
 */
export const paginasVisibles = (actual, total, ventana = 1) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const numeros = new Set([1, total]);
  for (let n = actual - ventana; n <= actual + ventana; n += 1) {
    if (n >= 1 && n <= total) numeros.add(n);
  }

  const ordenados = [...numeros].sort((a, b) => a - b);
  return ordenados.flatMap((numero, i) => (
    i > 0 && numero - ordenados[i - 1] > 1 ? [SALTO_DE_PAGINAS, numero] : [numero]
  ));
};
