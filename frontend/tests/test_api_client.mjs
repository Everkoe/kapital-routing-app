import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  apiFetch,
  apiRequest,
  logoutSession,
  setSessionExpiredHandler,
} from '../src/utils/apiClient.js';

const jsonResponse = (body, { status = 200 } = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** Sustituye fetch y restaura el estado global al terminar. */
const withFetch = async (impl, run) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return impl(path, init);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    setSessionExpiredHandler(null);
  }
};

test('devuelve el cuerpo JSON ya parseado', async () => {
  await withFetch(() => jsonResponse({ identifier: 'drv-1' }), async () => {
    const data = await apiFetch('/api/auth/me');
    assert.equal(data.identifier, 'drv-1');
  });
});

test('un 401 dispara el manejador de sesión expirada una sola vez', async () => {
  await withFetch(
    () => jsonResponse({ detail: 'Sesión inválida o expirada.' }, { status: 401 }),
    async () => {
      const expired = [];
      setSessionExpiredHandler((err) => expired.push(err));

      await assert.rejects(
        () => apiFetch('/api/user/profile'),
        (err) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.status, 401);
          assert.equal(err.message, 'Sesión inválida o expirada.');
          assert.ok(err.isSessionExpired);
          return true;
        },
      );

      assert.equal(expired.length, 1);
    },
  );
});

test('un 403 NO cierra la sesión: puede ser solo un rol sin permiso', async () => {
  await withFetch(
    () => jsonResponse({ detail: 'El rol actual no tiene permiso para esta acción.' }, { status: 403 }),
    async () => {
      const expired = [];
      setSessionExpiredHandler((err) => expired.push(err));

      await assert.rejects(
        () => apiFetch('/api/admin/users'),
        (err) => {
          assert.equal(err.status, 403);
          assert.ok(err.isForbidden);
          assert.ok(!err.isSessionExpired);
          return true;
        },
      );

      assert.equal(expired.length, 0, 'un 403 no debe expulsar al usuario');
    },
  );
});

test('propaga el detail del backend como mensaje accionable', async () => {
  await withFetch(
    () => jsonResponse({ detail: 'Tu cuenta está desactivada. Contacta con Administración.' }, { status: 403 }),
    async () => {
      await assert.rejects(
        () => apiFetch('/api/user/profile'),
        { message: 'Tu cuenta está desactivada. Contacta con Administración.' },
      );
    },
  );
});

test('sobrevive a un cuerpo de error que no es JSON', async () => {
  await withFetch(
    () => new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    async () => {
      await assert.rejects(
        () => apiFetch('/api/routes'),
        (err) => {
          assert.equal(err.status, 502);
          assert.match(err.message, /502 Bad Gateway/);
          return true;
        },
      );
    },
  );
});

test('serializa json y fija Content-Type sin pisar otras cabeceras', async () => {
  await withFetch(() => jsonResponse({ ok: true }), async (calls) => {
    await apiFetch('/api/flota/K-001', {
      method: 'PUT',
      json: { soat: '2027-05-20' },
      headers: { 'X-Trace': 'abc' },
    });

    const [{ init }] = calls;
    assert.equal(init.method, 'PUT');
    assert.equal(init.body, '{"soat":"2027-05-20"}');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers['X-Trace'], 'abc');
  });
});

test('preserva FormData y deja que el navegador construya su boundary', async () => {
  await withFetch(() => jsonResponse({ ok: true }), async (calls) => {
    const formData = new FormData();
    formData.append('file', new Blob(['routes']), 'routes.xlsx');
    formData.append('fecha', '2026-09-15');

    await apiFetch('/api/assign-routes/', { method: 'POST', body: formData });

    const [{ init }] = calls;
    assert.equal(init.body, formData);
    assert.equal(init.headers['Content-Type'], undefined);
  });
});

test('apiRequest devuelve la Response sin consumir, para descargas', async () => {
  await withFetch(() => new Response('binario', { status: 200 }), async () => {
    const response = await apiRequest('/api/flota/export?base=MASIVO');
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), 'binario');
  });
});

test('una respuesta sin cuerpo devuelve null en vez de romper', async () => {
  await withFetch(() => new Response(null, { status: 204 }), async () => {
    assert.equal(await apiFetch('/api/notifications/mark-read', { method: 'POST' }), null);
  });
});

test('logoutSession nunca lanza aunque el backend falle', async () => {
  await withFetch(() => jsonResponse({ detail: 'boom' }, { status: 503 }), async () => {
    assert.equal(await logoutSession(), false);
  });

  await withFetch(() => jsonResponse({ revoked: true }), async () => {
    assert.equal(await logoutSession(), true);
  });
});
