# AGENTS.md - Frontend

Ultima revision: 2026-05-12.

## Contexto

Este directorio es el repo Git desplegable del frontend:

```text
/home/abraham/proy_ia_security/frontend
```

Remoto:

```text
https://github.com/time45120-ctrl/proy_ia_frontend.git
```

Rama activa: `main`.

Ultimo commit operativo conocido: `f1.19`.

## Despliegue Hostinger

Frontend publico:

```text
https://afcrseguridad.com
```

Hostinger esta configurado como:

- Repositorio: `proy_ia_frontend`
- Rama: `main`
- Directorio raiz: `./`
- Framework: `Next.js`
- Node: `20.x`
- Build: por defecto / `npm run build`
- Start: `npm run start` / `node server.js`

La configuracion final que funciono localmente y se dejo para Hostinger:

- `package.json`
  - `prebuild`: `node scripts/print-deploy-info.js`
  - `build`: `NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com next build`
  - `start`: `node server.js`
- `next.config.js`
  - CommonJS.
  - `reactStrictMode: true`.
  - Sin `output: "export"`.
- `server.js`
  - Arranca Next server desde `.next`.
  - Escucha en `0.0.0.0`.
  - Usa `process.env.PORT || 3000`.
  - Log esperado al arrancar: `AFCR_FRONTEND_READY=http://0.0.0.0:<port>`.
- `scripts/print-deploy-info.js`
  - Imprime `AFCR_FRONTEND_BUILD=f1.19`.
  - Imprime `AFCR_FRONTEND_MODE=next-server`.

Lecciones aprendidas:

- Hostinger genero `.next`, no `out/`, aunque se intento `output: "export"`.
- No usar `postbuild` que exija `out/index.html`; fallo el despliegue con
  `AFCR_FRONTEND_EXPORT_MISSING=out/index.html`.
- No volver a reescribir assets `/_next` a `/next`.
- No usar Python `http.server` para produccion Hostinger.
- Si falla Hostinger, mirar el log completo despues del build, no solo el log de
  compilacion. `npm audit` no fue la causa de los fallos.

## Backend publico

La API publica es:

```text
https://api.afcrseguridad.com
```

El frontend compila con:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com
```

En `lib/backend-api.ts` el default tambien es:

```text
https://api.afcrseguridad.com
```

El cliente normaliza URLs para evitar:

- Produccion apuntando a IP LAN/privada.
- `http://api.afcrseguridad.com` desde HTTPS.

## Archivos importantes

- `app/page.tsx`: renderiza `WelcomeGate`.
- `app/layout.tsx`: metadata e idioma.
- `app/globals.css`: tema oscuro y estilos responsive.
- `components/welcome-gate.tsx`: welcome, sync y navegacion principal.
- `components/voice-dashboard.tsx`: grabacion de voz, tarjeta IA, tarjetas de
  modulos y confirmacion.
- `lib/backend-api.ts`: cliente HTTP al backend.
- `package.json`: scripts de Hostinger.
- `server.js`: servidor Next para produccion.
- `next.config.js`: config Next.
- `scripts/print-deploy-info.js`: marca visible en logs Hostinger.

## Tarjeta de IA

En `components/voice-dashboard.tsx`, la tarjeta de IA debe mostrar:

1. `Respuesta IA para el usuario`
2. `Respuesta Json para el dispositivo`

El campo JSON debe estar justo debajo del campo de respuesta IA.

Reglas:

- Cuando ya existe respuesta del backend, `Respuesta IA para el usuario` debe
  venir de la voz/transcripcion del usuario:
  - Prioridad: `respuesta_ia_usuario`
  - Compatibilidad: `respuesta_usuario`
  - Fallback: `plan.respuesta`
- Antes de que el usuario hable, mostrar un placeholder que aclare que aun no
  hay pregunta por voz y que los dispositivos visibles son de prueba.
- `Respuesta Json para el dispositivo` debe venir de:
  - Prioridad: `respuesta_json_dispositivo`
  - Compatibilidad: `intencion_json`
  - Fallback: JSON local de estado demo.
- El JSON es para dispositivos y automatizacion; no debe ser texto conversacional.

## Flujo de voz

- Verifica backend con `GET /ping`.
- Graba con `MediaRecorder` y `getUserMedia`.
- Envia audio a `POST /voice-intent`.
- Muestra preview/plan.
- Ejecuta hardware solo tras `POST /voice-intent/confirm`.
- Los ESP32 enlazados reciben comandos por polling HTTPS y el dashboard sigue
  su ACK mediante `GET /device/commands/{command_id}/status`.
- Luces legacy pueden ejecutar MQTT real.
- Camaras, puertas y drones son visuales/plan hasta conectar hardware real.

## Dispositivos demo

La UI puede mostrar dispositivos de prueba. No presentarlos como hardware real
confirmado ni contarlos para habilitar ejecucion. El dispositivo demo principal es:

```text
demo-luz-cocina
```

## Comandos

Build:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run build
```

Start local compatible con Hostinger:

```bash
cd /home/abraham/proy_ia_security/frontend
PORT=3101 npm run start
```

Deploy por Git:

```bash
cd /home/abraham/proy_ia_security/frontend
git status --short
npm run build
git add .
git commit -m "f1.N"
git push
```

No commitear `.env.local`.

## Diagnostico rapido

API:

```bash
curl https://api.afcrseguridad.com/ping
```

Frontend publico:

```bash
curl -I https://afcrseguridad.com
```

Si Hostinger falla:

- Confirmar commit en log: `AFCR_FRONTEND_BUILD=f1.N`.
- Confirmar modo: `AFCR_FRONTEND_MODE=next-server`.
- Confirmar que no aparece `AFCR_FRONTEND_EXPORT_MISSING`.
- Confirmar que el start usa `node server.js`.
