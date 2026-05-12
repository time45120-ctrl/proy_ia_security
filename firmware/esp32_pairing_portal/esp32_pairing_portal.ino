/*
  AFCR ESP32 pairing portal

  Flujo:
  1. Si el ESP32 no tiene WiFi guardado, crea AP temporal AFCR-ESP32-XXXX.
  2. El usuario abre http://192.168.4.1 y envia SSID, password, API URL y token.
  3. El ESP32 se conecta al WiFi real.
  4. Reclama el token en POST /devices/claim.
  5. Se conecta a MQTT TLS y escucha afcr/devices/{device_id}/commands.

  Librerias Arduino:
  - WiFi
  - WebServer
  - HTTPClient
  - WiFiClientSecure
  - Preferences
  - PubSubClient
  - ArduinoJson
*/

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

Preferences prefs;
WebServer server(80);
WiFiClientSecure tlsClient;
PubSubClient mqtt(tlsClient);

String deviceId;
String apiUrl;
String mqttTopic;

const int LED_PIN = 2;

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

  server.on("/", HTTP_GET, []() {
    server.send(200, "text/html", htmlForm());
  });

  server.on("/save", HTTP_POST, []() {
    prefs.begin("afcr", false);
    prefs.putString("ssid", server.arg("ssid"));
    prefs.putString("password", server.arg("password"));
    prefs.putString("api_url", server.arg("api_url"));
    prefs.putString("token", server.arg("token"));
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

  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
  }

  return WiFi.status() == WL_CONNECTED;
}

bool claimDevice() {
  prefs.begin("afcr", false);
  apiUrl = prefs.getString("api_url", "https://api.afcrseguridad.com");
  String token = prefs.getString("token", "");
  deviceId = prefs.getString("device_id", "");
  prefs.end();

  if (token == "" || deviceId != "") {
    return deviceId != "";
  }

  WiFiClientSecure client;
  client.setInsecure(); // MVP: reemplazar con CA raiz en produccion.

  HTTPClient http;
  http.begin(client, apiUrl + "/devices/claim");
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> request;
  request["token"] = token;
  request["device_id"] = "esp32-" + chipSuffix();

  String body;
  serializeJson(request, body);
  int code = http.POST(body);

  if (code < 200 || code >= 300) {
    http.end();
    return false;
  }

  StaticJsonDocument<1024> response;
  deserializeJson(response, http.getString());
  http.end();

  deviceId = response["device"]["device_id"].as<String>();
  mqttTopic = response["device"]["mqtt_topic"].as<String>();

  prefs.begin("afcr", false);
  prefs.putString("device_id", deviceId);
  prefs.putString("mqtt_topic", mqttTopic);
  prefs.end();

  return deviceId != "";
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  StaticJsonDocument<256> doc;
  deserializeJson(doc, payload, length);

  String accion = doc["accion"] | "";
  accion.toUpperCase();

  if (accion == "ON") {
    digitalWrite(LED_PIN, HIGH);
  } else if (accion == "OFF") {
    digitalWrite(LED_PIN, LOW);
  }
}

void connectMqtt() {
  prefs.begin("afcr", true);
  mqttTopic = prefs.getString("mqtt_topic", "");
  prefs.end();

  tlsClient.setInsecure(); // MVP: reemplazar con CA raiz en produccion.
  mqtt.setServer("TU_BROKER_MQTT_TLS", 8883);
  mqtt.setCallback(mqttCallback);

  while (!mqtt.connected()) {
    String clientId = "afcr-" + deviceId;
    if (mqtt.connect(clientId.c_str(), "TU_USUARIO_MQTT", "TU_PASSWORD_MQTT")) {
      mqtt.subscribe(mqttTopic.c_str());
    } else {
      delay(3000);
    }
  }
}

void sendHeartbeat() {
  static unsigned long lastHeartbeat = 0;
  if (millis() - lastHeartbeat < 30000 || deviceId == "") {
    return;
  }
  lastHeartbeat = millis();

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, apiUrl + "/devices/" + deviceId + "/heartbeat");
  http.addHeader("Content-Type", "application/json");
  http.POST("{\"status\":\"online\"}");
  http.end();
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);

  if (!connectWifi()) {
    startPortal();
    return;
  }

  if (claimDevice()) {
    connectMqtt();
  } else {
    startPortal();
  }
}

void loop() {
  if (WiFi.getMode() == WIFI_AP) {
    server.handleClient();
    return;
  }

  if (!mqtt.connected()) {
    connectMqtt();
  }

  mqtt.loop();
  sendHeartbeat();
}
