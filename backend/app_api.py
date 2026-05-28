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
# - cuarto_principal
# =========================================================


# =========================================================
# IMPORTACIONES
# =========================================================

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
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
PAIRING_TOKEN_MINUTES = int(os.getenv("PAIRING_TOKEN_MINUTES", "10"))
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
SUPABASE_DEVICE_SAFE_COLUMNS = (
    "device_id,organization_id,created_by,name,type,model,assigned_space,status,"
    "mqtt_topic,last_seen,created_at,pairing_expires_at,claimed_at"
)

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


def upload_private_audio(
    context: dict,
    request_id: str,
    filename: str,
    content_type: str,
    content: bytes,
) -> tuple[str, str]:
    object_path = f"{context['user_id']}/{request_id}/{filename}"
    quoted_path = urllib.parse.quote(object_path, safe="/")
    storage_content_type = (content_type or "application/octet-stream").split(";", 1)[0].strip()
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

    for row in rows:
        device = device_row_to_dict(row)
        name = device["name"].lower().replace("_", " ")
        if normalized_space in name or space_text in name:
            return device

    return device_row_to_dict(rows[0])


def find_http_esp32_for_space(
    espacio: str,
    organization_id: str | None = None,
    access_token: str | None = None,
) -> dict | None:
    normalized_space = normalize_espacio(espacio)
    if normalized_space not in ESPACIOS_VALIDOS:
        return None

    if using_supabase():
        if not organization_id or not access_token:
            return None
        query = (
            f"devices?select={SUPABASE_DEVICE_SAFE_COLUMNS}&claimed_at=not.is.null&type=eq.ESP32"
            f"&organization_id=eq.{urllib.parse.quote(organization_id)}"
            f"&assigned_space=eq.{urllib.parse.quote(normalized_space)}"
            "&order=claimed_at.desc&limit=1"
        )
        rows = supabase_rest("GET", query, access_token=access_token)
        if isinstance(rows, list) and rows:
            return device_row_to_dict(rows[0])
        return None

    space_aliases = {
        "sala": ("sala",),
        "comedor": ("comedor",),
        "cocina": ("cocina",),
        "cuarto_principal": ("cuarto principal", "dormitorio principal", "habitacion principal"),
    }
    with get_db_connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM devices
            WHERE claimed_at IS NOT NULL
              AND lower(type) = 'esp32'
            ORDER BY claimed_at DESC
            """
        ).fetchall()

    for row in rows:
        device = device_row_to_dict(row)
        name = normalize_text(device["name"]).replace("_", " ")
        if any(alias in name for alias in space_aliases[normalized_space]):
            return device

    return None


def infer_device_space(device: dict) -> str:
    name = normalize_text(str(device.get("name", ""))).replace("_", " ")
    aliases = (
        ("cuarto_principal", ("cuarto principal", "dormitorio principal", "habitacion principal")),
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
        result = supabase_http_request(
            "POST",
            "/rest/v1/rpc/poll_device_command",
            service_role=True,
            payload={
                "p_device_id": device_id,
                "p_device_api_key_hash": device_auth["device_api_key_hash"],
            },
        )
        if not isinstance(result, dict):
            raise HTTPException(status_code=401, detail="Credencial de dispositivo invalida")
        return {"ok": True, **result}

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
        row = conn.execute(
            """
            SELECT * FROM device_commands
            WHERE device_id = ?
              AND status IN ('queued', 'delivered')
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (device_id,)
        ).fetchone()

        if row is not None and row["status"] == "queued":
            conn.execute(
                """
                UPDATE device_commands
                SET status = 'delivered', delivered_at = ?
                WHERE command_id = ?
                """,
                (now, row["command_id"])
            )
            row = conn.execute(
                "SELECT * FROM device_commands WHERE command_id = ?",
                (row["command_id"],)
            ).fetchone()

        conn.commit()

    if row is None:
        return {
            "ok": True,
            "command_id": None,
            "target": "led",
            "action": "none",
            "status": "idle",
        }

    command = command_row_to_dict(row)
    return {
        "ok": True,
        "command_id": command["command_id"],
        "target": command["target"],
        "action": command["action"],
        "espacio": command["espacio"],
        "status": command["status"],
        "expires_at": command["expires_at"],
    }


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
        delivery = supabase_http_request(
            "POST",
            "/rest/v1/rpc/ack_device_command",
            service_role=True,
            payload={
                "p_command_id": command_id,
                "p_device_id": payload.device_id.strip(),
                "p_device_api_key_hash": device_auth["device_api_key_hash"],
                "p_status": status,
                "p_detail": payload.detail,
            },
        )
        if not isinstance(delivery, dict):
            raise HTTPException(status_code=404, detail="Comando no encontrado o expirado")
        return {"ok": status == "executed", "delivery": delivery}

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

        conn.execute(
            """
            UPDATE device_commands
            SET status = ?, ack_at = ?, failure_detail = ?
            WHERE command_id = ?
            """,
            (
                status,
                to_iso(utc_now()),
                (payload.detail or "").strip() or None,
                command_id,
            )
        )
        conn.commit()
        updated = conn.execute(
            "SELECT * FROM device_commands WHERE command_id = ?",
            (command_id,)
        ).fetchone()

    return {
        "ok": status == "executed",
        "delivery": command_row_to_dict(updated),
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
            payload.espacio or infer_device_space(device),
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

    if using_supabase():
        suffix = Path(audio.filename or "audio.webm").suffix or ".webm"
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        filename = f"{timestamp}_{Path(audio.filename or 'audio.webm').name}"
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
        "accion": accion
    }


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
        "accion": accion
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
            "description": "Detalle técnico breve para auditoría y depuración, no para hablar con el usuario."
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
    "required": ["texto", "intencion", "detalle", "espacio", "accion"],
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
    - Si menciona cuarto principal, habitacion principal, dormitorio principal o recamara principal, espacio = cuarto_principal.
    - Si no detectas ambiente, espacio = desconocido.
    - Si quiere controlar luces, intencion = control_luces.
    - Si habla de camaras, puertas, drones, seguridad general, preguntas o conversacion normal, intencion = otra.

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
            "espacio": "sala, comedor, cocina, cuarto_principal o desconocido",
            "accion": "ON, OFF o NONE"
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
        - Si menciona cuarto principal, habitación principal o dormitorio principal, usa "cuarto_principal".
        - Si no está claro, usa "desconocido".

        Ejemplos:
        - "prende luz cocina" -> {{"intencion_json":{{"texto":"prende luz cocina","intencion":"control_luces","detalle":"encender luz de cocina","espacio":"cocina","accion":"ON"}},"respuesta_usuario":"Entendi: quieres encender la luz de cocina. Lo dejo listo y espero tu confirmacion para ejecutarlo."}}
        - "apaga la luz de la sala" -> {{"intencion_json":{{"texto":"apaga la luz de la sala","intencion":"control_luces","detalle":"apagar luz de sala","espacio":"sala","accion":"OFF"}},"respuesta_usuario":"Perfecto, preparo el apagado de la luz de sala y no lo ejecuto hasta que confirmes."}}
        - "enciende la luz del comedor" -> {{"intencion_json":{{"texto":"enciende la luz del comedor","intencion":"control_luces","detalle":"encender luz de comedor","espacio":"comedor","accion":"ON"}},"respuesta_usuario":"Claro, puedo encender la luz del comedor; primero te muestro el plan para confirmarlo."}}
        - "apaga cuarto principal" -> {{"intencion_json":{{"texto":"apaga cuarto principal","intencion":"control_luces","detalle":"apagar luz del cuarto principal","espacio":"cuarto_principal","accion":"OFF"}},"respuesta_usuario":"Entendido, preparo apagar la luz del cuarto principal y quedo esperando tu confirmacion."}}
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
    device = find_http_esp32_for_space(espacio, organization_id, access_token)

    if device is None or accion not in {"ON", "OFF"}:
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
    espacio = ia_json.get("espacio", "desconocido")
    mqtt_preview = None
    delivery_preview = None
    can_execute = False

    if module == "lights":
        delivery_preview = build_http_delivery_preview(
            espacio, action, organization_id, access_token
        )
        if delivery_preview is not None:
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

    if can_execute:
        respuesta = ai_reply or (
            f"Entendi el comando para {module_label}: {action} en {espacio_label}. "
            "Lo dejo preparado y espero tu confirmacion antes de ejecutarlo."
        )
        steps = [
            "Validar lo que se transcribio del comando de voz.",
            f"Preparar {module_label} con accion {action} para {espacio_label}.",
            (
                "Esperar confirmacion y dejar el comando disponible para el ESP32 por HTTPS."
                if delivery_preview
                else f"Esperar confirmacion y publicar el payload MQTT en {mqtt_preview['mqtt_topic']}."
            ),
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
        "delivery_preview": delivery_preview,
        "expires_at": to_iso(utc_now() + timedelta(seconds=VOICE_PLAN_TTL_SECONDS)),
    }

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
                    "response_for_user": respuesta_usuario,
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
            "respuesta_usuario": respuesta_usuario,
            "respuesta_json_dispositivo": ia_json,
            "respuesta_ia_usuario": respuesta_usuario,
        },
        "intencion_json": ia_json,
        "respuesta_usuario": respuesta_usuario,
        "respuesta_json_dispositivo": ia_json,
        "respuesta_ia_usuario": respuesta_usuario,

        "plan": plan,
        "fase_4_mqtt": {
            "accion_mqtt": "PENDIENTE_CONFIRMACION" if plan["can_execute"] else "SIN_ACCION",
            "mqtt_topic": plan["mqtt_preview"]["mqtt_topic"] if plan["mqtt_preview"] else None,
            "mqtt_payload": plan["mqtt_preview"]["mqtt_payload"] if plan["mqtt_preview"] else None
        },
        "delivery": plan.get("delivery_preview"),
    }


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
