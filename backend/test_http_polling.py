import os
from datetime import timedelta
from pathlib import Path
import unittest


TEST_DB_PATH = Path("/tmp/afcr_devices_http_polling_test.db")
os.environ["DEVICES_DB_PATH"] = str(TEST_DB_PATH)
os.environ["AI_PROVIDER"] = "disabled-for-tests"
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_PUBLISHABLE_KEY"] = ""
os.environ["SUPABASE_SECRET_KEY"] = ""
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""

if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()

import app_api as api


class DummyMqttClient:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))
        return (0, 1)


class HttpPollingDeviceTests(unittest.TestCase):
    def setUp(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()
        api.init_devices_db()
        api.PENDING_VOICE_PLANS.clear()
        api.mqtt_client = DummyMqttClient()

    def tearDown(self):
        if TEST_DB_PATH.exists():
            TEST_DB_PATH.unlink()

    def pair_esp32(self, name="Luz cocina"):
        pairing = api.create_pairing_token(
            api.PairingTokenRequest(name=name, type="ESP32", model="ESP32")
        )
        claimed = api.claim_device(api.ClaimDeviceRequest(token=pairing["pairing_token"]))
        return pairing, claimed

    def light_plan(self, espacio="cocina", accion="ON"):
        return api.build_voice_intent_plan(
            f"{'enciende' if accion == 'ON' else 'apaga'} la luz de {espacio}",
            {
                "intencion": "control_luces",
                "espacio": espacio,
                "accion": accion,
            },
        )

    def test_claim_issues_key_once_and_poll_requires_bearer(self):
        pairing = api.create_pairing_token(
            api.PairingTokenRequest(name="Luz cocina", type="ESP32", model="ESP32")
        )
        self.assertEqual(pairing["transport"], "http_polling")
        self.assertNotIn("esp32_portal_url", pairing)

        claimed = api.claim_device(api.ClaimDeviceRequest(token=pairing["pairing_token"]))
        api_key = claimed["device_api_key"]
        self.assertTrue(api_key)
        self.assertNotIn("device_api_key_hash", claimed["device"])

        with self.assertRaises(api.HTTPException) as unauthenticated:
            api.poll_device_commands(pairing["device_id"], authorization=None)
        self.assertEqual(unauthenticated.exception.status_code, 401)

        with self.assertRaises(api.HTTPException) as reused:
            api.claim_device(api.ClaimDeviceRequest(token=pairing["pairing_token"]))
        self.assertEqual(reused.exception.status_code, 404)

        idle = api.poll_device_commands(
            pairing["device_id"], authorization=f"Bearer {api_key}"
        )
        self.assertEqual(idle["status"], "idle")

    def test_confirm_delivers_http_command_until_ack(self):
        pairing, claimed = self.pair_esp32()
        plan = self.light_plan()
        self.assertEqual(plan["delivery_preview"]["transport"], "http_polling")

        confirmed = api.confirm_voice_intent(
            api.VoiceIntentConfirmRequest(request_id=plan["request_id"])
        )
        self.assertTrue(confirmed["queued"])
        self.assertFalse(confirmed["executed"])
        self.assertEqual(api.mqtt_client.published, [])

        authorization = f"Bearer {claimed['device_api_key']}"
        delivered = api.poll_device_commands(pairing["device_id"], authorization)
        repeated = api.poll_device_commands(pairing["device_id"], authorization)
        self.assertEqual(delivered["command_id"], repeated["command_id"])
        self.assertEqual(delivered["action"], "turn_on")
        self.assertEqual(delivered["status"], "delivered")

        ack = api.acknowledge_device_command(
            delivered["command_id"],
            api.DeviceCommandAckRequest(
                device_id=pairing["device_id"],
                status="executed",
                detail="LED encendido",
            ),
            authorization,
        )
        self.assertTrue(ack["ok"])
        self.assertEqual(ack["delivery"]["status"], "executed")

        idle = api.poll_device_commands(pairing["device_id"], authorization)
        self.assertEqual(idle["status"], "idle")

    def test_expired_command_is_not_delivered(self):
        pairing, claimed = self.pair_esp32()
        delivery = api.send_device_command(
            pairing["device_id"],
            api.DeviceCommandRequest(accion="ON"),
        )["delivery"]

        with api.get_db_connection() as conn:
            conn.execute(
                "UPDATE device_commands SET expires_at = ? WHERE command_id = ?",
                (api.to_iso(api.utc_now() - timedelta(seconds=1)), delivery["command_id"]),
            )
            conn.commit()

        idle = api.poll_device_commands(
            pairing["device_id"], f"Bearer {claimed['device_api_key']}"
        )
        self.assertEqual(idle["status"], "idle")
        status = api.get_device_command_status(delivery["command_id"])
        self.assertEqual(status["delivery"]["status"], "expired")

    def test_dormitorio_alias_targets_cuarto_principal_esp32(self):
        self.pair_esp32("Luz dormitorio principal")
        plan = self.light_plan("cuarto_principal")
        self.assertEqual(plan["delivery_preview"]["transport"], "http_polling")

    def test_legacy_light_keeps_mqtt_delivery(self):
        pairing = api.create_pairing_token(
            api.PairingTokenRequest(name="Luz cocina", type="Luces", model="ESP32")
        )
        api.claim_device(api.ClaimDeviceRequest(token=pairing["pairing_token"]))

        plan = self.light_plan()
        confirmed = api.confirm_voice_intent(
            api.VoiceIntentConfirmRequest(request_id=plan["request_id"])
        )
        self.assertTrue(confirmed["executed"])
        self.assertEqual(len(api.mqtt_client.published), 1)

    def test_modern_supabase_secret_key_is_not_sent_as_bearer_token(self):
        previous = (
            api.SUPABASE_URL,
            api.SUPABASE_PUBLISHABLE_KEY,
            api.SUPABASE_SECRET_KEY,
            api.SUPABASE_SERVICE_ROLE_KEY,
            api.SUPABASE_SERVER_KEY,
        )
        try:
            api.SUPABASE_URL = "https://example.supabase.co"
            api.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test"
            api.SUPABASE_SECRET_KEY = "sb_secret_test"
            api.SUPABASE_SERVICE_ROLE_KEY = ""
            api.SUPABASE_SERVER_KEY = api.SUPABASE_SECRET_KEY

            headers = api.supabase_headers(service_role=True)
            self.assertEqual(headers["apikey"], "sb_secret_test")
            self.assertNotIn("Authorization", headers)
        finally:
            (
                api.SUPABASE_URL,
                api.SUPABASE_PUBLISHABLE_KEY,
                api.SUPABASE_SECRET_KEY,
                api.SUPABASE_SERVICE_ROLE_KEY,
                api.SUPABASE_SERVER_KEY,
            ) = previous


    def test_audio_content_type_is_normalized_for_storage(self):
        self.assertEqual(
            api.normalize_audio_content_type("audio/webm;codecs=opus"),
            "audio/webm",
        )
        self.assertEqual(api.audio_suffix_for_content_type("audio/mp4"), ".mp4")

    def test_audio_file_detection_allows_codec_parameters(self):
        self.assertTrue(api.is_audio_file("audio/webm;codecs=opus", "voz.webm"))
        self.assertTrue(api.is_audio_file("application/octet-stream", "voz.m4a"))



    def test_openai_transcription_uses_fallback_when_primary_is_empty(self):
        class DummyResult:
            def __init__(self, text):
                self.text = text

        class DummyTranscriptions:
            def __init__(self):
                self.models = []

            def create(self, model, file, language):
                self.models.append(model)
                return DummyResult("enciende la luz" if model == "whisper-1" else "")

        class DummyClient:
            def __init__(self):
                self.audio = type("Audio", (), {"transcriptions": DummyTranscriptions()})()

        previous = (
            api.openai_client,
            api.OPENAI_TRANSCRIBE_MODEL,
            api.OPENAI_TRANSCRIBE_FALLBACK_MODEL,
        )
        try:
            client = DummyClient()
            api.openai_client = client
            api.OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe"
            api.OPENAI_TRANSCRIBE_FALLBACK_MODEL = "whisper-1"

            text = api.transcribe_audio_with_openai(__file__)

            self.assertEqual(text, "enciende la luz")
            self.assertEqual(
                client.audio.transcriptions.models,
                ["gpt-4o-mini-transcribe", "whisper-1"],
            )
        finally:
            (
                api.openai_client,
                api.OPENAI_TRANSCRIBE_MODEL,
                api.OPENAI_TRANSCRIBE_FALLBACK_MODEL,
            ) = previous



if __name__ == "__main__":
    unittest.main()
