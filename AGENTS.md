# AGENTS.md - Memoria compacta de Codex

Ultima revision: 2026-07-27.

## Contexto rapido

Proyecto de asistente de voz IoT/domotico con dashboard web, backend FastAPI,
IA para interpretar comandos y flujo de confirmacion antes de ejecutar acciones
por polling HTTP(S) en ESP32 reales, con MQTT legacy. La fuente activa es:

```text
/home/abraham/proy_ia_security
```

No recrear la copia legacy anidada `proy_ia_security/`.

## Estado operativo actual

- El usuario esta validando en produccion y local segun el caso. No desplegar,
  hacer commits ni `git push` sin autorizacion explicita del usuario.
- Frontend local de prueba observado: `http://localhost:3001`.
- Backend local de prueba debe correr en `http://localhost:8000`; para el
  ESP32 fisico debe anunciar una URL LAN accesible, no `localhost`.
- El flujo ESP32 por HTTP(S) polling ya esta publicado en backend AWS. El
  backend operativo conocido es `b.30`.
- El frontend operativo conocido es `f.49`; Hostinger debe mostrar
  `AFCR_FRONTEND_BUILD=f.49` y `AFCR_FRONTEND_MODE=next-server`.
- El 2026-07-27 se migro produccion a `afcrtecnologia.com` y
  `api.afcrtecnologia.com`. El frontend anterior ya no tiene A/AAAA, el virtual
  host de la API anterior se retiro de Nginx con respaldo recuperable y CORS
  rechaza el origen anterior. Solo queda verificar la eliminacion DNS del A
  `api.afcrseguridad.com` en Hostinger.
- Supabase Auth usa Site URL y redirects del dominio nuevo. El SMTP productivo
  usa `contacto@afcrtecnologia.com`; registro, envio de OTP, verificacion e
  inicio de sesion terminaron con estado 200.
- OpenAI esta funcionando: se probo transcripcion con audio sintetico
  "prende el LED". El modelo principal es `gpt-4o-mini-transcribe` y el
  fallback remoto es `whisper-1`.
- El problema de transcripcion falsa observado el 2026-05-28 fue microfono
  desactivado o capturando silencio, no fallo de la API de OpenAI.
- Supabase CLI/MCP esta enlazado al proyecto `proy_ia_security`, referencia
  `omkbowrspgbuwpifksfk`. El 2026-07-20 se completo la migracion a hogares:
  `households`, `household_members` y `household_id` reemplazan totalmente
  la arquitectura de organizaciones. RLS aisla cada hogar y no quedan tablas,
  columnas ni metadata empresariales.
- Conteos verificados despues de la migracion y QA: 8 usuarios, 8 hogares,
  8 perfiles, 8 membresias, 2 dispositivos, 194 intenciones y 255 comandos.

## Repos Git activos

Hay repos Git separados. Usar el repo correcto para commits y push:

- Raiz/documentacion: `/home/abraham/proy_ia_security`
  - Remoto: `abraham-development/proy_ia_security`
  - Rama observada: `new1`
- Frontend: `/home/abraham/proy_ia_security/frontend`
  - Remoto: `abraham-development/proy_ia_frontend`
  - Rama: `main`
  - Ultimo cambio operativo conocido: `f.49`
- Backend: `/home/abraham/proy_ia_security/backend`
  - Remoto: `abraham-development/proy_ia_backend`
  - Rama: `main`
  - Ultimo cambio operativo conocido: `b.30`
  - Automatizacion AWS GitHub Actions + SSM activa para despliegue autorizado
    desde `main`.

Para cambios reales de frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run build
git add .
git commit -m "f.N"
git push
```

Para cambios reales de backend:

```bash
cd /home/abraham/proy_ia_security/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
git add app_api.py
git commit -m "b.N"
git push
```

No confundir con commits desde la raiz: el backend desplegable se versiona en
`/home/abraham/proy_ia_security/backend` y el frontend desplegable en
`/home/abraham/proy_ia_security/frontend`.

## Mapa actual

- Backend principal: `backend/app_api.py`
- Frontend principal: `frontend/`
- Firmware ESP32: `firmware/esp32_pairing_portal/esp32_pairing_portal.ino`
- Audios recibidos: `audios_recibidos/`
- README principal: `README.md`
- Persistencia activa al configurar Supabase: proyecto `omkbowrspgbuwpifksfk`
- Persistencia fallback de pruebas sin variables Supabase: `backend/devices.db`

Frontend relevante:

```text
frontend/
|-- app/
|   |-- desarrollo/
|   |   |-- dashboard/page.tsx
|   |   |-- sync/
|   |   |   |-- esp32-direct-sketch.ts
|   |   |   |-- page.tsx
|   |   |   `-- sync-lab.tsx
|   |   |-- layout.tsx
|   |   `-- workspace-context.tsx
|   |-- welcome/page.tsx
|   |-- globals.css
|   |-- layout.tsx
|   `-- page.tsx
|-- components/
|   `-- voice-dashboard.tsx
|-- lib/
|   `-- backend-api.ts
|-- package.json
|-- next.config.js
|-- server.js
|-- scripts/
|   `-- print-deploy-info.js
`-- .env.example
```

Backend relevante:

```text
backend/
|-- app_api.py
|-- AGENTS.md
`-- .env.example
```

## Stack

- Frontend: Next.js 15, React 19, TypeScript y Tailwind 3.
- Backend: FastAPI, Supabase Auth/Postgres/Storage, OpenAI, Ollama opcional,
  Whisper local opcional, SQLite fallback de pruebas, `python-dotenv` y MQTT.
- Firmware: Arduino/ESP32 con WiFi, HTTPClient, WiFiClientSecure,
  Preferences, ArduinoJson y huella local del token configurado.
- Broker MQTT por defecto del backend: `127.0.0.1:1883`.

## Despliegue

- Frontend publico Hostinger: `https://afcrtecnologia.com`
- Backend publico AWS: `https://api.afcrtecnologia.com`
- IP backend AWS: `3.132.192.3`
- DNS: `api.afcrtecnologia.com` apunta a `3.132.192.3`.
- Base de datos de aplicacion: Supabase `omkbowrspgbuwpifksfk`; requiere
  variables de `backend/.env.example` en cada entorno desplegado.
- Produccion frontend debe usar:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrtecnologia.com
```

El frontend publico corre por HTTPS; la API publica tambien debe estar por HTTPS
para evitar contenido mixto.

## Lecciones del despliegue en Hostinger

- Hostinger esta configurado como framework `Next.js`, root directory `./`,
  Node `20.x`, build por defecto.
- En los logs correctos debe verse:

```text
AFCR_FRONTEND_BUILD=f.49
AFCR_FRONTEND_MODE=next-server
```

- Hostinger no genero `out/index.html` de forma fiable aunque `output: "export"`
  estuviera en `next.config`. Se retiro el modo static export.
- No volver a agregar un `postbuild` que falle si no existe `out/index.html`.
- Config actual correcta del frontend:
  - `next.config.js` CommonJS sin `output: "export"`.
  - `npm run build` ejecuta `next build` con API publica.
  - `npm run start` ejecuta `node server.js`.
  - `server.js` arranca Next server sobre `.next` y escucha
    `process.env.PORT || 3000` en `0.0.0.0`.
- Antes hubo varios intentos fallidos:
  - Reescribir `/_next` a `/next`.
  - Servir `out/` con Python.
  - Exigir `out/index.html` en `postbuild`.
  - Static export forzado en Hostinger.
  Estos patrones no deben recuperarse sin evidencia nueva.
- `npm audit` puede mostrar vulnerabilidades; eso no fue la causa del fallo de
  despliegue. La causa fue incompatibilidad entre la salida esperada y lo que
  Hostinger estaba construyendo/arrancando.
- En desarrollo local no correr dos procesos `next dev` para el mismo
  `frontend/` ni ejecutar `npm run build` mientras un `next dev` activo usa el
  mismo `.next`; el 2026-05-25 eso corrompio chunks y produjo
  `Cannot find module './820.js'`. Recuperacion: detener instancias, borrar
  `frontend/.next` y arrancar una sola instancia.

## Frontend actual

Entrypoint:

- `frontend/app/page.tsx` redirige a `/welcome`.
- `frontend/app/welcome/page.tsx` implementa acceso/bienvenida.
- `frontend/app/desarrollo/layout.tsx` implementa shell y acceso al laboratorio.
- `frontend/app/layout.tsx` define idioma `es`, metadata y estilos globales.
- `frontend/app/globals.css` contiene estilos globales responsive.

Vistas principales:

- `/welcome`: `frontend/app/welcome/page.tsx`.
- `/desarrollo/sync`: `frontend/app/desarrollo/sync/sync-lab.tsx`.
- `/desarrollo/dashboard`: `frontend/components/voice-dashboard.tsx`.

Autenticacion:

- Mantiene correo + contrasena para registro e inicio de sesion.
- Confirmacion de registro y recuperacion usan OTP manual de 8 digitos.
- El perfil editable contiene solo nombre de usuario y telefono; no existe
  campo empresa ni se envia `company_name`.
- `/auth/confirm` se conserva para enlaces historicos.

La vista `sync`:

- Llama `GET /devices`.
- Crea tokens con `POST /devices/pairing-token`.
- Para `ESP32`, asigna el LED a un ambiente, muestra API URL, token, vigencia
  y modo HTTPS polling; muestra el sketch para Arduino IDE y el usuario edita
  `WIFI_SSID`, `WIFI_PASSWORD` y `PAIRING_TOKEN` antes de subirlo por USB.
- En laboratorio, el backend debe responder una `api_url` LAN alcanzable por
  el ESP32 (por ejemplo `http://192.168.0.5:8000`), no `localhost`; el sketch
  copiado la inserta automaticamente y admite HTTP solo para la red local. En
  produccion usa `https://api.afcrtecnologia.com` con CA.
- Tras crear el token, la pantalla desplaza al usuario a la guia Arduino IDE,
  ofrece copiar token/sketch e indica probar `<api_url>/ping` desde un celular
  en la misma WiFi antes de cargar un ESP32 real.
- Incluye un dispositivo demo `demo-luz-cocina` solo como muestra visual; no
  cuenta como hardware enlazado.

El dashboard de voz en `frontend/components/voice-dashboard.tsx`:

- Verifica backend con `GET /ping`.
- Usa `MediaRecorder`/`getUserMedia` para grabar audio.
- Envia audio a `POST /voice-intent`.
- Muestra dos canales separados:
  - `Respuesta IA para el usuario`: lenguaje natural para la persona.
  - `Respuesta Json para el dispositivo`: JSON tecnico para automatizacion.
- El campo de respuesta IA toma primero `respuesta_ia_usuario` del backend, luego
  `respuesta_usuario` por compatibilidad. Antes de recibir voz, muestra un
  placeholder que aclara que aun no hubo pregunta por voz y que los dispositivos
  visibles son de prueba.
- El campo JSON toma primero `respuesta_json_dispositivo`, luego
  `intencion_json`.
- Incluye una tarjeta `Logs de prueba` con eventos de `/ping`, permisos de
  microfono, MIME, tamano de audio, nivel de volumen (`peak_level` y
  `average_level`), respuesta del backend y estado de transcripcion.
- El frontend bloquea audio silencioso o demasiado pequeno antes de enviarlo:
  `SILENT_AUDIO_MIN_BYTES = 1500` y umbral de pico `0.03`.
- Al pulsar `Confirmar ejecucion`, un ESP32 real recibe una orden en cola HTTP;
  el dashboard sigue su ACK hasta mostrar ejecucion, fallo o expiracion.
- Comandos cortos como "prende el LED" deben habilitar confirmacion si existe
  un ESP32 enlazado. Si no se dijo ambiente, el backend usa el ESP32 reclamado
  mas reciente y su `assigned_space`.
- Luces legacy conservan MQTT; camaras, puertas, sensores y alarmas son planes
  o acciones simuladas en UI hasta conectar hardware real.

API client:

```text
frontend/lib/backend-api.ts
```

Funciones activas:

- `pingBackend()`
- `sendVoiceIntentPreview(file)`
- `confirmVoiceIntentPlan(requestId)`
- `getDeviceCommandStatus(commandId)`
- `listDevices()`
- `createPairingToken(input)`

Valor default compilado si no existe env:

```text
DEFAULT_API_BASE_URL = https://api.afcrtecnologia.com
```

El cliente normaliza URLs para evitar que produccion use hosts LAN/privados o
`http://api.afcrtecnologia.com`.

## Backend actual

Archivo principal:

```text
backend/app_api.py
```

Responsabilidades:

- Cargar `backend/.env` si `python-dotenv` esta disponible.
- Configurar CORS.
- Inicializar cliente MQTT.
- Inicializar OpenAI si `AI_PROVIDER=openai`.
- Inicializar Whisper local solo si no se usa OpenAI.
- Usar Supabase para hogares, dispositivos, planes y comandos si esta
  configurado; SQLite usa el hogar tecnico `local-household` como fallback
  sin variables Supabase.
- Guardar audio nuevo en Storage privado `voice-audio` cuando Supabase esta
  configurado; la purga diaria elimina objetos vencidos a los 30 dias.
- Transcribir audio.
- Interpretar intencion con OpenAI u Ollama y fallback por reglas.
- Separar respuesta de IA en:
  - `respuesta_ia_usuario` / `respuesta_usuario`: lenguaje natural para humano.
  - `respuesta_json_dispositivo` / `intencion_json`: JSON tecnico para
    dispositivos.
- Crear plan pendiente de confirmacion.
- Confirmar y encolar HTTP para ESP32 por ambiente; mantener MQTT para luces
  legacy.
- Gestionar pairing, claim, polling autenticado, ACK, heartbeat y comandos.
- Autorizar con `household_members/household_id` y omitir identificadores
  internos del hogar en las respuestas publicas.

Variables relevantes:

```python
SAVE_DIR = "/home/abraham/proy_ia_security/audios_recibidos"
MQTT_SERVER = os.getenv("MQTT_SERVER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_LUCES = os.getenv("MQTT_TOPIC_LUCES", "casa/esp32/luces")
MQTT_DEVICE_TOPIC_PREFIX = os.getenv("MQTT_DEVICE_TOPIC_PREFIX", "afcr/devices")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://api.afcrtecnologia.com")
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
OPENAI_TRANSCRIBE_FALLBACK_MODEL = os.getenv("OPENAI_TRANSCRIBE_FALLBACK_MODEL", "whisper-1")
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "700"))
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.45"))
AI_RESPONSE_STYLE = os.getenv("AI_RESPONSE_STYLE", "natural, claro, cercano y con criterio tecnico")
VOICE_PLAN_TTL_SECONDS = int(os.getenv("VOICE_PLAN_TTL_SECONDS", "300"))
VOICE_AUDIO_MIN_BYTES = int(os.getenv("VOICE_AUDIO_MIN_BYTES", "1500"))
DEVICE_COMMAND_TTL_SECONDS = int(os.getenv("DEVICE_COMMAND_TTL_SECONDS", "300"))
```

## Contratos activos

Endpoint raiz:

```text
GET /
```

Endpoint de salud:

```text
GET /ping
```

Endpoint principal:

```text
POST /voice-intent
multipart/form-data audio=<archivo>
```

Confirmacion de plan de voz:

```text
POST /voice-intent/confirm
Content-Type: application/json
{ "request_id": "..." }
```

Endpoints de dispositivos:

```text
POST /devices/pairing-token
POST /devices/claim
GET /devices
POST /devices/{device_id}/heartbeat
POST /devices/{device_id}/command
GET /device/commands?device_id={device_id}
POST /device/commands/{command_id}/ack
GET /device/commands/{command_id}/status
```

`POST /voice-intent` no ejecuta inmediatamente el comando fisico. Devuelve
preview con `plan.request_id`, `can_execute`, `module`, `action`, `espacio`,
`mqtt_preview`, `expires_at`, `respuesta_ia_usuario` y
`respuesta_json_dispositivo`. Para un `ESP32`, confirmar encola la orden y la
ejecucion real ocurre cuando el dispositivo consulta y devuelve ACK. Para
dispositivos legacy, la publicacion MQTT ocurre al confirmar.

Forma esperada de la IA:

```json
{
  "respuesta_ia_usuario": "Respuesta natural y coherente segun lo que dijo el usuario.",
  "respuesta_json_dispositivo": {
    "texto": "transcripcion",
    "intencion": "control_luces",
    "detalle": "detalle tecnico breve",
    "espacio": "cocina",
    "accion": "ON"
  }
}
```

Compatibilidad mantenida:

- `respuesta_usuario`
- `intencion_json`
- `fase_3_ia_json.respuesta_usuario`
- `fase_3_ia_json.intencion_json`
- `fase_3_ia_json.ia_json`

La respuesta para el usuario debe responder directamente a lo que pregunto o
pidio por voz. No debe ser un resumen generico del dashboard si hay
transcripcion concreta. El JSON para dispositivos no debe contener lenguaje
conversacional.

## ESP32 HTTP

El ESP32 reclamado recibe una `device_api_key` una sola vez y la almacena
localmente; Supabase persiste solo el hash. En produccion consulta por HTTPS:

```text
GET /device/commands?device_id={device_id}
Authorization: Bearer <device_api_key>
```

Al ejecutar su LED GPIO 2 confirma con:

```text
POST /device/commands/{command_id}/ack
```

Los comandos expiran a los 300 segundos y el dashboard muestra
`queued`, `delivered`, `executed`, `failed` o `expired`.

En laboratorio local el mismo sketch usa HTTP hacia la URL LAN que devuelve el
backend, por ejemplo `http://192.168.0.5:8000`; esto es solo para pruebas
dentro de la red del usuario y no sustituye HTTPS en produccion.

## MQTT Legacy

Topic MQTT activo:

```text
casa/esp32/luces
```

Payload MQTT activo:

```json
{
  "espacio": "cocina",
  "accion": "ON"
}
```

Si existe un dispositivo de luces reclamado en Supabase (o en SQLite fallback),
el backend puede publicar
en:

```text
afcr/devices/{device_id}/commands
```

Ambientes validos:

- `sala`
- `comedor`
- `cocina`
- `cuarto_principal`

Acciones validas:

- `ON`
- `OFF`

Valores relevantes de `fase_4_mqtt.accion_mqtt`:

- `PENDIENTE_CONFIRMACION`
- `MQTT_ON_<espacio>_OK`
- `MQTT_ON_<espacio>_ERROR`
- `MQTT_OFF_<espacio>_OK`
- `MQTT_OFF_<espacio>_ERROR`
- `PLAN_NO_EJECUTABLE`
- `MODULO_NO_EJECUTABLE`
- `SIN_ACCION`
- `ESPACIO_DESCONOCIDO`
- `ACCION_DESCONOCIDA`
- `SIN_JSON`

## ESP32

Flujo de pairing:

1. Frontend crea token con `POST /devices/pairing-token`.
2. Frontend muestra el sketch base y el token temporal.
3. Usuario escribe SSID, password WiFi y token en el sketch desde Arduino IDE.
4. Usuario sube el sketch al ESP32 por USB.
5. ESP32 se conecta directamente al WiFi y llama `POST /devices/claim` contra
   la `API_URL` insertada por la web: LAN HTTP en laboratorio o
   `https://api.afcrtecnologia.com` en produccion.
6. Backend marca dispositivo como `online`, guarda `claimed_at` y entrega
   `device_api_key` una sola vez.
7. ESP32 consulta `GET /device/commands?device_id=...` con bearer token.
8. ESP32 ejecuta el LED y envia ACK del comando al backend.

El backend no recibe ni guarda password WiFi; queda en el sketch local del
usuario. Si cambia WiFi, vuelve a cargar el sketch. Si cambia token, el
firmware descarta su credencial guardada y reclama el enlace nuevo.

Firmware base:

```text
firmware/esp32_pairing_portal/esp32_pairing_portal.ino
```

## Red De Laboratorio ESP32

- IP LAN Windows observada el 2026-05-25: `192.168.0.5`.
- IP WSL observada el 2026-05-25: `172.20.119.33`. Puede cambiar tras
  reiniciar Windows o WSL; volver a consultarla antes de probar hardware.
- Regla `portproxy` observada: `192.168.0.5:8000 -> 172.20.119.33:8000`.
- Aunque la regla estaba registrada, `curl http://192.168.0.5:8000/ping`
  desde Windows fallo el 2026-05-25; un ESP32 fisico no podra reclamar ni
  consultar comandos hasta que la escucha/firewall/portproxy responda desde
  otro dispositivo de la LAN.
- FastAPI local se probo usando base temporal en `/tmp` y:

```bash
DEVICES_DB_PATH=/tmp/afcr_devices_browser_runtime.db \
AI_PROVIDER=disabled-for-local \
CORS_ALLOW_ORIGINS=http://localhost:3001,http://127.0.0.1:3001 \
PUBLIC_API_URL=http://192.168.0.5:8000 \
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

- Antes de flashear hardware, generar un token nuevo y confirmar desde un
  celular en la misma red que `http://192.168.0.5:8000/ping` devuelve
  `{"pong":true}`.

## Comandos utiles

Frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run build
PORT=3101 npm run start
```

Backend:

```bash
cd /home/abraham/proy_ia_security/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Health checks:

```bash
curl https://api.afcrtecnologia.com/ping
curl -I https://afcrtecnologia.com
curl http://localhost:8000/ping
```

## Reglas para futuras sesiones

- Skill de mantenimiento: `.agents/skills/actualizador-agents-md/` contiene
  instrucciones y un script de inventario no destructivo para actualizar estos
  tres `AGENTS.md` cuando el usuario lo pida.
- No tocar `.env.local`, claves, tokens ni secretos.
- No tocar `backend/.env` salvo peticion explicita del usuario.
- Mantener `api.afcrtecnologia.com` como API publica salvo cambio explicito.
- Mientras el usuario este validando localmente, no desplegar ni hacer
  `git push`; los cambios de produccion requieren confirmacion explicita.
- Verificar el destino MCP antes de alterar Supabase; el proyecto autorizado
  para esta app es `omkbowrspgbuwpifksfk`.
- No recrear `proy_ia_security/` anidado.
- Respetar cambios existentes del usuario en el worktree.
- Antes de cambiar frontend, revisar:
  - `frontend/lib/backend-api.ts`
  - `frontend/app/desarrollo/sync/sync-lab.tsx`
  - `frontend/app/desarrollo/sync/esp32-direct-sketch.ts`
  - `frontend/app/desarrollo/workspace-context.tsx`
  - `frontend/components/voice-dashboard.tsx`
  - `frontend/package.json`
  - `frontend/server.js`
  - `frontend/next.config.js`
- Antes de cambiar backend, revisar `backend/app_api.py` completo.
- Mantener el contrato MQTT salvo solicitud explicita.
- Recordar que el flujo de voz actual es preview + confirmacion.
- Para pruebas fisicas locales del ESP32, no usar `localhost` dentro del
  sketch: usar la API LAN insertada por el backend y validar `/ping` desde otro
  equipo de la red.
- Para diagnosticar Hostinger, comparar el log con la marca
  `AFCR_FRONTEND_BUILD=...` de `frontend/scripts/print-deploy-info.js`.
- Si el sitio publica `503`, revisar primero si Hostinger esta arrancando el
  proceso Node (`npm run start`) y si el log muestra `AFCR_FRONTEND_READY=...`.
- No recuperar el postbuild de `out/index.html` salvo que Hostinger se cambie a
  despliegue estatico puro.
