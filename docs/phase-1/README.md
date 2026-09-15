# Fase 1 — Seguridad compatible

La fase 1 se aplica de manera incremental para conservar la experiencia actual.
El rol Programador de rutas y su motor no cambian durante esta etapa.

> **⚠️ Estado real al 2026-09-15 — este documento describía el plan, no lo ocurrido.**
>
> El paso 4 de "Despliegue reversible" (más abajo) exige mantener
> `KAPITAL_AUTH_ENFORCED=false` hasta instrumentar el manejo frontend de 401.
> **El PR #2 cambió ese default a `true` y se desplegó a producción sin cumplir la
> precondición**: el frontend sigue sin manejar respuestas 401 (0 coincidencias en
> `frontend/src/`, con 42 llamadas `fetch`), y solo ~12 de 46 endpoints tienen control
> de sesión.
>
> El paso 4 sigue siendo el criterio correcto; lo que está mal es el estado actual, no
> el plan. El orden de trabajo para converger está en
> [`docs/handoff/2026-09-15-relevo.md`](../handoff/2026-09-15-relevo.md) §8, y el
> contraste requisito por requisito en su §6.

## Lote 1: credenciales y privilegios

- El backend ya puede verificar contraseñas PBKDF2-HMAC-SHA256 con salt aleatorio
  y 310,000 iteraciones, además del formato antiguo.
- La escritura de hashes queda protegida por `KAPITAL_PASSWORD_HASH_WRITE`.
- Al activar esa variable, los usuarios nuevos guardan hashes y las contraseñas
  antiguas se migran automáticamente al primer login exitoso.
- Con la variable activada, los cambios de contraseña también almacenan
  exclusivamente el hash.
- `PUT /api/user/profile` rechaza cualquier intento de modificar directamente
  el rol del usuario.
- El login crea una sesión opaca en una cookie `HttpOnly` y guarda únicamente
  el SHA-256 del token. Las últimas cinco sesiones válidas por usuario se
  conservan durante 12 horas por defecto.
- Perfil y gestión de usuarios ya pueden exigir que la cookie corresponda al
  usuario o administrador declarado. La exigencia se activa con
  `KAPITAL_AUTH_ENFORCED=true` después del despliegue compatible.
- La configuración de Supabase prioriza variables de entorno, manteniendo un
  fallback temporal hasta verificar Vercel.

## Compatibilidad

No se cambian formularios, navegación, estilos ni respuestas públicas del login.
El login ya crea la sesión compatible y perfil/usuarios ya la reconocen. La
siguiente entrega cubrirá los endpoints activos restantes y el manejo frontend
de expiración antes de volverla obligatoria.

## Despliegue reversible

1. Desplegar este código con `KAPITAL_PASSWORD_HASH_WRITE=false`.
2. Confirmar login y cambio de contraseña en Preview y producción. Esta versión
   ya sabe leer ambos formatos, pero todavía escribe el formato anterior.
3. Configurar `KAPITAL_PASSWORD_HASH_WRITE=true` en Vercel y volver a desplegar.
4. Mantener `KAPITAL_AUTH_ENFORCED=false` hasta que todos los endpoints activos
   y el manejo frontend de respuestas 401 estén instrumentados.
5. Después, validar renovación de sesión y activar la exigencia primero en
   Preview y luego en producción.
6. Si se requiere rollback, volver como mínimo a la versión del paso 1, que ya
   reconoce los hashes generados.

No debe activarse la escritura de hashes antes de desplegar la compatibilidad de
lectura.
