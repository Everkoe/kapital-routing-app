// El T.U.C. (ATU) se retira: la operación dejó de usarlo y seguía contando
// para el estado de documentación, que es lo que alimenta los indicadores del
// panel. Los valores ya guardados se quedan donde están, sin leerse.
export const FLEET_DOCUMENT_FIELDS = Object.freeze(['soat', 'revision', 'licencia']);

export const getFleetUnitId = (vehicle) => {
  const unitId = vehicle?.unidad_id;
  return unitId === null || unitId === undefined ? '' : String(unitId).trim();
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const toUtcDay = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }

  if (typeof value !== 'string') return null;
  const match = DATE_ONLY_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDay = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcDay);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;

  return utcDay;
};

/**
 * Deriva el estado exclusivamente de la fecha de vencimiento.
 * Hoy se considera "Por vencer", igual que cualquier fecha entre hoy y 15 días.
 */
export const getDocumentStatus = (expirationDate, now = new Date()) => {
  const targetDay = toUtcDay(expirationDate);
  const today = toUtcDay(now);
  if (targetDay === null || today === null) {
    return { key: 'na', status: 'unknown', text: 'N/A', daysRemaining: null };
  }

  const daysRemaining = Math.round((targetDay - today) / DAY_MS);
  if (daysRemaining < 0) {
    return { key: 'expired', status: 'danger', text: 'Vencido', daysRemaining };
  }
  if (daysRemaining <= 15) {
    return { key: 'expiring', status: 'warning', text: 'Por vencer', daysRemaining };
  }
  return { key: 'valid', status: 'success', text: 'Vigente', daysRemaining };
};

export const countFleetDocumentStatuses = (fleet, now = new Date()) => {
  const counts = { valid: 0, expiring: 0, expired: 0, na: 0 };
  for (const vehicle of fleet || []) {
    for (const field of FLEET_DOCUMENT_FIELDS) {
      counts[getDocumentStatus(vehicle?.[field], now).key] += 1;
    }
  }
  return counts;
};
