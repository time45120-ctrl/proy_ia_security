# proy_ia_security

Sistema de asistente de voz IoT para laboratorio. El flujo captura audio desde
el dashboard, lo envia a FastAPI, interpreta la intencion con IA y, despues de
confirmacion humana, entrega comandos a un ESP32 real mediante polling HTTPS y
ACK. MQTT se conserva para dispositivos legacy.

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
- Endpoint ESP32: `GET /device/commands?device_id=...`
- Confirmacion ESP32: `POST /device/commands/{command_id}/ack`
- Broker MQTT esperado en `127.0.0.1:1883` desde el backend
- Topic MQTT legacy: `casa/esp32/luces`
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
   +-- confirmacion UI -> cola SQLite device_commands
   `-- GET HTTPS autenticado <- ESP32
          |
          +-- GPIO 2 LED
          `-- POST ACK -> dashboard muestra ejecucion
```

Luces legacy sin ESP32 HTTP asignado conservan la ruta MQTT.

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
- entrega HTTPS del ESP32 y estado `queued/delivered/executed/failed/expired`,
  o resultado MQTT para dispositivos legacy
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
DEVICE_COMMAND_TTL_SECONDS = 300
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

Despues de `POST /voice-intent`, el usuario confirma el plan. Si hay un ESP32
asignado al ambiente, `POST /voice-intent/confirm` encola la orden:

```json
{
  "ok": true,
  "queued": true,
  "executed": false,
  "delivery": {
    "transport": "http_polling",
    "command_id": "cmd_...",
    "device_id": "esp32-luz-cocina-...",
    "target": "led",
    "action": "turn_on",
    "espacio": "cocina",
    "status": "queued",
    "expires_at": "..."
  }
}
```

Estados visibles de entrega HTTPS:

- `queued`: confirmado y esperando una consulta del ESP32.
- `delivered`: el ESP32 recibio el JSON y aun debe confirmar.
- `executed`: el LED fue actualizado y confirmado.
- `failed`: el ESP32 informo que no ejecuto la orden.
- `expired`: no se ejecuto dentro de la ventana de 300 segundos.

## ESP32

El flujo legacy de laboratorio usa un broker MQTT expuesto en la LAN y el topic:

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

Para enlace real desde el frontend publico HTTPS, el flujo ESP32 usa pairing y
polling autenticado:

1. Frontend crea un token con `POST /devices/pairing-token`.
2. ESP32 crea un AP temporal, por ejemplo `AFCR-ESP32-XXXX`.
3. Usuario abre `http://192.168.4.1` y escribe SSID, password, API URL y token.
4. ESP32 llama `POST /devices/claim` contra `https://api.afcrseguridad.com`.
5. Backend guarda el dispositivo en SQLite y entrega una `device_api_key` una
   sola vez; en base solo persiste su hash.
6. Al confirmar un comando, el backend lo guarda en `device_commands`.
7. ESP32 consulta `GET /device/commands?device_id=...` con bearer token,
   ejecuta su LED GPIO 2 y envia `POST /device/commands/{id}/ack`.

El backend no recibe ni guarda la contraseña WiFi. Esa clave solo se escribe en
el portal local del ESP32.

Endpoints nuevos:

```text
POST /devices/pairing-token
POST /devices/claim
GET /devices
POST /devices/{device_id}/command
POST /devices/{device_id}/heartbeat
GET /device/commands?device_id={device_id}
POST /device/commands/{command_id}/ack
GET /device/commands/{command_id}/status
```

Firmware base:

```text
firmware/esp32_pairing_portal/esp32_pairing_portal.ino
```

El firmware ESP32 incluido valida `https://api.afcrseguridad.com` con
`ISRG Root X1`, la raiz de la cadena Let's Encrypt actualmente publicada. MQTT
queda como transporte legacy configurable mediante:

```bash
MQTT_SERVER=mqtt.afcrseguridad.com
MQTT_PORT=8883
MQTT_TLS=true
MQTT_USERNAME=...
MQTT_PASSWORD=...
MQTT_DEVICE_TOPIC_PREFIX=afcr/devices
PUBLIC_API_URL=https://api.afcrseguridad.com
```

## Comandos de voz esperados

| Frase del usuario | Espacio | Accion IA | Payload ESP32 |
|---|---|---|---|
| `prende la luz de la sala` | `sala` | `ON` | `led / turn_on` |
| `enciende la luz del comedor` | `comedor` | `ON` | `led / turn_on` |
| `apaga la luz de la cocina` | `cocina` | `OFF` | `led / turn_off` |
| `apaga cuarto principal` | `cuarto_principal` | `OFF` | `led / turn_off` |

Si no hay ESP32 HTTP asignado al ambiente, la ruta MQTT legacy continua
disponible para luces ya conectadas.

## Verificacion

Backend:

```bash
python3 -c "import ast, pathlib; ast.parse(pathlib.Path('backend/app_api.py').read_text()); print('backend/app_api.py syntax OK')"
cd backend
python3 -m unittest -v test_http_polling.py
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

1. Flashear `firmware/esp32_pairing_portal/esp32_pairing_portal.ino`.
2. En Sincronizacion elegir `ESP32`, ambiente `cocina` y crear el enlace.
3. Conectarse a `AFCR-ESP32-XXXX`, abrir `http://192.168.4.1` e introducir
   WiFi, API URL y pairing token.
4. Esperar que el inventario de la web muestre el ESP32 `Online`.
5. Enviar voz diciendo `prende la luz de la cocina` y confirmar el plan.
6. Verificar LED encendido y estado `LED ejecutado y confirmado por el ESP32`.
7. Repetir con apagado; desconectar mas de 300 segundos para comprobar
   expiracion sin ejecucion tardia.

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

### El ESP32 no recibe comandos HTTPS

Revisar:

1. Que el token siga vigente al reclamarlo.
2. Que el ESP32 haya guardado `device_id` y `device_api_key` durante el claim.
3. Que tenga salida HTTPS hacia `api.afcrseguridad.com`.
4. Que la cadena TLS publica siga siendo valida para `ISRG Root X1`.
5. Que el equipo se haya asignado al mismo ambiente dicho por voz.

### Un dispositivo legacy no conecta al broker MQTT

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
