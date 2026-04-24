# proy_ia_security

Sistema de asistente de voz IoT para laboratorio local. El flujo actual captura audio desde un navegador Android, lo envía a un backend FastAPI que corre en WSL, transcribe con Whisper, analiza intención y estado de ánimo con Qwen2 vía Ollama, y publica comandos MQTT que un ESP32 consume para controlar un LED simple y un LED RGB.

Este README documenta el estado real probado del proyecto para que sea fácil retomarlo sin reconstruir la topología desde cero.

## Estado actual validado

- Frontend móvil apuntando a `http://192.168.0.2:8000`
- Backend FastAPI ejecutándose en WSL
- Ollama ejecutándose en WSL con `qwen2:7b-instruct-q4_0`
- Mosquitto ejecutándose en WSL
- ESP32 conectado al broker MQTT a través de Windows `portproxy`
- Topics confirmados:
  - `casa/esp32/led`
  - `casa/esp32/rgb`

## Arquitectura real del laboratorio

```text
Android Browser
   |
   | HTTP -> 192.168.0.2:8000
   v
Windows host
   |
   | portproxy -> WSL:<IP-interna-actual>:8000
   v
WSL
   |
   +-- FastAPI (backend/app_api.py)
   |     |
   |     +-- Whisper tiny
   |     +-- Ollama + qwen2:7b-instruct-q4_0
   |     `-- paho-mqtt
   |
   `-- Mosquitto -> 127.0.0.1:1883 para backend

ESP32
   |
   | MQTT -> 192.168.0.2:1883
   v
Windows host
   |
   | portproxy -> WSL:<IP-interna-actual>:1883
   v
Mosquitto en WSL
```

## Topología de red actual

### Roles por equipo

- `Windows` expone la IP LAN `192.168.0.2`
- `WSL` corre el backend, Ollama y Mosquitto
- `Android` consume la API por HTTP usando la IP de Windows
- `ESP32` consume MQTT usando la IP de Windows

### Port forwarding usado

En Windows se está usando `netsh interface portproxy` para reenviar tráfico hacia WSL. El patrón actual es:

```text
192.168.0.2:8000 -> WSL:<IP-actual>:8000
192.168.0.2:1883 -> WSL:<IP-actual>:1883
```

En una prueba previa también existió una regla para `80`, pero el flujo actual del proyecto usa `8000` para HTTP y `1883` para MQTT.

### Importante sobre la IP de WSL

La IP interna de WSL puede cambiar después de reiniciar WSL o Windows. Si eso ocurre, hay que:

1. Obtener la IP actual de WSL.
2. Actualizar `portproxy` en Windows para `8000` y `1883`.
3. Verificar que el firewall de Windows permita ambos puertos.

## Componentes del proyecto

### Frontend

Carpeta: [frontend](/home/abraham/proy_ia_security/frontend)

- Migrado a `Next.js` con `App Router`
- Escrito en `TypeScript`
- Estilizado con `Tailwind CSS`
- Mantiene la integración real con:
  - `GET /ping` para validar conectividad
  - `POST /voice-intent` para enviar el audio
- Propone un dashboard domotico escalable con:
  - un nucleo central de IA por voz
  - visualizacion de `Luces conectadas`
  - visualizacion de `Puertas conectadas`
  - visualizacion de `Camaras conectadas`

Configuración del frontend:

```bash
NEXT_PUBLIC_API_BASE_URL=http://192.168.0.220:8000
```

Uso recomendado en desarrollo local:

1. Copiar [frontend/.env.example](/home/abraham/proy_ia_security/frontend/.env.example:1) a `frontend/.env.local`
2. Ajustar `NEXT_PUBLIC_API_BASE_URL` a la IP LAN real del host que expone FastAPI
3. Levantar el frontend y abrir el dashboard desde desktop o Android en la misma red

### Backend

Archivo: [backend/app_api.py](/home/abraham/proy_ia_security/backend/app_api.py:1)

Responsabilidades:

- Recibir audio por `multipart/form-data`
- Guardar el archivo en `audios_recibidos/`
- Transcribir con Whisper `tiny`
- Enviar el texto a `ollama run qwen2:7b-instruct-q4_0`
- Extraer JSON de la respuesta del modelo
- Publicar acciones MQTT para LED y RGB
- Responder JSON con trazabilidad del flujo

Configuración actual relevante:

```python
MQTT_SERVER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC_LED = "casa/esp32/led"
MQTT_TOPIC_RGB = "casa/esp32/rgb"
```

Esto es correcto porque el backend corre en WSL y Mosquitto también corre en WSL.

### Broker MQTT

Servicio: `mosquitto` en WSL

Configuración clave validada:

```conf
listener 1883 0.0.0.0
allow_anonymous true
```

Esto permite que:

- el backend use `127.0.0.1:1883`
- Windows `portproxy` pueda reenviar conexiones externas hacia WSL
- el ESP32 llegue al broker entrando por `192.168.0.2:1883`

### ESP32

El sketch del ESP32 no vive todavía dentro de este repo, pero el comportamiento esperado ya está definido y probado.

Configuración relevante del ESP32:

```cpp
const char* mqtt_server = "192.168.0.2";
```

Topics suscritos:

- `casa/esp32/led`
- `casa/esp32/rgb`

Payloads esperados:

- LED simple:
  - `ON`
  - `OFF`
- RGB:
  - `HAPPY`
  - `SAD`
  - `NEUTRAL`

## Flujo funcional

1. El usuario abre el frontend en Android.
2. El frontend prueba conectividad con `GET /ping`.
3. El usuario graba audio.
4. El frontend envía el archivo a `POST /voice-intent`.
5. El backend guarda el audio en `audios_recibidos/`.
6. Whisper transcribe el audio.
7. Qwen2 analiza intención y estado de ánimo.
8. El backend traduce la salida del modelo a comandos MQTT.
9. Mosquitto distribuye el mensaje al ESP32.
10. El ESP32 cambia el LED simple o el RGB según el topic y payload recibidos.

## Comandos de voz esperados

### LED simple

| Frase del usuario | Acción lógica | Topic | Payload |
|---|---|---|---|
| `prende la luz` | encender LED | `casa/esp32/led` | `ON` |
| `enciende el led` | encender LED | `casa/esp32/led` | `ON` |
| `apaga la luz` | apagar LED | `casa/esp32/led` | `OFF` |
| `apaga el led` | apagar LED | `casa/esp32/led` | `OFF` |

### Estado de ánimo

| Frase del usuario | Estado detectado | Topic | Payload |
|---|---|---|---|
| `me siento alegre` | alegre | `casa/esp32/rgb` | `HAPPY` |
| `estoy feliz` | alegre | `casa/esp32/rgb` | `HAPPY` |
| `me siento triste` | triste | `casa/esp32/rgb` | `SAD` |
| `estoy desanimado` | triste | `casa/esp32/rgb` | `SAD` |
| sin emoción clara | neutral/desconocido | `casa/esp32/rgb` | `NEUTRAL` o sin acción |

## Endpoints actuales

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/ping` | Prueba rápida de conectividad |
| `POST` | `/voice-intent` | Procesa audio, llama al modelo y publica acciones MQTT |

### Respuesta típica de `POST /voice-intent`

```json
{
  "ok": true,
  "filename": "20250331-153045_audio.webm",
  "saved_path": "/home/abraham/proy_ia_security/audios_recibidos/20250331-153045_audio.webm",
  "content_type": "audio/webm",
  "texto_transcrito": "prende la luz, me siento alegre",
  "ia_raw": "{ ... respuesta completa de Qwen2 ... }",
  "ia_json": {
    "texto": "prende la luz, me siento alegre",
    "intencion": "encender iluminación",
    "detalle": "El usuario quiere encender el LED y expresa alegría",
    "siguiente_paso_led": "encender_led",
    "estado_animo": "alegre",
    "siguiente_paso_rgb": "rgb_alegre"
  },
  "accion_mqtt_led": "LED_ON_OK",
  "accion_mqtt_rgb": "RGB_ALEGRE_OK"
}
```

### Valores importantes del backend

`accion_mqtt_led`

- `LED_ON_OK`
- `LED_ON_ERROR`
- `LED_OFF_OK`
- `LED_OFF_ERROR`
- `SIN_ACCION_LED`
- `SIN_JSON`

`accion_mqtt_rgb`

- `RGB_ALEGRE_OK`
- `RGB_ALEGRE_ERROR`
- `RGB_TRISTE_OK`
- `RGB_TRISTE_ERROR`
- `RGB_NEUTRAL_OK`
- `RGB_NEUTRAL_ERROR`
- `SIN_ACCION_RGB`
- `SIN_JSON`

## Cómo ejecutar el entorno actual

### 1. Activar el entorno virtual

```bash
cd /home/abraham/proy_ia_security
source venv/bin/activate
```

### 2. Verificar que Mosquitto esté activo en WSL

```bash
ps -ef | grep mosquitto
sudo ss -ltnp | grep 1883
```

Debe aparecer escuchando en `0.0.0.0:1883` o equivalente, no solo en `127.0.0.1:1883`.

### 3. Levantar el backend

```bash
cd backend
uvicorn app_api:app --host 0.0.0.0 --port 8000
```

### 4. Levantar el frontend nuevo

```bash
cd frontend
npm install
npm run dev
```

Crear un archivo `.env.local` dentro de `frontend/` con:

```bash
NEXT_PUBLIC_API_BASE_URL=http://192.168.0.220:8000
```

Luego abrir el dashboard en:

```text
http://localhost:3000
```

### 5. Verificar conectividad desde Android o desktop

Desde el dashboard, usar el boton `Probar API` o pulsar el nucleo de voz para enviar audio al backend actual.

### 6. Verificar conectividad MQTT del ESP32

El ESP32 debe conectarse al broker con:

```cpp
const char* mqtt_server = "192.168.0.2";
```

Si todo está bien, dejará de mostrar errores `rc=-2` y se conectará al broker.

## Problema real ya encontrado y resuelto

### Síntoma

El ESP32 mostraba repetidamente:

```text
Intentando conectar MQTT...falló, rc=-2
```

### Causa real

Mosquitto estaba corriendo en WSL, pero el servicio seguía escuchando solo en localhost o no había recargado correctamente la configuración. El backend local podía hablar con el broker, pero el tráfico reenviado desde Windows no lograba entrar.

### Solución aplicada

1. Confirmar que existía una configuración válida en WSL:

```conf
listener 1883 0.0.0.0
allow_anonymous true
```

2. Reiniciar `mosquitto` con permisos `sudo`:

```bash
sudo systemctl restart mosquitto
```

3. Verificar nuevamente el listener:

```bash
sudo ss -ltnp | grep 1883
```

4. Reprobar el ESP32.

Resultado: el ESP32 quedó conectado correctamente.

## Troubleshooting rápido

### El ESP32 no conecta al broker

Revisar en este orden:

1. Que `mosquitto` esté corriendo en WSL.
2. Que esté escuchando en `0.0.0.0:1883`.
3. Que Windows siga teniendo `portproxy` hacia la IP actual de WSL.
4. Que el firewall de Windows permita `1883`.
5. Que el ESP32 siga usando `192.168.0.2` como broker MQTT.

### El frontend no llega al backend

Revisar:

1. Que `uvicorn` esté corriendo en `0.0.0.0:8000`.
2. Que la IP LAN de Windows siga siendo `192.168.0.2`.
3. Que `portproxy` de Windows para `8000` siga apuntando a la IP actual de WSL.
4. Que el firewall de Windows permita `8000`.
5. Que `frontend/.env.local` siga apuntando a la IP correcta del backend.

### Después de reiniciar Windows o WSL algo dejó de funcionar

La primera sospecha debe ser la IP interna de WSL. Si cambió, actualizar `portproxy` y luego volver a validar backend y MQTT.

## Estructura actual del repo

```text
proy_ia_security/
├── backend/
│   └── app_api.py
├── frontend/
│   ├── app/
│   ├── components/
│   ├── package.json
│   └── tailwind.config.ts
├── audios_recibidos/
├── venv/
└── README.md
```

## Dependencias usadas hoy

- Python 3.12
- Node.js
- npm
- FastAPI
- Uvicorn
- `whisper-timestamped`
- `paho-mqtt`
- `python-multipart`
- Ollama
- modelo `qwen2:7b-instruct-q4_0`
- Mosquitto

Instalación manual actual del backend:

```bash
pip install fastapi uvicorn openai-whisper whisper-timestamped paho-mqtt python-multipart
```

Instalación del frontend:

```bash
cd frontend
npm install
```

## Notas para retomarlo rápido

- El frontend y el ESP32 no deben apuntar a la IP interna de WSL; deben apuntar a la IP LAN de Windows.
- El backend sí debe seguir apuntando a `127.0.0.1` para MQTT mientras Mosquitto corra dentro de WSL.
- El punto más frágil de esta topología es `WSL IP + portproxy + restart de mosquitto`.
- Si el ESP32 falla con `rc=-2`, casi siempre el problema es de reachability TCP hacia `192.168.0.2:1883`, no de lógica en el sketch.
- El dashboard nuevo ya deja lista una base visual para crecer hacia estados reales de luces, puertas y camaras sin rehacer la UI desde cero.
