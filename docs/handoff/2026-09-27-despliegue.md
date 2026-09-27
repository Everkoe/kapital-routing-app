# Despliegue de `develop` a `main` — 2026-09-27

Los commits de `develop` que aún no están en producción (`git log origin/main..develop`):

| Commit | Qué cambia |
|---|---|
| `8b57b4d` | Las sesiones salen de la fila única a `public.sesiones`. |
| `46b1399` | Guardar escribe solo lo que cambió (`guardar_estado()`), y dos instancias ya no se pisan. |
| `47f3ced` | Once endpoints que no pedían sesión, y no eran todos de lectura. |
| `31bdae3` | Primera revisión independiente: un guardado podía borrar una cuenta real. |
| `339affb` | Tope de intentos en el login y en el cambio de contraseña. |
| `67f6e75` | Segunda revisión: generación por clave, 409 que no se repite, reintentos. |
| `8a589bb` | Tercera revisión: altas que se borraban, vuelta atrás tras un 409, tope atómico y por cuenta. |
| `74c4404` | Cuarta revisión: el registro público sin tope, candado por origen, `Callable` sin importar. |

Las cuatro revisiones las hizo un revisor independiente sobre el código, antes de desplegar; cada
hallazgo tiene una prueba que falla con el código anterior. La cuarta ya no encontró nada grave en lo
cambiado. Queda un riesgo conocido, de antes y de gravedad media-baja: cualquier relectura completa —y
la que hace un 409— sustituye los diccionarios en memoria que otra petición en curso puede estar
modificando, y ese cambio se pierde aunque la petición responda 200. Pasa desde siempre con
`reload_db()`; lo resuelve de verdad sacar las cuentas de la fila única a tablas.

**El CI de GitHub usa Python 3.12 y en local solo hay 3.14**: 3.14 evalúa las anotaciones en diferido y
deja pasar un nombre sin importar que en 3.12 impediría arrancar el backend (pasó con `Callable`). Antes
de desplegar, comprobar que el workflow de `main` queda en verde.

## Lo que ya está en la base

Las migraciones **007, 008 y 009 ya están aplicadas** en `kapital-routing-v2`. Son inertes para el código
que hay hoy en producción: crean tablas y funciones que ese código no usa, y la 009 quita a `anon` y a
`authenticated` un permiso de lectura sobre `app_state` que el backend no utiliza. Comprobarlo antes de
desplegar:

```bash
./frontend/venv/Scripts/python.exe scripts/aplicar_sql.py --consulta "select to_regclass('public.sesiones') is not null as sesiones, to_regclass('public.intentos_acceso') is not null as intentos, exists(select 1 from pg_proc where proname = 'guardar_estado') as guardar_estado"
```

Las tres deben dar `true`.

## Pasos

1. Fusionar `develop` en `main` con un commit de merge (`Merge develop: …`, como los anteriores) y subirlo.
2. Esperar a que Vercel marque el despliegue como **READY**.
3. **En ese momento**, pasar las sesiones abiertas del índice viejo a la tabla, para que nadie tenga que
   volver a entrar. Es repetible:

   ```bash
   ./frontend/venv/Scripts/python.exe scripts/migrar_sesiones.py --aplicar
   ```

4. Comprobaciones contra la base real, sin tocar datos de nadie:

   ```bash
   ./frontend/venv/Scripts/python.exe scripts/probar_sesiones.py
   ./frontend/venv/Scripts/python.exe scripts/probar_guardar_estado.py
   ./frontend/venv/Scripts/python.exe scripts/probar_intentos.py
   ```

5. En producción, sin sesión: `/api/auth/me`, `/api/notifications` y `/api/conductor/info/K-027` deben
   responder **401**. Con sesión, entrar como una persona de cada rol y recorrer su portal.
6. Durante el primer día, buscar en los logs de Vercel:
   - `sin escribir`: un endpoint modificó algo que no había cargado, y ese cambio no se guardó;
   - `rechazado, una cuenta nueva ya existía`: un 409 en la escritura;
   - `intentos_acceso no`: el tope no pudo consultar su tabla y dejó pasar.

   Ninguno debería aparecer. Si aparece, el log dice qué operación fue.

## Volver atrás

Revertir el merge en `main`. Lo único que se nota es que todo el mundo tiene que iniciar sesión una vez:
las sesiones abiertas con el código nuevo están en la tabla, y el viejo no la lee. Las migraciones no hace
falta deshacerlas; el código viejo no las usa.

## Para Codex (o quien toque el backend después)

- La autenticación es asíncrona: `abrir_sesion`, `await refrescar_sesiones_de(user)`,
  `await get_user_by_session`, `await require_request_actor`. `session_index` ya no existe.
- El dueño de una sesión es `_clave_de_cuenta(user)`, **nunca** `user["identifier"]`: 124 de 128 cuentas no
  lo tienen.
- **Todo endpoint que modifique usuarios, flota, avisos, actividad o rutas tiene que cargarlos antes**
  (`reload_db()`, `_load_compat_users()`, `_load_compat_user()`, `_load_compat_fleet()`…). Lo no leído no se
  escribe, y una cuenta que la instancia no leyó se trata como nueva: si existe, 409.
- **Toda carga nueva que meta algo de `app_state` en memoria debe llamar a `_recordar_base`** (o a
  `_recordar_base_de_cuentas` si reemplaza las cuentas).
- Un endpoint nuevo empieza por `require_any_session` / `require_admin_session` /
  `require_session_owner`. La prueba `test_endpoints_that_never_asked_for_a_session_now_do` es la lista de
  los que se cerraron; añadir ahí los nuevos.
- Después de tocar las funciones de `supabase/`, correr sus `scripts/probar_*.py`: las pruebas del backend
  simulan PostgREST y no ven un fallo de Postgres.
