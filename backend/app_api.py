# =========================================================
# app_api.py
# ---------------------------------------------------------
# Sistema por fases:
#
# FASE 1: Celular -> Servidor -> Guarda audio
# FASE 2: Whisper -> Audio a texto
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

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import os
import subprocess
import json
import textwrap
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

# Whisper
from whisper_timestamped import load_model, transcribe

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
MQTT_SERVER = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC_LUCES = "casa/esp32/luces"

# --- Whisper ---
WHISPER_MODEL_NAME = "tiny"

# --- CORS ---
# Separar con comas si se necesitan otros origenes:
# CORS_ALLOW_ORIGINS="https://afcrseguridad.com,http://localhost:3000"
DEFAULT_CORS_ALLOW_ORIGINS = (
    "https://afcrseguridad.com",
    "https://www.afcrseguridad.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
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
# Modelo recomendado para esta tarea:
# Puedes cambiarlo por variable de entorno:
# export OPENAI_MODEL="gpt-4o-mini"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

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
        client.connect(MQTT_SERVER, MQTT_PORT, 60)
        client.loop_start()
        print(f"Conectado a MQTT en {MQTT_SERVER}:{MQTT_PORT}")

    except Exception as e:
        print("ERROR MQTT:", e)

    return client


mqtt_client = create_mqtt_client()


# =========================================================
# INICIALIZACIÓN WHISPER
# =========================================================

print(f"Cargando modelo Whisper ({WHISPER_MODEL_NAME})...")
whisper_model = load_model(WHISPER_MODEL_NAME)
print("Whisper cargado correctamente.")


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
            print(f"OpenAI configurado correctamente. Modelo: {OPENAI_MODEL}")
        except Exception as e:
            print("ERROR inicializando OpenAI:", e)


# =========================================================
# ENDPOINTS BÁSICOS
# =========================================================

@app.get("/")
def root():
    return {
        "ok": True,
        "message": "API viva",
        "demo": "4 LEDs por ambiente",
        "ai_provider": AI_PROVIDER
    }


@app.get("/ping")
def ping():
    return {"pong": True}


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
# FASE 2: WHISPER -> AUDIO A TEXTO
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


def transcribe_audio(file_path: str) -> str:
    """
    Transcribe un archivo de audio usando Whisper.
    """
    try:
        result = transcribe(whisper_model, file_path)
        return result.get("text", "").strip()

    except Exception as e:
        print("Error Whisper:", e)
        return ""


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
    Whisper convierte el audio recibido en texto.
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

    return {
        "texto": texto_transcrito,
        "intencion": intencion,
        "detalle": "resultado por reglas locales",
        "espacio": espacio,
        "accion": accion
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


def call_openai_intent(texto_transcrito: str) -> str:
    """
    Usa OpenAI API para convertir texto transcrito en JSON de intención.
    """
    if openai_client is None:
        raise RuntimeError("OpenAI no está inicializado. Revisa OPENAI_API_KEY o instala la librería openai.")

    system_prompt = """
    Eres un sistema de análisis de intenciones para control de luces por ambiente.
    Tu tarea es interpretar comandos en español y devolver únicamente la estructura solicitada.

    Reglas:
    - Si el usuario quiere prender, encender, activar una luz o foco, accion = ON.
    - Si el usuario quiere apagar o desactivar una luz o foco, accion = OFF.
    - Si no está claro, accion = NONE.
    - Si menciona sala, espacio = sala.
    - Si menciona comedor, espacio = comedor.
    - Si menciona cocina, espacio = cocina.
    - Si menciona cuarto principal, habitación principal o dormitorio principal, espacio = cuarto_principal.
    - Si no detectas ambiente, espacio = desconocido.
    - Si quiere controlar luces, intencion = control_luces.
    - Si no corresponde a control de luces, intencion = otra.
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
        text={
            "format": {
                "type": "json_schema",
                "name": "intencion_luces",
                "schema": INTENT_JSON_SCHEMA,
                "strict": True
            }
        },
        max_output_tokens=300
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
        Eres un sistema de análisis de intenciones para control de luces por ambiente.

        El usuario dijo:
        "{texto_transcrito}"

        Tu tarea es:
        1. Entender si el usuario quiere encender o apagar una luz.
        2. Detectar el ambiente mencionado.
        3. Devolver SOLO un JSON válido.
        4. No devolver explicaciones fuera del JSON.
        5. Usar exactamente esta estructura:

        {{
          "texto": "texto transcrito del usuario",
          "intencion": "control_luces o otra",
          "detalle": "explicación breve",
          "espacio": "sala, comedor, cocina, cuarto_principal o desconocido",
          "accion": "ON, OFF o NONE"
        }}

        Reglas:
        - Responde SOLO con JSON válido.
        - No uses Markdown.
        - No agregues texto extra.
        - Copia el texto transcrito en el campo "texto".
        - El idioma del usuario es español.

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
        - "prende luz cocina" -> {{"texto":"prende luz cocina","intencion":"control_luces","detalle":"encender luz de cocina","espacio":"cocina","accion":"ON"}}
        - "apaga la luz de la sala" -> {{"texto":"apaga la luz de la sala","intencion":"control_luces","detalle":"apagar luz de sala","espacio":"sala","accion":"OFF"}}
        - "enciende la luz del comedor" -> {{"texto":"enciende la luz del comedor","intencion":"control_luces","detalle":"encender luz de comedor","espacio":"comedor","accion":"ON"}}
        - "apaga cuarto principal" -> {{"texto":"apaga cuarto principal","intencion":"control_luces","detalle":"apagar luz del cuarto principal","espacio":"cuarto_principal","accion":"OFF"}}
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

def send_mqtt_luz(espacio: str, accion: str) -> tuple[bool, dict | None]:
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
            return False, None

        if accion not in {"ON", "OFF"}:
            return False, None

        payload = {
            "espacio": espacio,
            "accion": accion
        }

        result = mqtt_client.publish(MQTT_TOPIC_LUCES, json.dumps(payload))
        ok = result[0] == 0

        return ok, payload

    except Exception as e:
        print("MQTT ERROR (LUCES):", e)
        return False, None


def execute_actions_from_ai(ia_json: dict) -> tuple[str, dict | None]:
    """
    Ejecuta la acción MQTT según el JSON interpretado.
    """
    if not ia_json:
        return "SIN_JSON", None

    intencion = ia_json.get("intencion", "otra")
    espacio = ia_json.get("espacio", "desconocido")
    accion = ia_json.get("accion", "NONE")

    if intencion != "control_luces":
        return "SIN_ACCION", None

    if espacio == "desconocido":
        return "ESPACIO_DESCONOCIDO", None

    if accion not in {"ON", "OFF"}:
        return "ACCION_DESCONOCIDA", None

    ok, payload = send_mqtt_luz(espacio, accion)

    if ok:
        return f"MQTT_{accion}_{espacio}_OK", payload

    return f"MQTT_{accion}_{espacio}_ERROR", payload


def fase_4_ejecutar_json_con_mqtt(ia_json: dict):
    """
    FASE 4:
    FastAPI toma el JSON de intención y lo convierte en comando MQTT.
    El ESP32 recibe el mensaje y ejecuta la acción física.
    """
    accion_mqtt, mqtt_payload = execute_actions_from_ai(ia_json)

    return {
        "accion_mqtt": accion_mqtt,
        "mqtt_topic": MQTT_TOPIC_LUCES,
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
    FASE 2: Transcribir audio con Whisper
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
    # FASE 4
    # -------------------------
    fase_4 = fase_4_ejecutar_json_con_mqtt(ia_json)

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

        "fase_4_mqtt": fase_4
    }
