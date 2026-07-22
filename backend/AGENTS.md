# AGENTS.md - Backend

Ultima revision: 2026-07-20.

## Contexto

Este directorio es el repo Git desplegable del backend:

```text
/home/abraham/proy_ia_security/backend
```

Remoto:

```text
https://github.com/abraham-development/proy_ia_backend.git
```

Rama activa: `main`.

Ultimo commit operativo conocido: `b.24`.

Backend publico:

```text
https://api.afcrseguridad.com
```

IP AWS:

```text
3.132.192.3
```

## Estado De Trabajo Actual

- El usuario valida en produccion y local segun el caso. No hacer commit, push
  ni actualizar AWS sin autorizacion explicita.
- Produccion objetivo: frontend Hostinger `https://afcrseguridad.com`,
  backend AWS `https://api.afcrseguridad.com` (`3.132.192.3`) y Supabase
  `omkbowrspgbuwpifksfk`.
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
POST /devices/{device_id}/heartbeat
POST /devices/{device_id}/command
GET /device/commands?device_id={device_id}
POST /device/commands/{command_id}/ack
GET /device/commands/{command_id}/status
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
SAVE_DIR = "/home/abraham/proy_ia_security/audios_recibidos"
MQTT_SERVER = os.getenv("MQTT_SERVER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_LUCES = os.getenv("MQTT_TOPIC_LUCES", "casa/esp32/luces")
MQTT_DEVICE_TOPIC_PREFIX = os.getenv("MQTT_DEVICE_TOPIC_PREFIX", "afcr/devices")
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://api.afcrseguridad.com")
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
  usar `https://api.afcrseguridad.com` y TLS validado.

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

## Despliegue AWS Automatizado

- El backend desplegable sigue siendo este repo, remoto `proy_ia_backend`, rama
  `main`; la raiz `proy_ia_security/new1` no activa el deploy backend.
- El workflow objetivo esta en `.github/workflows/deploy-aws.yml` y usa GitHub
  OIDC mas AWS Systems Manager; no debe almacenar `.ppk` ni claves AWS
  permanentes.
- Tras transferir el repo a `abraham-development`, AWS confia en el sujeto
  OIDC inmutable
  `repo:abraham-development@260437753/proy_ia_backend@1227907633:environment:production`.
- La preparacion de EC2, variables GitHub, rol OIDC y SSM se documentan en
  `deploy/README.md`.
- En AWS se confirmo el checkout `/home/ubuntu/proy_ia_backend`, el entorno
  `.venv`, el servicio `proy-ia-backend.service` y Nginx hacia
  `127.0.0.1:8000`.
- `scripts/deploy-ec2.sh` exige `.env` privado ya instalado en EC2, instala las
  dependencias de `requirements.txt` como `ubuntu`, valida, reinicia el
  servicio y prueba `/ping`.
- Los push a `main` despliegan el backend cuando la automatizacion AWS esta
  disponible; hacerlos solo con autorizacion explicita del usuario.

## Comandos

Validar sintaxis:

```bash
cd /home/abraham/proy_ia_security/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
```

Levantar backend:

```bash
cd /home/abraham/proy_ia_security/backend
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
curl https://api.afcrseguridad.com/ping
```

Pruebas:

```bash
cd /home/abraham/proy_ia_security/backend
venv/bin/python test_http_polling.py
```

La suite verificada para `b.24` contiene 25 pruebas.

Deploy por Git:

```bash
cd /home/abraham/proy_ia_security/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
git status --short
git add app_api.py
git commit -m "b.N"
git push
```

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
