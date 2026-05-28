export const ESP32_DIRECT_SKETCH = String.raw`/*
  AFCR ESP32 laboratory client

  Flujo:
  1. Conecta 4 LEDs externos con resistencia y GND comun:
     - Sala: GPIO 16
     - Cocina: GPIO 17
     - Comedor: GPIO 18
     - Dormitorio: GPIO 19
  2. Edita WIFI_SSID, WIFI_PASSWORD y PAIRING_TOKEN en Arduino IDE.
  3. Carga este sketch al ESP32 mediante USB.
  4. El ESP32 reclama el token con POST /devices/claim.
  5. Consulta GET /device/commands cada 5 segundos mediante HTTPS autenticado.
  6. Ejecuta el LED del ambiente solicitado y confirma con POST /device/commands/{id}/ack.

  Librerias Arduino:
  - ArduinoJson
  - HTTPClient
  - Preferences
  - WiFi
  - WiFiClientSecure
*/

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

Preferences prefs;

String deviceId;
String deviceApiKey;

// Edita solamente estas tres lineas antes de subir el sketch.
const char* WIFI_SSID = "TU_WIFI";
const char* WIFI_PASSWORD = "TU_PASSWORD";
const char* PAIRING_TOKEN = "PEGA_AQUI_TU_TOKEN";

// La web reemplaza esta URL por la API activa al copiar el sketch.
const char* API_URL = "https://api.afcrseguridad.com";

struct RoomLed {
  const char* espacio;
  const char* label;
  int pin;
};

const RoomLed ROOM_LEDS[] = {
  {"sala", "Sala", 16},
  {"cocina", "Cocina", 17},
  {"comedor", "Comedor", 18},
  {"dormitorio", "Dormitorio", 19},
};
const int ROOM_LED_COUNT = sizeof(ROOM_LEDS) / sizeof(ROOM_LEDS[0]);
const unsigned long POLL_INTERVAL_MS = 5000;
const unsigned long LINK_RETRY_INTERVAL_MS = 10000;
unsigned long lastPollAt = 0;
unsigned long lastLinkAttemptAt = 0;

// ISRG Root X1: valida la cadena Let's Encrypt de api.afcrseguridad.com.
const char ISRG_ROOT_X1[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

bool beginApiRequest(HTTPClient& http, WiFiClientSecure& secureClient, const String& endpoint) {
  String url = String(API_URL) + endpoint;

  if (url.startsWith("https://")) {
    secureClient.setCACert(ISRG_ROOT_X1);
    return http.begin(secureClient, url);
  }

  // HTTP se admite solo para pruebas en la red local del laboratorio.
  return http.begin(url);
}

int findRoomLedPin(const String& espacio) {
  for (int i = 0; i < ROOM_LED_COUNT; i++) {
    if (espacio == ROOM_LEDS[i].espacio) {
      return ROOM_LEDS[i].pin;
    }
  }

  return -1;
}

String roomLedLabel(const String& espacio) {
  for (int i = 0; i < ROOM_LED_COUNT; i++) {
    if (espacio == ROOM_LEDS[i].espacio) {
      return String(ROOM_LEDS[i].label);
    }
  }

  return espacio;
}

void initializeRoomLeds() {
  for (int i = 0; i < ROOM_LED_COUNT; i++) {
    pinMode(ROOM_LEDS[i].pin, OUTPUT);
    digitalWrite(ROOM_LEDS[i].pin, LOW);
  }
}

String tokenFingerprint() {
  uint32_t fingerprint = 2166136261UL;
  String token = String(PAIRING_TOKEN);

  for (unsigned int i = 0; i < token.length(); i++) {
    fingerprint ^= static_cast<uint8_t>(token[i]);
    fingerprint *= 16777619UL;
  }

  return String(fingerprint, HEX);
}

bool configurationReady() {
  return String(WIFI_SSID) != "TU_WIFI"
    && String(WIFI_SSID).length() > 0
    && String(WIFI_PASSWORD) != "TU_PASSWORD"
    && String(PAIRING_TOKEN) != "PEGA_AQUI_TU_TOKEN"
    && String(PAIRING_TOKEN).length() > 0;
}

bool connectWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.println("Conectando al WiFi...");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi conectado: " + WiFi.localIP().toString());
    return true;
  }

  return false;
}

bool claimDevice() {
  String currentTokenFingerprint = tokenFingerprint();

  prefs.begin("afcr", true);
  deviceId = prefs.getString("device_id", "");
  deviceApiKey = prefs.getString("device_api_key", "");
  String savedTokenFingerprint = prefs.getString("token_hash", "");
  prefs.end();

  if (
    deviceId != ""
    && deviceApiKey != ""
    && savedTokenFingerprint == currentTokenFingerprint
  ) {
    Serial.println("Credencial guardada encontrada. Reutilizando enlace.");
    return true;
  }

  if (deviceId != "" || deviceApiKey != "" || savedTokenFingerprint != "") {
    prefs.begin("afcr", false);
    prefs.remove("device_id");
    prefs.remove("device_api_key");
    prefs.remove("token_hash");
    prefs.end();
    deviceId = "";
    deviceApiKey = "";
    Serial.println("Token diferente. Iniciando un enlace nuevo.");
  }

  WiFiClientSecure client;
  HTTPClient http;
  if (!beginApiRequest(http, client, "/devices/claim")) {
    Serial.println("No se pudo iniciar la solicitud de enlace.");
    return false;
  }
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> request;
  request["token"] = PAIRING_TOKEN;

  String body;
  serializeJson(request, body);
  int code = http.POST(body);

  if (code < 200 || code >= 300) {
    Serial.println("Fallo claim HTTP: " + String(code));
    http.end();
    return false;
  }

  StaticJsonDocument<1024> response;
  DeserializationError error = deserializeJson(response, http.getString());
  http.end();

  if (error) {
    Serial.println("No se pudo parsear la respuesta de claim.");
    return false;
  }

  deviceId = response["device"]["device_id"].as<String>();
  deviceApiKey = response["device_api_key"].as<String>();

  if (deviceId == "" || deviceApiKey == "") {
    Serial.println("El claim no devolvio credenciales HTTP.");
    return false;
  }

  prefs.begin("afcr", false);
  prefs.putString("device_id", deviceId);
  prefs.putString("device_api_key", deviceApiKey);
  prefs.putString("token_hash", currentTokenFingerprint);
  prefs.end();

  Serial.println("ESP32 enlazado: " + deviceId);
  return true;
}

bool acknowledgeCommand(const String& commandId, const String& status, const String& detail) {
  WiFiClientSecure client;
  HTTPClient http;
  if (!beginApiRequest(http, client, "/device/commands/" + commandId + "/ack")) {
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + deviceApiKey);

  StaticJsonDocument<256> request;
  request["device_id"] = deviceId;
  request["status"] = status;
  request["detail"] = detail;

  String body;
  serializeJson(request, body);
  int code = http.POST(body);
  http.end();

  return code >= 200 && code < 300;
}

void pollCommands() {
  if (millis() - lastPollAt < POLL_INTERVAL_MS) {
    return;
  }
  lastPollAt = millis();

  WiFiClientSecure client;
  HTTPClient http;
  if (!beginApiRequest(http, client, "/device/commands?device_id=" + deviceId)) {
    Serial.println("No se pudo iniciar polling HTTP.");
    return;
  }
  http.addHeader("Authorization", "Bearer " + deviceApiKey);

  int code = http.GET();
  if (code < 200 || code >= 300) {
    Serial.println("Fallo polling HTTP: " + String(code));
    http.end();
    return;
  }

  StaticJsonDocument<512> response;
  DeserializationError error = deserializeJson(response, http.getString());
  http.end();

  if (error) {
    Serial.println("No se pudo parsear un comando.");
    return;
  }

  String commandId = response["command_id"] | "";
  String target = response["target"] | "";
  String action = response["action"] | "";
  String espacio = response["espacio"] | "";

  if (commandId == "" || action == "none") {
    return;
  }

  int ledPin = findRoomLedPin(espacio);
  String roomLabel = roomLedLabel(espacio);
  String status = "failed";
  String detail = "Comando no soportado";

  if (target == "led" && ledPin < 0) {
    detail = "Ambiente no soportado: " + espacio;
    Serial.println(detail);
  } else if (target == "led" && action == "turn_on") {
    digitalWrite(ledPin, HIGH);
    status = "executed";
    detail = "LED " + roomLabel + " encendido";
    Serial.println(detail);
  } else if (target == "led" && action == "turn_off") {
    digitalWrite(ledPin, LOW);
    status = "executed";
    detail = "LED " + roomLabel + " apagado";
    Serial.println(detail);
  }

  if (!acknowledgeCommand(commandId, status, detail)) {
    Serial.println("No se pudo enviar ACK; el comando se reintentara.");
  }
}

void setup() {
  Serial.begin(115200);
  initializeRoomLeds();

  if (!configurationReady()) {
    Serial.println("Edita WIFI_SSID, WIFI_PASSWORD y PAIRING_TOKEN en Arduino IDE.");
    return;
  }

  if (!connectWifi()) {
    Serial.println("No fue posible conectar al WiFi configurado.");
    return;
  }

  if (!claimDevice()) {
    Serial.println("No fue posible enlazar el ESP32. Revisa el token y vuelve a cargar el sketch.");
  }
}

void loop() {
  if (!configurationReady()) {
    delay(1000);
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastLinkAttemptAt >= LINK_RETRY_INTERVAL_MS) {
      lastLinkAttemptAt = millis();
      Serial.println("WiFi desconectado; intentando reconectar.");
      WiFi.reconnect();
    }
    delay(250);
    return;
  }

  if (deviceId == "" || deviceApiKey == "") {
    if (millis() - lastLinkAttemptAt >= LINK_RETRY_INTERVAL_MS) {
      lastLinkAttemptAt = millis();
      claimDevice();
    }
    delay(250);
    return;
  }

  pollCommands();
}
`;
