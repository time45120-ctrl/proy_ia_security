# AGENTS.md - Memoria compacta de Codex

Ultima revision de mapa: 2026-05-12.

## Contexto rapido

Este proyecto es un asistente de voz IoT/domotico para laboratorio local y
despliegue web. La app publica un dashboard para enlazar dispositivos ESP32,
grabar comandos de voz, pedir a IA que interprete la intencion y, despues de
confirmacion del usuario, publicar comandos MQTT para actuadores.

La fuente activa del proyecto es esta raiz:

```text
/home/abraham/proy_ia_security
```

La copia legacy anidada `proy_ia_security/` fue eliminada. La unica fuente
valida del proyecto es esta raiz.

## Mapa del proyecto

- Backend principal: `backend/app_api.py`
- Frontend principal: `frontend/`
- Firmware ESP32: `firmware/esp32_pairing_portal/esp32_pairing_portal.ino`
- Audios recibidos: `audios_recibidos/`
- README principal: `README.md`
- Package raiz con scripts proxy: `package.json`
- Env de ejemplo backend: `backend/.env.example`
- Env de ejemplo frontend: `frontend/.env.example`
- Persistencia local de dispositivos: `backend/devices.db` por defecto

Estructura activa:

```text
proy_ia_security/
|-- AGENTS.md
|-- README.md
|-- package.json
|-- backend/
|   |-- app_api.py
|   `-- .env.example
|-- frontend/
|   |-- app/
|   |   |-- globals.css
|   |   |-- layout.tsx
|   |   `-- page.tsx
|   |-- components/
|   |   |-- voice-dashboard.tsx
|   |   `-- welcome-gate.tsx
|   |-- lib/
|   |   `-- backend-api.ts
|   |-- package.json
|   |-- next.config.ts
|   |-- tailwind.config.ts
|   `-- .env.example
|-- firmware/
|   `-- esp32_pairing_portal/
|       `-- esp32_pairing_portal.ino
`-- audios_recibidos/
```

Stack actual:

- Frontend: Next.js 15, React 19, TypeScript y Tailwind 3.
- Backend: FastAPI, OpenAI, Ollama opcional, Whisper local opcional,
  SQLite, `python-dotenv` y MQTT con `paho-mqtt`.
- Firmware: Arduino/ESP32 con WiFi, WebServer, HTTPClient, WiFiClientSecure,
  Preferences, PubSubClient y ArduinoJson.
- Broker MQTT esperado por defecto por el backend: `127.0.0.1:1883`.

## Despliegue actual

- Frontend en Hostinger: `https://afcrseguridad.com`
- Backend en AWS: IP publica `3.132.192.3`
- API publica: `https://api.afcrseguridad.com`
- DNS en Hostinger: `api.afcrseguridad.com` apunta a `3.132.192.3`.
- Produccion debe usar:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com
```

Para pruebas locales o LAN, usar `frontend/.env.local` con la URL del backend
de pruebas. Para produccion, configurar `NEXT_PUBLIC_API_BASE_URL` en Hostinger;
no commitear `.env.local`.

El frontend publico corre por HTTPS, asi que la API publica tambien debe estar
disponible por HTTPS para evitar bloqueo por contenido mixto del navegador.

## Frontend actual

Entrypoint:

- `frontend/app/page.tsx` renderiza `WelcomeGate`.
- `frontend/app/layout.tsx` define idioma `es`, metadata y estilos globales.
- `frontend/app/globals.css` define tema oscuro, fuentes CSS y grilla de fondo.

Vistas principales en `frontend/components/welcome-gate.tsx`:

- `welcome`: pantalla inicial con imagen remota y boton de configuracion.
- `sync`: sincronizacion/enlace de dispositivos ESP32.
- `dashboard`: panel principal con voz, modulos y detalle por categoria.

La vista `sync`:

- Llama `GET /devices` con `listDevices()`.
- Crea tokens con `POST /devices/pairing-token`.
- Muestra API URL, token, device id y topic MQTT para configurar el ESP32.
- Incluye un dispositivo demo fijo `demo-luz-cocina` para que exista un
  dispositivo enlazado visualmente.

El dashboard de voz en `frontend/components/voice-dashboard.tsx`:

- Verifica backend con `GET /ping`.
- Usa `MediaRecorder`/`getUserMedia` para grabar audio.
- Envia el audio a `POST /voice-intent`.
- Muestra transcripcion, plan de IA, modulo, accion, ambiente, MQTT preview y
  respuesta completa.
- Ejecuta hardware real solo cuando el usuario pulsa `Confirmar ejecucion`, que
  llama `POST /voice-intent/confirm`.
- Modulos visuales: luces, puertas, camaras y drones.
- Solo luces ejecuta MQTT real actualmente; puertas/camaras/drones muestran plan
  escrito o acciones simuladas en UI.

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
DEFAULT_API_BASE_URL = http://192.168.0.220:8000
```

`frontend/.env.example` recomienda local:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

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
- Crear un plan pendiente de confirmacion.
- Confirmar y publicar MQTT para luces.
- Gestionar pairing, claim, heartbeat y comandos de dispositivos.

Variables relevantes:

```python
SAVE_DIR = "/home/abraham/proy_ia_security/audios_recibidos"
MQTT_SERVER = os.getenv("MQTT_SERVER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_LUCES = os.getenv("MQTT_TOPIC_LUCES", "casa/esp32/luces")
MQTT_DEVICE_TOPIC_PREFIX = os.getenv("MQTT_DEVICE_TOPIC_PREFIX", "afcr/devices")
DB_PATH = os.getenv("DEVICES_DB_PATH", ".../backend/devices.db")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://api.afcrseguridad.com")
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
LOCAL_AI_MODEL = os.getenv("LOCAL_AI_MODEL", "qwen2:7b-instruct-q4_0")
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

`POST /voice-intent` ya no ejecuta inmediatamente el comando fisico. Devuelve un
plan con `request_id`, `can_execute`, `module`, `action`, `espacio`,
`mqtt_preview` y `expires_at`. Para luces validas, `fase_4_mqtt.accion_mqtt`
sale como `PENDIENTE_CONFIRMACION`. La publicacion real ocurre en
`POST /voice-intent/confirm`.

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
en el topic especifico del dispositivo:

```text
afcr/devices/{device_id}/commands
```

En ese caso el payload puede incluir tambien:

```json
{
  "espacio": "cocina",
  "accion": "ON",
  "device_id": "..."
}
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

## Flujo de dispositivos ESP32

Pairing desde frontend publico:

1. El frontend crea token con `POST /devices/pairing-token`.
2. El ESP32 crea un AP temporal `AFCR-ESP32-XXXX`.
3. El usuario abre `http://192.168.4.1`.
4. El usuario escribe SSID, password WiFi, API URL y token en el portal local.
5. El ESP32 llama `POST /devices/claim` contra `PUBLIC_API_URL`.
6. El backend marca el dispositivo como `online`, guarda `claimed_at` y devuelve
   el topic MQTT.
7. El ESP32 se suscribe a `afcr/devices/{device_id}/commands`.
8. El ESP32 envia heartbeat a `POST /devices/{device_id}/heartbeat`.

El backend no recibe ni guarda la password WiFi. Esa clave solo se escribe en el
portal local del ESP32.

Firmware base:

```text
firmware/esp32_pairing_portal/esp32_pairing_portal.ino
```

Notas del firmware:

- Usa `Preferences` para guardar SSID, password, API URL, token, device id y
  topic.
- Usa `WiFiClientSecure.setInsecure()` como MVP; en produccion reemplazar por CA
  raiz.
- El sketch trae placeholders MQTT:
  `TU_BROKER_MQTT_TLS`, `TU_USUARIO_MQTT`, `TU_PASSWORD_MQTT`.
- El callback MQTT actual enciende/apaga `LED_PIN = 2` cuando recibe `ON`/`OFF`.

Para produccion MQTT TLS, usar variables del backend como:

```bash
MQTT_SERVER=mqtt.afcrseguridad.com
MQTT_PORT=8883
MQTT_TLS=true
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_DEVICE_TOPIC_PREFIX=afcr/devices
PUBLIC_API_URL=https://api.afcrseguridad.com
```

## Comandos utiles

Desde la raiz:

```bash
npm run dev
npm run build
npm run start
npm run frontend:dev
npm run frontend:build
npm run frontend:start
```

Levantar backend:

```bash
cd /home/abraham/proy_ia_security/backend
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Levantar frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run dev
```

Build frontend:

```bash
cd /home/abraham/proy_ia_security/frontend
npm run build
```

Health check:

```bash
curl http://localhost:8000/ping
```

Verificar sintaxis del backend:

```bash
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('backend/app_api.py').read_text()); print('backend/app_api.py syntax OK')"
```

Dependencias Python manuales, porque no hay `requirements.txt` ni `pyproject.toml`
en la raiz activa:

```bash
pip install fastapi uvicorn openai python-dotenv whisper-timestamped paho-mqtt python-multipart
```

Si se usa Ollama:

```bash
ollama pull qwen2:7b-instruct-q4_0
```

## Alternar proveedor de IA

El backend carga variables locales desde `backend/.env`, ignorado por git.
Usar `backend/.env.example` como plantilla. `frontend/.env.local` es solo para
variables del frontend como `NEXT_PUBLIC_API_BASE_URL`; nunca guardar secretos
en variables `NEXT_PUBLIC_*` porque llegan al navegador.

El CORS del backend se configura con `CORS_ALLOW_ORIGINS`, separado por comas.
Por defecto permite produccion y desarrollo local:

```bash
CORS_ALLOW_ORIGINS=https://afcrseguridad.com,https://www.afcrseguridad.com,http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:3002,http://127.0.0.1:3002
```

La Fase 3 cambia entre OpenAI API e IA local con esta linea de
`backend/app_api.py`:

```python
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
```

Para usar OpenAI API:

```bash
cd /home/abraham/proy_ia_security/backend
cp .env.example .env
# Editar backend/.env:
#
# AI_PROVIDER=openai
# OPENAI_API_KEY=TU_API_KEY
# OPENAI_MODEL=gpt-4o-mini
# OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Para volver a IA local con Qwen2/Ollama:

```bash
cd /home/abraham/proy_ia_security/backend
# Editar backend/.env:
#
# AI_PROVIDER=local
# LOCAL_AI_MODEL=qwen2:7b-instruct-q4_0
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

No guardar claves reales en archivos del repo.

Variables de `backend/.env.example` que describen la configuracion actual:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=TU_API_KEY
OPENAI_MODEL=gpt-4o-mini
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
LOCAL_AI_MODEL=qwen2:7b-instruct-q4_0
PUBLIC_API_URL=https://api.afcrseguridad.com
DEVICES_DB_PATH=/home/abraham/proy_ia_security/backend/devices.db
PAIRING_TOKEN_MINUTES=10
DEVICE_ONLINE_WINDOW_SECONDS=120
MQTT_SERVER=127.0.0.1
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
MQTT_TLS=false
MQTT_TOPIC_LUCES=casa/esp32/luces
MQTT_DEVICE_TOPIC_PREFIX=afcr/devices
```

## Reglas para futuras sesiones

- No tocar `.env.local`, claves, tokens ni secretos.
- No tocar `backend/.env` salvo peticion explicita del usuario.
- Mantener `api.afcrseguridad.com` como dominio publico de API salvo cambio
  explicito del usuario.
- No recrear `proy_ia_security/` anidado salvo peticion explicita.
- Respetar cambios existentes del usuario en el worktree.
- Preferir cambios pequenos, locales y verificados.
- Usar `README.md` como fuente extendida de arquitectura, comandos y
  troubleshooting.
- Mantener el contrato MQTT actual salvo que el usuario pida cambiarlo:
  topic `casa/esp32/luces` y payload `{ "espacio": "...", "accion": "ON|OFF" }`.
- Recordar que el flujo de voz actual es preview + confirmacion:
  `/voice-intent` prepara plan y `/voice-intent/confirm` ejecuta.
- Antes de cambiar frontend, revisar `frontend/lib/backend-api.ts`,
  `frontend/components/welcome-gate.tsx` y
  `frontend/components/voice-dashboard.tsx`.
- Antes de cambiar backend, revisar `backend/app_api.py` completo.
- Antes de cambiar firmware, revisar el flujo de pairing y los placeholders MQTT
  en `firmware/esp32_pairing_portal/esp32_pairing_portal.ino`.

## Notas operativas

- `frontend/.env.local` sobreescribe `NEXT_PUBLIC_API_BASE_URL`.
- Si no existe env frontend, `frontend/lib/backend-api.ts` usa por defecto
  `http://192.168.0.220:8000`.
- En Hostinger, `NEXT_PUBLIC_API_BASE_URL` debe apuntar a
  `https://api.afcrseguridad.com`.
- `backend/devices.db` es persistencia local de dispositivos enlazados; no tratar
  sus filas como codigo fuente.
- El frontend puede apuntar a una IP LAN de Windows si FastAPI corre dentro de
  WSL y se expone con `portproxy`.
- En AWS, verificar security group/firewall, servicio FastAPI activo y HTTPS
  para `api.afcrseguridad.com` antes de diagnosticar el frontend.
- Si despues de reiniciar Windows o WSL deja de conectar, sospechar primero de la
  IP interna de WSL y de las reglas `portproxy` para `8000` y `1883`.
- El cambio de este archivo es documentacion; no requiere build ni tests de app.
