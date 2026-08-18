# AGENTS.md - Frontend

Ultima revision: 2026-08-18.

## Contexto

Este directorio contiene el frontend del monorepo:

```text
/home/abraham/proyectos/casa-domotica-ia/frontend
```

Repositorio canonico:

```text
https://github.com/abraham-development/casa-domotica-ia.git
```

`frontend/` no tiene un Git independiente: su toplevel es
`/home/abraham/proyectos/casa-domotica-ia`. La rama unica en GitHub es `main`;
acepta pushes directos y mantiene bloqueados el borrado y el `force push`.

Marca vigente de la fuente y del frontend publicado verificado: `f.65`. La
revision remota verificada es `a0cfcb3` (`n.46`).

## Estado De Trabajo Actual

- Se prueba en produccion y local segun el caso. No hacer commit, push ni
  publicar en Hostinger sin autorizacion explicita del usuario.
- URL local habitual para el frontend: `http://localhost:3000`; puede usarse
  `3001` si el puerto esta ocupado.
- No modificar `frontend/.env.local` sin solicitud explicita.
- `frontend/.env.local` existe, tiene modo `600` y supera `npm run check:env`;
  no mostrar ni versionar sus valores. El build de Hostinger usa las variables
  publicas configuradas en su panel.
- La API publica refleja el flujo ESP32 directo; la ultima referencia importada
  del backend es `b.32`.
- El 2026-07-27 se completo el corte a AFCR Tecnologia. Supabase Auth envio y
  verifico OTP por SMTP de `contacto@afcrtecnologia.com` y registro/login
  finalizaron con estado 200.
- La experiencia publica es de domotica residencial: hogares, casa inteligente,
  sensores y alarmas. No existe campo empresa en registro, perfil ni metadata.
- Hostinger sigue desplegando desde `main` con raiz `./frontend`. Supabase usa
  su GitHub Integration nativa con working directory `.`, production branch
  `main` y `Deploy to production`; el usuario confirmo que esta habilitada y se
  valida con el check nativo posterior al push. No usa secretos Supabase en
  GitHub.
- La cuenta SMTP se administra en Hostinger y se configura en Supabase Auth;
  sus credenciales no pertenecen al frontend ni a GitHub.

## Despliegue Hostinger

Frontend publico:

```text
https://afcrtecnologia.com
```

Hostinger esta configurado como:

- Repositorio: `abraham-development/casa-domotica-ia`
- Rama: `main`
- Directorio raiz: `./frontend`
- Framework: `Next.js`
- Node: `24.x`
- Build: `npm run build`
- Directorio de salida: `out`
- Archivo de entrada: ninguno

Configuracion vigente:

- `package.json`
  - `prebuild`: `node scripts/print-deploy-info.js`
  - `build`: `next build`
  - `postbuild`: `node scripts/prepare-static-hosting.js`
  - No hay comando `start`; Hostinger sirve archivos estaticos.
- Variables publicas de produccion configuradas en Hostinger:
  - `NEXT_PUBLIC_SITE_URL=https://afcrtecnologia.com`
  - `NEXT_PUBLIC_API_BASE_URL=https://api.afcrtecnologia.com`
  - `NEXT_PUBLIC_SUPABASE_URL=https://omkbowrspgbuwpifksfk.supabase.co`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave_publishable>`
- `next.config.js`
  - CommonJS, `output: "export"`, `trailingSlash: true`.
  - `images.unoptimized: true` para servir assets locales directamente.
- `scripts/prepare-static-hosting.js`
  - Comprueba `out/` y copia `public/.htaccess` a `out/.htaccess`.
- `scripts/print-deploy-info.js`
  - Imprime `AFCR_FRONTEND_BUILD=f.65`.
  - Imprime `AFCR_FRONTEND_MODE=static-export`.

Lecciones aprendidas:

- No configurar archivo de entrada, `server.js` ni comando start.
- No depender de `/_next/image`; produjo 503 en el runtime administrado.
- `public/.htaccess` conserva redireccion de `www`, CSP y cabeceras de
  seguridad en el artefacto publicado.
- Si falla Hostinger, revisar que el build genere `out/` y que el postbuild
  anuncie `AFCR_FRONTEND_HOSTINGER_CONFIG=out/.htaccess`.
- `npm audit` no fue la causa de los fallos.
- No ejecutar dos instancias `next dev` ni ejecutar `npm run build` mientras
  `next dev` escribe `.next`; para recuperar, detener instancias, limpiar
  `.next` y arrancar un solo servidor.

## Backend publico

La API publica es:

```text
https://api.afcrtecnologia.com
```

El frontend compila con:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrtecnologia.com
NEXT_PUBLIC_SUPABASE_URL=https://omkbowrspgbuwpifksfk.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave_publishable>
```

En `lib/backend-api.ts` el default tambien es:

```text
https://api.afcrtecnologia.com
```

El cliente normaliza URLs para evitar:

- Produccion apuntando a IP LAN/privada.
- `http://api.afcrtecnologia.com` desde HTTPS.

## Archivos importantes

- `app/page.tsx`: redirige en el navegador a `/welcome/` y conserva un enlace
  manual para que la raiz exportada siempre entregue HTML util.
- `app/welcome/page.tsx`: pantalla de ingreso al laboratorio.
- `app/auth/confirm/page.tsx`: confirmacion de correo Supabase en el navegador
  para enlaces historicos y redireccion segura al laboratorio.
- `app/desarrollo/layout.tsx`: shell y control de acceso al laboratorio.
- `app/desarrollo/workspace-context.tsx`: inventario, demo y navegacion.
- `app/desarrollo/sync/sync-lab.tsx`: pairing y guia Arduino IDE.
- `app/desarrollo/sync/esp32-direct-sketch.ts`: sketch C++ copiable.
- `app/layout.tsx`: metadata e idioma.
- `app/globals.css`: tema oscuro y estilos responsive.
- `components/voice-dashboard.tsx`: grabacion de voz, tarjeta IA, tarjetas de
  modulos, confirmacion e historial auditado de voz.
- `lib/backend-api.ts`: cliente HTTP al backend.
- `lib/supabase/`: clientes y helpers de Supabase Auth.
- No existe middleware raiz en el export estatico. `workspace-context.tsx`
  valida la sesion en el navegador y el backend vuelve a validar el JWT y el
  hogar en cada operacion protegida.
- `package.json`: scripts de Hostinger.
- `next.config.js`: exportacion estatica para Hostinger.
- `scripts/prepare-static-hosting.js`: prepara `.htaccess` dentro de `out/`.
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
- Si el usuario dice `prende el LED`, el backend puede devolver un plan
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
  `https://api.afcrtecnologia.com`.
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
cd /home/abraham/proyectos/casa-domotica-ia/frontend
npm run build
```

No ejecutar este build mientras el servidor `next dev` local siga activo sobre
el mismo `.next`; detenerlo primero o validar solo tipos con:

```bash
npx tsc --noEmit --pretty false
```

Preview local del artefacto estatico, despues del build:

```bash
cd /home/abraham/proyectos/casa-domotica-ia/frontend
python3 -m http.server 3101 --directory out
```

Publicacion por Git:

1. Ejecutar el build dentro de `frontend/`.
2. Desde el toplevel `/home/abraham/proyectos/casa-domotica-ia`, revisar y hacer commit
   solo de los archivos autorizados.
3. Ejecutar `git push` a `main`; un Pull Request es opcional para cambios que
   requieran revision previa.
4. Confirmar el CI posterior al push y el despliegue de Hostinger.

Cada push a `main` puede activar Hostinger y ejecuta CI. No commitear `.env`
ni variantes `.env.*`; solo `.env.example` puede quedar versionado.

## Diagnostico rapido

API:

```bash
curl https://api.afcrtecnologia.com/ping
```

Frontend publico:

```bash
curl -I https://afcrtecnologia.com
```

Si Hostinger falla:

- Confirmar marca en log: `AFCR_FRONTEND_BUILD=f.65`.
- Confirmar modo: `AFCR_FRONTEND_MODE=static-export`.
- Confirmar que se genero `out/`.
- Confirmar `AFCR_FRONTEND_HOSTINGER_CONFIG=out/.htaccess`.
- Confirmar directorio raiz `./frontend`, salida `out` y archivo de entrada
  vacio.
