import { FALLBACK_STATE, NOVELTY_REASONS, SERVICE_STATES } from './estadoCatalog.js';

/**
 * Badges de estado. El catálogo y sus helpers viven en `estadoCatalog.js`.
 */

const Badge = ({ entry, size }) => (
  <span className="pw-state" data-tone={entry.tone}>
    <entry.Icon size={size} aria-hidden="true" />
    {entry.label}
  </span>
);

export const ServiceStateBadge = ({ estado, size = 15 }) => (
  <Badge entry={SERVICE_STATES[estado] || FALLBACK_STATE} size={size} />
);

export const NoveltyReasonBadge = ({ motivo, size = 13 }) => (
  <Badge entry={NOVELTY_REASONS[motivo] || FALLBACK_STATE} size={size} />
);
