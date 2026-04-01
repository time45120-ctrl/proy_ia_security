# Asistente de Voz IoT con Qwen2

Sistema de asistente de voz inteligente que captura audio desde un navegador móvil, transcribe la voz con Whisper, analiza la intención con el modelo de IA **Qwen2 7B**, y ejecuta acciones físicas en un ESP32 (LED y LED RGB) via MQTT.

---

## Arquitectura

```
Usuario (Android/Browser)
        │  voz grabada
        ▼
  [Frontend - index.html]
        │  POST /voice-intent (multipart/form-data)
        ▼
  [Backend - FastAPI app_api.py]
        ├── Whisper (tiny)  →  transcribe audio a texto
        ├── Qwen2 7B Instruct (Ollama)  →  analiza intención y ánimo
        └── paho-mqtt  →  publica comandos al broker MQTT
                                │
                                ▼
                        [ESP32 - Hardware IoT]
                         ├── LED simple   (casa/esp32/led)
                         └── LED RGB      (casa/esp32/rgb)
```

---

## Requisitos Previos

### Software en el servidor (Ubuntu)

| Requisito | Instalación |
|-----------|-------------|
| Python 3.12+ | `sudo apt install python3.12` |
| Ollama | [ollama.com/download](https://ollama.com/download) |
| Modelo Qwen2 | `ollama pull qwen2:7b-instruct-q4_0` |
| Broker MQTT (Mosquitto) | `sudo apt install mosquitto mosquitto-clients` |

### Hardware requerido
- ESP32 conectado al mismo broker MQTT
- LED en pin GPIO del ESP32 suscrito al topic `casa/esp32/led`
- LED RGB suscrito al topic `casa/esp32/rgb`

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone <url-del-repositorio>
cd proy_ia_security

# 2. Crear entorno virtual
python3 -m venv venv
source venv/bin/activate

# 3. Instalar dependencias
pip install fastapi uvicorn openai-whisper whisper-timestamped paho-mqtt python-multipart
```

---

## Configuración

Antes de ejecutar, ajusta las siguientes variables en `backend/app_api.py`:

```python
# IP del broker MQTT (tu servidor Ubuntu)
MQTT_SERVER = "192.168.0.12"
MQTT_PORT   = 1883
```

Y en `frontend/index.html`:

```javascript
// IP del servidor donde corre el backend
const HOST = "http://172.20.119.33";
```

> Reemplaza las IPs con las de tu red local.

### Modelo Whisper

El modelo por defecto es `"tiny"` (más rápido, menos preciso). Puedes cambiarlo en `app_api.py`:

```python
whisper_model = load_model("tiny")   # opciones: tiny | base | small | medium | large
```

---

## Cómo Ejecutar

```bash
# Activar entorno virtual
source venv/bin/activate

# Iniciar el backend (desde la raíz del proyecto)
cd backend
uvicorn app_api:app --host 0.0.0.0 --port 80
```

El servidor queda disponible en `http://<IP-DEL-SERVIDOR>/`.

---

## Uso

1. Abre el navegador en tu Android y ve a `http://<IP-DEL-SERVIDOR>/`
2. Presiona **"Probar conexión"** para verificar que el servidor responde
3. Presiona **"Grabar y enviar"** para abrir la grabadora nativa
4. Graba un comando de voz (ejemplos abajo)
5. Guarda la grabación — se envía automáticamente al servidor
6. La respuesta JSON aparece en pantalla con la transcripción y las acciones ejecutadas

---

## Comandos de Voz Disponibles

### Control de LED

| Ejemplo de frase | Acción ejecutada |
|-----------------|-----------------|
| "Prende la luz" / "Enciende el led" | LED encendido → MQTT: `ON` |
| "Apaga la luz" / "Apaga el led" | LED apagado → MQTT: `OFF` |

### Estado de Ánimo (RGB)

| Ejemplo de frase | Color RGB | MQTT payload |
|-----------------|-----------|-------------|
| "Me siento alegre" / "Estoy feliz" | Color alegre | `HAPPY` |
| "Me siento triste" / "Estoy desanimado" | Color triste | `SAD` |
| Sin expresión de ánimo | Color neutro | `NEUTRAL` |

---

## Endpoints de la API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Health check — `{"ok": true, "message": "API viva"}` |
| `GET` | `/ping` | Prueba de conexión — `{"pong": true}` |
| `POST` | `/voice-intent` | Procesa audio y ejecuta acciones IoT |

### Respuesta de `POST /voice-intent`

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

### Valores posibles de `accion_mqtt_led`

| Valor | Significado |
|-------|-------------|
| `LED_ON_OK` | LED encendido exitosamente |
| `LED_ON_ERROR` | Error al encender el LED |
| `LED_OFF_OK` | LED apagado exitosamente |
| `LED_OFF_ERROR` | Error al apagar el LED |
| `SIN_ACCION_LED` | No se detectó comando de LED |
| `SIN_JSON` | Qwen2 no retornó JSON válido |

### Valores posibles de `accion_mqtt_rgb`

| Valor | Significado |
|-------|-------------|
| `RGB_ALEGRE_OK` | RGB configurado a modo alegre |
| `RGB_TRISTE_OK` | RGB configurado a modo triste |
| `RGB_NEUTRAL_OK` | RGB configurado a modo neutro |
| `*_ERROR` | Error al publicar en MQTT |
| `SIN_ACCION_RGB` | No se detectó estado de ánimo |
| `SIN_JSON` | Qwen2 no retornó JSON válido |

---

## Estructura del Proyecto

```
proy_ia_security/
├── backend/
│   └── app_api.py          # API principal (FastAPI + Whisper + Qwen2 + MQTT)
├── frontend/
│   └── index.html          # Interfaz web para Android
├── audios_recibidos/       # Audios guardados automáticamente (formato: YYYYMMDD-HHMMSS_nombre)
├── venv/                   # Entorno virtual Python (no versionar)
└── README.md
```

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML5 + JavaScript (Vanilla, XHR, File API) |
| Backend | Python 3.12 + FastAPI + Uvicorn |
| Transcripción de voz | OpenAI Whisper (local, modelo tiny) |
| IA / LLM | Qwen2 7B Instruct Q4 via Ollama |
| Comunicación IoT | paho-mqtt → MQTT Broker (Mosquitto) → ESP32 |
| Aceleración | PyTorch + CUDA (GPU NVIDIA, opcional) |

---

## Topics MQTT

| Topic | Payloads posibles | Descripción |
|-------|-------------------|-------------|
| `casa/esp32/led` | `ON` / `OFF` | Control del LED simple |
| `casa/esp32/rgb` | `HAPPY` / `SAD` / `NEUTRAL` | Estado de ánimo en LED RGB |
