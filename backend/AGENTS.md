# AGENTS.md - Backend

Ultima revision: 2026-05-12.

## Contexto

Este directorio es el repo Git desplegable del backend:

```text
/home/abraham/proy_ia_security/backend
```

Remoto:

```text
https://github.com/time45120-ctrl/proy_ia_backend.git
```

Rama activa: `main`.

Ultimo commit operativo conocido: `b1.6`.

Backend publico:

```text
https://api.afcrseguridad.com
```

IP AWS:

```text
3.132.192.3
```

## Archivo principal

```text
app_api.py
```

Responsabilidades:

- FastAPI publica endpoints HTTP.
- Carga `backend/.env` si `python-dotenv` esta disponible.
- Configura CORS para frontend publico y desarrollo local.
- Inicializa OpenAI si `AI_PROVIDER=openai`.
- Inicializa Whisper local solo como respaldo cuando no se usa OpenAI.
- Inicializa MQTT con `paho-mqtt`.
- Gestiona SQLite de dispositivos enlazados.
- Recibe audio, lo guarda en `audios_recibidos/`, transcribe e interpreta.
- Genera plan pendiente de confirmacion.
- Publica MQTT para luces solo despues de confirmacion.
- Gestiona pairing/claim/heartbeat/comandos de ESP32.

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
```

`POST /voice-intent` no ejecuta hardware. Devuelve preview/plan. La ejecucion
fisica ocurre solo en `/voice-intent/confirm`.

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
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "700"))
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.45"))
AI_RESPONSE_STYLE = os.getenv("AI_RESPONSE_STYLE", "natural, claro, cercano y con criterio tecnico")
LOCAL_AI_MODEL = os.getenv("LOCAL_AI_MODEL", "qwen2:7b-instruct-q4_0")
VOICE_PLAN_TTL_SECONDS = int(os.getenv("VOICE_PLAN_TTL_SECONDS", "300"))
```

No tocar `backend/.env` ni claves reales salvo peticion explicita del usuario.

## MQTT

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

Health check:

```bash
curl https://api.afcrseguridad.com/ping
```

Deploy por Git:

```bash
cd /home/abraham/proy_ia_security/backend
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('app_api.py').read_text()); print('app_api.py syntax OK')"
git status --short
git add app_api.py
git commit -m "b1.N"
git push
```

## Reglas operativas

- No commitear `.env`, claves, tokens ni secretos.
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

