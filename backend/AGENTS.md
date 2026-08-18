# AGENTS.md - Backend

Ultima revision: 2026-08-18.

## Contexto

Este directorio contiene el backend desplegable del monorepo:

```text
/home/abraham/proyectos/casa-domotica-ia/backend
```

Repositorio canonico:

```text
https://github.com/abraham-development/casa-domotica-ia.git
```

`backend/` no tiene un Git independiente: su toplevel es
`/home/abraham/proyectos/casa-domotica-ia`. La rama unica en GitHub es `main`;
acepta pushes directos y mantiene bloqueados el borrado y el `force push`.

Ultima referencia importada del backend: `b.32`. La ultima ejecucion de
despliegue verificada corresponde a `a0cfcb3` (`n.46`).

Backend publico:

```text
https://api.afcrtecnologia.com
```

IP Hostinger VPS:

```text
2.24.95.57
```

## Estado De Trabajo Actual

- El usuario valida en produccion y local segun el caso. No hacer commit, push
  ni actualizar el VPS sin autorizacion explicita.
- `backend/.env` existe, tiene modo `600` y supera `npm run check:env`; no
  mostrar ni versionar sus valores. El despliegue VPS conserva por separado el
  archivo privado instalado en el servidor.
- `backend/.venv` usa Python 3.12.13, contiene las dependencias declaradas y
  supera las 26 pruebas. El entorno Python 3.14 anterior se conserva localmente
  como respaldo ignorado por Git.
- Produccion activa: frontend Hostinger `https://afcrtecnologia.com`,
  backend Hostinger VPS `https://api.afcrtecnologia.com` (`2.24.95.57`) y Supabase
  `omkbowrspgbuwpifksfk`.
- El 2026-07-27 se emitio y valido TLS para la API nueva, se cambio
  `PUBLIC_API_URL`, se dejo CORS solo para el frontend nuevo y se retiro el
  virtual host `api.afcrseguridad.com`. El respaldo recuperable del retiro esta
  en `/var/backups/afcr-domain-migration/legacy-retired-20260727T082540Z`.
- GitHub Actions usa `PUBLIC_HEALTH_URL=https://api.afcrtecnologia.com/ping`.
  `MONOREPO_BACKEND_DEPLOY_ENABLED=true`; las banderas de configuracion,
  inspeccion y retiro del dominio anterior permanecen en `false`.
- El backend se despliega por GitHub Actions mediante SSH al VPS; los secretos
  productivos permanecen en `/opt/casa-domotica-ia/backend/.env`.
- Supabase usa su GitHub Integration nativa con working directory `.`, rama
  productiva `main` y `Deploy to production`; no necesita secretos Supabase en
  GitHub. El usuario confirmo que la integracion esta habilitada; se valida con
  su check nativo despues del push. SMTP se administra entre Hostinger y
  Supabase Auth, no en GitHub.
- El 2026-07-20 se completo en Supabase la arquitectura residencial:
  `households`, `household_members` y `household_id`; se eliminaron
  definitivamente tablas, columnas, funciones, politicas y metadata de
  organizaciones. Los conteos productivos quedaron preservados.
- La autorizacion remota usa membresia del hogar con roles `owner/member`.
  Los payloads publicos omiten `household_id`; SQLite usa
  `local-household` como hogar tecnico de fallback.
- La prueba QA temporal confirmo trigger de registro, RLS, login, `GET /devices`,
  ocultacion de IDs, revocacion y limpieza completa.
- La API publica ya expone el flujo ESP32 directo por Arduino IDE, claim,
  polling HTTP(S), ACK y confirmacion. No reintroducir `esp32_portal_url`.

## Archivo principal

```text
app_api.py
```

Responsabilidades:

- FastAPI publica endpoints HTTP.
- Carga `backend/.env` si `python-dotenv` esta disponible.
- Configura CORS para frontend publico y desarrollo local.
- Inicializa OpenAI si `AI_PROVIDER=openai`.
- Transcribe con `gpt-4o-mini-transcribe` y reintenta con `whisper-1` si
  el modelo principal devuelve texto vacio.
- Inicializa Whisper local solo como respaldo cuando no se usa OpenAI.
- Inicializa MQTT con `paho-mqtt`.
- Gestiona dispositivos y comandos en Supabase bajo RLS por hogar; mantiene
  SQLite como fallback para pruebas locales sin variables Supabase.
- Recibe audio, lo guarda en Storage privado si Supabase esta activo, transcribe
  e interpreta; el audio vence a los 30 dias.
- Rechaza audios demasiado pequenos con `VOICE_AUDIO_MIN_BYTES = 1500` para
  evitar transcripciones falsas por silencio o microfono desactivado.
- Genera plan pendiente de confirmacion.
- Encola comandos HTTP(S) para ESP32 reales solo despues de confirmacion.
- Conserva MQTT para luces legacy.
- Gestiona pairing/claim/polling/ACK/heartbeat de ESP32.
- No exponer `household_id` ni identificadores internos de aislamiento en
  respuestas para navegador o dispositivos.

## IA: dos canales obligatorios

La IA debe devolver dos cosas separadas:

1. Respuesta natural para humano:
   - Campos: `respuesta_ia_usuario` y compatibilidad `respuesta_usuario`.
   - Debe responder directamente a lo que dijo el usuario por voz.
   - Debe ser clara, inteligente, natural y comprensible.
   - No debe incluir JSON, payloads, nombres de campos internos ni codigo.
   - Puede mencionar si algo queda pendiente de confirmacion.
   - Si el usuario pregunta por el estado del dashboard, puede explicar que hay
     dispositivos demo y que no todo representa hardware real confirmado.
2. JSON tecnico para dispositivos:
   - Campos: `respuesta_json_dispositivo` y compatibilidad `intencion_json`.
   - Debe ser parseable y estable.
   - No debe contener lenguaje conversacional.
   - Alimenta la logica de plan/MQTT.

Forma esperada:

```json
{
  "respuesta_ia_usuario": "Entendi que quieres encender la luz de cocina. Lo dejo listo y espero tu confirmacion antes de ejecutar.",
  "respuesta_json_dispositivo": {
    "texto": "enciende la luz de cocina",
    "intencion": "control_luces",
    "detalle": "encender luz de cocina",
    "espacio": "cocina",
    "accion": "ON"
  }
}
```

Compatibilidad mantenida en `/voice-intent`:

- `respuesta_usuario`
- `intencion_json`
- `fase_3_ia_json.respuesta_usuario`
- `fase_3_ia_json.respuesta_ia_usuario`
- `fase_3_ia_json.intencion_json`
- `fase_3_ia_json.respuesta_json_dispositivo`
- `fase_3_ia_json.ia_json`

La funcion `sanitize_user_reply()` evita que el texto al usuario sea un bloque
JSON crudo. `call_openai_intent()` y `build_local_ai_prompt()` contienen las
reglas principales del contrato.

## Endpoints

Salud:

```text
GET /ping
```

Voz:

```text
POST /voice-intent
multipart/form-data audio=<archivo>
```

Confirmacion:

```text
POST /voice-intent/confirm
Content-Type: application/json
{ "request_id": "..." }
```

Dispositivos:

```text
POST /devices/pairing-token
POST /devices/claim
GET /devices
GET /devices/{device_id}/led-states
POST /devices/{device_id}/heartbeat
POST /devices/{device_id}/command
GET /device/commands?device_id={device_id}
POST /device/commands/{command_id}/ack
GET /device/commands/{command_id}/status
GET /voice-intents/{request_id}/audio/respuesta-ia
GET /voice-intents/recent
```

`POST /voice-intent` no ejecuta hardware. Devuelve preview/plan. Para un
dispositivo tipo `ESP32`, `/voice-intent/confirm` encola el comando y la
ejecucion real se confirma cuando el firmware envia ACK. Los dispositivos
legacy de luces mantienen MQTT al confirmar.

Comandos cortos como `prende el LED` son ejecutables aunque no incluyan
ambiente explicito si hay un ESP32 reclamado; el backend usa el ESP32 mas
reciente y su `assigned_space`.

## Variables relevantes

```python
SAVE_DIR = os.getenv(
    "VOICE_AUDIO_SAVE_DIR",
    str(Path(__file__).resolve().parent / "audios_recibidos"),
)
MQTT_SERVER = os.getenv("MQTT_SERVER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_LUCES = os.getenv("MQTT_TOPIC_LUCES", "casa/esp32/luces")
MQTT_DEVICE_TOPIC_PREFIX = os.getenv("MQTT_DEVICE_TOPIC_PREFIX", "afcr/devices")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://api.afcrtecnologia.com")
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
OPENAI_TRANSCRIBE_FALLBACK_MODEL = os.getenv("OPENAI_TRANSCRIBE_FALLBACK_MODEL", "whisper-1")
VOICE_AUDIO_MIN_BYTES = int(os.getenv("VOICE_AUDIO_MIN_BYTES", "1500"))
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "700"))
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.45"))
AI_RESPONSE_STYLE = os.getenv("AI_RESPONSE_STYLE", "natural, claro, cercano y con criterio tecnico")
LOCAL_AI_MODEL = os.getenv("LOCAL_AI_MODEL", "qwen2:7b-instruct-q4_0")
VOICE_PLAN_TTL_SECONDS = int(os.getenv("VOICE_PLAN_TTL_SECONDS", "300"))
DEVICE_COMMAND_TTL_SECONDS = int(os.getenv("DEVICE_COMMAND_TTL_SECONDS", "300"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "").strip()
```

`SUPABASE_SECRET_KEY` es la credencial privada recomendada para el backend. La
variable legacy `SUPABASE_SERVICE_ROLE_KEY` solo se conserva como fallback de
compatibilidad. No tocar `backend/.env` ni claves reales salvo peticion
explicita del usuario.

## ESP32 HTTP(S) Polling

- La plataforma crea un token temporal; el usuario lo pega en el sketch junto
  a su WiFi, lo sube por USB y el ESP32 reclama el enlace al conectarse,
  recibiendo `device_id` mas una `device_api_key` que guarda localmente.
- Supabase guarda solo el hash de `device_api_key` en operacion remota; SQLite
  conserva ese comportamiento en el fallback.
- El ESP32 consulta `GET /device/commands?device_id=...` con
  `Authorization: Bearer <device_api_key>`.
- Un comando se reentrega hasta recibir `POST /device/commands/{id}/ack` o
  expirar a los 300 segundos.
- Estados: `queued`, `delivered`, `executed`, `failed`, `expired`.
- El contrato local de pairing ya no devuelve `esp32_portal_url`; no reintroducir
  portal/AP temporal salvo nueva decision explicita.
- Para laboratorio, `PUBLIC_API_URL` debe ser una URL LAN que el ESP32 pueda
  alcanzar y el sketch acepta HTTP solo para esa prueba local. Para produccion
  usar `https://api.afcrtecnologia.com` y TLS validado.

## MQTT Legacy

Topic default:

```text
casa/esp32/luces
```

Payload:

```json
{
  "espacio": "cocina",
  "accion": "ON"
}
```

Si hay dispositivo de luces reclamado, puede usar:

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

## Despliegue Hostinger VPS Automatizado

- El workflow activo esta en la raiz
  `.github/workflows/deploy-backend-vps.yml`.
- Se activa por push a `main` cuando cambia `backend/**` o el propio workflow;
  tambien permite `workflow_dispatch`.
- Usa SSH con una clave privada almacenada en el Environment `production` de
  GitHub. El repositorio privado debe estar clonado en el VPS mediante una
  deploy key.
- El checkout recomendado es `/opt/casa-domotica-ia`, la aplicacion esta en
  `/opt/casa-domotica-ia/backend` y el entorno virtual en
  `/opt/casa-domotica-ia/backend/.venv`.
- `scripts/deploy-vps.sh` exige `.env` privado ya instalado en el VPS, ejecuta
  sintaxis y 26 pruebas, reinicia `afcr-backend.service` y valida `/ping`.
- Nginx termina TLS y reenvia hacia `127.0.0.1:8000`.

## Comandos

Validar sintaxis:

```bash
cd /home/abraham/proyectos/casa-domotica-ia/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
```

Levantar backend:

```bash
cd /home/abraham/proyectos/casa-domotica-ia/backend
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Laboratorio fisico sin tocar `devices.db`:

```bash
DEVICES_DB_PATH=/tmp/afcr_devices_browser_runtime.db \
AI_PROVIDER=disabled-for-local \
CORS_ALLOW_ORIGINS=http://localhost:3001,http://127.0.0.1:3001 \
PUBLIC_API_URL=http://<IP-LAN-Windows>:8000 \
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

En la prueba observada el 2026-05-25, Windows tenia IP `192.168.0.5` y WSL
`172.20.119.33`; habia una regla `portproxy` para `8000`, pero la URL LAN no
respondia. No considerar listo un ESP32 fisico hasta que
`http://<IP-LAN-Windows>:8000/ping` funcione desde otro equipo en la misma WiFi.

Health check:

```bash
curl https://api.afcrtecnologia.com/ping
```

Pruebas:

```bash
cd /home/abraham/proyectos/casa-domotica-ia/backend
python3 -B -m unittest -v test_http_polling.py
```

La suite verificada contiene 26 pruebas.

Publicacion por Git:

1. Validar sintaxis y pruebas dentro de `backend/`.
2. Desde el toplevel `/home/abraham/proyectos/casa-domotica-ia`, revisar y hacer commit
   solo de los archivos autorizados.
3. Ejecutar `git push` a `main`; un Pull Request es opcional para cambios que
   requieran revision previa.
4. Confirmar CI y, si cambiaron archivos operativos del backend, el despliegue
   del VPS.

Un push a `main` que cambie archivos operativos de `backend/**` despliega el VPS
automaticamente cuando el Environment `production` tiene sus secretos SSH.

## Reglas operativas

- No commitear `.env`, claves, tokens ni secretos.
- No desplegar ni hacer `git push` mientras las pruebas sigan marcadas como
  locales por el usuario.
- No tratar `devices.db` como codigo fuente.
- No commitear audios recibidos.
- Mantener el contrato MQTT salvo instruccion explicita.
- Antes de cambiar prompts, revisar `sanitize_user_reply()`,
  `build_default_ai_reply()`, `call_openai_intent()`,
  `build_local_ai_prompt()` y `fase_3_interpretar_intencion()`.
- Si se cambia el contrato de `/voice-intent`, actualizar tambien:
  - `frontend/lib/backend-api.ts`
  - `frontend/components/voice-dashboard.tsx`
- La respuesta natural debe estar alineada a la voz del usuario; el JSON debe
  estar alineado a los dispositivos.
- Antes de alterar schema o datos verificar que MCP siga enlazado al proyecto
  autorizado `omkbowrspgbuwpifksfk`.
