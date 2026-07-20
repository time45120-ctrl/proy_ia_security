# AGENTS.md - Frontend

Ultima revision: 2026-07-20.

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

Ultimo commit operativo conocido: `f.46`.

## Estado De Trabajo Actual

- Se prueba en produccion y local segun el caso. No hacer commit, push ni
  publicar en Hostinger sin autorizacion explicita del usuario.
- URL local observada para el frontend: `http://localhost:3001`.
- `frontend/.env.local` apunta a `http://localhost:8000` para la API local; no
  modificar ese archivo sin solicitud explicita.
- La API publica ya refleja el flujo ESP32 directo y el backend operativo
  conocido es `b.24`.
- La experiencia publica es de domotica residencial: hogares, casa inteligente,
  sensores y alarmas. No existe campo empresa en registro, perfil ni metadata.

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
  - `build`: `next build`
  - `start`: `node server.js`
- Variables publicas de produccion configuradas en Hostinger:
  - `NEXT_PUBLIC_SITE_URL=https://afcrseguridad.com`
  - `NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com`
  - `NEXT_PUBLIC_SUPABASE_URL=https://omkbowrspgbuwpifksfk.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave_publishable>`
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
  - Imprime `AFCR_FRONTEND_BUILD=f.46`.
  - Imprime `AFCR_FRONTEND_MODE=next-server`.

Lecciones aprendidas:

- Hostinger genero `.next`, no `out/`, aunque se intento `output: "export"`.
- No usar `postbuild` que exija `out/index.html`; fallo el despliegue con
  `AFCR_FRONTEND_EXPORT_MISSING=out/index.html`.
- No volver a reescribir assets `/_next` a `/next`.
- No usar Python `http.server` para produccion Hostinger.
- Si falla Hostinger, mirar el log completo despues del build, no solo el log de
  compilacion. `npm audit` no fue la causa de los fallos.
- No ejecutar dos instancias `next dev` sobre este repo ni ejecutar
  `npm run build` mientras `next dev` escribe `.next`; eso provoco el error
  local `Cannot find module './820.js'`. Para recuperar, detener instancias,
  limpiar `.next` y arrancar un solo servidor.

## Backend publico

La API publica es:

```text
https://api.afcrseguridad.com
```

El frontend compila con:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com
NEXT_PUBLIC_SUPABASE_URL=https://omkbowrspgbuwpifksfk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave_publishable>
```

En `lib/backend-api.ts` el default tambien es:

```text
https://api.afcrseguridad.com
```

El cliente normaliza URLs para evitar:

- Produccion apuntando a IP LAN/privada.
- `http://api.afcrseguridad.com` desde HTTPS.

## Archivos importantes

- `app/page.tsx`: redirige a `/welcome`.
- `app/welcome/page.tsx`: pantalla de ingreso al laboratorio.
- `app/auth/confirm/route.ts`: confirmacion de correo Supabase y creacion de
  sesion SSR antes de ingresar al laboratorio.
- `app/desarrollo/layout.tsx`: shell y control de acceso al laboratorio.
- `app/desarrollo/workspace-context.tsx`: inventario, demo y navegacion.
- `app/desarrollo/sync/sync-lab.tsx`: pairing y guia Arduino IDE.
- `app/desarrollo/sync/esp32-direct-sketch.ts`: sketch C++ copiable.
- `app/layout.tsx`: metadata e idioma.
- `app/globals.css`: tema oscuro y estilos responsive.
- `components/voice-dashboard.tsx`: grabacion de voz, tarjeta IA, tarjetas de
  modulos, confirmacion e historial auditado de voz.
- `lib/backend-api.ts`: cliente HTTP al backend.
- `lib/supabase/`: cliente/browser/server de Supabase Auth.
- `middleware.ts`: protege `/desarrollo` mediante sesion Supabase.
- `package.json`: scripts de Hostinger.
- `server.js`: servidor Next para produccion.
- `next.config.js`: config Next.
- `scripts/print-deploy-info.js`: marca visible en logs Hostinger.

## Autenticacion

- Registro e inicio de sesion mantienen correo + contrasena.
- Registro nuevo se confirma con OTP manual de 8 digitos y permite reenvio con
  espera visual.
- Recuperacion solicita correo, valida OTP de tipo `recovery` y permite
  establecer una contrasena nueva.
- `/auth/confirm` permanece para enlaces emitidos antes del flujo OTP.
- El perfil editable contiene solo nombre de usuario y telefono. El frontend
  no solicita, consulta ni envia empresa, `company_name` o identificadores
  internos del hogar.

## Tarjeta de IA

En `components/voice-dashboard.tsx`, la tarjeta de IA incluye tambien una card
`Logs de prueba` para diagnosticar voz, backend y OpenAI: `/ping`, permiso de
microfono, MIME, tamano del audio, `peak_level`, `average_level`, transcripcion
y respuesta del backend.

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
- Usa `echoCancellation`, `noiseSuppression` y `autoGainControl`; mide volumen
  con Web Audio y bloquea audio silencioso o menor a `SILENT_AUDIO_MIN_BYTES = 1500`.
- Envia audio a `POST /voice-intent`.
- El alta email/password usa OTP manual; `/auth/confirm` sigue registrado para
  compatibilidad con enlaces historicos.
- Todas las rutas de inventario, voz y estado incluyen el JWT de la sesion
  Supabase; el backend aplica aislamiento por hogar sin devolver
  `household_id` al navegador.
- Los audios nuevos quedan en el bucket privado `voice-audio` y el dashboard
  solo presenta metadatos del historial, no reproduccion publica.
- Muestra preview/plan.
- Si el usuario dice `prende el LED`, el backend `b.24` puede devolver un plan
  ejecutable usando el ESP32 enlazado mas reciente cuando no hay ambiente explicito.
- Ejecuta hardware solo tras `POST /voice-intent/confirm`.
- Los ESP32 enlazados reciben comandos por polling HTTP(S) y el dashboard sigue
  su ACK mediante `GET /device/commands/{command_id}/status`.
- La vista de Sincronizacion guia Arduino IDE, muestra un sketch copiable y
  pide editar `WIFI_SSID`, `WIFI_PASSWORD` y `PAIRING_TOKEN` antes de subirlo
  por USB; no usa portal WiFi local.
- Al crear enlace ESP32, la vista desplaza automaticamente a la guia y
  sustituye `API_URL` en el sketch copiado con `api_url` devuelta por backend.
- En laboratorio esa URL debe ser LAN y accesible desde el ESP32, por ejemplo
  `http://192.168.0.5:8000`; se muestra una prueba `<api_url>/ping` para hacer
  desde un celular en la misma WiFi. En produccion debe ser
  `https://api.afcrseguridad.com`.
- Luces legacy pueden ejecutar MQTT real.
- Camaras, puertas, sensores y alarmas son visuales/plan hasta conectar
  hardware real.
- El problema de transcripcion falsa del 2026-05-28 fue microfono desactivado;
  si vuelve a pasar revisar primero la card de logs antes de cambiar OpenAI.

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

No ejecutar este build mientras el servidor `next dev` local siga activo sobre
el mismo `.next`; detenerlo primero o validar solo tipos con:

```bash
npx tsc --noEmit --pretty false
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
git commit -m "f.N"
git push
```

No commitear `.env` ni variantes `.env.*`; solo `.env.example` puede quedar
versionado.

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

- Confirmar commit en log: `AFCR_FRONTEND_BUILD=f.N`.
- Confirmar modo: `AFCR_FRONTEND_MODE=next-server`.
- Confirmar que no aparece `AFCR_FRONTEND_EXPORT_MISSING`.
- Confirmar que el start usa `node server.js`.
