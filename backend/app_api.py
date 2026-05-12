# =========================================================
# app_api.py
# ---------------------------------------------------------
# Sistema por fases:
#
# FASE 1: Celular -> Servidor -> Guarda audio
# FASE 2: OpenAI audio -> Audio a texto
# FASE 3: IA -> Texto a JSON de intención
#          Puede usar:
#          - OpenAI API
#          - IA local con Ollama/Qwen2
# FASE 4: JSON -> MQTT -> ESP32 -> Actuador
#
# Demo 4 LEDs por ambiente:
# - sala
# - comedor
# - cocina
# - cuarto_principal
# =========================================================


# =========================================================
# IMPORTACIONES
# =========================================================

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
import os
import subprocess
import json
import textwrap
import hashlib
import secrets
import sqlite3
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# Whisper local de respaldo
try:
    from whisper_timestamped import load_model, transcribe
except ImportError:
    load_model = None
    transcribe = None

# MQTT
import paho.mqtt.client as mqtt

# OpenAI
try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


# =========================================================
# CONFIGURACIÓN GENERAL
# =========================================================

ENV_PATH = Path(__file__).resolve().parent / ".env"

if load_dotenv is not None:
    load_dotenv(ENV_PATH)
elif ENV_PATH.exists():
    print("AVISO: backend/.env existe, pero python-dotenv no esta instalado.")

# --- Ruta local para guardar audios ---
SAVE_DIR = "/home/abraham/proy_ia_security/audios_recibidos"

# --- MQTT ---
MQTT_SERVER = os.getenv("MQTT_SERVER", "127.0.0.1")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "").strip()
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "").strip()
MQTT_TLS = os.getenv("MQTT_TLS", "false").strip().lower() in {"1", "true", "yes", "on"}
MQTT_TOPIC_LUCES = os.getenv("MQTT_TOPIC_LUCES", "casa/esp32/luces")
MQTT_DEVICE_TOPIC_PREFIX = os.getenv("MQTT_DEVICE_TOPIC_PREFIX", "afcr/devices")

# --- Dispositivos enlazados ---
DB_PATH = os.getenv(
    "DEVICES_DB_PATH",
    str(Path(__file__).resolve().parent / "devices.db")
)
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "https://api.afcrseguridad.com").rstrip("/")
PAIRING_TOKEN_MINUTES = int(os.getenv("PAIRING_TOKEN_MINUTES", "10"))
DEVICE_ONLINE_WINDOW_SECONDS = int(os.getenv("DEVICE_ONLINE_WINDOW_SECONDS", "120"))

# --- Transcripcion ---
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
WHISPER_MODEL_NAME = "tiny"

# --- CORS ---
# Separar con comas si se necesitan otros origenes:
# CORS_ALLOW_ORIGINS="https://afcrseguridad.com,http://localhost:3000"
DEFAULT_CORS_ALLOW_ORIGINS = (
    "https://afcrseguridad.com",
    "https://www.afcrseguridad.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
)
CORS_ALLOW_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "CORS_ALLOW_ORIGINS",
        ",".join(DEFAULT_CORS_ALLOW_ORIGINS)
    ).split(",")
    if origin.strip()
]

# --- IA: cambiar entre OpenAI API o IA local ---
# Valores posibles:
#   "openai" -> usa API de OpenAI
#   "local"  -> usa Ollama/Qwen2 local
AI_PROVIDER = os.getenv("AI_PROVIDER", "openai").strip().lower()

# --- OpenAI ---
# No pongas la API KEY directamente en el código.
# En Linux:
# export OPENAI_API_KEY="tu_api_key"
#
# Modelo recomendado para respuestas mas inteligentes y naturales.
# Puedes bajarlo a gpt-4o-mini si necesitas menor costo/latencia.
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o")
OPENAI_MAX_OUTPUT_TOKENS = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "700"))
AI_TEMPERATURE = float(os.getenv("AI_TEMPERATURE", "0.45"))
AI_RESPONSE_STYLE = os.getenv(
    "AI_RESPONSE_STYLE",
    "natural, claro, cercano y con criterio tecnico"
).strip()

# --- IA local con Ollama ---
# Puedes cambiarlo por variable de entorno:
# export LOCAL_AI_MODEL="qwen2:7b-instruct-q4_0"
LOCAL_AI_MODEL = os.getenv("LOCAL_AI_MODEL", "qwen2:7b-instruct-q4_0")

# --- Ambientes permitidos ---
ESPACIOS_VALIDOS = {
    "sala",
    "comedor",
    "cocina",
    "cuarto_principal"
}
ESPACIOS_DESCRIPCION = {
    "sala": "sala",
    "comedor": "comedor",
    "cocina": "cocina",
    "cuarto_principal": "cuarto principal",
}

# --- Planes de voz pendientes de confirmacion ---
VOICE_PLAN_TTL_SECONDS = int(os.getenv("VOICE_PLAN_TTL_SECONDS", "300"))
PENDING_VOICE_PLANS: dict[str, dict] = {}


# =========================================================
# INICIALIZACIÓN DE FASTAPI
# =========================================================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# INICIALIZACIÓN MQTT
# =========================================================

def create_mqtt_client():
    """
    Crea y conecta el cliente MQTT al broker.
    """
    client = mqtt.Client()

    try:
        print("Intentando conectar a MQTT...")
        if MQTT_USERNAME:
            client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD or None)

        if MQTT_TLS:
            client.tls_set()

        client.connect(MQTT_SERVER, MQTT_PORT, 60)
        client.loop_start()
        print(f"Conectado a MQTT en {MQTT_SERVER}:{MQTT_PORT}")

    except Exception as e:
        print("ERROR MQTT:", e)

    return client


mqtt_client = create_mqtt_client()


# =========================================================
# INICIALIZACIÓN OPENAI
# =========================================================

openai_client = None

if AI_PROVIDER == "openai":
    if OpenAI is None:
        print("ERROR: La librería openai no está instalada.")
        print("Instala con: pip install openai")
    else:
        try:
            openai_client = OpenAI()
            print(
                "OpenAI configurado correctamente. "
                f"Modelo IA: {OPENAI_MODEL}. "
                f"Modelo transcripcion: {OPENAI_TRANSCRIBE_MODEL}"
            )
        except Exception as e:
            print("ERROR inicializando OpenAI:", e)


# =========================================================
# INICIALIZACIÓN WHISPER LOCAL DE RESPALDO
# =========================================================

whisper_model = None

if AI_PROVIDER != "openai":
    if load_model is None:
        print("ERROR: whisper_timestamped no esta instalado para transcripcion local.")
    else:
        print(f"Cargando modelo Whisper local ({WHISPER_MODEL_NAME})...")
        whisper_model = load_model(WHISPER_MODEL_NAME)
        print("Whisper local cargado correctamente.")


# =========================================================
# DISPOSITIVOS: MODELOS Y PERSISTENCIA SQLITE
# =========================================================

class PairingTokenRequest(BaseModel):
    name: str
    type: str
    model: str
    network: str | None = None


class ClaimDeviceRequest(BaseModel):
    token: str
    device_id: str | None = None
    name: str | None = None
    type: str | None = None
    model: str | None = None


class HeartbeatRequest(BaseModel):
    status: str | None = "online"


class DeviceCommandRequest(BaseModel):
    accion: str
    espacio: str | None = None


class VoiceIntentConfirmRequest(BaseModel):
    request_id: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_iso(value: datetime) -> str:
    return value.isoformat()


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def hash_pairing_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_devices_db():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)

    with get_db_connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                model TEXT NOT NULL,
                status TEXT NOT NULL,
                mqtt_topic TEXT NOT NULL,
                last_seen TEXT,
                created_at TEXT NOT NULL,
                pairing_token_hash TEXT,
                pairing_expires_at TEXT,
                claimed_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_devices_pairing_token_hash ON devices(pairing_token_hash)"
        )
        conn.commit()


def normalize_device_type(device_type: str) -> str:
    value = (device_type or "").strip().lower()

    equivalents = {
        "luz": "Luces",
        "luces": "Luces",
        "light": "Luces",
        "lights": "Luces",
        "camara": "Camaras",
        "cámara": "Camaras",
        "camaras": "Camaras",
        "cámaras": "Camaras",
        "camera": "Camaras",
        "cameras": "Camaras",
        "puerta": "Puertas",
        "puertas": "Puertas",
        "door": "Puertas",
        "doors": "Puertas",
        "drone": "Drones",
        "drones": "Drones",
    }

    return equivalents.get(value, device_type.strip() or "Dispositivo")


def create_device_id(name: str, model: str) -> str:
    readable = f"{model}-{name}".lower()
    readable = "".join(ch if ch.isalnum() else "-" for ch in readable)
    readable = "-".join(part for part in readable.split("-") if part)
    suffix = secrets.token_hex(3)
    return f"{readable[:32]}-{suffix}"


def device_row_to_dict(row: sqlite3.Row) -> dict:
    device = dict(row)
    status = device.get("status", "offline")
    last_seen = parse_iso(device.get("last_seen"))

    if status == "online" and last_seen is not None:
        age = (utc_now() - last_seen).total_seconds()
        if age > DEVICE_ONLINE_WINDOW_SECONDS:
            status = "offline"

    if status == "pending":
        status_label = "Pendiente de enlace"
    elif status == "online":
        status_label = "Online"
    elif status == "offline":
        status_label = "Offline"
    else:
        status_label = "Enlazado"

    device["status"] = status
    device["status_label"] = status_label
    device.pop("pairing_token_hash", None)

    return device


def get_device(device_id: str) -> dict | None:
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM devices WHERE device_id = ?",
            (device_id,)
        ).fetchone()

    if row is None:
        return None

    return device_row_to_dict(row)


def find_light_device_for_space(espacio: str) -> dict | None:
    normalized_space = normalize_espacio(espacio)
    space_text = normalized_space.replace("_", " ")

    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM devices
            WHERE claimed_at IS NOT NULL
              AND lower(type) IN ('luces', 'luz', 'light', 'lights')
            ORDER BY claimed_at DESC
            """
        ).fetchall()

    if not rows:
        return None

    for row in rows:
        device = device_row_to_dict(row)
        name = device["name"].lower().replace("_", " ")
        if normalized_space in name or space_text in name:
            return device

    return device_row_to_dict(rows[0])


init_devices_db()


# =========================================================
# ENDPOINTS BÁSICOS
# =========================================================

@app.get("/")
def root():
    return {
        "ok": True,
        "message": "API viva",
        "demo": "4 LEDs por ambiente",
        "ai_provider": AI_PROVIDER,
        "ai_config": {
            "openai_model": OPENAI_MODEL,
            "openai_transcribe_model": OPENAI_TRANSCRIBE_MODEL,
            "max_output_tokens": OPENAI_MAX_OUTPUT_TOKENS,
            "temperature": AI_TEMPERATURE,
            "response_style": AI_RESPONSE_STYLE,
        }
    }


@app.get("/ping")
def ping():
    return {"pong": True}


@app.post("/devices/pairing-token")
def create_pairing_token(payload: PairingTokenRequest):
    """
    Crea un token temporal para enlazar un ESP32.
    La contraseña WiFi no se recibe ni se guarda en este backend.
    """
    name = payload.name.strip()
    device_type = normalize_device_type(payload.type)
    model = payload.model.strip()

    if not name or not model:
        raise HTTPException(status_code=400, detail="name y model son obligatorios")

    token = secrets.token_urlsafe(24)
    token_hash = hash_pairing_token(token)
    device_id = create_device_id(name, model)
    created_at = utc_now()
    expires_at = created_at + timedelta(minutes=PAIRING_TOKEN_MINUTES)
    mqtt_topic = f"{MQTT_DEVICE_TOPIC_PREFIX}/{device_id}/commands"

    with get_db_connection() as conn:
        conn.execute(
            """
            INSERT INTO devices (
                device_id, name, type, model, status, mqtt_topic, last_seen,
                created_at, pairing_token_hash, pairing_expires_at, claimed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                device_id,
                name,
                device_type,
                model,
                "pending",
                mqtt_topic,
                None,
                to_iso(created_at),
                token_hash,
                to_iso(expires_at),
                None,
            )
        )
        conn.commit()

    return {
        "ok": True,
        "device_id": device_id,
        "pairing_token": token,
        "pairing_expires_at": to_iso(expires_at),
        "api_url": PUBLIC_API_URL,
        "esp32_portal_url": "http://192.168.4.1",
        "mqtt_topic": mqtt_topic,
        "mqtt_server": MQTT_SERVER,
        "mqtt_port": MQTT_PORT,
        "mqtt_tls": MQTT_TLS,
    }


@app.post("/devices/claim")
def claim_device(payload: ClaimDeviceRequest):
    """
    El ESP32 llama este endpoint despues de conectarse al WiFi real.
    """
    token_hash = hash_pairing_token(payload.token.strip())
    now = utc_now()

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM devices
            WHERE pairing_token_hash = ?
              AND claimed_at IS NULL
            """,
            (token_hash,)
        ).fetchone()

        if row is None:
            raise HTTPException(status_code=404, detail="Token invalido o ya usado")

        expires_at = parse_iso(row["pairing_expires_at"])
        if expires_at is None or expires_at < now:
            raise HTTPException(status_code=410, detail="Token expirado")

        conn.execute(
            """
            UPDATE devices
            SET status = ?, last_seen = ?, claimed_at = ?, pairing_token_hash = NULL
            WHERE device_id = ?
            """,
            ("online", to_iso(now), to_iso(now), row["device_id"])
        )
        conn.commit()

    device = get_device(row["device_id"])

    return {
        "ok": True,
        "device": device,
    }


@app.get("/devices")
def list_devices():
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM devices ORDER BY created_at DESC"
        ).fetchall()

    return {
        "ok": True,
        "devices": [device_row_to_dict(row) for row in rows],
    }


@app.post("/devices/{device_id}/heartbeat")
def device_heartbeat(device_id: str, payload: HeartbeatRequest):
    status = (payload.status or "online").strip().lower()
    if status not in {"online", "offline", "linked"}:
        status = "online"

    now = utc_now()

    with get_db_connection() as conn:
        result = conn.execute(
            """
            UPDATE devices
            SET status = ?, last_seen = ?
            WHERE device_id = ?
            """,
            (status, to_iso(now), device_id)
        )
        conn.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

    return {
        "ok": True,
        "device": get_device(device_id),
    }


@app.post("/devices/{device_id}/command")
def send_device_command(device_id: str, payload: DeviceCommandRequest):
    device = get_device(device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

    accion = payload.accion.strip().upper()
    if accion not in {"ON", "OFF", "NONE", "CAPTURE", "LOCK", "ROUTE"}:
        raise HTTPException(status_code=400, detail="Accion no soportada")

    command_payload = {
        "device_id": device_id,
        "accion": accion,
    }

    if payload.espacio:
        command_payload["espacio"] = normalize_espacio(payload.espacio)

    result = mqtt_client.publish(device["mqtt_topic"], json.dumps(command_payload))
    ok = result[0] == 0

    return {
        "ok": ok,
        "mqtt_topic": device["mqtt_topic"],
        "mqtt_payload": command_payload,
    }


# =========================================================
# FASE 1: CELULAR -> SERVIDOR -> GUARDAR AUDIO
# =========================================================

def save_uploaded_audio(audio: UploadFile, content: bytes) -> tuple[str, str]:
    """
    Guarda el archivo de audio recibido en disco.
    Retorna:
    - filename
    - file_path
    """
    os.makedirs(SAVE_DIR, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    original_name = audio.filename or "audio.webm"

    filename = f"{timestamp}_{original_name}"
    file_path = os.path.join(SAVE_DIR, filename)

    with open(file_path, "wb") as f:
        f.write(content)

    return filename, file_path


async def fase_1_recibir_y_guardar_audio(audio: UploadFile):
    """
    FASE 1:
    El celular envía el audio al backend.
    FastAPI lo recibe y lo guarda en el servidor.
    """
    content = await audio.read()
    content_type = audio.content_type or ""

    filename, file_path = save_uploaded_audio(audio, content)

    return {
        "filename": filename,
        "file_path": file_path,
        "content_type": content_type
    }


# =========================================================
# FASE 2: OPENAI AUDIO -> AUDIO A TEXTO
# =========================================================

def is_audio_file(content_type: str, filename: str = "") -> bool:
    """
    Verifica si el archivo parece ser audio.
    Algunos celulares pueden enviar content_type vacío o application/octet-stream.
    Por eso también validamos por extensión.
    """
    if content_type.startswith("audio/"):
        return True

    filename = filename.lower()

    extensiones_audio = (
        ".webm",
        ".wav",
        ".mp3",
        ".m4a",
        ".ogg",
        ".aac",
        ".flac"
    )

    return filename.endswith(extensiones_audio)


def transcribe_audio_with_openai(file_path: str) -> str:
    """
    Transcribe un archivo de audio usando OpenAI.
    """
    if openai_client is None:
        raise RuntimeError("OpenAI no está inicializado. Revisa OPENAI_API_KEY.")

    try:
        with open(file_path, "rb") as audio_file:
            result = openai_client.audio.transcriptions.create(
                model=OPENAI_TRANSCRIBE_MODEL,
                file=audio_file,
                language="es",
            )

        return getattr(result, "text", "").strip()

    except Exception as e:
        print("Error OpenAI transcripcion:", e)
        return ""


def transcribe_audio_with_local_whisper(file_path: str) -> str:
    """
    Transcribe un archivo de audio usando Whisper local como respaldo.
    """
    global whisper_model

    try:
        if load_model is None or transcribe is None:
            print("Whisper local no esta disponible.")
            return ""

        if whisper_model is None:
            print(f"Cargando modelo Whisper local ({WHISPER_MODEL_NAME})...")
            whisper_model = load_model(WHISPER_MODEL_NAME)
            print("Whisper local cargado correctamente.")

        result = transcribe(whisper_model, file_path)
        return result.get("text", "").strip()

    except Exception as e:
        print("Error Whisper local:", e)
        return ""


def transcribe_audio(file_path: str) -> str:
    """
    Transcribe audio. En OpenAI usa gpt-4o-mini-transcribe.
    """
    if AI_PROVIDER == "openai":
        return transcribe_audio_with_openai(file_path)

    return transcribe_audio_with_local_whisper(file_path)


def normalize_text(text: str) -> str:
    """
    Limpieza básica del texto transcrito.
    """
    if not text:
        return ""

    return " ".join(text.strip().lower().split())


def fase_2_transcribir_audio(file_path: str, filename: str, content_type: str) -> str:
    """
    FASE 2:
    OpenAI convierte el audio recibido en texto.
    """
    if is_audio_file(content_type, filename):
        texto_transcrito = transcribe_audio(file_path)
    else:
        print(f"Archivo no reconocido como audio: content_type={content_type}, filename={filename}")
        texto_transcrito = ""

    return normalize_text(texto_transcrito)


# =========================================================
# FUNCIONES COMUNES PARA LA FASE 3
# =========================================================

def normalize_espacio(espacio: str) -> str:
    """
    Normaliza diferentes formas de nombrar ambientes.
    """
    if not espacio:
        return "desconocido"

    e = espacio.strip().lower()

    equivalencias = {
        "sala": "sala",
        "la sala": "sala",

        "comedor": "comedor",
        "el comedor": "comedor",

        "cocina": "cocina",
        "la cocina": "cocina",

        "cuarto principal": "cuarto_principal",
        "el cuarto principal": "cuarto_principal",
        "mi cuarto principal": "cuarto_principal",
        "habitacion principal": "cuarto_principal",
        "habitación principal": "cuarto_principal",
        "dormitorio principal": "cuarto_principal",
        "cuarto_principal": "cuarto_principal",
    }

    if e in equivalencias:
        return equivalencias[e]

    e = (
        e.replace("á", "a")
         .replace("é", "e")
         .replace("í", "i")
         .replace("ó", "o")
         .replace("ú", "u")
    )

    equivalencias_sin_tilde = {
        "habitacion principal": "cuarto_principal"
    }

    if e in equivalencias_sin_tilde:
        return equivalencias_sin_tilde[e]

    return "desconocido"


def extract_json(text: str):
    """
    Intenta extraer un JSON válido desde la respuesta de la IA.
    Sirve tanto para OpenAI como para IA local.
    """
    if not text:
        return None

    start = text.find("{")
    end = text.rfind("}")

    if start != -1 and end != -1 and end > start:
        fragment = text[start:end + 1]

        try:
            return json.loads(fragment)
        except Exception as e:
            print("Error parseando JSON:", e)
            return None

    return None


def fallback_rule_parser(texto_transcrito: str) -> dict:
    """
    Fallback por reglas si la IA falla.
    Esto mantiene la demo funcionando aunque OpenAI u Ollama no respondan.
    """
    t = normalize_text(texto_transcrito)

    accion = "NONE"
    espacio = "desconocido"

    # Detectar acción
    if any(x in t for x in ["prende", "enciende", "encender", "activar", "activa"]):
        accion = "ON"

    elif any(x in t for x in ["apaga", "apagar", "desactiva", "desactivar"]):
        accion = "OFF"

    # Detectar espacio
    if "sala" in t:
        espacio = "sala"

    elif "comedor" in t:
        espacio = "comedor"

    elif "cocina" in t:
        espacio = "cocina"

    elif (
        "cuarto principal" in t
        or "habitacion principal" in t
        or "habitación principal" in t
        or "dormitorio principal" in t
    ):
        espacio = "cuarto_principal"

    intencion = "control_luces" if accion in {"ON", "OFF"} and espacio != "desconocido" else "otra"
    if intencion == "control_luces":
        accion_texto = "encender" if accion == "ON" else "apagar"
        respuesta_usuario = (
            f"Entendi que quieres {accion_texto} la luz de "
            f"{ESPACIOS_DESCRIPCION.get(espacio, espacio)}. Lo dejo preparado "
            "para que confirmes antes de ejecutarlo."
        )
    else:
        respuesta_usuario = (
            "Te escuche, pero necesito que me digas una accion y un ambiente "
            "concreto para poder preparar un comando."
        )

    return {
        "texto": texto_transcrito,
        "intencion": intencion,
        "detalle": "resultado por reglas locales",
        "espacio": espacio,
        "accion": accion,
        "respuesta_usuario": respuesta_usuario
    }


def sanitize_ai_json(ia_json: dict | None, texto_transcrito: str) -> dict:
    """
    Limpia y valida el JSON generado por la IA.
    Si la IA falla, usa fallback por reglas.
    """
    if not ia_json:
        return fallback_rule_parser(texto_transcrito)

    texto = str(ia_json.get("texto", texto_transcrito)).strip()
    intencion = str(ia_json.get("intencion", "otra")).strip().lower()
    detalle = str(ia_json.get("detalle", "")).strip()
    respuesta_usuario = str(ia_json.get("respuesta_usuario", "")).strip()
    espacio = normalize_espacio(str(ia_json.get("espacio", "desconocido")))
    accion = str(ia_json.get("accion", "NONE")).strip().upper()

    if accion not in {"ON", "OFF", "NONE"}:
        accion = "NONE"

    if espacio not in ESPACIOS_VALIDOS:
        espacio = "desconocido"

    if intencion not in {"control_luces", "otra"}:
        intencion = "otra"

    saneado = {
        "texto": texto or texto_transcrito,
        "intencion": intencion,
        "detalle": detalle,
        "espacio": espacio,
        "accion": accion,
        "respuesta_usuario": respuesta_usuario
    }

    # Si quedó ambiguo, intenta rescatar con fallback
    if saneado["espacio"] == "desconocido" or saneado["accion"] == "NONE":
        fallback = fallback_rule_parser(texto_transcrito)

        if saneado["espacio"] == "desconocido" and fallback["espacio"] != "desconocido":
            saneado["espacio"] = fallback["espacio"]

        if saneado["accion"] == "NONE" and fallback["accion"] != "NONE":
            saneado["accion"] = fallback["accion"]

        if saneado["intencion"] == "otra" and fallback["intencion"] == "control_luces":
            saneado["intencion"] = "control_luces"

        if not saneado["detalle"]:
            saneado["detalle"] = "ajustado con validación local"

        if not saneado["respuesta_usuario"]:
            saneado["respuesta_usuario"] = fallback.get("respuesta_usuario", "")

    if not saneado["respuesta_usuario"]:
        saneado["respuesta_usuario"] = build_default_ai_reply(texto_transcrito, saneado)

    return saneado


def build_default_ai_reply(texto_transcrito: str, ia_json: dict) -> str:
    """
    Construye una respuesta conversacional si el modelo no devuelve una.
    """
    intencion = ia_json.get("intencion", "otra")
    espacio = ia_json.get("espacio", "desconocido")
    accion = ia_json.get("accion", "NONE")

    if intencion == "control_luces" and espacio != "desconocido" and accion in {"ON", "OFF"}:
        accion_texto = "encender" if accion == "ON" else "apagar"
        return (
            f"Listo, entendi que quieres {accion_texto} la luz de "
            f"{ESPACIOS_DESCRIPCION.get(espacio, espacio)}. Te preparo el plan "
            "y espero tu confirmacion antes de tocar el hardware."
        )

    if texto_transcrito:
        return (
            "Entendi la solicitud, pero no veo todavia un comando ejecutable de "
            "luces. Puedo ayudarte mejor si mencionas accion y ambiente."
        )

    return "No pude obtener una transcripcion clara. Intenta decir el comando otra vez."


# =========================================================
# FASE 3A: OPENAI API -> TEXTO A JSON
# =========================================================

INTENT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "texto": {
            "type": "string",
            "description": "Texto transcrito del usuario."
        },
        "intencion": {
            "type": "string",
            "enum": ["control_luces", "otra"],
            "description": "Intención detectada."
        },
        "detalle": {
            "type": "string",
            "description": "Explicación breve de la intención detectada."
        },
        "respuesta_usuario": {
            "type": "string",
            "description": "Respuesta natural, útil y breve para mostrar al usuario."
        },
        "espacio": {
            "type": "string",
            "enum": ["sala", "comedor", "cocina", "cuarto_principal", "desconocido"],
            "description": "Ambiente mencionado por el usuario."
        },
        "accion": {
            "type": "string",
            "enum": ["ON", "OFF", "NONE"],
            "description": "Acción solicitada."
        }
    },
    "required": ["texto", "intencion", "detalle", "respuesta_usuario", "espacio", "accion"],
    "additionalProperties": False
}


def call_openai_intent(texto_transcrito: str) -> str:
    """
    Usa OpenAI API para convertir texto transcrito en JSON de intención.
    """
    if openai_client is None:
        raise RuntimeError("OpenAI no está inicializado. Revisa OPENAI_API_KEY o instala la librería openai.")

    system_prompt = f"""
    Eres Aura Home AI, un asistente domotico de voz para un laboratorio IoT.
    Interpretas comandos en español y devuelves SOLO el JSON solicitado por el esquema.

    Objetivo:
    - Entender la intencion real del usuario, aunque hable de forma casual.
    - Ser flexible con sinonimos, frases incompletas y expresiones naturales.
    - Mantener el control de hardware seguro: nunca inventes ejecuciones fuera del contrato.
    - En "respuesta_usuario", habla con estilo {AI_RESPONSE_STYLE}. Evita sonar robotico.

    Capacidades actuales:
    - Luces: ejecutables despues de confirmacion del usuario.
    - Camaras, puertas y drones: pueden entenderse y describirse como plan, pero no ejecutar hardware real todavia.

    Reglas de clasificacion:
    - Si pide prender, encender, activar, iluminar, subir luz, poner luz o prender foco, accion = ON.
    - Si pide apagar, desactivar, quitar luz, bajar luz o dejar a oscuras, accion = OFF.
    - Si no hay accion clara, accion = NONE.
    - Si menciona sala, espacio = sala.
    - Si menciona comedor, espacio = comedor.
    - Si menciona cocina, espacio = cocina.
    - Si menciona cuarto principal, habitacion principal, dormitorio principal o recamara principal, espacio = cuarto_principal.
    - Si no detectas ambiente, espacio = desconocido.
    - Si quiere controlar luces, intencion = control_luces.
    - Si habla de camaras, puertas, drones, seguridad general, preguntas o conversacion normal, intencion = otra.

    Como escribir "respuesta_usuario":
    - Maximo dos frases.
    - Si es un comando claro de luces, confirma lo entendido y recuerda que esperas confirmacion antes de ejecutar.
    - Si falta ambiente o accion, pide solo el dato que falta.
    - Si es camaras/puertas/drones, responde que puedes preparar el plan, pero que ese modulo aun no ejecuta hardware real.
    - Si es conversacion general, responde utilmente sin prometer acciones fisicas.
    """

    user_prompt = f'El usuario dijo: "{texto_transcrito}"'

    response = openai_client.responses.create(
        model=OPENAI_MODEL,
        input=[
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],
        temperature=AI_TEMPERATURE,
        text={
            "format": {
                "type": "json_schema",
                "name": "intencion_luces",
                "schema": INTENT_JSON_SCHEMA,
                "strict": True
            }
        },
        max_output_tokens=OPENAI_MAX_OUTPUT_TOKENS
    )

    return response.output_text.strip()


# =========================================================
# FASE 3B: IA LOCAL OLLAMA/QWEN2 -> TEXTO A JSON
# =========================================================

def build_local_ai_prompt(texto_transcrito: str) -> str:
    """
    Construye el prompt para IA local.
    Se mantiene compatible con Qwen2/Ollama.
    """
    return textwrap.dedent(f"""
        Eres Aura Home AI, un asistente domotico de voz para un laboratorio IoT.
        Interpreta comandos en español con criterio y tono natural.

        El usuario dijo:
        "{texto_transcrito}"

        Tu tarea es:
        1. Entender si el usuario quiere encender o apagar una luz.
        2. Detectar el ambiente mencionado.
        3. Redactar una respuesta breve, clara y natural para el usuario.
        4. Devolver SOLO un JSON válido.
        5. No devolver explicaciones fuera del JSON.
        6. Usar exactamente esta estructura:

        {{
          "texto": "texto transcrito del usuario",
          "intencion": "control_luces o otra",
          "detalle": "explicación breve",
          "respuesta_usuario": "respuesta natural y breve para el usuario",
          "espacio": "sala, comedor, cocina, cuarto_principal o desconocido",
          "accion": "ON, OFF o NONE"
        }}

        Reglas:
        - Responde SOLO con JSON válido.
        - No uses Markdown.
        - No agregues texto extra.
        - Copia el texto transcrito en el campo "texto".
        - El idioma del usuario es español.
        - En "respuesta_usuario", no seas seco: confirma lo entendido y pide confirmacion si hay accion ejecutable.
        - Si falta accion o ambiente, pide solo ese dato faltante.
        - Si habla de camaras, puertas o drones, explica que puedes preparar un plan, pero no ejecutar hardware real aun.

        Para el campo "intencion":
        - Si quiere encender o apagar una luz de un ambiente, usa "control_luces".
        - Si no corresponde, usa "otra".

        Para el campo "accion":
        - Si el usuario pide prender, encender, activar la luz o foco, usa "ON".
        - Si el usuario pide apagar, desactivar la luz o foco, usa "OFF".
        - Si no está claro, usa "NONE".

        Para el campo "espacio":
        - Si menciona sala, usa "sala".
        - Si menciona comedor, usa "comedor".
        - Si menciona cocina, usa "cocina".
        - Si menciona cuarto principal, habitación principal o dormitorio principal, usa "cuarto_principal".
        - Si no está claro, usa "desconocido".

        Ejemplos:
        - "prende luz cocina" -> {{"texto":"prende luz cocina","intencion":"control_luces","detalle":"encender luz de cocina","respuesta_usuario":"Entendi: quieres encender la luz de cocina. Lo dejo listo y espero tu confirmacion para ejecutarlo.","espacio":"cocina","accion":"ON"}}
        - "apaga la luz de la sala" -> {{"texto":"apaga la luz de la sala","intencion":"control_luces","detalle":"apagar luz de sala","respuesta_usuario":"Perfecto, preparo el apagado de la luz de sala y no lo ejecuto hasta que confirmes.","espacio":"sala","accion":"OFF"}}
        - "enciende la luz del comedor" -> {{"texto":"enciende la luz del comedor","intencion":"control_luces","detalle":"encender luz de comedor","respuesta_usuario":"Claro, puedo encender la luz del comedor; primero te muestro el plan para confirmarlo.","espacio":"comedor","accion":"ON"}}
        - "apaga cuarto principal" -> {{"texto":"apaga cuarto principal","intencion":"control_luces","detalle":"apagar luz del cuarto principal","respuesta_usuario":"Entendido, preparo apagar la luz del cuarto principal y quedo esperando tu confirmacion.","espacio":"cuarto_principal","accion":"OFF"}}
    """)


def call_local_ai_intent(texto_transcrito: str) -> str:
    """
    Ejecuta IA local vía Ollama.
    """
    prompt = build_local_ai_prompt(texto_transcrito)

    process = subprocess.Popen(
        ["ollama", "run", LOCAL_AI_MODEL],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    out, err = process.communicate(prompt)

    if err:
        print("OLLAMA STDERR:", err)

    return out.strip()


# =========================================================
# FASE 3: IA -> TEXTO A JSON DE INTENCIÓN
# =========================================================

def fase_3_interpretar_intencion(texto_transcrito: str) -> tuple[str, dict | None, dict]:
    """
    FASE 3:
    Interpreta el texto transcrito usando OpenAI API o IA local.
    Devuelve:
    - ia_raw: respuesta cruda de la IA
    - ia_json_raw: JSON extraído antes de limpiar
    - ia_json: JSON final limpio y validado
    """
    if not texto_transcrito:
        ia_json = fallback_rule_parser(texto_transcrito)
        return "", None, ia_json

    ia_raw = ""

    try:
        if AI_PROVIDER == "openai":
            ia_raw = call_openai_intent(texto_transcrito)

        elif AI_PROVIDER == "local":
            ia_raw = call_local_ai_intent(texto_transcrito)

        else:
            print(f"AI_PROVIDER inválido: {AI_PROVIDER}")
            ia_raw = ""

    except Exception as e:
        print("ERROR EN FASE 3 IA:", e)
        ia_raw = ""

    ia_json_raw = extract_json(ia_raw)
    ia_json = sanitize_ai_json(ia_json_raw, texto_transcrito)

    return ia_raw, ia_json_raw, ia_json


# =========================================================
# FASE 4: JSON -> MQTT -> ESP32 -> ACTUADOR
# =========================================================

def cleanup_expired_voice_plans():
    """
    Elimina planes de voz que ya no deben poder confirmarse.
    """
    now = utc_now()
    expired_request_ids = [
        request_id
        for request_id, pending in PENDING_VOICE_PLANS.items()
        if pending["expires_at"] < now
    ]

    for request_id in expired_request_ids:
        PENDING_VOICE_PLANS.pop(request_id, None)


def infer_command_module(texto_transcrito: str, ia_json: dict) -> str:
    """
    Detecta a que modulo pertenece el comando.
    """
    if ia_json.get("intencion") == "control_luces":
        return "lights"

    text = normalize_text(texto_transcrito)

    if any(word in text for word in ["camara", "camaras", "cámara", "cámaras", "video"]):
        return "cameras"

    if any(word in text for word in ["puerta", "puertas", "porton", "portón", "acceso"]):
        return "doors"

    if any(word in text for word in ["drone", "drones", "ruta", "vuelo", "perimetro", "perímetro"]):
        return "drones"

    return "general"


def infer_module_action(module: str, texto_transcrito: str, ia_json: dict) -> str:
    """
    Normaliza la accion solicitada para mostrar un plan entendible.
    """
    if module == "lights":
        return str(ia_json.get("accion", "NONE")).upper()

    text = normalize_text(texto_transcrito)

    if module == "cameras":
        if any(word in text for word in ["captura", "capturar", "foto", "imagen"]):
            return "CAPTURE"
        return "VIEW"

    if module == "doors":
        if any(word in text for word in ["bloquea", "bloquear", "cerrar", "asegura", "seguro"]):
            return "LOCK"
        return "CHECK"

    if module == "drones":
        if any(word in text for word in ["ruta", "recorrido", "vuelo", "patrulla", "inicia"]):
            return "ROUTE"
        return "CHECK"

    return "NONE"


def build_light_mqtt_preview(espacio: str, accion: str) -> tuple[dict | None, str]:
    """
    Construye el payload MQTT esperado sin publicarlo.
    """
    espacio = normalize_espacio(espacio)
    accion = accion.upper().strip()

    if espacio not in ESPACIOS_VALIDOS or accion not in {"ON", "OFF"}:
        return None, MQTT_TOPIC_LUCES

    payload = {
        "espacio": espacio,
        "accion": accion
    }

    device = find_light_device_for_space(espacio)
    topic = device["mqtt_topic"] if device else MQTT_TOPIC_LUCES

    if device:
        payload["device_id"] = device["device_id"]

    return payload, topic


def build_voice_intent_plan(texto_transcrito: str, ia_json: dict) -> dict:
    """
    Crea un plan pendiente para que el usuario lo confirme antes de ejecutar.
    """
    cleanup_expired_voice_plans()

    request_id = secrets.token_urlsafe(16)
    module = infer_command_module(texto_transcrito, ia_json)
    action = infer_module_action(module, texto_transcrito, ia_json)
    espacio = ia_json.get("espacio", "desconocido")
    mqtt_preview = None
    can_execute = False

    if module == "lights":
        payload, topic = build_light_mqtt_preview(espacio, action)
        if payload is not None:
            mqtt_preview = {
                "mqtt_topic": topic,
                "mqtt_payload": payload
            }
            can_execute = True

    module_labels = {
        "lights": "luces",
        "cameras": "camaras",
        "doors": "puertas",
        "drones": "drones",
        "general": "sistema"
    }
    module_label = module_labels.get(module, "sistema")
    ai_reply = str(ia_json.get("respuesta_usuario", "")).strip()
    espacio_label = ESPACIOS_DESCRIPCION.get(espacio, espacio)

    if can_execute:
        respuesta = ai_reply or (
            f"Entendi el comando para {module_label}: {action} en {espacio_label}. "
            "Lo dejo preparado y espero tu confirmacion antes de ejecutarlo."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            f"Preparar {module_label} con accion {action} para {espacio_label}.",
            f"Esperar confirmacion y publicar el payload MQTT en {mqtt_preview['mqtt_topic']}.",
        ]
    elif module in {"cameras", "doors", "drones"}:
        respuesta = ai_reply or (
            f"Entendi una solicitud para {module_label}. Puedo ordenarla como plan, "
            "pero ese modulo aun no tiene ejecucion fisica habilitada."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            f"Identificar el modulo {module_label} y la accion sugerida {action}.",
            "Mantenerlo como plan hasta conectar la ejecucion real del modulo.",
        ]
    else:
        respuesta = ai_reply or (
            "Escuche tu solicitud, pero me falta una accion ejecutable para los "
            "modulos conectados."
        )
        steps = [
            "Revisar la transcripcion del comando.",
            "Pedir solo el dato faltante si falta modulo, ambiente o accion.",
        ]

    plan = {
        "request_id": request_id,
        "respuesta": respuesta,
        "steps": steps,
        "can_execute": can_execute,
        "module": module,
        "action": action,
        "espacio": espacio,
        "mqtt_preview": mqtt_preview,
        "expires_at": to_iso(utc_now() + timedelta(seconds=VOICE_PLAN_TTL_SECONDS)),
    }

    PENDING_VOICE_PLANS[request_id] = {
        "expires_at": utc_now() + timedelta(seconds=VOICE_PLAN_TTL_SECONDS),
        "plan": plan,
    }

    return plan


def send_mqtt_luz(espacio: str, accion: str) -> tuple[bool, dict | None, str]:
    """
    Publica el comando MQTT para el ESP32.

    Payload esperado por el ESP32:
    {
      "espacio": "cocina",
      "accion": "ON"
    }
    """
    try:
        espacio = normalize_espacio(espacio)
        accion = accion.upper().strip()

        if espacio not in ESPACIOS_VALIDOS:
            return False, None, MQTT_TOPIC_LUCES

        if accion not in {"ON", "OFF"}:
            return False, None, MQTT_TOPIC_LUCES

        payload = {
            "espacio": espacio,
            "accion": accion
        }

        device = find_light_device_for_space(espacio)
        topic = device["mqtt_topic"] if device else MQTT_TOPIC_LUCES

        if device:
            payload["device_id"] = device["device_id"]

        result = mqtt_client.publish(topic, json.dumps(payload))
        ok = result[0] == 0

        return ok, payload, topic

    except Exception as e:
        print("MQTT ERROR (LUCES):", e)
        return False, None, MQTT_TOPIC_LUCES


def execute_actions_from_ai(ia_json: dict) -> tuple[str, dict | None, str]:
    """
    Ejecuta la acción MQTT según el JSON interpretado.
    """
    if not ia_json:
        return "SIN_JSON", None, MQTT_TOPIC_LUCES

    intencion = ia_json.get("intencion", "otra")
    espacio = ia_json.get("espacio", "desconocido")
    accion = ia_json.get("accion", "NONE")

    if intencion != "control_luces":
        return "SIN_ACCION", None, MQTT_TOPIC_LUCES

    if espacio == "desconocido":
        return "ESPACIO_DESCONOCIDO", None, MQTT_TOPIC_LUCES

    if accion not in {"ON", "OFF"}:
        return "ACCION_DESCONOCIDA", None, MQTT_TOPIC_LUCES

    ok, payload, topic = send_mqtt_luz(espacio, accion)

    if ok:
        return f"MQTT_{accion}_{espacio}_OK", payload, topic

    return f"MQTT_{accion}_{espacio}_ERROR", payload, topic


def fase_4_ejecutar_json_con_mqtt(ia_json: dict):
    """
    FASE 4:
    FastAPI toma el JSON de intención y lo convierte en comando MQTT.
    El ESP32 recibe el mensaje y ejecuta la acción física.
    """
    accion_mqtt, mqtt_payload, mqtt_topic = execute_actions_from_ai(ia_json)

    return {
        "accion_mqtt": accion_mqtt,
        "mqtt_topic": mqtt_topic,
        "mqtt_payload": mqtt_payload
    }


# =========================================================
# ENDPOINT PRINCIPAL: UNE LAS 4 FASES
# =========================================================

@app.post("/voice-intent")
async def voice_intent(audio: UploadFile = File(...)):
    """
    Flujo principal:
    FASE 1: Recibir y guardar audio
    FASE 2: Transcribir audio con OpenAI
    FASE 3: Interpretar intención con IA
    FASE 4: Ejecutar acción por MQTT
    """

    # -------------------------
    # FASE 1
    # -------------------------
    fase_1 = await fase_1_recibir_y_guardar_audio(audio)

    # -------------------------
    # FASE 2
    # -------------------------
    texto_transcrito = fase_2_transcribir_audio(
        file_path=fase_1["file_path"],
        filename=fase_1["filename"],
        content_type=fase_1["content_type"]
    )

    # -------------------------
    # FASE 3
    # -------------------------
    ia_raw, ia_json_raw, ia_json = fase_3_interpretar_intencion(texto_transcrito)

    # -------------------------
    # PLAN PENDIENTE
    # -------------------------
    plan = build_voice_intent_plan(texto_transcrito, ia_json)

    # -------------------------
    # RESPUESTA FINAL
    # -------------------------
    return {
        "ok": True,
        "ai_provider": AI_PROVIDER,

        "fase_1_audio_guardado": {
            "filename": fase_1["filename"],
            "saved_path": fase_1["file_path"],
            "content_type": fase_1["content_type"]
        },

        "fase_2_transcripcion": {
            "texto_transcrito": texto_transcrito
        },

        "fase_3_ia_json": {
            "ia_raw": ia_raw,
            "ia_json_raw": ia_json_raw,
            "ia_json": ia_json
        },

        "plan": plan,
        "fase_4_mqtt": {
            "accion_mqtt": "PENDIENTE_CONFIRMACION" if plan["can_execute"] else "SIN_ACCION",
            "mqtt_topic": plan["mqtt_preview"]["mqtt_topic"] if plan["mqtt_preview"] else MQTT_TOPIC_LUCES,
            "mqtt_payload": plan["mqtt_preview"]["mqtt_payload"] if plan["mqtt_preview"] else None
        }
    }


@app.post("/voice-intent/confirm")
def confirm_voice_intent(payload: VoiceIntentConfirmRequest):
    """
    Ejecuta un plan de voz previamente devuelto por /voice-intent.
    En esta version solo las luces publican MQTT real.
    """
    cleanup_expired_voice_plans()

    request_id = payload.request_id.strip()
    pending = PENDING_VOICE_PLANS.pop(request_id, None)

    if pending is None:
        raise HTTPException(status_code=404, detail="Plan no encontrado o expirado")

    plan = pending["plan"]

    if not plan.get("can_execute"):
        return {
            "ok": True,
            "executed": False,
            "message": "Este plan no ejecuta hardware real en esta version.",
            "plan": plan,
            "fase_4_mqtt": {
                "accion_mqtt": "PLAN_NO_EJECUTABLE",
                "mqtt_topic": MQTT_TOPIC_LUCES,
                "mqtt_payload": None
            }
        }

    if plan.get("module") != "lights":
        return {
            "ok": True,
            "executed": False,
            "message": "Solo los comandos de luces estan habilitados para ejecucion real.",
            "plan": plan,
            "fase_4_mqtt": {
                "accion_mqtt": "MODULO_NO_EJECUTABLE",
                "mqtt_topic": MQTT_TOPIC_LUCES,
                "mqtt_payload": None
            }
        }

    espacio = str(plan.get("espacio", "desconocido"))
    action = str(plan.get("action", "NONE"))
    ok, mqtt_payload, mqtt_topic = send_mqtt_luz(espacio, action)
    accion_mqtt = (
        f"MQTT_{action}_{normalize_espacio(espacio)}_OK"
        if ok
        else f"MQTT_{action}_{normalize_espacio(espacio)}_ERROR"
    )

    return {
        "ok": ok,
        "executed": ok,
        "message": "Comando ejecutado por MQTT." if ok else "No se pudo publicar el comando MQTT.",
        "plan": plan,
        "fase_4_mqtt": {
            "accion_mqtt": accion_mqtt,
            "mqtt_topic": mqtt_topic,
            "mqtt_payload": mqtt_payload
        }
    }
