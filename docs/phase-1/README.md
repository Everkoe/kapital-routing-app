# Fase 1 — Seguridad compatible

La fase 1 se aplica de manera incremental para conservar la experiencia actual.
El rol Programador de rutas y su motor no cambian durante esta etapa.

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
- La configuración de Supabase prioriza variables de entorno, manteniendo un
  fallback temporal hasta verificar Vercel.

## Compatibilidad

No se cambian formularios, navegación, estilos ni respuestas públicas del login.
El login ya crea la sesión compatible; la siguiente entrega aplicará esa sesión
a los endpoints y centralizará la autorización antes de volverla obligatoria.

## Despliegue reversible

1. Desplegar este código con `KAPITAL_PASSWORD_HASH_WRITE=false`.
2. Confirmar login y cambio de contraseña en Preview y producción. Esta versión
   ya sabe leer ambos formatos, pero todavía escribe el formato anterior.
3. Configurar `KAPITAL_PASSWORD_HASH_WRITE=true` en Vercel y volver a desplegar.
4. Si se requiere rollback, volver como mínimo a la versión del paso 1, que ya
   reconoce los hashes generados.

No debe activarse la escritura de hashes antes de desplegar la compatibilidad de
lectura.
