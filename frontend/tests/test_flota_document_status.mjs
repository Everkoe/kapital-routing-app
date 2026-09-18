import test from 'node:test';
import assert from 'node:assert/strict';
import { countFleetDocumentStatuses, getDocumentStatus, getFleetUnitId } from '../src/utils/flotaDocumentStatus.js';

const TODAY = new Date(2026, 8, 15, 12);

test('clasifica fechas vacías o inválidas como N/A', () => {
  for (const value of ['', null, undefined, '15/09/2026', '2026-02-30']) {
    assert.equal(getDocumentStatus(value, TODAY).key, 'na');
  }
});

test('clasifica los límites de vencimiento de forma consistente', () => {
  assert.equal(getDocumentStatus('2026-09-14', TODAY).key, 'expired');
  assert.equal(getDocumentStatus('2026-09-15', TODAY).key, 'expiring');
  assert.equal(getDocumentStatus('2026-09-30', TODAY).key, 'expiring');
  assert.equal(getDocumentStatus('2026-10-01', TODAY).key, 'valid');
});

test('los KPI usan exactamente los mismos estados que las filas', () => {
  const counts = countFleetDocumentStatuses([{
    soat: '2026-10-01', revision: '2026-09-30', licencia: '2026-09-14',
  }], TODAY);
  assert.deepEqual(counts, { valid: 1, expiring: 1, expired: 1, na: 0 });
});

test('el T.U.C. (ATU) ya no cuenta para el estado de documentación', () => {
  // Se retiró del seguimiento. Una unidad con su fecha guardada no debe sumar
  // un documento más ni aparecer como vigente por él.
  const conAtu = countFleetDocumentStatuses([{ soat: '2026-10-01', atu: '2026-10-01' }], TODAY);
  const sinAtu = countFleetDocumentStatuses([{ soat: '2026-10-01' }], TODAY);
  assert.deepEqual(conAtu, sinAtu);
  assert.equal(conAtu.valid, 1, 'solo el SOAT cuenta como vigente');
});

test('la identidad operativa de edición es unidad_id, no la placa física', () => {
  assert.equal(getFleetUnitId({ unidad_id: 'PADRON-001', placa: 'ABC-123' }), 'PADRON-001');
  assert.equal(getFleetUnitId({ placa: 'ABC-123' }), '');
});
