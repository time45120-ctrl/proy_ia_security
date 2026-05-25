/*
  AFCR ESP32 laboratory client

  Flujo:
  1. Sin configuracion, expone la red temporal AFCR-ESP32-XXXX.
  2. El usuario introduce WiFi, API URL y pairing token en http://192.168.4.1.
  3. Reclama el token con POST /devices/claim y guarda device_id/api_key.
  4. Consulta GET /device/commands cada 5 segundos mediante HTTPS autenticado.
  5. Ejecuta el LED integrado y confirma con POST /device/commands/{id}/ack.

  Librerias Arduino:
  - ArduinoJson
  - HTTPClient
  - Preferences
  - WebServer
  - WiFi
  - WiFiClientSecure
*/

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

Preferences prefs;
WebServer server(80);

String deviceId;
String deviceApiKey;
String apiUrl;

const int LED_PIN = 2;
const unsigned long POLL_INTERVAL_MS = 5000;
unsigned long lastPollAt = 0;

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

String chipSuffix() {
  uint64_t mac = ESP.getEfuseMac();
  char suffix[7];
  snprintf(suffix, sizeof(suffix), "%06X", (uint32_t)(mac & 0xFFFFFF));
  return String(suffix);
}

String htmlForm() {
  return R"HTML(
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AFCR ESP32 Setup</title>
  <style>
    body{font-family:Arial;background:#07111d;color:#fff;padding:24px}
    label{display:block;margin:14px 0 6px;color:#a4e6ff;text-transform:uppercase;font-size:12px;letter-spacing:.12em}
    input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #28445a;background:#050c16;color:#fff}
    button{margin-top:18px;width:100%;padding:14px;border:0;border-radius:8px;background:#a4e6ff;color:#003543;font-weight:700}
    main{max-width:520px;margin:auto}
  </style>
</head>
<body>
  <main>
    <h1>Enlazar ESP32</h1>
    <p>Tu clave WiFi se guarda solo en este dispositivo.</p>
    <form method="post" action="/save">
      <label>SSID WiFi</label>
      <input name="ssid" required>
      <label>Password WiFi</label>
      <input name="password" type="password" required>
      <label>API URL</label>
      <input name="api_url" value="https://api.afcrseguridad.com" required>
      <label>Pairing token</label>
      <input name="token" required>
      <button>Guardar y enlazar</button>
    </form>
  </main>
</body>
</html>
)HTML";
}

void startPortal() {
  String apName = "AFCR-ESP32-" + chipSuffix();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(apName.c_str());
  Serial.println("Portal de configuracion activo: " + apName);

  server.on("/", HTTP_GET, []() {
    server.send(200, "text/html", htmlForm());
  });

  server.on("/save", HTTP_POST, []() {
    prefs.begin("afcr", false);
    prefs.putString("ssid", server.arg("ssid"));
    prefs.putString("password", server.arg("password"));
    prefs.putString("api_url", server.arg("api_url"));
    prefs.putString("token", server.arg("token"));
    prefs.remove("device_id");
    prefs.remove("device_api_key");
    prefs.end();

    server.send(200, "text/html", "<h1>Datos guardados</h1><p>El ESP32 reiniciara para enlazarse.</p>");
    delay(1200);
    ESP.restart();
  });

  server.begin();
}

bool connectWifi() {
  prefs.begin("afcr", true);
  String ssid = prefs.getString("ssid", "");
  String password = prefs.getString("password", "");
  prefs.end();

  if (ssid == "") {
    return false;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), password.c_str());

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
  prefs.begin("afcr", true);
  apiUrl = prefs.getString("api_url", "https://api.afcrseguridad.com");
  String token = prefs.getString("token", "");
  deviceId = prefs.getString("device_id", "");
  deviceApiKey = prefs.getString("device_api_key", "");
  prefs.end();

  if (deviceId != "" && deviceApiKey != "") {
    return true;
  }

  if (token == "") {
    return false;
  }

  WiFiClientSecure client;
  client.setCACert(ISRG_ROOT_X1);

  HTTPClient http;
  http.begin(client, apiUrl + "/devices/claim");
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> request;
  request["token"] = token;

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
  prefs.remove("token");
  prefs.end();

  Serial.println("ESP32 enlazado: " + deviceId);
  return true;
}

bool acknowledgeCommand(const String& commandId, const String& status, const String& detail) {
  WiFiClientSecure client;
  client.setCACert(ISRG_ROOT_X1);

  HTTPClient http;
  http.begin(client, apiUrl + "/device/commands/" + commandId + "/ack");
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
  client.setCACert(ISRG_ROOT_X1);

  HTTPClient http;
  String url = apiUrl + "/device/commands?device_id=" + deviceId;
  http.begin(client, url);
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

  if (commandId == "" || action == "none") {
    return;
  }

  String status = "failed";
  String detail = "Comando no soportado";

  if (target == "led" && action == "turn_on") {
    digitalWrite(LED_PIN, HIGH);
    status = "executed";
    detail = "LED encendido";
    Serial.println("LED ENCENDIDO");
  } else if (target == "led" && action == "turn_off") {
    digitalWrite(LED_PIN, LOW);
    status = "executed";
    detail = "LED apagado";
    Serial.println("LED APAGADO");
  }

  if (!acknowledgeCommand(commandId, status, detail)) {
    Serial.println("No se pudo enviar ACK; el comando se reintentara.");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  if (!connectWifi() || !claimDevice()) {
    startPortal();
  }
}

void loop() {
  if (WiFi.getMode() == WIFI_AP) {
    server.handleClient();
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado; intentando reconectar.");
    WiFi.reconnect();
    delay(1000);
    return;
  }

  pollCommands();
}
