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
# FASE 4: JSON -> confirmacion -> HTTP polling ESP32 o MQTT legacy -> Actuador
#
# Demo 4 LEDs por ambiente:
# - sala
# - comedor
# - cocina
# - dormitorio
# =========================================================


# =========================================================
# IMPORTACIONES
# =========================================================

from fastapi import FastAPI, File, Header, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel
import os
import re
import subprocess
import json
import textwrap
import hashlib
import secrets
import sqlite3
import tempfile
import urllib.error
import urllib.parse
import urllib.request
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
PAIRING_TOKEN_MINUTES = int(os.getenv("PAIRING_TOKEN_MINUTES", "60"))
DEVICE_ONLINE_WINDOW_SECONDS = int(os.getenv("DEVICE_ONLINE_WINDOW_SECONDS", "120"))
DEVICE_COMMAND_TTL_SECONDS = int(os.getenv("DEVICE_COMMAND_TTL_SECONDS", "300"))

# --- Supabase: persistencia principal al configurar estas variables ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_SERVER_KEY = SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY
SUPABASE_AUDIO_BUCKET = os.getenv("SUPABASE_AUDIO_BUCKET", "voice-audio").strip()
VOICE_AUDIO_RETENTION_DAYS = int(os.getenv("VOICE_AUDIO_RETENTION_DAYS", "30"))
VOICE_AUDIO_MIN_BYTES = int(os.getenv("VOICE_AUDIO_MIN_BYTES", "1500"))
SUPABASE_DEVICE_SAFE_COLUMNS = (
    "device_id,organization_id,created_by,name,type,model,assigned_space,status,"
    "mqtt_topic,last_seen,created_at,pairing_expires_at,claimed_at"
)

# --- Transcripcion ---
OPENAI_TRANSCRIBE_MODEL = os.getenv("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe").strip()
OPENAI_TRANSCRIBE_FALLBACK_MODEL = os.getenv("OPENAI_TRANSCRIBE_FALLBACK_MODEL", "whisper-1").strip()
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
OPENAI_TTS_ENABLED = os.getenv("OPENAI_TTS_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts").strip()
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "marin").strip()
OPENAI_TTS_RESPONSE_FORMAT = os.getenv("OPENAI_TTS_RESPONSE_FORMAT", "mp3").strip().lower()
OPENAI_TTS_INSTRUCTIONS = os.getenv(
    "OPENAI_TTS_INSTRUCTIONS",
    "Habla en espanol latino con tono claro, cercano, profesional y tranquilo. "
    "Debe sonar como un asistente domotico confiable que responde de forma breve.",
).strip()
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
    "dormitorio"
}
ESPACIOS_DESCRIPCION = {
    "sala": "Sala",
    "comedor": "Comedor",
    "cocina": "Cocina",
    "dormitorio": "Dormitorio",
}
ESP32_MULTIROOM_ESPACIOS = ("sala", "cocina", "comedor", "dormitorio")
ESP32_ROOM_GPIO_LABELS = {
    "sala": "GPIO 16",
    "cocina": "GPIO 17",
    "comedor": "GPIO 18",
    "dormitorio": "GPIO 19",
}
LED_STATE_INITIAL = "OFF"
LED_STATE_BY_COMMAND_ACTION = {
    "turn_on": "ON",
    "turn_off": "OFF",
}
LIGHT_ACTION_ALIASES = {
    "ON": ("prende", "prender", "prenda", "prendas", "enciende", "encender", "activar", "activa", "ilumina", "iluminar", "sube", "subir", "pon", "poner"),
    "OFF": ("apaga", "apagar", "apague", "apagues", "desactiva", "desactivar", "quita", "quitar", "baja", "bajar"),
}
LIGHT_ACTION_WORDS = {
    alias: action
    for action, aliases in LIGHT_ACTION_ALIASES.items()
    for alias in aliases
}
LIGHT_ACTION_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(word) for word in sorted(LIGHT_ACTION_WORDS, key=len, reverse=True)) + r")\b"
)
LIGHT_SPACE_ALIASES = {
    "sala": ("sala",),
    "cocina": ("cocina",),
    "comedor": ("comedor",),
    "dormitorio": (
        "dormitorio",
        "cuarto principal",
        "habitacion principal",
        "dormitorio principal",
        "recamara principal",
        "cuarto",
        "habitacion",
        "recamara",
    ),
}
LIGHT_WORD_ALIASES = ("luz", "luces", "led", "leds", "foco", "focos", "lampara", "lamparas")

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
    assigned_space: str | None = None


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


class DeviceCommandAckRequest(BaseModel):
    device_id: str
    status: str
    detail: str | None = None


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


def hash_device_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def using_supabase() -> bool:
    return bool(SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY)


def ensure_supabase_configuration() -> None:
    if not using_supabase():
        raise HTTPException(status_code=503, detail="Supabase no esta configurado en el backend")


def bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sesion requerida")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sesion requerida")
    return token


def supabase_headers(access_token: str | None = None, service_role: bool = False) -> dict[str, str]:
    ensure_supabase_configuration()
    if service_role:
        if not SUPABASE_SERVER_KEY:
            raise HTTPException(
                status_code=503,
                detail="SUPABASE_SECRET_KEY es requerida para operaciones privilegiadas",
            )
        # Modern sb_secret keys identify service_role through apikey and are not JWTs.
        return {"apikey": SUPABASE_SERVER_KEY}

    headers = {"apikey": SUPABASE_PUBLISHABLE_KEY}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    return headers


def supabase_http_request(
    method: str,
    endpoint: str,
    *,
    access_token: str | None = None,
    service_role: bool = False,
    payload: object | bytes | None = None,
    headers: dict[str, str] | None = None,
) -> object | None:
    request_headers = supabase_headers(access_token, service_role)
    request_headers.update(headers or {})
    data = None
    if isinstance(payload, bytes):
        data = payload
    elif payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")

    request = urllib.request.Request(
        f"{SUPABASE_URL}{endpoint}",
        data=data,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            if not raw:
                return None
            return json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"SUPABASE HTTP {error.code}: {detail}")
        raise HTTPException(status_code=error.code, detail="Operacion Supabase rechazada") from error
    except urllib.error.URLError as error:
        print("SUPABASE CONNECTION ERROR:", error)
        raise HTTPException(status_code=503, detail="No se pudo conectar a Supabase") from error


def supabase_binary_request(
    method: str,
    endpoint: str,
    *,
    access_token: str | None = None,
    service_role: bool = False,
    payload: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[bytes, str]:
    request_headers = supabase_headers(access_token, service_role)
    request_headers.update(headers or {})
    request = urllib.request.Request(
        f"{SUPABASE_URL}{endpoint}",
        data=payload,
        headers=request_headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read(), response.headers.get("Content-Type", "application/octet-stream")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print(f"SUPABASE BINARY HTTP {error.code}: {detail}")
        raise HTTPException(status_code=error.code, detail="Audio privado no disponible") from error
    except urllib.error.URLError as error:
        print("SUPABASE BINARY CONNECTION ERROR:", error)
        raise HTTPException(status_code=503, detail="No se pudo conectar a Supabase Storage") from error


def supabase_rest(
    method: str,
    resource: str,
    *,
    access_token: str | None = None,
    service_role: bool = False,
    payload: dict | None = None,
    representation: bool = False,
) -> list[dict] | dict | None:
    headers = {"Prefer": "return=representation"} if representation else {}
    return supabase_http_request(
        method,
        f"/rest/v1/{resource}",
        access_token=access_token,
        service_role=service_role,
        payload=payload,
        headers=headers,
    )


def authenticated_context(authorization: str | None) -> dict:
    token = bearer_token(authorization)
    user = supabase_http_request("GET", "/auth/v1/user", access_token=token)
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Sesion invalida")

    user_id = str(user["id"])
    query = (
        "organization_members?select=organization_id,role"
        f"&user_id=eq.{urllib.parse.quote(user_id)}&limit=1"
    )
    memberships = supabase_rest("GET", query, access_token=token)
    if not isinstance(memberships, list) or not memberships:
        raise HTTPException(status_code=403, detail="La cuenta no tiene empresa asociada")

    return {
        "token": token,
        "user_id": user_id,
        "organization_id": memberships[0]["organization_id"],
        "role": memberships[0]["role"],
    }


def normalize_audio_content_type(content_type: str) -> str:
    return (content_type or "").split(";", 1)[0].strip().lower()


def audio_suffix_for_content_type(content_type: str) -> str | None:
    normalized = normalize_audio_content_type(content_type)
    return {
        "audio/webm": ".webm",
        "audio/mp4": ".mp4",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/ogg": ".ogg",
        "audio/aac": ".aac",
        "audio/flac": ".flac",
    }.get(normalized)


def upload_private_audio(
    context: dict,
    request_id: str,
    filename: str,
    content_type: str,
    content: bytes,
) -> tuple[str, str]:
    object_path = f"{context['user_id']}/{request_id}/{filename}"
    quoted_path = urllib.parse.quote(object_path, safe="/")
    storage_content_type = normalize_audio_content_type(content_type) or "application/octet-stream"
    supabase_http_request(
        "POST",
        f"/storage/v1/object/{SUPABASE_AUDIO_BUCKET}/{quoted_path}",
        access_token=context["token"],
        payload=content,
        headers={
            "Content-Type": storage_content_type or "application/octet-stream",
            "x-upsert": "false",
        },
    )
    expires_at = to_iso(utc_now() + timedelta(days=VOICE_AUDIO_RETENTION_DAYS))
    return object_path, expires_at


TTS_AUDIO_FORMATS = {
    "mp3": ("audio/mpeg", ".mp3"),
    "wav": ("audio/wav", ".wav"),
    "opus": ("audio/ogg", ".opus"),
    "aac": ("audio/aac", ".aac"),
    "flac": ("audio/flac", ".flac"),
}


def tts_format_settings() -> tuple[str, str, str]:
    response_format = OPENAI_TTS_RESPONSE_FORMAT
    if response_format not in TTS_AUDIO_FORMATS:
        response_format = "mp3"
    content_type, suffix = TTS_AUDIO_FORMATS[response_format]
    return response_format, content_type, suffix


def build_tts_audio_endpoint(request_id: str) -> str:
    return f"/voice-intents/{urllib.parse.quote(request_id)}/audio/respuesta-ia"


def build_response_tts_audio_metadata(
    *,
    request_id: str,
    available: bool,
    content_type: str | None = None,
    storage_path: str | None = None,
    expires_at: str | None = None,
    error: str | None = None,
) -> dict:
    _, default_content_type, _ = tts_format_settings()
    metadata = {
        "available": available,
        "content_type": content_type or default_content_type,
        "endpoint": build_tts_audio_endpoint(request_id),
        "model": OPENAI_TTS_MODEL,
        "voice": OPENAI_TTS_VOICE,
    }
    if storage_path:
        metadata["storage_path"] = storage_path
    if expires_at:
        metadata["expires_at"] = expires_at
    if error:
        metadata["error"] = error
    return metadata


def generate_response_tts_audio(context: dict | None, request_id: str, respuesta_usuario: str) -> dict:
    if not OPENAI_TTS_ENABLED:
        return build_response_tts_audio_metadata(
            request_id=request_id,
            available=False,
            error="Texto a voz desactivado por OPENAI_TTS_ENABLED.",
        )

    if context is None or not using_supabase():
        return build_response_tts_audio_metadata(
            request_id=request_id,
            available=False,
            error="Texto a voz requiere sesion y Supabase Storage configurado.",
        )

    if openai_client is None:
        return build_response_tts_audio_metadata(
            request_id=request_id,
            available=False,
            error="OpenAI no esta inicializado para generar voz.",
        )

    text_to_speak = " ".join(str(respuesta_usuario or "").split())
    if not text_to_speak:
        return build_response_tts_audio_metadata(
            request_id=request_id,
            available=False,
            error="La respuesta IA esta vacia y no se puede convertir a voz.",
        )

    response_format, content_type, suffix = tts_format_settings()
    text_to_speak = text_to_speak[:4096]
    temporary_path = None

    try:
        temporary = tempfile.NamedTemporaryFile(prefix="afcr_tts_", suffix=suffix, delete=False)
        temporary_path = temporary.name
        temporary.close()

        with openai_client.audio.speech.with_streaming_response.create(
            model=OPENAI_TTS_MODEL,
            voice=OPENAI_TTS_VOICE,
            input=text_to_speak,
            instructions=OPENAI_TTS_INSTRUCTIONS,
            response_format=response_format,
        ) as speech_response:
            speech_response.stream_to_file(temporary_path)

        audio_bytes = Path(temporary_path).read_bytes()
        storage_path, expires_at = upload_private_audio(
            context,
            request_id,
            f"respuesta-ia{suffix}",
            content_type,
            audio_bytes,
        )
        return build_response_tts_audio_metadata(
            request_id=request_id,
            available=True,
            content_type=content_type,
            storage_path=storage_path,
            expires_at=expires_at,
        )
    except Exception as error:
        print("OPENAI TTS ERROR:", error)
        return build_response_tts_audio_metadata(
            request_id=request_id,
            available=False,
            content_type=content_type,
            error="No se pudo generar la voz IA para esta respuesta.",
        )
    finally:
        if temporary_path:
            try:
                os.unlink(temporary_path)
            except FileNotFoundError:
                pass


def resolve_tts_storage_path(record: dict, request_id: str) -> tuple[str, str]:
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    metadata = plan.get("respuesta_ia_audio") if isinstance(plan.get("respuesta_ia_audio"), dict) else {}
    storage_path = str(metadata.get("storage_path") or "").strip()
    content_type = str(metadata.get("content_type") or "").strip()

    if storage_path:
        return storage_path, content_type or tts_format_settings()[1]

    _, fallback_content_type, suffix = tts_format_settings()
    user_id = str(record.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=404, detail="Audio IA no encontrado")
    return f"{user_id}/{request_id}/respuesta-ia{suffix}", content_type or fallback_content_type


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
                claimed_at TEXT,
                device_api_key_hash TEXT
            )
            """
        )
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(devices)").fetchall()
        }
        if "device_api_key_hash" not in columns:
            conn.execute("ALTER TABLE devices ADD COLUMN device_api_key_hash TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_devices_pairing_token_hash ON devices(pairing_token_hash)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS device_commands (
                command_id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                target TEXT NOT NULL,
                action TEXT NOT NULL,
                espacio TEXT NOT NULL,
                status TEXT NOT NULL,
                source_request_id TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                delivered_at TEXT,
                ack_at TEXT,
                failure_detail TEXT,
                FOREIGN KEY (device_id) REFERENCES devices(device_id)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_device_commands_delivery
            ON device_commands(device_id, status, created_at)
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS device_led_states (
                device_id TEXT NOT NULL,
                espacio TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('ON', 'OFF')),
                updated_at TEXT NOT NULL,
                source_command_id TEXT,
                PRIMARY KEY (device_id, espacio),
                FOREIGN KEY (device_id) REFERENCES devices(device_id)
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_device_led_states_device
            ON device_led_states(device_id)
            """
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
        "esp32": "ESP32",
    }

    return equivalents.get(value, device_type.strip() or "Dispositivo")


def create_device_id(name: str, model: str) -> str:
    readable = f"{model}-{name}".lower()
    readable = "".join(ch if ch.isalnum() else "-" for ch in readable)
    readable = "-".join(part for part in readable.split("-") if part)
    suffix = secrets.token_hex(3)
    return f"{readable[:32]}-{suffix}"


def device_row_to_dict(row: sqlite3.Row | dict) -> dict:
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
    device.pop("device_api_key_hash", None)
    if normalize_device_type(str(device.get("type", ""))) == "ESP32":
        device["transport"] = "http_polling"
        device["commands_url"] = "/device/commands"
    else:
        device["transport"] = "mqtt"

    return device


def get_device(device_id: str, access_token: str | None = None) -> dict | None:
    if using_supabase():
        if not access_token:
            raise HTTPException(status_code=401, detail="Sesion requerida")
        query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}"
            f"&device_id=eq.{urllib.parse.quote(device_id)}&limit=1"
        )
        rows = supabase_rest("GET", query, access_token=access_token)
        if not isinstance(rows, list) or not rows:
            return None
        return device_row_to_dict(rows[0])

    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM devices WHERE device_id = ?",
            (device_id,)
        ).fetchone()

    if row is None:
        return None

    return device_row_to_dict(row)


def find_light_device_for_space(
    espacio: str,
    organization_id: str | None = None,
    access_token: str | None = None,
) -> dict | None:
    normalized_space = normalize_espacio(espacio)
    space_text = normalized_space.replace("_", " ")

    if using_supabase():
        if not organization_id or not access_token:
            return None
        query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}&claimed_at=not.is.null"
            "&type=in.(Luces,luz,light,lights)"
            f"&organization_id=eq.{urllib.parse.quote(organization_id)}"
            "&order=claimed_at.desc"
        )
        rows = supabase_rest("GET", query, access_token=access_token)
    else:
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

    space_aliases = {
        "sala": ("sala",),
        "comedor": ("comedor",),
        "cocina": ("cocina",),
        "dormitorio": (
            "dormitorio",
            "cuarto principal",
            "habitacion principal",
            "habitación principal",
            "dormitorio principal",
            "recamara principal",
        ),
    }
    aliases = space_aliases.get(normalized_space, (normalized_space, space_text))

    for row in rows:
        device = device_row_to_dict(row)
        name = device["name"].lower().replace("_", " ")
        if any(alias in name for alias in aliases):
            return device

    return device_row_to_dict(rows[0])


def find_latest_http_esp32(
    organization_id: str | None = None,
    access_token: str | None = None,
) -> dict | None:
    if using_supabase():
        if not organization_id or not access_token:
            return None
        query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}&claimed_at=not.is.null&type=eq.ESP32"
            f"&organization_id=eq.{urllib.parse.quote(organization_id)}"
            "&order=claimed_at.desc&limit=1"
        )
        rows = supabase_rest("GET", query, access_token=access_token)
        if isinstance(rows, list) and rows:
            return device_row_to_dict(rows[0])
        return None

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM devices
            WHERE claimed_at IS NOT NULL
              AND lower(type) = 'esp32'
            ORDER BY claimed_at DESC
            LIMIT 1
            """
        ).fetchone()

    return device_row_to_dict(row) if row else None


def find_http_esp32_for_space(
    espacio: str,
    organization_id: str | None = None,
    access_token: str | None = None,
) -> dict | None:
    normalized_space = normalize_espacio(espacio)
    if normalized_space not in ESPACIOS_VALIDOS:
        return None

    return find_latest_http_esp32(organization_id, access_token)


def infer_device_space(device: dict) -> str:
    name = normalize_text(str(device.get("name", ""))).replace("_", " ")
    aliases = (
        ("dormitorio", ("dormitorio", "cuarto principal", "dormitorio principal", "habitacion principal")),
        ("sala", ("sala",)),
        ("comedor", ("comedor",)),
        ("cocina", ("cocina",)),
    )
    for espacio, values in aliases:
        if any(value in name for value in values):
            return espacio

    return "desconocido"


def cleanup_expired_device_commands(
    organization_id: str | None = None,
    access_token: str | None = None,
) -> None:
    if using_supabase():
        if not organization_id or not access_token:
            return
        query = (
            "device_commands?status=in.(queued,delivered)"
            f"&organization_id=eq.{urllib.parse.quote(organization_id)}"
            f"&expires_at=lt.{urllib.parse.quote(to_iso(utc_now()))}"
        )
        supabase_rest(
            "PATCH",
            query,
            service_role=True,
            payload={"status": "expired"},
        )
        return

    with get_db_connection() as conn:
        conn.execute(
            """
            UPDATE device_commands
            SET status = 'expired'
            WHERE status IN ('queued', 'delivered')
              AND expires_at < ?
            """,
            (to_iso(utc_now()),)
        )
        conn.commit()


def command_row_to_dict(row: sqlite3.Row | dict) -> dict:
    command = dict(row)
    command["transport"] = "http_polling"
    command["commands_url"] = "/device/commands"
    return command


def command_poll_item(command: sqlite3.Row | dict) -> dict:
    command_dict = command_row_to_dict(command)
    return {
        "command_id": command_dict["command_id"],
        "target": command_dict["target"],
        "action": command_dict["action"],
        "espacio": command_dict["espacio"],
        "status": command_dict["status"],
        "expires_at": command_dict["expires_at"],
    }


def build_polled_command_response(commands: list[sqlite3.Row | dict]) -> dict:
    if not commands:
        return {
            "ok": True,
            "command_id": None,
            "target": "led",
            "action": "none",
            "status": "idle",
        }

    command_items = [command_poll_item(command) for command in commands]
    if len(command_items) == 1:
        return {"ok": True, **command_items[0]}

    return {
        "ok": True,
        "command_id": command_items[0]["command_id"],
        "target": "leds",
        "action": "batch",
        "espacio": "multiple",
        "status": "delivered",
        "expires_at": min(item["expires_at"] for item in command_items if item.get("expires_at")),
        "commands": command_items,
    }


def normalize_led_state(value: str | None) -> str:
    state = str(value or LED_STATE_INITIAL).strip().upper()
    return state if state in {"ON", "OFF"} else LED_STATE_INITIAL


def default_led_state_row(device: dict, espacio: str, updated_at: str | None = None) -> dict:
    return {
        "device_id": device["device_id"],
        "organization_id": device.get("organization_id"),
        "espacio": espacio,
        "status": LED_STATE_INITIAL,
        "updated_at": updated_at,
        "source_command_id": None,
    }


def build_led_states_response(device: dict, rows: list[sqlite3.Row | dict]) -> dict:
    row_map = {
        normalize_espacio(str(dict(row).get("espacio", ""))): dict(row)
        for row in rows
    }
    states = []

    for espacio in ESP32_MULTIROOM_ESPACIOS:
        row = row_map.get(espacio) or default_led_state_row(device, espacio)
        state = normalize_led_state(str(row.get("status") or LED_STATE_INITIAL))
        states.append({
            "espacio": espacio,
            "label": ESPACIOS_DESCRIPCION.get(espacio, espacio),
            "state": state,
            "gpio": ESP32_ROOM_GPIO_LABELS.get(espacio),
            "updated_at": row.get("updated_at"),
            "source_command_id": row.get("source_command_id"),
        })

    on_count = sum(1 for item in states if item["state"] == "ON")
    off_count = sum(1 for item in states if item["state"] == "OFF")
    updated_values = [
        str(item["updated_at"])
        for item in states
        if item.get("updated_at") and item.get("source_command_id")
    ]

    return {
        "ok": True,
        "device": device,
        "device_id": device["device_id"],
        "device_status": device.get("status", "offline"),
        "device_status_label": device.get("status_label", "Offline"),
        "states": states,
        "summary": {
            "total": len(states),
            "on": on_count,
            "off": off_count,
            "last_updated_at": max(updated_values) if updated_values else None,
        },
    }


def fetch_sqlite_device_led_state_rows(
    conn: sqlite3.Connection,
    device_id: str,
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT *
        FROM device_led_states
        WHERE device_id = ?
        ORDER BY espacio ASC
        """,
        (device_id,),
    ).fetchall()


def initialize_sqlite_device_led_states(conn: sqlite3.Connection, device_id: str) -> None:
    now = to_iso(utc_now())
    conn.executemany(
        """
        INSERT OR IGNORE INTO device_led_states (
            device_id, espacio, status, updated_at, source_command_id
        )
        VALUES (?, ?, 'OFF', ?, NULL)
        """,
        [(device_id, espacio, now) for espacio in ESP32_MULTIROOM_ESPACIOS],
    )


def upsert_sqlite_led_states_from_commands(
    conn: sqlite3.Connection,
    commands: list[sqlite3.Row | dict],
) -> None:
    updates = []
    now = to_iso(utc_now())

    for command in commands:
        command_dict = dict(command)
        state = LED_STATE_BY_COMMAND_ACTION.get(str(command_dict.get("action", "")))
        espacio = normalize_espacio(str(command_dict.get("espacio", "")))
        if state is None or espacio not in ESPACIOS_VALIDOS:
            continue

        updates.append((
            command_dict["device_id"],
            espacio,
            state,
            now,
            command_dict.get("command_id"),
        ))

    if not updates:
        return

    conn.executemany(
        """
        INSERT INTO device_led_states (
            device_id, espacio, status, updated_at, source_command_id
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id, espacio) DO UPDATE SET
            status = excluded.status,
            updated_at = excluded.updated_at,
            source_command_id = excluded.source_command_id
        """,
        updates,
    )


def led_state_rows_from_executed_commands(
    device: dict,
    commands: list[sqlite3.Row | dict],
) -> list[dict]:
    latest_by_space: dict[str, dict] = {}

    for command in commands:
        command_dict = dict(command)
        if str(command_dict.get("status", "")) != "executed":
            continue

        state = LED_STATE_BY_COMMAND_ACTION.get(str(command_dict.get("action", "")))
        espacio = normalize_espacio(str(command_dict.get("espacio", "")))
        if state is None or espacio not in ESPACIOS_VALIDOS:
            continue

        if espacio in latest_by_space:
            continue

        latest_by_space[espacio] = {
            "device_id": command_dict.get("device_id") or device["device_id"],
            "organization_id": command_dict.get("organization_id") or device.get("organization_id"),
            "espacio": espacio,
            "status": state,
            "updated_at": (
                command_dict.get("ack_at")
                or command_dict.get("delivered_at")
                or command_dict.get("created_at")
            ),
            "source_command_id": command_dict.get("command_id"),
        }

    return list(latest_by_space.values())


def merge_led_state_rows_with_command_history(
    device: dict,
    state_rows: list[sqlite3.Row | dict],
    command_rows: list[sqlite3.Row | dict],
) -> list[dict]:
    merged_rows = [dict(row) for row in state_rows]
    command_state_rows = led_state_rows_from_executed_commands(device, command_rows)
    return [*merged_rows, *command_state_rows]


def fetch_sqlite_led_state_rows_from_executed_commands(
    conn: sqlite3.Connection,
    device_id: str,
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT *
        FROM device_commands
        WHERE device_id = ?
          AND target = 'led'
          AND status = 'executed'
        ORDER BY COALESCE(ack_at, delivered_at, created_at) DESC, created_at DESC
        LIMIT 100
        """,
        (device_id,),
    ).fetchall()


def fetch_supabase_device_led_state_rows(device: dict) -> list[dict]:
    organization_id = str(device.get("organization_id") or "").strip()
    if not organization_id:
        return []

    query = (
        "device_led_states?select=device_id,organization_id,espacio,status,"
        "updated_at,source_command_id"
        f"&device_id=eq.{urllib.parse.quote(str(device['device_id']))}"
        f"&organization_id=eq.{urllib.parse.quote(organization_id)}"
        "&order=espacio.asc"
    )
    try:
        rows = supabase_rest("GET", query, service_role=True)
    except HTTPException as error:
        print("SUPABASE LED STATE READ SKIPPED:", error.detail)
        return []

    return rows if isinstance(rows, list) else []


def fetch_supabase_led_state_rows_from_executed_commands(device: dict) -> list[dict]:
    organization_id = str(device.get("organization_id") or "").strip()
    if not organization_id:
        return []

    query = (
        "device_commands?select=command_id,device_id,organization_id,target,action,"
        "espacio,status,created_at,delivered_at,ack_at"
        f"&device_id=eq.{urllib.parse.quote(str(device['device_id']))}"
        f"&organization_id=eq.{urllib.parse.quote(organization_id)}"
        "&target=eq.led&status=eq.executed"
        "&order=created_at.desc"
        "&limit=100"
    )
    try:
        rows = supabase_rest("GET", query, service_role=True)
    except HTTPException as error:
        print("SUPABASE LED STATE HISTORY READ SKIPPED:", error.detail)
        return []

    return rows if isinstance(rows, list) else []


def ensure_supabase_device_led_states(device: dict, rows: list[dict] | None = None) -> list[dict]:
    organization_id = str(device.get("organization_id") or "").strip()
    if not organization_id:
        return rows or []

    existing_rows = rows if rows is not None else fetch_supabase_device_led_state_rows(device)
    existing_spaces = {
        normalize_espacio(str(row.get("espacio", "")))
        for row in existing_rows
    }
    now = to_iso(utc_now())
    missing_rows = [
        default_led_state_row(device, espacio, now)
        for espacio in ESP32_MULTIROOM_ESPACIOS
        if espacio not in existing_spaces
    ]

    if not missing_rows:
        return existing_rows

    try:
        supabase_http_request(
            "POST",
            "/rest/v1/device_led_states",
            service_role=True,
            payload=missing_rows,
            headers={"Prefer": "return=minimal"},
        )
    except HTTPException as error:
        print("SUPABASE LED STATE INIT SKIPPED:", error.detail)

    return [*existing_rows, *missing_rows]


def upsert_supabase_led_states_from_commands(commands: list[dict]) -> None:
    now = to_iso(utc_now())
    payload = []

    for command in commands:
        state = LED_STATE_BY_COMMAND_ACTION.get(str(command.get("action", "")))
        espacio = normalize_espacio(str(command.get("espacio", "")))
        organization_id = str(command.get("organization_id") or "").strip()
        if state is None or espacio not in ESPACIOS_VALIDOS or not organization_id:
            continue

        payload.append({
            "device_id": command["device_id"],
            "organization_id": organization_id,
            "espacio": espacio,
            "status": state,
            "updated_at": now,
            "source_command_id": command.get("command_id"),
        })

    if not payload:
        return

    try:
        supabase_http_request(
            "POST",
            "/rest/v1/device_led_states?on_conflict=device_id,espacio",
            service_role=True,
            payload=payload,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
    except HTTPException as error:
        print("SUPABASE LED STATE UPSERT SKIPPED:", error.detail)


def verify_supabase_http_device(device_id: str, device_api_key_hash: str) -> dict:
    query = (
        f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}"
        f"&device_id=eq.{urllib.parse.quote(device_id)}"
        f"&device_api_key_hash=eq.{urllib.parse.quote(device_api_key_hash)}"
        "&claimed_at=not.is.null&limit=1"
    )
    rows = supabase_rest("GET", query, service_role=True)
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=401, detail="Credencial de dispositivo invalida")
    return device_row_to_dict(rows[0])


def cleanup_expired_device_commands_for_device(device_id: str) -> None:
    if not using_supabase():
        return
    query = (
        "device_commands?status=in.(queued,delivered)"
        f"&device_id=eq.{urllib.parse.quote(device_id)}"
        f"&expires_at=lt.{urllib.parse.quote(to_iso(utc_now()))}"
    )
    supabase_rest(
        "PATCH",
        query,
        service_role=True,
        payload={"status": "expired"},
    )


def fetch_supabase_pending_command_group(device_id: str) -> list[dict]:
    first_query = (
        "device_commands?select=*"
        f"&device_id=eq.{urllib.parse.quote(device_id)}"
        "&status=in.(queued,delivered)&order=created_at.asc&limit=1"
    )
    rows = supabase_rest("GET", first_query, service_role=True)
    if not isinstance(rows, list) or not rows:
        return []

    first = rows[0]
    source_request_id = first.get("source_request_id")
    if not source_request_id:
        return [first]

    group_query = (
        "device_commands?select=*"
        f"&device_id=eq.{urllib.parse.quote(device_id)}"
        f"&source_request_id=eq.{urllib.parse.quote(str(source_request_id))}"
        "&status=in.(queued,delivered)&order=created_at.asc"
    )
    group_rows = supabase_rest("GET", group_query, service_role=True)
    return group_rows if isinstance(group_rows, list) and group_rows else [first]


def mark_supabase_commands_delivered(device_id: str, commands: list[dict]) -> list[dict]:
    queued = [command for command in commands if command.get("status") == "queued"]
    if not queued:
        return commands

    now = to_iso(utc_now())
    source_request_id = commands[0].get("source_request_id") if len(commands) > 1 else None
    if source_request_id:
        patch_query = (
            "device_commands?status=eq.queued"
            f"&device_id=eq.{urllib.parse.quote(device_id)}"
            f"&source_request_id=eq.{urllib.parse.quote(str(source_request_id))}"
        )
        fetch_query = (
            "device_commands?select=*"
            f"&device_id=eq.{urllib.parse.quote(device_id)}"
            f"&source_request_id=eq.{urllib.parse.quote(str(source_request_id))}"
            "&status=in.(queued,delivered)&order=created_at.asc"
        )
    else:
        command_id = str(queued[0]["command_id"])
        patch_query = f"device_commands?command_id=eq.{urllib.parse.quote(command_id)}&status=eq.queued"
        fetch_query = f"device_commands?select=*&command_id=eq.{urllib.parse.quote(command_id)}&limit=1"

    supabase_rest(
        "PATCH",
        patch_query,
        service_role=True,
        payload={"status": "delivered", "delivered_at": now},
    )
    updated = supabase_rest("GET", fetch_query, service_role=True)
    return updated if isinstance(updated, list) and updated else commands


def poll_supabase_device_commands(device_id: str, device_api_key_hash: str) -> dict:
    verify_supabase_http_device(device_id, device_api_key_hash)
    supabase_rest(
        "PATCH",
        f"devices?device_id=eq.{urllib.parse.quote(device_id)}",
        service_role=True,
        payload={"status": "online", "last_seen": to_iso(utc_now())},
    )
    cleanup_expired_device_commands_for_device(device_id)
    commands = fetch_supabase_pending_command_group(device_id)
    commands = mark_supabase_commands_delivered(device_id, commands)
    return build_polled_command_response(commands)


def fetch_sqlite_pending_command_group(conn: sqlite3.Connection, device_id: str) -> list[sqlite3.Row]:
    first = conn.execute(
        """
        SELECT * FROM device_commands
        WHERE device_id = ?
          AND status IN ('queued', 'delivered')
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (device_id,)
    ).fetchone()
    if first is None:
        return []

    source_request_id = first["source_request_id"]
    if not source_request_id:
        return [first]

    rows = conn.execute(
        """
        SELECT * FROM device_commands
        WHERE device_id = ?
          AND source_request_id = ?
          AND status IN ('queued', 'delivered')
        ORDER BY created_at ASC
        """,
        (device_id, source_request_id)
    ).fetchall()
    return rows or [first]


def mark_sqlite_commands_delivered(conn: sqlite3.Connection, commands: list[sqlite3.Row]) -> list[sqlite3.Row]:
    queued_ids = [command["command_id"] for command in commands if command["status"] == "queued"]
    if not queued_ids:
        return commands

    now = to_iso(utc_now())
    placeholders = ",".join("?" for _ in queued_ids)
    conn.execute(
        f"""
        UPDATE device_commands
        SET status = 'delivered', delivered_at = ?
        WHERE command_id IN ({placeholders})
        """,
        (now, *queued_ids)
    )
    conn.commit()

    all_ids = [command["command_id"] for command in commands]
    fetch_placeholders = ",".join("?" for _ in all_ids)
    return conn.execute(
        f"""
        SELECT * FROM device_commands
        WHERE command_id IN ({fetch_placeholders})
        ORDER BY created_at ASC
        """,
        tuple(all_ids)
    ).fetchall()


def enqueue_http_led_command(
    device: dict,
    accion: str,
    espacio: str,
    source_request_id: str | None = None,
    context: dict | None = None,
) -> dict:
    accion = accion.strip().upper()
    normalized_space = normalize_espacio(espacio)
    action = {"ON": "turn_on", "OFF": "turn_off"}.get(accion)

    if action is None or normalized_space not in ESPACIOS_VALIDOS:
        raise HTTPException(status_code=400, detail="Comando LED no soportado")

    created_at = utc_now()
    expires_at = created_at + timedelta(seconds=DEVICE_COMMAND_TTL_SECONDS)
    command_id = f"cmd_{secrets.token_urlsafe(16)}"

    if using_supabase():
        if context is None:
            raise HTTPException(status_code=401, detail="Sesion requerida")
        supabase_rest(
            "POST",
            "device_commands",
            service_role=True,
            payload={
                "command_id": command_id,
                "organization_id": context["organization_id"],
                "device_id": device["device_id"],
                "created_by": context["user_id"],
                "target": "led",
                "action": action,
                "espacio": normalized_space,
                "status": "queued",
                "source_request_id": source_request_id,
                "created_at": to_iso(created_at),
                "expires_at": to_iso(expires_at),
            },
        )
    else:
        with get_db_connection() as conn:
            conn.execute(
                """
                INSERT INTO device_commands (
                    command_id, device_id, target, action, espacio, status,
                    source_request_id, created_at, expires_at
                )
                VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)
                """,
                (
                    command_id,
                    device["device_id"],
                    "led",
                    action,
                    normalized_space,
                    source_request_id,
                    to_iso(created_at),
                    to_iso(expires_at),
                )
            )
            conn.commit()

    return {
        "transport": "http_polling",
        "command_id": command_id,
        "device_id": device["device_id"],
        "target": "led",
        "action": action,
        "espacio": normalized_space,
        "status": "queued",
        "commands_url": "/device/commands",
        "expires_at": to_iso(expires_at),
    }


def authenticate_http_device(device_id: str, authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Credencial de dispositivo requerida")

    api_key = authorization.removeprefix("Bearer ").strip()
    if using_supabase():
        if not api_key:
            raise HTTPException(status_code=401, detail="Credencial de dispositivo invalida")
        return {"device_id": device_id, "device_api_key_hash": hash_device_api_key(api_key)}

    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM devices WHERE device_id = ?",
            (device_id,)
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

    expected_hash = row["device_api_key_hash"]
    if not expected_hash or not secrets.compare_digest(expected_hash, hash_device_api_key(api_key)):
        raise HTTPException(status_code=401, detail="Credencial de dispositivo invalida")

    return device_row_to_dict(row)


if not using_supabase():
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
            "openai_transcribe_fallback_model": OPENAI_TRANSCRIBE_FALLBACK_MODEL,
            "max_output_tokens": OPENAI_MAX_OUTPUT_TOKENS,
            "temperature": AI_TEMPERATURE,
            "response_style": AI_RESPONSE_STYLE,
        }
    }


@app.get("/ping")
def ping():
    return {"pong": True}


@app.post("/devices/pairing-token")
def create_pairing_token(
    payload: PairingTokenRequest,
    authorization: str | None = Header(default=None),
):
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
    assigned_space = normalize_espacio(payload.assigned_space or name)
    if assigned_space not in ESPACIOS_VALIDOS:
        assigned_space = None

    if using_supabase():
        context = authenticated_context(authorization)
        supabase_rest(
            "POST",
            "devices",
            service_role=True,
            payload={
                "device_id": device_id,
                "organization_id": context["organization_id"],
                "created_by": context["user_id"],
                "name": name,
                "type": device_type,
                "model": model,
                "assigned_space": assigned_space,
                "status": "pending",
                "mqtt_topic": mqtt_topic,
                "created_at": to_iso(created_at),
                "pairing_token_hash": token_hash,
                "pairing_expires_at": to_iso(expires_at),
            },
        )
        if device_type == "ESP32":
            ensure_supabase_device_led_states({
                "device_id": device_id,
                "organization_id": context["organization_id"],
            })
    else:
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
            if device_type == "ESP32":
                initialize_sqlite_device_led_states(conn, device_id)
            conn.commit()

    return {
        "ok": True,
        "device_id": device_id,
        "pairing_token": token,
        "pairing_expires_at": to_iso(expires_at),
        "api_url": PUBLIC_API_URL,
        "mqtt_topic": mqtt_topic,
        "mqtt_server": MQTT_SERVER,
        "mqtt_port": MQTT_PORT,
        "mqtt_tls": MQTT_TLS,
        "transport": "http_polling" if device_type == "ESP32" else "mqtt",
        "commands_url": "/device/commands" if device_type == "ESP32" else None,
    }


@app.post("/devices/claim")
def claim_device(payload: ClaimDeviceRequest):
    """
    El ESP32 llama este endpoint despues de conectarse al WiFi real.
    """
    token_hash = hash_pairing_token(payload.token.strip())
    now = utc_now()
    device_api_key = None

    if using_supabase():
        device_api_key = secrets.token_urlsafe(32)
        device = supabase_http_request(
            "POST",
            "/rest/v1/rpc/claim_device",
            service_role=True,
            payload={
                "p_token_hash": token_hash,
                "p_device_api_key_hash": hash_device_api_key(device_api_key),
            },
        )
        if not isinstance(device, dict):
            raise HTTPException(status_code=404, detail="Token invalido, expirado o ya usado")
        if normalize_device_type(str(device.get("type", ""))) != "ESP32":
            device_api_key = None
        else:
            ensure_supabase_device_led_states(device)
        return {
            "ok": True,
            "device": device_row_to_dict(device),
            "device_api_key": device_api_key,
            "commands_url": "/device/commands" if device_api_key else None,
        }

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

        if normalize_device_type(row["type"]) == "ESP32":
            device_api_key = secrets.token_urlsafe(32)

        conn.execute(
            """
            UPDATE devices
            SET status = ?, last_seen = ?, claimed_at = ?, pairing_token_hash = NULL,
                device_api_key_hash = ?
            WHERE device_id = ?
            """,
            (
                "online",
                to_iso(now),
                to_iso(now),
                hash_device_api_key(device_api_key) if device_api_key else None,
                row["device_id"],
            )
        )
        conn.commit()

    device = get_device(row["device_id"])
    if device and normalize_device_type(str(device.get("type", ""))) == "ESP32":
        with get_db_connection() as conn:
            initialize_sqlite_device_led_states(conn, row["device_id"])
            conn.commit()

    return {
        "ok": True,
        "device": device,
        "device_api_key": device_api_key,
        "commands_url": "/device/commands" if device_api_key else None,
    }


@app.get("/devices")
def list_devices(authorization: str | None = Header(default=None)):
    if using_supabase():
        context = authenticated_context(authorization)
        query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}"
            f"&organization_id=eq.{urllib.parse.quote(context['organization_id'])}"
            "&order=created_at.desc"
        )
        rows = supabase_rest("GET", query, access_token=context["token"])
        return {
            "ok": True,
            "devices": [device_row_to_dict(row) for row in (rows or [])],
        }

    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM devices ORDER BY created_at DESC"
        ).fetchall()

    return {
        "ok": True,
        "devices": [device_row_to_dict(row) for row in rows],
    }


@app.get("/devices/{device_id}/led-states")
def get_device_led_states(
    device_id: str,
    authorization: str | None = Header(default=None),
):
    safe_device_id = device_id.strip()
    if not safe_device_id:
        raise HTTPException(status_code=400, detail="device_id es obligatorio")

    if using_supabase():
        context = authenticated_context(authorization)
        query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}"
            f"&device_id=eq.{urllib.parse.quote(safe_device_id)}"
            f"&organization_id=eq.{urllib.parse.quote(context['organization_id'])}"
            "&limit=1"
        )
        rows = supabase_rest("GET", query, access_token=context["token"])
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

        device = device_row_to_dict(rows[0])
        if normalize_device_type(str(device.get("type", ""))) != "ESP32":
            raise HTTPException(status_code=400, detail="El dispositivo no es ESP32")

        state_rows = fetch_supabase_device_led_state_rows(device)
        state_rows = ensure_supabase_device_led_states(device, state_rows)
        command_rows = fetch_supabase_led_state_rows_from_executed_commands(device)
        state_rows = merge_led_state_rows_with_command_history(device, state_rows, command_rows)
        return build_led_states_response(device, state_rows)

    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM devices WHERE device_id = ?",
            (safe_device_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

        device = device_row_to_dict(row)
        if normalize_device_type(str(device.get("type", ""))) != "ESP32":
            raise HTTPException(status_code=400, detail="El dispositivo no es ESP32")

        initialize_sqlite_device_led_states(conn, safe_device_id)
        conn.commit()
        state_rows = fetch_sqlite_device_led_state_rows(conn, safe_device_id)
        command_rows = fetch_sqlite_led_state_rows_from_executed_commands(conn, safe_device_id)
        state_rows = merge_led_state_rows_with_command_history(device, state_rows, command_rows)

    return build_led_states_response(device, state_rows)


@app.delete("/devices/{device_id}")
def delete_device(
    device_id: str,
    authorization: str | None = Header(default=None),
):
    safe_device_id = urllib.parse.quote(device_id.strip(), safe="")
    if not safe_device_id:
        raise HTTPException(status_code=400, detail="device_id es obligatorio")

    if using_supabase():
        context = authenticated_context(authorization)
        safe_organization_id = urllib.parse.quote(context["organization_id"], safe="")
        device_query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}"
            f"&device_id=eq.{safe_device_id}"
            f"&organization_id=eq.{safe_organization_id}"
            "&limit=1"
        )
        rows = supabase_rest("GET", device_query, service_role=True)
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

        device = rows[0]
        created_by = str(device.get("created_by") or "")
        if context["role"] != "owner" and created_by != context["user_id"]:
            raise HTTPException(status_code=403, detail="No puedes eliminar este enlace")

        command_query = (
            "device_commands?select=command_id"
            f"&device_id=eq.{safe_device_id}"
            f"&organization_id=eq.{safe_organization_id}"
        )
        deleted_commands = supabase_rest(
            "DELETE",
            command_query,
            service_role=True,
            representation=True,
        )
        device_delete_query = (
            "devices?select=device_id"
            f"&device_id=eq.{safe_device_id}"
            f"&organization_id=eq.{safe_organization_id}"
        )
        deleted_devices = supabase_rest(
            "DELETE",
            device_delete_query,
            service_role=True,
            representation=True,
        )
        if not isinstance(deleted_devices, list) or not deleted_devices:
            raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

        return {
            "ok": True,
            "deleted_device_id": device_id,
            "deleted_commands": (
                len(deleted_commands) if isinstance(deleted_commands, list) else 0
            ),
        }

    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT device_id FROM devices WHERE device_id = ?",
            (device_id.strip(),),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

        deleted_commands = conn.execute(
            "DELETE FROM device_commands WHERE device_id = ?",
            (device_id.strip(),),
        ).rowcount
        conn.execute(
            "DELETE FROM device_led_states WHERE device_id = ?",
            (device_id.strip(),),
        )
        conn.execute(
            "DELETE FROM devices WHERE device_id = ?",
            (device_id.strip(),),
        )
        conn.commit()

    return {
        "ok": True,
        "deleted_device_id": device_id,
        "deleted_commands": max(deleted_commands, 0),
    }


@app.post("/devices/{device_id}/heartbeat")
def device_heartbeat(
    device_id: str,
    payload: HeartbeatRequest,
    authorization: str | None = Header(default=None),
):
    status = (payload.status or "online").strip().lower()
    if status not in {"online", "offline", "linked"}:
        status = "online"

    now = utc_now()

    if using_supabase():
        device_auth = authenticate_http_device(device_id, authorization)
        updated = supabase_http_request(
            "POST",
            "/rest/v1/rpc/heartbeat_device",
            service_role=True,
            payload={
                "p_device_id": device_id,
                "p_device_api_key_hash": device_auth["device_api_key_hash"],
                "p_status": status,
            },
        )
        if not updated:
            raise HTTPException(status_code=404, detail="Dispositivo no encontrado")
        return {"ok": True, "device_id": device_id, "status": status, "last_seen": to_iso(now)}

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


@app.get("/device/commands")
def poll_device_commands(
    device_id: str,
    authorization: str | None = Header(default=None),
):
    device_auth = authenticate_http_device(device_id, authorization)
    if using_supabase():
        return poll_supabase_device_commands(device_id, device_auth["device_api_key_hash"])

    cleanup_expired_device_commands()
    now = to_iso(utc_now())

    with get_db_connection() as conn:
        conn.execute(
            """
            UPDATE devices
            SET status = 'online', last_seen = ?
            WHERE device_id = ?
            """,
            (now, device_id)
        )
        commands = fetch_sqlite_pending_command_group(conn, device_id)
        commands = mark_sqlite_commands_delivered(conn, commands)

    return build_polled_command_response(commands)


@app.post("/device/commands/{command_id}/ack")
def acknowledge_device_command(
    command_id: str,
    payload: DeviceCommandAckRequest,
    authorization: str | None = Header(default=None),
):
    device_auth = authenticate_http_device(payload.device_id.strip(), authorization)
    cleanup_expired_device_commands()
    status = payload.status.strip().lower()
    if status not in {"executed", "failed"}:
        raise HTTPException(status_code=400, detail="status debe ser executed o failed")

    if using_supabase():
        return acknowledge_supabase_device_command(
            command_id,
            payload.device_id.strip(),
            device_auth["device_api_key_hash"],
            status,
            payload.detail,
        )

    with get_db_connection() as conn:
        row = conn.execute(
            """
            SELECT * FROM device_commands
            WHERE command_id = ? AND device_id = ?
            """,
            (command_id, payload.device_id.strip())
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Comando no encontrado")
        if row["status"] == "expired":
            raise HTTPException(status_code=410, detail="Comando expirado")
        if row["status"] not in {"queued", "delivered", "executed", "failed"}:
            raise HTTPException(status_code=409, detail="Comando no puede confirmarse")

        source_request_id = row["source_request_id"]
        if source_request_id:
            group_rows = conn.execute(
                """
                SELECT * FROM device_commands
                WHERE device_id = ?
                  AND source_request_id = ?
                  AND status IN ('queued', 'delivered', 'executed', 'failed')
                ORDER BY created_at ASC
                """,
                (payload.device_id.strip(), source_request_id)
            ).fetchall()
        else:
            group_rows = [row]

        command_ids = [command["command_id"] for command in group_rows]
        placeholders = ",".join("?" for _ in command_ids)
        conn.execute(
            f"""
            UPDATE device_commands
            SET status = ?, ack_at = ?, failure_detail = ?
            WHERE command_id IN ({placeholders})
            """,
            (
                status,
                to_iso(utc_now()),
                (payload.detail or "").strip() or None,
                *command_ids,
            )
        )
        conn.commit()
        updated = conn.execute(
            f"""
            SELECT * FROM device_commands
            WHERE command_id IN ({placeholders})
            ORDER BY created_at ASC
            """,
            tuple(command_ids)
        ).fetchall()
        if status == "executed":
            upsert_sqlite_led_states_from_commands(conn, updated)
            conn.commit()

    deliveries = [command_row_to_dict(command) for command in updated]
    return {
        "ok": status == "executed",
        "delivery": deliveries[0] if deliveries else None,
        "deliveries": deliveries,
    }


def acknowledge_supabase_device_command(
    command_id: str,
    device_id: str,
    device_api_key_hash: str,
    status: str,
    detail: str | None,
) -> dict:
    verify_supabase_http_device(device_id, device_api_key_hash)
    cleanup_expired_device_commands_for_device(device_id)

    query = (
        "device_commands?select=*"
        f"&command_id=eq.{urllib.parse.quote(command_id)}"
        f"&device_id=eq.{urllib.parse.quote(device_id)}"
        "&limit=1"
    )
    rows = supabase_rest("GET", query, service_role=True)
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Comando no encontrado")

    command = rows[0]
    if command.get("status") == "expired":
        raise HTTPException(status_code=410, detail="Comando expirado")
    if command.get("status") not in {"queued", "delivered", "executed", "failed"}:
        raise HTTPException(status_code=409, detail="Comando no puede confirmarse")

    source_request_id = command.get("source_request_id")
    if source_request_id:
        group_query = (
            "device_commands?select=*"
            f"&device_id=eq.{urllib.parse.quote(device_id)}"
            f"&source_request_id=eq.{urllib.parse.quote(str(source_request_id))}"
            "&status=in.(queued,delivered,executed,failed)&order=created_at.asc"
        )
        group_rows = supabase_rest("GET", group_query, service_role=True)
        commands = group_rows if isinstance(group_rows, list) and group_rows else [command]
        patch_query = (
            "device_commands?status=in.(queued,delivered,executed,failed)"
            f"&device_id=eq.{urllib.parse.quote(device_id)}"
            f"&source_request_id=eq.{urllib.parse.quote(str(source_request_id))}"
        )
        fetch_query = group_query.replace("&status=in.(queued,delivered,executed,failed)", "")
    else:
        commands = [command]
        patch_query = f"device_commands?command_id=eq.{urllib.parse.quote(command_id)}"
        fetch_query = query

    supabase_rest(
        "PATCH",
        patch_query,
        service_role=True,
        payload={
            "status": status,
            "ack_at": to_iso(utc_now()),
            "failure_detail": (detail or "").strip() or None,
        },
    )
    updated = supabase_rest("GET", fetch_query, service_role=True)
    deliveries = [command_row_to_dict(command) for command in updated] if isinstance(updated, list) else []
    if status == "executed":
        state_source_rows = updated if isinstance(updated, list) and updated else commands
        upsert_supabase_led_states_from_commands(state_source_rows)
    if not deliveries:
        deliveries = [command_row_to_dict(command) for command in commands]
    return {
        "ok": status == "executed",
        "delivery": deliveries[0] if deliveries else None,
        "deliveries": deliveries,
    }


@app.get("/device/commands/{command_id}/status")
def get_device_command_status(
    command_id: str,
    authorization: str | None = Header(default=None),
):
    if using_supabase():
        context = authenticated_context(authorization)
        cleanup_expired_device_commands(context["organization_id"], context["token"])
        query = f"device_commands?select=*&command_id=eq.{urllib.parse.quote(command_id)}&limit=1"
        rows = supabase_rest("GET", query, access_token=context["token"])
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=404, detail="Comando no encontrado")
        return {"ok": True, "delivery": command_row_to_dict(rows[0])}

    cleanup_expired_device_commands()
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM device_commands WHERE command_id = ?",
            (command_id,)
        ).fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Comando no encontrado")

    return {
        "ok": True,
        "delivery": command_row_to_dict(row),
    }


@app.post("/devices/{device_id}/command")
def send_device_command(
    device_id: str,
    payload: DeviceCommandRequest,
    authorization: str | None = Header(default=None),
):
    context = authenticated_context(authorization) if using_supabase() else None
    device = get_device(device_id, context["token"] if context else None)
    if device is None:
        raise HTTPException(status_code=404, detail="Dispositivo no encontrado")

    accion = payload.accion.strip().upper()
    if accion not in {"ON", "OFF", "NONE", "CAPTURE", "LOCK", "ROUTE"}:
        raise HTTPException(status_code=400, detail="Accion no soportada")

    if device.get("transport") == "http_polling":
        if accion not in {"ON", "OFF"}:
            raise HTTPException(status_code=400, detail="ESP32 HTTP solo admite ON u OFF")
        delivery = enqueue_http_led_command(
            device,
            accion,
            payload.espacio or "desconocido",
            context=context,
        )
        return {
            "ok": True,
            "queued": True,
            "executed": False,
            "delivery": delivery,
        }

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

    if len(content) < VOICE_AUDIO_MIN_BYTES:
        raise HTTPException(
            status_code=422,
            detail=(
                "El audio recibido es demasiado pequeno para transcribir. "
                "Revisa que el microfono no este silenciado y vuelve a grabar."
            ),
        )

    if using_supabase():
        inferred_suffix = audio_suffix_for_content_type(content_type)
        original_path = Path(audio.filename or f"audio{inferred_suffix or '.webm'}")
        suffix = inferred_suffix or original_path.suffix or ".webm"
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filename = f"{timestamp}_{original_path.stem}{suffix}"
        temporary = tempfile.NamedTemporaryFile(prefix="afcr_voice_", suffix=suffix, delete=False)
        temporary.write(content)
        temporary.close()
        file_path = temporary.name
    else:
        filename, file_path = save_uploaded_audio(audio, content)

    return {
        "filename": filename,
        "file_path": file_path,
        "content_type": content_type,
        "content_type_normalized": normalize_audio_content_type(content_type),
        "content_size_bytes": len(content),
        "content": content,
        "temporary": using_supabase(),
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
    if normalize_audio_content_type(content_type).startswith("audio/"):
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


def transcribe_audio_with_openai_model(file_path: str, model: str) -> str:
    if openai_client is None:
        raise HTTPException(
            status_code=503,
            detail="OpenAI no esta inicializado. Revisa OPENAI_API_KEY en el backend.",
        )

    with open(file_path, "rb") as audio_file:
        result = openai_client.audio.transcriptions.create(
            model=model,
            file=audio_file,
            language="es",
        )

    return getattr(result, "text", "").strip()


def transcribe_audio_with_openai(file_path: str) -> str:
    """
    Transcribe un archivo de audio usando OpenAI.
    Si el modelo principal devuelve texto vacio, reintenta con whisper-1.
    """
    models = [OPENAI_TRANSCRIBE_MODEL]
    if OPENAI_TRANSCRIBE_FALLBACK_MODEL and OPENAI_TRANSCRIBE_FALLBACK_MODEL not in models:
        models.append(OPENAI_TRANSCRIBE_FALLBACK_MODEL)

    errors = []
    for model in models:
        try:
            text = transcribe_audio_with_openai_model(file_path, model)
        except Exception as e:
            print(f"Error OpenAI transcripcion con {model}:", repr(e))
            errors.append(f"{model}: {e}")
            continue

        if text:
            if model != OPENAI_TRANSCRIBE_MODEL:
                print(f"Transcripcion recuperada con fallback {model}.")
            return text

        print(f"OpenAI devolvio transcripcion vacia con {model}.")

    if errors:
        raise HTTPException(
            status_code=502,
            detail="OpenAI no pudo transcribir el audio: " + " | ".join(errors),
        )

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

        "dormitorio": "dormitorio",
        "el dormitorio": "dormitorio",
        "mi dormitorio": "dormitorio",
        "cuarto principal": "dormitorio",
        "el cuarto principal": "dormitorio",
        "mi cuarto principal": "dormitorio",
        "habitacion principal": "dormitorio",
        "habitación principal": "dormitorio",
        "dormitorio principal": "dormitorio",
        "recamara principal": "dormitorio",
        "cuarto_principal": "dormitorio",
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
        "dormitorio": "dormitorio",
        "habitacion principal": "dormitorio",
        "recamara principal": "dormitorio",
        "cuarto_principal": "dormitorio",
    }

    if e in equivalencias_sin_tilde:
        return equivalencias_sin_tilde[e]

    return "desconocido"


def normalize_rule_text(text: str) -> str:
    """
    Normaliza texto para reglas locales de voz: minusculas, sin tildes,
    guiones bajos como espacios y puntuacion irrelevante fuera.
    """
    normalized = normalize_text(text).replace("_", " ")
    replacements = {
        "á": "a",
        "é": "e",
        "í": "i",
        "ó": "o",
        "ú": "u",
        "ü": "u",
        "ñ": "n",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)

    normalized = re.sub(r"[^a-z0-9\s]", " ", normalized)
    return " ".join(normalized.split())


def detect_light_action(text: str) -> str:
    plain = normalize_rule_text(text)
    match = LIGHT_ACTION_PATTERN.search(plain)
    if match:
        return LIGHT_ACTION_WORDS.get(match.group(1), "NONE")

    if any(phrase in plain for phrase in ("a oscuras", "sin luz", "sin luces")):
        return "OFF"

    return "NONE"


def mentions_light_words(text: str) -> bool:
    plain = normalize_rule_text(text)
    return any(re.search(rf"\b{re.escape(word)}\b", plain) for word in LIGHT_WORD_ALIASES)


def mentions_all_lights(text: str) -> bool:
    plain = normalize_rule_text(text)
    if not plain:
        return False

    all_patterns = (
        "todas las luces",
        "toda las luces",
        "todos los leds",
        "todos los led",
        "todos los focos",
        "todas las lamparas",
    )
    if any(pattern in plain for pattern in all_patterns):
        return True

    words = set(plain.split())
    mentions_all = bool(words.intersection({"todas", "todos"}))
    return mentions_all and any(word in words for word in LIGHT_WORD_ALIASES)


def detect_spaces_in_text(text: str) -> list[str]:
    plain = normalize_rule_text(text)
    matches: list[tuple[int, str]] = []

    for espacio, aliases in LIGHT_SPACE_ALIASES.items():
        positions = []
        for alias in aliases:
            alias_plain = normalize_rule_text(alias)
            match = re.search(rf"\b{re.escape(alias_plain)}\b", plain)
            if match:
                positions.append(match.start())
        if positions:
            matches.append((min(positions), espacio))

    ordered: list[str] = []
    for _position, espacio in sorted(matches, key=lambda item: item[0]):
        if espacio not in ordered:
            ordered.append(espacio)

    return ordered


def coalesce_light_commands(commands: list[dict]) -> tuple[list[dict], bool]:
    normalized: list[dict] = []
    seen_actions: dict[str, str] = {}

    for command in commands:
        espacio = normalize_espacio(str(command.get("espacio", "desconocido")))
        accion = str(command.get("accion", "NONE")).strip().upper()
        if espacio not in ESPACIOS_VALIDOS or accion not in {"ON", "OFF"}:
            continue

        previous_action = seen_actions.get(espacio)
        if previous_action and previous_action != accion:
            return [], True
        if previous_action == accion:
            continue

        seen_actions[espacio] = accion
        normalized.append({"espacio": espacio, "accion": accion})

    return normalized, False


def extract_light_commands_from_text(texto_transcrito: str) -> tuple[list[dict], bool]:
    plain = normalize_rule_text(texto_transcrito)
    if not plain:
        return [], False

    action_matches = list(LIGHT_ACTION_PATTERN.finditer(plain))
    if not action_matches:
        action = detect_light_action(plain)
        if action == "NONE":
            return [], False
        spaces = list(ESP32_MULTIROOM_ESPACIOS) if mentions_all_lights(plain) else detect_spaces_in_text(plain)
        return coalesce_light_commands([{"espacio": espacio, "accion": action} for espacio in spaces])

    commands: list[dict] = []
    for index, match in enumerate(action_matches):
        action = LIGHT_ACTION_WORDS.get(match.group(1), "NONE")
        next_start = action_matches[index + 1].start() if index + 1 < len(action_matches) else len(plain)
        segment = plain[match.start():next_start]
        spaces = list(ESP32_MULTIROOM_ESPACIOS) if mentions_all_lights(segment) else detect_spaces_in_text(segment)

        # Para frases como "prende todas las luces" si la palabra "todas" quedo antes
        # del verbo por la transcripcion, rescata el alcance global solo cuando hay una accion.
        if not spaces and len(action_matches) == 1 and mentions_all_lights(plain):
            spaces = list(ESP32_MULTIROOM_ESPACIOS)

        commands.extend({"espacio": espacio, "accion": action} for espacio in spaces)

    return coalesce_light_commands(commands)


def normalize_light_commands(
    raw_commands,
    texto_transcrito: str = "",
    fallback_action: str = "NONE",
    fallback_space: str = "desconocido",
) -> tuple[list[dict], bool]:
    text_commands, text_conflict = extract_light_commands_from_text(texto_transcrito)
    if text_conflict:
        return [], True

    model_commands: list[dict] = []
    if isinstance(raw_commands, list):
        model_commands, model_conflict = coalesce_light_commands(
            [command for command in raw_commands if isinstance(command, dict)]
        )
        if model_conflict:
            return [], True

    fallback_space = normalize_espacio(str(fallback_space))
    fallback_action = str(fallback_action).strip().upper()
    all_lights_requested = mentions_all_lights(texto_transcrito)

    if all_lights_requested:
        if text_commands:
            return text_commands, False
        if fallback_action in {"ON", "OFF"}:
            return coalesce_light_commands([
                {"espacio": espacio, "accion": fallback_action}
                for espacio in ESP32_MULTIROOM_ESPACIOS
            ])

    if len(text_commands) > 1:
        return text_commands, False

    if model_commands:
        return model_commands, False

    if fallback_space in ESPACIOS_VALIDOS and fallback_action in {"ON", "OFF"}:
        return [{"espacio": fallback_space, "accion": fallback_action}], False

    if text_commands:
        return text_commands, False

    return [], False


def describe_light_commands(commands: list[dict]) -> str:
    labels = []
    for command in commands:
        accion = str(command.get("accion", "NONE")).upper()
        espacio = ESPACIOS_DESCRIPCION.get(command.get("espacio"), command.get("espacio", "ambiente"))
        accion_texto = "encender" if accion == "ON" else "apagar"
        labels.append(f"{accion_texto} {espacio}")

    if not labels:
        return "sin comandos de luces"
    if len(labels) == 1:
        return labels[0]
    return ", ".join(labels[:-1]) + f" y {labels[-1]}"


def light_space_label(espacio: str) -> str:
    """Devuelve el nombre visible del ambiente sin cambiar el contrato interno."""
    normalized_space = normalize_espacio(str(espacio))
    if normalized_space in ESPACIOS_DESCRIPCION:
        return ESPACIOS_DESCRIPCION[normalized_space]

    plain = str(espacio or "").strip().lower()
    if plain in {"multiple", "todos", "todas", "all"}:
        return "Todas"

    return str(espacio or "desconocido")


def is_all_lights_command(commands: list[dict]) -> bool:
    if len(commands) != len(ESP32_MULTIROOM_ESPACIOS):
        return False

    command_spaces = {normalize_espacio(str(command.get("espacio", ""))) for command in commands}
    return command_spaces == set(ESP32_MULTIROOM_ESPACIOS)


def public_light_command(command: dict) -> dict:
    return {
        **command,
        "espacio": light_space_label(str(command.get("espacio", "desconocido"))),
    }


def public_delivery_preview(preview: dict | None) -> dict | None:
    if preview is None:
        return None

    return {
        **preview,
        "espacio": light_space_label(str(preview.get("espacio", "desconocido"))),
    }


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
    commands, conflict = normalize_light_commands([], texto_transcrito)

    if conflict:
        return {
            "texto": texto_transcrito,
            "intencion": "control_luces",
            "detalle": "comandos contradictorios sobre el mismo ambiente",
            "espacio": "desconocido",
            "accion": "NONE",
            "comandos_luces": [],
            "conflicto_comandos": True,
        }

    accion = "NONE"
    espacio = "desconocido"

    if commands:
        accion = commands[0]["accion"]
        espacio = commands[0]["espacio"]
    else:
        accion = detect_light_action(t)
        spaces = detect_spaces_in_text(t)
        if spaces:
            espacio = spaces[0]

    intencion = "control_luces" if accion in {"ON", "OFF"} and (espacio != "desconocido" or mentions_light_words(t)) else "otra"
    result = {
        "texto": texto_transcrito,
        "intencion": intencion,
        "detalle": "resultado por reglas locales",
        "espacio": espacio,
        "accion": accion,
    }

    if len(commands) > 1:
        result["comandos_luces"] = commands
        result["detalle"] = f"comandos multiples: {describe_light_commands(commands)}"

    return result


def split_ai_interpretation(ia_json: dict | None) -> tuple[dict | None, str]:
    """
    Separa la salida de la IA en dos canales:
    - intencion_json: datos para dispositivos y automatizacion.
    - respuesta_usuario: texto natural para la persona.
    Acepta el formato nuevo y tambien el formato anterior por compatibilidad.
    """
    if not ia_json:
        return None, ""

    if isinstance(ia_json.get("intencion_json"), dict):
        return ia_json.get("intencion_json"), str(ia_json.get("respuesta_usuario", "")).strip()

    legacy_intent = dict(ia_json)
    respuesta_usuario = str(legacy_intent.pop("respuesta_usuario", "")).strip()

    return legacy_intent, respuesta_usuario


def sanitize_ai_json(
    ia_json: dict | None,
    texto_transcrito: str,
    respuesta_usuario: str = "",
) -> dict:
    """
    Limpia y valida el JSON generado por la IA.
    Si la IA falla, usa fallback por reglas.
    """
    if not ia_json:
        return fallback_rule_parser(texto_transcrito)

    texto = str(ia_json.get("texto", texto_transcrito)).strip()
    intencion = str(ia_json.get("intencion", "otra")).strip().lower()
    detalle = str(ia_json.get("detalle", "")).strip()
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
    }

    commands, conflict = normalize_light_commands(
        ia_json.get("comandos_luces"),
        texto_transcrito,
        accion,
        espacio,
    )
    if conflict:
        saneado.update({
            "intencion": "control_luces",
            "detalle": detalle or "comandos contradictorios sobre el mismo ambiente",
            "espacio": "desconocido",
            "accion": "NONE",
            "comandos_luces": [],
            "conflicto_comandos": True,
        })
        return saneado

    if commands:
        saneado["intencion"] = "control_luces"
        saneado["espacio"] = commands[0]["espacio"]
        saneado["accion"] = commands[0]["accion"]
        if len(commands) > 1:
            saneado["comandos_luces"] = commands
            if not saneado["detalle"]:
                saneado["detalle"] = f"comandos multiples: {describe_light_commands(commands)}"

    # Si quedó ambiguo, intenta rescatar con fallback
    if saneado["espacio"] == "desconocido" or saneado["accion"] == "NONE":
        fallback = fallback_rule_parser(texto_transcrito)

        if fallback.get("conflicto_comandos"):
            saneado.update(fallback)
            return saneado

        if saneado["espacio"] == "desconocido" and fallback["espacio"] != "desconocido":
            saneado["espacio"] = fallback["espacio"]

        if saneado["accion"] == "NONE" and fallback["accion"] != "NONE":
            saneado["accion"] = fallback["accion"]

        if saneado["intencion"] == "otra" and fallback["intencion"] == "control_luces":
            saneado["intencion"] = "control_luces"

        if fallback.get("comandos_luces"):
            saneado["comandos_luces"] = fallback["comandos_luces"]

        if not saneado["detalle"]:
            saneado["detalle"] = "ajustado con validación local"

    return saneado


def sanitize_user_reply(respuesta_usuario: str, texto_transcrito: str, intencion_json: dict) -> str:
    """
    Limpia el texto natural para el usuario y garantiza una respuesta de respaldo.
    """
    respuesta = " ".join(str(respuesta_usuario or "").strip().split())
    looks_like_machine_payload = (
        respuesta.startswith("{")
        or respuesta.startswith("[")
        or '"intencion_json"' in respuesta
        or '"accion"' in respuesta
        or '"espacio"' in respuesta
    )

    if respuesta and not looks_like_machine_payload:
        return respuesta

    return build_default_ai_reply(texto_transcrito, intencion_json)


def build_default_ai_reply(texto_transcrito: str, ia_json: dict) -> str:
    """
    Construye una respuesta conversacional si el modelo no devuelve una.
    """
    intencion = ia_json.get("intencion", "otra")
    espacio = ia_json.get("espacio", "desconocido")
    accion = ia_json.get("accion", "NONE")
    comandos_luces = ia_json.get("comandos_luces") if isinstance(ia_json.get("comandos_luces"), list) else []

    if ia_json.get("conflicto_comandos"):
        return (
            "Escuche ordenes contradictorias para el mismo ambiente. Dime de nuevo "
            "que luz quieres encender o apagar para ejecutarlo con seguridad."
        )

    if intencion == "control_luces" and len(comandos_luces) > 1:
        return (
            f"Listo, entendi que quieres {describe_light_commands(comandos_luces)}. "
            "Lo dejo preparado y espero tu confirmacion antes de tocar el hardware."
        )

    if intencion == "control_luces" and accion in {"ON", "OFF"}:
        accion_texto = "encender" if accion == "ON" else "apagar"
        if espacio != "desconocido":
            return (
                f"Listo, entendi que quieres {accion_texto} la luz de "
                f"{ESPACIOS_DESCRIPCION.get(espacio, espacio)}. Te preparo el plan "
                "y espero tu confirmacion antes de tocar el hardware."
            )
        return (
            f"Entendi que quieres {accion_texto} un LED. Dime si es sala, "
            "cocina, comedor o dormitorio para preparar el comando correcto."
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
            "description": "Detalle técnico breve para auditoría y depuración, no para hablar con el usuario."
        },
        "espacio": {
            "type": "string",
            "enum": ["sala", "comedor", "cocina", "dormitorio", "desconocido"],
            "description": "Ambiente mencionado por el usuario."
        },
        "accion": {
            "type": "string",
            "enum": ["ON", "OFF", "NONE"],
            "description": "Acción solicitada."
        },
        "comandos_luces": {
            "type": "array",
            "description": "Lista de comandos de luces cuando la frase incluye varios ambientes, todas las luces o acciones mixtas. Usa [] si es comando simple o no aplica.",
            "items": {
                "type": "object",
                "properties": {
                    "espacio": {
                        "type": "string",
                        "enum": ["sala", "comedor", "cocina", "dormitorio"]
                    },
                    "accion": {
                        "type": "string",
                        "enum": ["ON", "OFF"]
                    }
                },
                "required": ["espacio", "accion"],
                "additionalProperties": False
            }
        }
    },
    "required": ["texto", "intencion", "detalle", "espacio", "accion", "comandos_luces"],
    "additionalProperties": False
}

AI_INTERPRETATION_SCHEMA = {
    "type": "object",
    "properties": {
        "intencion_json": {
            **INTENT_JSON_SCHEMA,
            "description": (
                "Respuesta JSON para el dispositivo. Debe ser técnico, estable, parseable "
                "y sin lenguaje conversacional."
            )
        },
        "respuesta_usuario": {
            "type": "string",
            "description": (
                "Respuesta IA para el usuario. Debe estar en lenguaje natural, claro, "
                "inteligente y comprensible por una persona."
            )
        }
    },
    "required": ["intencion_json", "respuesta_usuario"],
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
    - Devuelve exactamente dos canales separados:
      1. "intencion_json": respuesta JSON para el dispositivo.
      2. "respuesta_usuario": respuesta IA para el usuario.

    Reglas del canal "intencion_json":
    - Es exclusivamente para dispositivos, automatizacion, MQTT y logica interna.
    - Debe ser estable, corto, parseable y sin frases conversacionales.
    - No agregues consejos, explicaciones humanas ni texto natural dentro de este objeto.
    - Usa solo los campos permitidos por el esquema.

    Reglas del canal "respuesta_usuario":
    - Es exclusivamente para la persona que usa el dashboard.
    - Habla con estilo {AI_RESPONSE_STYLE}. Evita sonar robotico.
    - No pegues JSON, payloads MQTT, nombres de campos internos ni codigo.
    - Responde directamente a la frase transcrita del usuario; no des un resumen generico del dashboard si el usuario pidio o pregunto algo concreto.
    - Usa el contexto del dashboard solo cuando ayude a contestar esa pregunta concreta.
    - Explica lo que entendiste con lenguaje natural, inteligente y facil de comprender.
    - Si hay accion ejecutable, recuerda que queda lista y espera confirmacion.

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
    - Si menciona dormitorio, cuarto principal, habitacion principal, dormitorio principal o recamara principal, espacio = dormitorio.
    - Si no detectas ambiente, espacio = desconocido.
    - Si quiere controlar luces, intencion = control_luces.
    - Si habla de camaras, puertas, drones, seguridad general, preguntas o conversacion normal, intencion = otra.
    - Para un comando simple, llena espacio/accion legacy y usa comandos_luces = [].
    - Para varios ambientes o varias acciones en una frase, llena comandos_luces con cada orden y conserva espacio/accion con la primera orden por compatibilidad.
    - "prende cocina y comedor" => comandos_luces con cocina ON y comedor ON.
    - "prende todas las luces" => comandos_luces con sala, cocina, comedor y dormitorio en ON.
    - "apaga todas las luces" => comandos_luces con sala, cocina, comedor y dormitorio en OFF.
    - "prende cocina y apaga comedor" => comandos_luces con cocina ON y comedor OFF.
    - Si la misma frase da ordenes contradictorias al mismo ambiente, usa accion = NONE, espacio = desconocido, comandos_luces = [] y pide aclaracion.

    Como escribir "respuesta_usuario":
    - Maximo dos frases.
    - Debe contestar la pregunta o comando real del usuario, usando el texto transcrito como fuente principal.
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
                "name": "interpretacion_voz",
                "schema": AI_INTERPRETATION_SCHEMA,
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
        3. Separar la salida en JSON tecnico para dispositivos y respuesta natural para el usuario.
        4. Devolver SOLO un JSON válido.
        5. No devolver explicaciones fuera del JSON.
        6. Usar exactamente esta estructura:

        {{
          "intencion_json": {{
            "texto": "texto transcrito del usuario",
            "intencion": "control_luces o otra",
            "detalle": "detalle tecnico breve",
            "espacio": "sala, comedor, cocina, dormitorio o desconocido",
            "accion": "ON, OFF o NONE",
            "comandos_luces": []
          }},
          "respuesta_usuario": "respuesta IA natural, clara e inteligente para el usuario"
        }}

        Reglas:
        - Responde SOLO con JSON válido.
        - No uses Markdown.
        - No agregues texto extra.
        - Copia el texto transcrito en el campo "intencion_json.texto".
        - El idioma del usuario es español.
        - "intencion_json" es SOLO para dispositivos: no incluyas frases conversacionales, consejos ni explicaciones humanas.
        - "respuesta_usuario" es SOLO para el humano: no incluyas JSON, payloads, nombres de campos internos ni codigo.
        - "respuesta_usuario" debe responder directamente al texto transcrito del usuario, no a un estado generico del dashboard.
        - En "respuesta_usuario", no seas seco: responde con lenguaje natural, inteligente, comprensible y pide confirmacion si hay accion ejecutable.
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
        - Si menciona dormitorio, cuarto principal, habitación principal o dormitorio principal, usa "dormitorio".
        - Si no está claro, usa "desconocido".

        Para el campo "comandos_luces":
        - En un comando simple, usa [].
        - Si hay varios ambientes, todas las luces o acciones mixtas, agrega cada orden como {"espacio":"...","accion":"ON|OFF"}.
        - "prende cocina y comedor" significa cocina ON y comedor ON.
        - "prende todas las luces" significa sala, cocina, comedor y dormitorio ON.
        - "apaga todas las luces" significa sala, cocina, comedor y dormitorio OFF.
        - "prende cocina y apaga comedor" significa cocina ON y comedor OFF.
        - Si hay contradicción sobre el mismo ambiente, no ejecutes: accion NONE, espacio desconocido y comandos_luces [].

        Ejemplos:
        - "prende luz cocina" -> {{"intencion_json":{{"texto":"prende luz cocina","intencion":"control_luces","detalle":"encender luz de cocina","espacio":"cocina","accion":"ON"}},"respuesta_usuario":"Entendi: quieres encender la luz de cocina. Lo dejo listo y espero tu confirmacion para ejecutarlo."}}
        - "apaga la luz de la sala" -> {{"intencion_json":{{"texto":"apaga la luz de la sala","intencion":"control_luces","detalle":"apagar luz de sala","espacio":"sala","accion":"OFF"}},"respuesta_usuario":"Perfecto, preparo el apagado de la luz de sala y no lo ejecuto hasta que confirmes."}}
        - "enciende la luz del comedor" -> {{"intencion_json":{{"texto":"enciende la luz del comedor","intencion":"control_luces","detalle":"encender luz de comedor","espacio":"comedor","accion":"ON"}},"respuesta_usuario":"Claro, puedo encender la luz del comedor; primero te muestro el plan para confirmarlo."}}
        - "apaga dormitorio" -> {{"intencion_json":{{"texto":"apaga dormitorio","intencion":"control_luces","detalle":"apagar luz de dormitorio","espacio":"dormitorio","accion":"OFF"}},"respuesta_usuario":"Entendido, preparo apagar la luz del dormitorio y quedo esperando tu confirmacion."}}
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

def fase_3_interpretar_intencion(texto_transcrito: str) -> tuple[str, dict | None, dict, str]:
    """
    FASE 3:
    Interpreta el texto transcrito usando OpenAI API o IA local.
    Devuelve:
    - ia_raw: respuesta cruda de la IA
    - ia_json_raw: JSON extraído antes de limpiar
    - ia_json: intencion JSON final limpio y validado para dispositivos
    - respuesta_usuario: respuesta natural para el usuario
    """
    if not texto_transcrito:
        ia_json = fallback_rule_parser(texto_transcrito)
        respuesta_usuario = build_default_ai_reply(texto_transcrito, ia_json)
        return "", None, ia_json, respuesta_usuario

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
    ia_json_candidate, respuesta_usuario_raw = split_ai_interpretation(ia_json_raw)
    ia_json = sanitize_ai_json(ia_json_candidate, texto_transcrito, respuesta_usuario_raw)
    respuesta_usuario = sanitize_user_reply(respuesta_usuario_raw, texto_transcrito, ia_json)

    return ia_raw, ia_json_raw, ia_json, respuesta_usuario


# =========================================================
# FASE 4: JSON -> ENTREGA HTTP ESP32 O MQTT LEGACY -> ACTUADOR
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
    if any(word in text for word in ["luz", "luces", "led", "foco", "lampara", "lámpara"]):
        return "lights"

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


def build_light_mqtt_preview(
    espacio: str,
    accion: str,
    organization_id: str | None = None,
    access_token: str | None = None,
) -> tuple[dict | None, str]:
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

    device = find_light_device_for_space(espacio, organization_id, access_token)
    topic = device["mqtt_topic"] if device else MQTT_TOPIC_LUCES

    if device:
        payload["device_id"] = device["device_id"]

    return payload, topic


def build_http_delivery_preview(
    espacio: str,
    accion: str,
    organization_id: str | None = None,
    access_token: str | None = None,
) -> dict | None:
    espacio = normalize_espacio(espacio)
    accion = accion.upper().strip()

    if accion not in {"ON", "OFF"}:
        return None

    if espacio not in ESPACIOS_VALIDOS:
        return None

    device = find_http_esp32_for_space(espacio, organization_id, access_token)
    if device is None:
        return None

    return {
        "transport": "http_polling",
        "device_id": device["device_id"],
        "target": "led",
        "action": "turn_on" if accion == "ON" else "turn_off",
        "espacio": espacio,
        "status": "pending_confirmation",
        "commands_url": "/device/commands",
    }


def build_voice_intent_plan(
    texto_transcrito: str,
    ia_json: dict,
    respuesta_usuario: str = "",
    organization_id: str | None = None,
    access_token: str | None = None,
) -> dict:
    """
    Crea un plan pendiente para que el usuario lo confirme antes de ejecutar.
    """
    cleanup_expired_voice_plans()

    request_id = secrets.token_urlsafe(16)
    module = infer_command_module(texto_transcrito, ia_json)
    action = infer_module_action(module, texto_transcrito, ia_json)
    espacio = normalize_espacio(str(ia_json.get("espacio", "desconocido")))
    light_commands, command_conflict = normalize_light_commands(
        ia_json.get("comandos_luces"),
        texto_transcrito,
        action,
        espacio,
    )
    command_conflict = command_conflict or bool(ia_json.get("conflicto_comandos"))
    mqtt_preview = None
    delivery_preview = None
    delivery_previews: list[dict] = []
    can_execute = False

    if module == "lights" and command_conflict:
        action = "NONE"
        espacio = "desconocido"
        light_commands = []
    elif module == "lights" and len(light_commands) > 1:
        for command in light_commands:
            preview = build_http_delivery_preview(
                command["espacio"], command["accion"], organization_id, access_token
            )
            if preview is not None:
                delivery_previews.append(preview)

        if len(delivery_previews) == len(light_commands):
            delivery_preview = delivery_previews[0]
            can_execute = True

        action = light_commands[0]["accion"] if len({cmd["accion"] for cmd in light_commands}) == 1 else "MULTIPLE"
        espacio = "multiple"
    elif module == "lights":
        if len(light_commands) == 1:
            action = light_commands[0]["accion"]
            espacio = light_commands[0]["espacio"]

        delivery_preview = build_http_delivery_preview(
            espacio, action, organization_id, access_token
        )
        if delivery_preview is not None:
            espacio = delivery_preview.get("espacio", espacio)
            can_execute = True
        else:
            payload, topic = build_light_mqtt_preview(
                espacio, action, organization_id, access_token
            )
        if delivery_preview is None and payload is not None:
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
    ai_reply = str(respuesta_usuario or "").strip()
    espacio_label = ESPACIOS_DESCRIPCION.get(espacio, espacio)
    command_summary = describe_light_commands(light_commands)

    if command_conflict:
        respuesta = (
            "Escuche ordenes contradictorias para el mismo ambiente. Dime de nuevo "
            "que luz quieres encender o apagar para prepararlo con seguridad."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            "Pedir aclaracion porque un mismo ambiente recibio ordenes opuestas.",
        ]
    elif can_execute:
        respuesta = ai_reply or (
            f"Entendi el comando para {module_label}: {command_summary if len(light_commands) > 1 else f'{action} en {espacio_label}'}. "
            "Lo dejo preparado y espero tu confirmacion antes de ejecutarlo."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            (
                f"Preparar {module_label}: {command_summary}."
                if len(light_commands) > 1
                else f"Preparar {module_label} con accion {action} para {espacio_label}."
            ),
            (
                "Esperar confirmacion y enviar un solo lote batch al ESP32 por HTTPS."
                if delivery_previews
                else (
                    "Esperar confirmacion y dejar el comando disponible para el ESP32 por HTTPS."
                    if delivery_preview
                    else f"Esperar confirmacion y publicar el payload MQTT en {mqtt_preview['mqtt_topic']}."
                )
            ),
        ]
    elif module == "lights" and light_commands:
        respuesta = (
            f"Entendi que quieres {command_summary}, pero no encuentro un ESP32 enlazado "
            "para recibir esos comandos ahora mismo."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            "Confirmar que exista un ESP32 enlazado y online para sala, cocina, comedor y dormitorio.",
        ]
    elif module == "lights" and action in {"ON", "OFF"} and espacio == "desconocido":
        accion_texto = "encender" if action == "ON" else "apagar"
        respuesta = (
            f"Entendi que quieres {accion_texto} un LED. Dime si es sala, "
            "cocina, comedor o dormitorio para preparar el comando correcto."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            "Pedir el ambiente exacto: sala, cocina, comedor o dormitorio.",
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

    public_space = (
        "Todas"
        if len(light_commands) > 1 and is_all_lights_command(light_commands)
        else espacio
    )

    plan = {
        "request_id": request_id,
        "respuesta": respuesta,
        "steps": steps,
        "can_execute": can_execute,
        "module": module,
        "action": action,
        "espacio": public_space,
        "mqtt_preview": mqtt_preview,
        "delivery_preview": delivery_preview,
        "delivery_previews": delivery_previews or None,
        "delivery_mode": "batch_http_polling" if len(light_commands) > 1 and delivery_previews else ("http_polling" if delivery_preview else "mqtt" if mqtt_preview else None),
        "expires_at": to_iso(utc_now() + timedelta(seconds=VOICE_PLAN_TTL_SECONDS)),
    }

    if len(light_commands) > 1:
        plan["comandos_luces"] = [public_light_command(command) for command in light_commands]
        plan["batch"] = bool(delivery_previews)

    if not using_supabase():
        PENDING_VOICE_PLANS[request_id] = {
            "expires_at": utc_now() + timedelta(seconds=VOICE_PLAN_TTL_SECONDS),
            "plan": plan,
        }

    return plan


def send_mqtt_luz(
    espacio: str,
    accion: str,
    organization_id: str | None = None,
    access_token: str | None = None,
) -> tuple[bool, dict | None, str]:
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

        device = find_light_device_for_space(espacio, organization_id, access_token)
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
async def voice_intent(
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """
    Flujo principal:
    FASE 1: Recibir y guardar audio
    FASE 2: Transcribir audio con OpenAI
    FASE 3: Interpretar intención con IA
    FASE 4: Ejecutar acción por MQTT
    """

    context = authenticated_context(authorization) if using_supabase() else None
    fase_1 = await fase_1_recibir_y_guardar_audio(audio)
    audio_path = None
    audio_expires_at = None
    respuesta_ia_audio = None

    try:
        texto_transcrito = fase_2_transcribir_audio(
            file_path=fase_1["file_path"],
            filename=fase_1["filename"],
            content_type=fase_1["content_type"]
        )
        ia_raw, ia_json_raw, ia_json, respuesta_usuario = fase_3_interpretar_intencion(texto_transcrito)
        plan = build_voice_intent_plan(
            texto_transcrito,
            ia_json,
            respuesta_usuario,
            context["organization_id"] if context else None,
            context["token"] if context else None,
        )
        respuesta_usuario_final = str(plan.get("respuesta") or respuesta_usuario).strip()
        respuesta_ia_audio = generate_response_tts_audio(context, plan["request_id"], respuesta_usuario_final)
        plan["respuesta_ia_audio"] = respuesta_ia_audio

        if context:
            audio_path, audio_expires_at = upload_private_audio(
                context,
                plan["request_id"],
                fase_1["filename"],
                fase_1["content_type"],
                fase_1["content"],
            )
            supabase_rest(
                "POST",
                "voice_intents",
                service_role=True,
                payload={
                    "request_id": plan["request_id"],
                    "organization_id": context["organization_id"],
                    "user_id": context["user_id"],
                    "filename": fase_1["filename"],
                    "content_type": fase_1["content_type"],
                    "audio_path": audio_path,
                    "audio_expires_at": audio_expires_at,
                    "transcription": texto_transcrito,
                    "ai_provider": AI_PROVIDER,
                    "response_for_user": respuesta_usuario_final,
                    "device_intent": ia_json,
                    "plan": plan,
                    "status": "pending_confirmation" if plan["can_execute"] else "not_executable",
                    "expires_at": plan["expires_at"],
                },
            )
    finally:
        if fase_1.get("temporary"):
            try:
                os.unlink(fase_1["file_path"])
            except FileNotFoundError:
                pass

    # -------------------------
    # RESPUESTA FINAL
    # -------------------------
    return {
        "ok": True,
        "ai_provider": AI_PROVIDER,

        "fase_1_audio_guardado": {
            "filename": fase_1["filename"],
            "content_type": fase_1["content_type"],
            "content_type_normalized": fase_1["content_type_normalized"],
            "content_size_bytes": fase_1["content_size_bytes"],
            "stored": bool(audio_path) if context else True,
            "audio_expires_at": audio_expires_at,
        },

        "fase_2_transcripcion": {
            "texto_transcrito": texto_transcrito
        },

        "fase_3_ia_json": {
            "ia_raw": ia_raw,
            "ia_json_raw": ia_json_raw,
            "ia_json": ia_json,
            "intencion_json": ia_json,
            "respuesta_usuario": respuesta_usuario_final,
            "respuesta_json_dispositivo": ia_json,
            "respuesta_ia_usuario": respuesta_usuario_final,
        },
        "intencion_json": ia_json,
        "respuesta_usuario": respuesta_usuario_final,
        "respuesta_json_dispositivo": ia_json,
        "respuesta_ia_usuario": respuesta_usuario_final,
        "respuesta_ia_audio": respuesta_ia_audio,

        "plan": plan,
        "fase_4_mqtt": {
            "accion_mqtt": "PENDIENTE_CONFIRMACION" if plan["can_execute"] else "SIN_ACCION",
            "mqtt_topic": plan["mqtt_preview"]["mqtt_topic"] if plan["mqtt_preview"] else None,
            "mqtt_payload": plan["mqtt_preview"]["mqtt_payload"] if plan["mqtt_preview"] else None
        },
        "delivery": plan.get("delivery_preview"),
        "delivery_previews": plan.get("delivery_previews"),
    }


@app.get("/voice-intents/{request_id}/audio/respuesta-ia")
def voice_intent_user_reply_audio(
    request_id: str,
    authorization: str | None = Header(default=None),
):
    if not using_supabase():
        raise HTTPException(status_code=503, detail="Supabase no esta configurado en el backend")

    context = authenticated_context(authorization)
    safe_request_id = request_id.strip()
    if not safe_request_id:
        raise HTTPException(status_code=404, detail="Audio IA no encontrado")

    safe_organization_id = urllib.parse.quote(context["organization_id"])
    safe_request_id_query = urllib.parse.quote(safe_request_id)
    query = (
        "voice_intents?select=request_id,user_id,organization_id,plan"
        f"&request_id=eq.{safe_request_id_query}"
        f"&organization_id=eq.{safe_organization_id}"
        "&limit=1"
    )
    rows = supabase_rest("GET", query, access_token=context["token"])
    if not isinstance(rows, list) or not rows:
        raise HTTPException(status_code=404, detail="Audio IA no encontrado")

    record = rows[0]
    plan = record.get("plan") if isinstance(record.get("plan"), dict) else {}
    metadata = plan.get("respuesta_ia_audio") if isinstance(plan.get("respuesta_ia_audio"), dict) else {}
    if metadata and metadata.get("available") is False:
        raise HTTPException(status_code=404, detail="Audio IA no disponible para esta respuesta")

    storage_path, expected_content_type = resolve_tts_storage_path(record, safe_request_id)
    quoted_path = urllib.parse.quote(storage_path, safe="/")
    content, storage_content_type = supabase_binary_request(
        "GET",
        f"/storage/v1/object/authenticated/{SUPABASE_AUDIO_BUCKET}/{quoted_path}",
        access_token=context["token"],
    )
    media_type = expected_content_type or storage_content_type or "audio/mpeg"
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline; filename=respuesta-ia.mp3",
        },
    )


@app.post("/voice-intent/confirm")
def confirm_voice_intent(
    payload: VoiceIntentConfirmRequest,
    authorization: str | None = Header(default=None),
):
    """
    Ejecuta un plan de voz previamente devuelto por /voice-intent.
    Para ESP32 enlazados, encola una orden HTTPS hasta que el dispositivo envie ACK.
    Para luces legacy, mantiene la publicacion MQTT existente.
    """
    request_id = payload.request_id.strip()
    context = authenticated_context(authorization) if using_supabase() else None
    if context:
        query = (
            "voice_intents?select=request_id,plan,status,expires_at"
            f"&request_id=eq.{urllib.parse.quote(request_id)}&limit=1"
        )
        rows = supabase_rest("GET", query, access_token=context["token"])
        if not isinstance(rows, list) or not rows:
            raise HTTPException(status_code=404, detail="Plan no encontrado o expirado")
        pending = rows[0]
        expires_at = parse_iso(pending.get("expires_at"))
        if pending.get("status") != "pending_confirmation" or not expires_at or expires_at < utc_now():
            if pending.get("status") == "pending_confirmation":
                supabase_rest(
                    "PATCH",
                    f"voice_intents?request_id=eq.{urllib.parse.quote(request_id)}",
                    service_role=True,
                    payload={"status": "expired"},
                )
            raise HTTPException(status_code=404, detail="Plan no encontrado o expirado")
        plan = pending["plan"]
    else:
        cleanup_expired_voice_plans()
        pending = PENDING_VOICE_PLANS.pop(request_id, None)
        if pending is None:
            raise HTTPException(status_code=404, detail="Plan no encontrado o expirado")
        plan = pending["plan"]

    if not plan.get("can_execute"):
        if context:
            supabase_rest(
                "PATCH",
                f"voice_intents?request_id=eq.{urllib.parse.quote(request_id)}",
                service_role=True,
                payload={"status": "not_executable", "confirmed_at": to_iso(utc_now())},
            )
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
    plan_commands, plan_conflict = normalize_light_commands(
        plan.get("comandos_luces"),
        "",
        action,
        espacio,
    )
    if plan_conflict:
        raise HTTPException(status_code=400, detail="Plan con comandos contradictorios")

    if len(plan_commands) > 1:
        deliveries = []
        for command in plan_commands:
            http_device = find_http_esp32_for_space(
                command["espacio"],
                context["organization_id"] if context else None,
                context["token"] if context else None,
            )
            if http_device is None:
                raise HTTPException(status_code=400, detail="No hay ESP32 enlazado para ejecutar todos los comandos")
            deliveries.append(
                enqueue_http_led_command(
                    http_device,
                    command["accion"],
                    command["espacio"],
                    source_request_id=request_id,
                    context=context,
                )
            )

        if context:
            supabase_rest(
                "PATCH",
                f"voice_intents?request_id=eq.{urllib.parse.quote(request_id)}",
                service_role=True,
                payload={"status": "queued", "confirmed_at": to_iso(utc_now())},
            )
        return {
            "ok": True,
            "queued": True,
            "executed": False,
            "message": "Comandos enviados en un lote batch al ESP32. Esperando confirmacion de los LEDs.",
            "plan": plan,
            "delivery": deliveries[0] if deliveries else None,
            "deliveries": deliveries,
            "queued_count": len(deliveries),
            "batch": True,
            "delivery_mode": "batch_http_polling",
            "fase_4_mqtt": {
                "accion_mqtt": "COLA_HTTP_ESP32_MULTI",
                "mqtt_topic": None,
                "mqtt_payload": None,
            }
        }

    http_device = find_http_esp32_for_space(
        espacio,
        context["organization_id"] if context else None,
        context["token"] if context else None,
    )
    if http_device is not None:
        delivery = enqueue_http_led_command(
            http_device,
            action,
            espacio,
            source_request_id=request_id,
            context=context,
        )
        if context:
            supabase_rest(
                "PATCH",
                f"voice_intents?request_id=eq.{urllib.parse.quote(request_id)}",
                service_role=True,
                payload={"status": "queued", "confirmed_at": to_iso(utc_now())},
            )
        return {
            "ok": True,
            "queued": True,
            "executed": False,
            "message": "Comando enviado a la cola del ESP32. Esperando confirmacion del LED.",
            "plan": plan,
            "delivery": delivery,
            "fase_4_mqtt": {
                "accion_mqtt": "COLA_HTTP_ESP32",
                "mqtt_topic": None,
                "mqtt_payload": None,
            }
        }

    ok, mqtt_payload, mqtt_topic = send_mqtt_luz(
        espacio,
        action,
        context["organization_id"] if context else None,
        context["token"] if context else None,
    )
    if context:
        supabase_rest(
            "PATCH",
            f"voice_intents?request_id=eq.{urllib.parse.quote(request_id)}",
            service_role=True,
            payload={
                "status": "executed" if ok else "failed",
                "confirmed_at": to_iso(utc_now()),
            },
        )
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


@app.get("/voice-intents/recent")
def recent_voice_intents(authorization: str | None = Header(default=None)):
    if not using_supabase():
        return {"ok": True, "items": []}

    context = authenticated_context(authorization)
    query = (
        "voice_intents?select=request_id,transcription,response_for_user,device_intent,"
        "status,created_at,confirmed_at,audio_expires_at,audio_purged_at"
        f"&organization_id=eq.{urllib.parse.quote(context['organization_id'])}"
        "&order=created_at.desc&limit=12"
    )
    items = supabase_rest("GET", query, access_token=context["token"])
    return {"ok": True, "items": items or []}
