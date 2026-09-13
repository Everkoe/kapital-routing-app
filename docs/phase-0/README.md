# Fase 0 — Red de seguridad

Esta carpeta congela el comportamiento observable de Kapital antes de cambiar
autenticación, persistencia o arquitectura. La fase 0 no modifica lógica de
negocio ni diseño visual.

## Verificación automática

Desde `frontend/`, con el entorno virtual activo:

```powershell
npm run verify:baseline
```

El comando ejecuta:

1. Pruebas de caracterización offline. Nunca llaman a Supabase.
2. Límites de deuda técnica. Se permite reducir los contadores, no aumentarlos.
3. Build de producción de Vite.

La misma verificación se ejecuta en GitHub Actions para cada pull request y
cada actualización de `main`.

El lint completo todavía falla por deuda histórica. El límite inicial es 118
errores y 5 advertencias dentro de `frontend/src`; cada fase deberá mantener o
reducir esos valores.

## Backup antes de migraciones

El directorio `backups/` está ignorado por Git porque contiene contraseñas y
datos personales. Para respaldar la fila `app_state` y el bucket `evidencias`:

```powershell
frontend\venv\Scripts\python.exe scripts\phase0\backup_supabase.py --bucket evidencias
```

El comando crea una carpeta con fecha UTC, un manifiesto SHA-256 y una copia de
cada objeto accesible. Para comprobar el backup:

```powershell
frontend\venv\Scripts\python.exe scripts\phase0\validate_backup.py backups\supabase\<fecha-UTC>
```

Los backups nunca deben añadirse al repositorio ni compartirse sin cifrado.

## Artefactos versionados

- `openapi-baseline.json`: contrato generado por FastAPI.
- `api-contracts.md`: resumen legible de endpoints y consumidores.
- `data-inventory.md`: conteos anonimizados del snapshot de producción.
- `regression-matrix.md`: flujos manuales obligatorios antes de desplegar.
- `visual-baseline.md`: matriz para capturas visuales por rol y tema.
