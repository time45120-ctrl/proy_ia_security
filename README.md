# proy_ia_security

Sistema de asistente de voz IoT para laboratorio local. El flujo actual captura
audio desde el dashboard, lo envia a un backend FastAPI, transcribe con Whisper,
interpreta la intencion con OpenAI u Ollama y publica comandos MQTT para luces
por ambiente.

La fuente activa del proyecto es la carpeta raiz:

```text
/home/abraham/proy_ia_security
```

La copia legacy anidada `proy_ia_security/` fue eliminada. La unica fuente
valida del proyecto es esta raiz.

## Estado actual

- Frontend Next.js en `frontend/`
- Backend FastAPI en `backend/app_api.py`
- Frontend desplegado en Hostinger: `https://afcrseguridad.com`
- Backend desplegado en AWS: `3.132.192.3`
- API publica: `https://api.afcrseguridad.com`
- DNS Hostinger: `api.afcrseguridad.com` apunta a `3.132.192.3`
- Endpoint de salud: `GET /ping`
- Endpoint principal: `POST /voice-intent`
- Broker MQTT esperado en `127.0.0.1:1883` desde el backend
- Topic MQTT activo: `casa/esp32/luces`
- Payload MQTT activo:

```json
{
  "espacio": "cocina",
  "accion": "ON"
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

## Arquitectura

```text
Android o desktop browser
   |
   | HTTP -> NEXT_PUBLIC_API_BASE_URL
   v
Frontend Next.js
   |
   | GET /ping
   | POST /voice-intent multipart/form-data audio=<archivo>
   v
Backend FastAPI (backend/app_api.py)
   |
   +-- guarda audio en audios_recibidos/
   +-- Whisper tiny -> texto
   +-- OpenAI u Ollama -> JSON de intencion
   `-- MQTT -> casa/esp32/luces
          |
          v
       ESP32 suscrito a casa/esp32/luces
```

En el laboratorio, si FastAPI y Mosquitto corren dentro de WSL, Windows puede
exponerlos hacia la LAN con `portproxy`:

```text
<IP-LAN-Windows>:8000 -> WSL:<IP-interna-actual>:8000
<IP-LAN-Windows>:1883 -> WSL:<IP-interna-actual>:1883
```

La IP interna de WSL puede cambiar despues de reiniciar WSL o Windows. Si eso
ocurre, actualizar las reglas de `portproxy` y revisar el firewall de Windows.

## Frontend

El frontend usa `NEXT_PUBLIC_API_BASE_URL` para decidir donde esta FastAPI.
`frontend/.env.local` manda sobre el valor default compilado en el codigo.

Pruebas locales/LAN:

```bash
NEXT_PUBLIC_API_BASE_URL=http://192.168.0.220:8000
```

Produccion en Hostinger:

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com
```

No subir `frontend/.env.local` al repo. Para produccion, configurar la variable
en Hostinger antes de compilar/desplegar el frontend.

Comandos:

```bash
cd frontend
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000
```

El dashboard muestra:

- conectividad con `GET /ping`
- transcripcion devuelta por `fase_2_transcripcion.texto_transcrito`
- intencion, detalle, ambiente y accion desde `fase_3_ia_json.ia_json`
- resultado MQTT desde `fase_4_mqtt`
- respuesta completa del backend para trazabilidad

## Backend

Archivo principal:

```text
backend/app_api.py
```

Configuracion relevante:

```python
MQTT_SERVER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC_LUCES = "casa/esp32/luces"
CORS_ALLOW_ORIGINS = [...]
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
LOCAL_AI_MODEL = os.getenv("LOCAL_AI_MODEL", "qwen2:7b-instruct-q4_0")
```

`AI_PROVIDER` acepta:

- `openai`: usa la API de OpenAI y requiere `OPENAI_API_KEY`
- `local`: usa Ollama con `LOCAL_AI_MODEL`

El backend carga variables locales desde `backend/.env`. Ese archivo no debe
subirse a git; usa `backend/.env.example` como plantilla. `frontend/.env.local`
es solo para variables del frontend como `NEXT_PUBLIC_API_BASE_URL`; no pongas
secretos ahi porque cualquier variable `NEXT_PUBLIC_*` llega al navegador.

El CORS del backend se configura con `CORS_ALLOW_ORIGINS`, separado por comas.
Por defecto permite produccion y desarrollo local:

```bash
CORS_ALLOW_ORIGINS=https://afcrseguridad.com,https://www.afcrseguridad.com,http://localhost:3000,http://127.0.0.1:3000
```

El frontend publico usa HTTPS, asi que la API publica tambien debe responder por
HTTPS en `https://api.afcrseguridad.com` para evitar bloqueo por contenido mixto.

La parte quirurgica esta en esta linea:

```python
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()
```

Con eso eliges si la Fase 3 trabaja con OpenAI API o con IA local sin tocar el
resto del backend.

Para usar OpenAI API:

```bash
cd /home/abraham/proy_ia_security/backend
cp .env.example .env
# Editar backend/.env y poner la API key real solo ahi.
#
# AI_PROVIDER=openai
# OPENAI_API_KEY=TU_API_KEY
# OPENAI_MODEL=gpt-4o-mini
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

Levantar backend:

```bash
cd /home/abraham/proy_ia_security/backend
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

Respuesta tipica de `POST /voice-intent`:

```json
{
  "ok": true,
  "ai_provider": "openai",
  "fase_1_audio_guardado": {
    "filename": "20260425-153045_audio.webm",
    "saved_path": "/home/abraham/proy_ia_security/audios_recibidos/20260425-153045_audio.webm",
    "content_type": "audio/webm"
  },
  "fase_2_transcripcion": {
    "texto_transcrito": "prende la luz de la cocina"
  },
  "fase_3_ia_json": {
    "ia_raw": "{\"texto\":\"prende la luz de la cocina\",\"intencion\":\"control_luces\",\"detalle\":\"encender luz de cocina\",\"espacio\":\"cocina\",\"accion\":\"ON\"}",
    "ia_json_raw": {
      "texto": "prende la luz de la cocina",
      "intencion": "control_luces",
      "detalle": "encender luz de cocina",
      "espacio": "cocina",
      "accion": "ON"
    },
    "ia_json": {
      "texto": "prende la luz de la cocina",
      "intencion": "control_luces",
      "detalle": "encender luz de cocina",
      "espacio": "cocina",
      "accion": "ON"
    }
  },
  "fase_4_mqtt": {
    "accion_mqtt": "MQTT_ON_cocina_OK",
    "mqtt_topic": "casa/esp32/luces",
    "mqtt_payload": {
      "espacio": "cocina",
      "accion": "ON"
    }
  }
}
```

Valores relevantes de `fase_4_mqtt.accion_mqtt`:

- `MQTT_ON_<espacio>_OK`
- `MQTT_ON_<espacio>_ERROR`
- `MQTT_OFF_<espacio>_OK`
- `MQTT_OFF_<espacio>_ERROR`
- `SIN_ACCION`
- `ESPACIO_DESCONOCIDO`
- `ACCION_DESCONOCIDA`
- `SIN_JSON`

## ESP32

El ESP32 debe conectarse al broker MQTT expuesto en la LAN y suscribirse a:

```text
casa/esp32/luces
```

El sketch debe parsear JSON y aplicar la accion al ambiente recibido:

```json
{
  "espacio": "sala",
  "accion": "OFF"
}
```

El backend no publica topics separados por LED simple o RGB en el contrato nuevo.

## Comandos de voz esperados

| Frase del usuario | Intencion | Espacio | Accion | Topic |
|---|---|---|---|---|
| `prende la luz de la sala` | `control_luces` | `sala` | `ON` | `casa/esp32/luces` |
| `enciende la luz del comedor` | `control_luces` | `comedor` | `ON` | `casa/esp32/luces` |
| `apaga la luz de la cocina` | `control_luces` | `cocina` | `OFF` | `casa/esp32/luces` |
| `apaga cuarto principal` | `control_luces` | `cuarto_principal` | `OFF` | `casa/esp32/luces` |

Si falta ambiente o accion, el backend no publica un comando fisico y devuelve
un estado como `ESPACIO_DESCONOCIDO`, `ACCION_DESCONOCIDA` o `SIN_ACCION`.

## Verificacion

Backend:

```bash
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('backend/app_api.py').read_text()); print('backend/app_api.py syntax OK')"
```

Frontend:

```bash
cd frontend
npm run build
```

Health check:

```bash
curl http://localhost:8000/ping
```

Prueba funcional manual:

1. Levantar Mosquitto y confirmar que escucha en `1883`.
2. Levantar FastAPI en `0.0.0.0:8000`.
3. Levantar el frontend.
4. Pulsar `Probar API`.
5. Enviar un audio diciendo `prende la luz de la cocina`.
6. Confirmar en la UI que aparecen transcripcion, ambiente `cocina`, accion `ON`,
   topic `casa/esp32/luces` y payload JSON.
7. Repetir con `apaga la luz de la sala`.
8. Verificar desde el ESP32 o un cliente MQTT que el mensaje llega al topic.

## Troubleshooting rapido

### El frontend no llega al backend

Revisar:

1. Que `uvicorn` este corriendo en `0.0.0.0:8000`.
2. Que `frontend/.env.local` tenga la IP LAN correcta.
3. Que `portproxy` de Windows para `8000` apunte a la IP actual de WSL.
4. Que el firewall de Windows permita `8000`.

En produccion:

1. Que Hostinger tenga `NEXT_PUBLIC_API_BASE_URL=https://api.afcrseguridad.com`.
2. Que `api.afcrseguridad.com` resuelva hacia `3.132.192.3`.
3. Que AWS permita trafico entrante hacia HTTPS o el puerto publicado.
4. Que el backend o reverse proxy responda en `https://api.afcrseguridad.com/ping`.
5. Que `CORS_ALLOW_ORIGINS` incluya `https://afcrseguridad.com` y
   `https://www.afcrseguridad.com`.

### El ESP32 no conecta al broker

Revisar:

1. Que `mosquitto` este corriendo.
2. Que escuche en `0.0.0.0:1883` si debe recibir conexiones externas.
3. Que `portproxy` de Windows para `1883` apunte a la IP actual de WSL.
4. Que el firewall de Windows permita `1883`.
5. Que el ESP32 use la IP LAN de Windows como broker, no la IP interna de WSL.

### Despues de reiniciar Windows o WSL algo dejo de funcionar

La primera sospecha debe ser la IP interna de WSL. Si cambio, actualizar
`portproxy` para `8000` y `1883`, reiniciar servicios si hace falta y validar
otra vez `GET /ping` y MQTT.

## Dependencias

No hay todavia un manifiesto Python (`requirements.txt` o `pyproject.toml`) en
la raiz activa, asi que las dependencias del backend siguen siendo instalacion
manual.

Backend:

```bash
pip install fastapi uvicorn openai python-dotenv whisper-timestamped paho-mqtt python-multipart
```

Si se usa Ollama:

```bash
ollama pull qwen2:7b-instruct-q4_0
```

Frontend:

```bash
cd frontend
npm install
```

## Estructura principal

```text
proy_ia_security/
├── backend/
│   └── app_api.py
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── package.json
│   └── tailwind.config.ts
├── audios_recibidos/
└── README.md
```
