import {
  Activity, FileCheck, FileText, FileX, ShieldCheck, ShieldX, Truck, UserCheck, UserCircle, UserX,
} from 'lucide-react';
import { ICONO_POR_TIPO } from './tiposDeActividad.js';

/**
 * Los iconos de `ICONO_POR_TIPO`, importados uno a uno.
 *
 * El historial los buscaba por nombre en `import * as Iconos from
 * 'lucide-react'`, y eso metía los más de mil iconos de la librería —624 KB—
 * en el paquete que descarga todo el mundo al abrir la aplicación, aunque solo
 * se usaran estos. Un nombre nuevo en `ICONO_POR_TIPO` tiene que añadirse
 * aquí; una prueba lo comprueba.
 */
export const ICONOS_DE_ACTIVIDAD = {
  Activity, FileCheck, FileText, FileX, ShieldCheck, ShieldX, Truck, UserCheck, UserCircle, UserX,
};

/** El icono de un tipo de evento, o el neutro si no tiene uno propio. */
export const iconoDeActividad = (tipo) => ICONOS_DE_ACTIVIDAD[ICONO_POR_TIPO[tipo]] || Activity;
