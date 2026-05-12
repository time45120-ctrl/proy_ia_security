# AGENTS.md - Memoria compacta de Codex

Ultima revision: 2026-05-12.

## Contexto rapido

Proyecto de asistente de voz IoT/domotico con dashboard web, backend FastAPI,
IA para interpretar comandos y flujo de confirmacion antes de ejecutar acciones
MQTT. La fuente activa es:

```text
/home/abraham/proy_ia_security
```

No recrear la copia legacy anidada `proy_ia_security/`.

## Repos Git activos

Hay repos Git separados. Usar el repo correcto para commits y push:

- Raiz/documentacion: `/home/abraham/proy_ia_security`
  - Remoto: `time45120-ctrl/proy_ia_security`
  - Rama observada: `new1`
- Frontend: `/home/abraham/proy_ia_security/frontend`
  - Remoto: `time45120-ctrl/proy_ia_frontend`
  - Rama: `main`
  - Ultimo cambio operativo conocido: `f1.19`
- Backend: `/home/abraham/proy_ia_security/backend`
  - Remoto: `time45120-ctrl/proy_ia_backend`
  - Rama: `main`
  - Ultimo cambio operativo conocido: `b1.6`

Para cambios reales de frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run build
git add .
git commit -m "f1.N"
git push
```

Para cambios reales de backend:

```bash
cd /home/abraham/proy_ia_security/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
git add app_api.py
git commit -m "b1.N"
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
- Persistencia local de dispositivos: `backend/devices.db` por defecto

Frontend relevante:

```text
frontend/
|-- app/
|   |-- globals.css
|   |-- layout.tsx
|   `-- page.tsx
|-- components/
|   |-- voice-dashboard.tsx
|   `-- welcome-gate.tsx
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
- Backend: FastAPI, OpenAI, Ollama opcional, Whisper local opcional, SQLite,
  `python-dotenv` y MQTT con `paho-mqtt`.
- Firmware: Arduino/ESP32 con WiFi, WebServer, HTTPClient, WiFiClientSecure,
  Preferences, PubSubClient y ArduinoJson.
- Broker MQTT por defecto del backend: `127.0.0.1:1883`.

## Despliegue

- Frontend publico Hostinger: `https://afcrseguridad.com`
- Backend publico AWS: `https://api.afcrseguridad.com`
- IP backend AWS: `3.132.192.3`
- DNS: `api.afcrseguridad.com` apunta a `3.132.192.3`.
- Produccion frontend debe usar:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com
```

El frontend publico corre por HTTPS; la API publica tambien debe estar por HTTPS
para evitar contenido mixto.

## Lecciones del despliegue en Hostinger

- Hostinger esta configurado como framework `Next.js`, root directory `./`,
  Node `20.x`, build por defecto.
- En los logs correctos debe verse:

```text
AFCR_FRONTEND_BUILD=f1.19
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

## Frontend actual

Entrypoint:

- `frontend/app/page.tsx` renderiza `WelcomeGate`.
- `frontend/app/layout.tsx` define idioma `es`, metadata y estilos globales.
- `frontend/app/globals.css` contiene estilos globales responsive.

Vistas principales en `frontend/components/welcome-gate.tsx`:

- `welcome`: pantalla inicial.
- `sync`: enlace de dispositivos ESP32.
- `dashboard`: panel principal con voz, modulos y detalle por categoria.

La vista `sync`:

- Llama `GET /devices`.
- Crea tokens con `POST /devices/pairing-token`.
- Muestra API URL, token, device id y topic MQTT.
- Incluye un dispositivo demo `demo-luz-cocina` para experiencia visual inicial.

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
- Ejecuta hardware real solo cuando el usuario pulsa `Confirmar ejecucion`, que
  llama `POST /voice-intent/confirm`.
- Solo luces ejecuta MQTT real actualmente; camaras, puertas y drones son
  planes o acciones simuladas en UI.

API client:

```text
frontend/lib/backend-api.ts
```

Funciones activas:

- `pingBackend()`
- `sendVoiceIntentPreview(file)`
- `confirmVoiceIntentPlan(requestId)`
- `listDevices()`
- `createPairingToken(input)`

Valor default compilado si no existe env:

```text
DEFAULT_API_BASE_URL = https://api.afcrseguridad.com
```

El cliente normaliza URLs para evitar que produccion use hosts LAN/privados o
`http://api.afcrseguridad.com`.

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
- Crear/migrar tabla SQLite `devices`.
- Guardar audios recibidos en `audios_recibidos/`.
- Transcribir audio.
- Interpretar intencion con OpenAI u Ollama y fallback por reglas.
- Separar respuesta de IA en:
  - `respuesta_ia_usuario` / `respuesta_usuario`: lenguaje natural para humano.
  - `respuesta_json_dispositivo` / `intencion_json`: JSON tecnico para
    dispositivos.
- Crear plan pendiente de confirmacion.
- Confirmar y publicar MQTT para luces.
- Gestionar pairing, claim, heartbeat y comandos de dispositivos.

Variables relevantes:

```python
SAVE_DIR = "/home/abraham/proy_ia_security/audios_recibidos"
MQTT_SERVER = os.getenv("MQTT_SERVER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_LUCES = os.getenv("MQTT_TOPIC_LUCES", "casa/esp32/luces")
MQTT_DEVICE_TOPIC_PREFIX = os.getenv("MQTT_DEVICE_TOPIC_PREFIX", "afcr/devices")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://api.afcrseguridad.com")
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "700"))
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.45"))
AI_RESPONSE_STYLE = os.getenv("AI_RESPONSE_STYLE", "natural, claro, cercano y con criterio tecnico")
VOICE_PLAN_TTL_SECONDS = int(os.getenv("VOICE_PLAN_TTL_SECONDS", "300"))
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
```

`POST /voice-intent` no ejecuta inmediatamente el comando fisico. Devuelve
preview con `plan.request_id`, `can_execute`, `module`, `action`, `espacio`,
`mqtt_preview`, `expires_at`, `respuesta_ia_usuario` y
`respuesta_json_dispositivo`. La publicacion real ocurre en
`POST /voice-intent/confirm`.

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

## MQTT

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

Si existe un dispositivo de luces reclamado en SQLite, el backend puede publicar
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
2. ESP32 crea AP temporal `AFCR-ESP32-XXXX`.
3. Usuario abre `http://192.168.4.1`.
4. Usuario escribe SSID, password WiFi, API URL y token.
5. ESP32 llama `POST /devices/claim` contra `PUBLIC_API_URL`.
6. Backend marca dispositivo como `online`, guarda `claimed_at` y devuelve topic.
7. ESP32 se suscribe a `afcr/devices/{device_id}/commands`.
8. ESP32 envia heartbeat a `POST /devices/{device_id}/heartbeat`.

El backend no recibe ni guarda password WiFi.

Firmware base:

```text
firmware/esp32_pairing_portal/esp32_pairing_portal.ino
```

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
curl https://api.afcrseguridad.com/ping
curl -I https://afcrseguridad.com
```

## Reglas para futuras sesiones

- No tocar `.env.local`, claves, tokens ni secretos.
- No tocar `backend/.env` salvo peticion explicita del usuario.
- Mantener `api.afcrseguridad.com` como API publica salvo cambio explicito.
- No recrear `proy_ia_security/` anidado.
- Respetar cambios existentes del usuario en el worktree.
- Antes de cambiar frontend, revisar:
  - `frontend/lib/backend-api.ts`
  - `frontend/components/welcome-gate.tsx`
  - `frontend/components/voice-dashboard.tsx`
  - `frontend/package.json`
  - `frontend/server.js`
  - `frontend/next.config.js`
- Antes de cambiar backend, revisar `backend/app_api.py` completo.
- Mantener el contrato MQTT salvo solicitud explicita.
- Recordar que el flujo de voz actual es preview + confirmacion.
- Para diagnosticar Hostinger, comparar el log con la marca
  `AFCR_FRONTEND_BUILD=...` de `frontend/scripts/print-deploy-info.js`.
- Si el sitio publica `503`, revisar primero si Hostinger esta arrancando el
  proceso Node (`npm run start`) y si el log muestra `AFCR_FRONTEND_READY=...`.
- No recuperar el postbuild de `out/index.html` salvo que Hostinger se cambie a
  despliegue estatico puro.

