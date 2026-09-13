# Matriz de regresión funcional

Esta matriz debe completarse en un despliegue Preview antes de promover cambios
a producción. Usar cuentas y documentos de prueba, nunca datos personales reales.

| ID | Rol | Escenario | Resultado esperado |
|---|---|---|---|
| AUTH-01 | Todos | Login válido | Abre el portal correspondiente |
| AUTH-02 | Todos | Login inválido | Muestra error y no crea sesión |
| AUTH-03 | Nuevo usuario | Registro | Queda pendiente, excepto el primer administrador |
| AUTH-04 | Pendiente | Intento de login | Acceso denegado con mensaje de aprobación |
| DRV-01 | Conductor | Completar onboarding | Guarda perfil y ocho documentos |
| DRV-02 | Administración | Rechazar documento con motivo | El conductor ve documento y motivo |
| DRV-03 | Conductor | Resubir documento | Estado cambia a revisión y notifica al administrador |
| DRV-04 | Administración | Subir documento por el conductor | No crea notificación redundante |
| DRV-05 | Conductor aprobado | Consultar rutas | Solo muestra sus rutas asignadas |
| FLT-01 | Administración | Crear unidad | Aparece en control de flota |
| FLT-02 | Administración | Editar unidad | Conserva documentos y datos no modificados |
| FLT-03 | Administración | Exportar por base | Respeta plantilla, columnas, colores y GRUPO |
| RTE-01 | Programador | Importar Excel válido | Conserva todos los pasajeros sin duplicados |
| RTE-02 | Programador | Importar Excel sin coincidencias | Muestra un error comprensible |
| RTE-03 | Programador | Reasignar con drag and drop | Respeta capacidad máxima |
| RTE-04 | Programador | Guardar y publicar | Gerente recibe resumen actualizado |
| RTE-05 | Programador | Limpiar tablero | Solicita confirmación y elimina rutas actuales |
| OPS-01 | Conductor | Cambiar estado de pasajero | Cliente observa el nuevo estado |
| OPS-02 | Conductor | Enviar SOS | Administración recibe alerta una sola vez |
| MGR-01 | Gerente | Abrir dashboard | KPIs concuerdan con el resumen de rutas |
| CLI-01 | Cliente | Consultar personal | Solo aparecen rutas de su empresa |
| DOC-01 | Administración | Abrir imagen | Se adapta al alto sin descarga obligatoria |
| DOC-02 | Administración | Abrir PDF | Muestra icono y botón de descarga, sin iframe |

## Criterio de aprobación

- Todos los casos críticos `AUTH`, `DRV`, `RTE` y `OPS` deben aprobar.
- No puede haber pérdida de usuarios, documentos, flota, rutas o notificaciones.
- Cualquier diferencia visual debe estar documentada y aprobada antes del merge.
