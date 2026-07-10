# PRD — AIQuota: Monitor de consumo de proveedores de IA

**Versión:** 0.1 · **Fecha:** Julio 2026 · **Estado:** Borrador

---

## 1. Resumen

Aplicación de escritorio multiplataforma (Linux y Windows) que vive en la bandeja del sistema y muestra, de un vistazo, el consumo de cuota de varios proveedores de IA: **Claude**, **Codex (OpenAI)** y **OpenCode Go**. Al hacer clic en el icono se abre un popup compacto con el detalle por proveedor y ventana temporal.

**Framework recomendado: Electron.** Motivo principal: la API interna de claude.ai está protegida por Cloudflare y rechaza peticiones HTTP planas (la extensión de referencia necesita Chromium vía Playwright para funcionar). Electron ya embebe Chromium, así que las peticiones salen desde un contexto de navegador real y, además, permite un flujo de login integrado: el usuario inicia sesión en claude.ai dentro de una ventana de la app y esta lee el cookie de sesión automáticamente, sin copiar nada de DevTools. Tauri sería más ligero, pero obligaría a replicar el workaround de Playwright o a pedir credenciales manualmente.

### Proyectos de referencia

Extensiones de VS Code cuya lógica de lectura de cuotas sirve de base para los adaptadores:

| Proveedor | Repositorio |
|---|---|
| Claude | https://github.com/jonis100/claude-quota-tracker |
| OpenCode Go | https://github.com/jorgealonsodev/opencode-go-monitor |
| Codex (OpenAI) | https://github.com/eddie-givens/codex-quota-stats |

## 2. Problema

Quien usa varios proveedores de IA (planes de suscripción con límites por ventanas de 5 h, semanales o mensuales) no tiene un sitio único donde ver cuánta cuota le queda. Hoy debe abrir cada web o instalar extensiones de VS Code separadas, atadas al editor.

## 3. Objetivos

- Ver el % de consumo de todos los proveedores sin abrir ningún navegador ni editor.
- Recibir avisos al superar umbrales configurables (p. ej. 80 % y 95 %).
- Configuración de credenciales una sola vez, almacenada de forma segura.
- Instalable con doble clic en Linux (AppImage/.deb) y Windows (.exe NSIS).

**No-objetivos (v1):** macOS, histórico/gráficas de consumo, gestión de claves de API de facturación por tokens.

## 4. Usuarios objetivo

Desarrolladores con suscripciones a Claude (Pro/Max), Codex (ChatGPT Plus/Pro) y OpenCode Go, que trabajan en Linux o Windows y quieren controlar su gasto de cuota durante la jornada.

## 5. Alcance funcional

### 5.1 Icono de bandeja (tray)
- Icono con estado agregado por color: verde (todo <70 %), ámbar (algún proveedor 70–90 %), rojo (>90 %) y gris (error/sin configurar).
- Tooltip con resumen rápido: `Claude 62 % · Codex 34 % · OpenCode 12 %`.
- Menú contextual: Abrir popup, Actualizar ahora, Ajustes, Salir.

### 5.2 Popup
- Ventana sin marco anclada junto a la bandeja, se cierra al perder foco.
- Una tarjeta por **cuenta/workspace conectado** (no por proveedor): nombre del proveedor + etiqueta de la cuenta (p. ej. "OpenCode · Personal", "OpenCode · Empresa", "Claude · trabajo@..."), estado de conexión y barra de progreso por cada ventana temporal (Claude: 5 h y 7 días; OpenCode: rolling, semanal, mensual; Codex: según `wham/usage`).
- Tiempo restante hasta el reset de cada ventana y hora de última actualización.
- Botón de refresco manual.

### 5.3 Ajustes
- Activar/desactivar cada proveedor. **Ningún proveedor es obligatorio**: la app funciona con cualquier subconjunto; los desactivados o sin configurar no aparecen en el popup ni afectan al color del tray.
- **Múltiples cuentas/workspaces por proveedor**: botón "Añadir cuenta" en cada proveedor, con etiqueta editable por instancia (Personal, Empresa…). En OpenCode cada workspace es una instancia (mismo cookie `auth`, distinto `workspaceId`); en Claude y Codex cada cuenta requiere su propio login, en una sesión de Electron aislada (`session.fromPartition`) para que las cookies no colisionen. Cada instancia se puede pausar o eliminar individualmente.
- Intervalo de sondeo (1–60 min, por defecto 5).
- Umbrales de notificación.
- Autoarranque con el sistema.
- Conexión por proveedor (ver 6).

### 5.4 Notificaciones
- Notificación nativa del SO al cruzar un umbral (una vez por ventana, sin spam).
- Notificación de credencial caducada con enlace directo a reconectar.

## 6. Integración por proveedor (adaptadores)

Arquitectura de **patrón adapter con instancias**: interfaz común `QuotaProvider { id, configure(), fetchQuota(): QuotaWindow[], authStatus() }`. Cada proveedor es un módulo aislado y admite **N instancias de conexión** (`ProviderInstance { instanceId, providerId, label, credentialsRef }`): cada cuenta o workspace es una instancia con sus credenciales propias en el keychain (clave por `instanceId`), su sesión de Electron aislada y su ciclo de sondeo. Añadir un proveedor nuevo no toca el core; añadir una cuenta más es solo crear otra instancia.

| Proveedor | Fuente de datos | Autenticación | Particularidad |
|---|---|---|---|
| Claude | `claude.ai/api/organizations/{orgId}/usage` | Cookie `sessionKey` (`sk-ant-sid01-…`) + Org ID | Cloudflare: las peticiones deben salir de la sesión Chromium de Electron. Login integrado: ventana a claude.ai → leer cookie de `session.cookies` → obtener Org ID de la API |
| Codex | Estado local `~/.codex` + `chatgpt.com/backend-api/wham/usage` | **Dual, en cascada:** 1) token de `~/.codex/auth.json` si existe el CLI (cero configuración); 2) fallback: login integrado a chatgpt.com y token de la sesión web | Detectar 401 por token caducado → refrescar con el refresh token de `auth.json` o caer al login web. En Windows la ruta es `%USERPROFILE%\.codex` |
| OpenCode Go | API de opencode.ai con fallback de scraping HTML | Cookie `auth` + `workspaceId` | Estrategia dual API→scraping para resiliencia ante cambios; mismo flujo de login integrado que Claude |

**Nota de riesgo común:** las tres integraciones usan APIs internas/no documentadas. El diseño debe asumir rupturas: errores por proveedor aislados (un fallo no tumba el resto), mensajes claros en la tarjeta afectada y adaptadores versionados para parchear rápido.

## 7. Seguridad de credenciales

- Cookies y tokens cifrados con `safeStorage` de Electron, que delega en el SO: **Secret Service/kwallet** en Linux y **DPAPI/Credential Manager** en Windows.
- Nunca en texto plano ni en el config JSON; nunca en logs.
- Las credenciales solo viajan a los dominios oficiales de cada proveedor.

## 8. Stack técnico

- **Electron + electron-builder** (targets: AppImage y .deb en Linux; NSIS .exe en Windows).
- **TypeScript** en main y renderer.
- Renderer del popup: **React + Vite** (o vanilla si se quiere mínimo peso; el popup es una sola vista).
- Proceso main: scheduler de polling, adaptadores, tray, notificaciones, `safeStorage`.
- IPC tipado entre main y popup (contextIsolation activado, sin `nodeIntegration` en renderer).
- Actualizaciones automáticas con electron-updater (fase 2).

## 9. Fases

**MVP (fase 1):** tray + popup, adaptador Codex (el más simple, sin login), adaptador Claude con login integrado, polling, notificaciones de umbral, instaladores Linux/Windows. El core ya se diseña sobre el modelo de instancias, aunque el MVP exponga una cuenta por proveedor.

**Fase 2:** adaptador OpenCode Go con multi-workspace, multi-cuenta en Claude y Codex (sesiones aisladas), autoarranque, auto-update, umbrales por proveedor.

**Fase 3:** histórico local con mini-gráficas, más proveedores (Gemini, Cursor…), soporte macOS.

## 10. Métricas de éxito

- Configurar los 3 proveedores en <3 minutos.
- Consumo de RAM en reposo <150 MB, CPU ~0 % entre sondeos.
- Recuperación ante credencial caducada en 1 clic.

## 11. Riesgos principales

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Cambios en APIs internas | Alto | Adaptadores aislados, fallback scraping, releases rápidas |
| Cloudflare endurece bloqueo | Alto (Claude) | Peticiones desde sesión real de Electron; fallback a webview oculto |
| Caducidad de cookies | Medio | Detección de 401 + notificación de reconexión |
| ToS de proveedores sobre APIs no públicas | Medio | Uso personal, solo lectura, credenciales del propio usuario |
