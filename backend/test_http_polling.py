import json
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
            api.DeviceCommandRequest(accion="ON", espacio="cocina"),
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

    def test_dormitorio_alias_targets_multiroom_esp32(self):
        self.pair_esp32("ESP32 multiambiente")
        plan = self.light_plan("cuarto_principal")
        self.assertEqual(plan["espacio"], "dormitorio")
        self.assertEqual(plan["delivery_preview"]["transport"], "http_polling")

    def test_single_esp32_controls_all_configured_rooms(self):
        pairing, _claimed = self.pair_esp32("ESP32 multiambiente")

        for room in ["sala", "cocina", "comedor", "dormitorio"]:
            with self.subTest(room=room):
                plan = self.light_plan(room)

                self.assertTrue(plan["can_execute"])
                self.assertEqual(plan["espacio"], room)
                self.assertEqual(plan["delivery_preview"]["device_id"], pairing["device_id"])
                self.assertEqual(plan["delivery_preview"]["espacio"], room)

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

    def test_legacy_cuarto_principal_light_matches_dormitorio_alias(self):
        pairing = api.create_pairing_token(
            api.PairingTokenRequest(name="Luz cuarto principal", type="Luces", model="ESP32")
        )
        api.claim_device(api.ClaimDeviceRequest(token=pairing["pairing_token"]))

        plan = self.light_plan("dormitorio")
        confirmed = api.confirm_voice_intent(
            api.VoiceIntentConfirmRequest(request_id=plan["request_id"])
        )

        self.assertTrue(confirmed["executed"])
        topic, payload_raw = api.mqtt_client.published[0]
        payload = json.loads(payload_raw)
        self.assertIn(pairing["device_id"], topic)
        self.assertEqual(payload["device_id"], pairing["device_id"])
        self.assertEqual(payload["espacio"], "dormitorio")

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



    def test_led_command_without_space_asks_for_room(self):
        self.pair_esp32("ESP32 multiambiente")
        plan = api.build_voice_intent_plan(
            "prende el led",
            {
                "intencion": "control_luces",
                "espacio": "desconocido",
                "accion": "ON",
            },
        )

        self.assertFalse(plan["can_execute"])
        self.assertEqual(plan["module"], "lights")
        self.assertEqual(plan["espacio"], "desconocido")
        self.assertIsNone(plan["delivery_preview"])
        self.assertIn("sala", plan["respuesta"])
        self.assertIn("dormitorio", plan["respuesta"])

    def test_rule_parser_treats_led_as_light_control(self):
        parsed = api.fallback_rule_parser("prende el led")

        self.assertEqual(parsed["intencion"], "control_luces")
        self.assertEqual(parsed["accion"], "ON")
        self.assertEqual(parsed["espacio"], "desconocido")



    def compound_light_plan(self, phrase):
        parsed = api.fallback_rule_parser(phrase)
        return api.build_voice_intent_plan(phrase, parsed)

    def test_rule_parser_understands_multiroom_same_action(self):
        parsed = api.fallback_rule_parser("prende cocina y comedor")

        self.assertEqual(parsed["intencion"], "control_luces")
        self.assertEqual(parsed["comandos_luces"], [
            {"espacio": "cocina", "accion": "ON"},
            {"espacio": "comedor", "accion": "ON"},
        ])

    def test_rule_parser_understands_all_lights(self):
        parsed_on = api.fallback_rule_parser("prende todas las luces")
        parsed_off = api.fallback_rule_parser("apaga todas las luces")

        self.assertEqual(len(parsed_on["comandos_luces"]), 4)
        self.assertEqual({command["accion"] for command in parsed_on["comandos_luces"]}, {"ON"})
        self.assertEqual(len(parsed_off["comandos_luces"]), 4)
        self.assertEqual({command["accion"] for command in parsed_off["comandos_luces"]}, {"OFF"})

    def test_rule_parser_understands_mixed_actions(self):
        parsed = api.fallback_rule_parser("prende cocina y apaga comedor")

        self.assertEqual(parsed["comandos_luces"], [
            {"espacio": "cocina", "accion": "ON"},
            {"espacio": "comedor", "accion": "OFF"},
        ])

    def test_rule_parser_rejects_contradictory_same_room(self):
        parsed = api.fallback_rule_parser("prende cocina y apaga cocina")
        plan = api.build_voice_intent_plan("prende cocina y apaga cocina", parsed)

        self.assertTrue(parsed["conflicto_comandos"])
        self.assertFalse(plan["can_execute"])
        self.assertEqual(plan["action"], "NONE")
        self.assertIn("contradictorias", plan["respuesta"])

    def test_confirm_delivers_multiple_http_commands_as_one_batch_until_ack(self):
        pairing, claimed = self.pair_esp32("ESP32 multiambiente")
        plan = self.compound_light_plan("prende cocina y comedor")

        self.assertTrue(plan["can_execute"])
        self.assertTrue(plan["batch"])
        self.assertEqual(plan["delivery_mode"], "batch_http_polling")
        self.assertEqual(len(plan["comandos_luces"]), 2)
        self.assertEqual(len(plan["delivery_previews"]), 2)

        confirmed = api.confirm_voice_intent(
            api.VoiceIntentConfirmRequest(request_id=plan["request_id"])
        )
        self.assertTrue(confirmed["queued"])
        self.assertTrue(confirmed["batch"])
        self.assertEqual(confirmed["delivery_mode"], "batch_http_polling")
        self.assertEqual(confirmed["queued_count"], 2)
        self.assertEqual(len(confirmed["deliveries"]), 2)
        self.assertEqual(api.mqtt_client.published, [])

        authorization = f"Bearer {claimed['device_api_key']}"
        batch = api.poll_device_commands(pairing["device_id"], authorization)
        self.assertEqual(batch["status"], "delivered")
        self.assertEqual(batch["target"], "leds")
        self.assertEqual(batch["action"], "batch")
        self.assertEqual(len(batch["commands"]), 2)
        self.assertEqual({command["espacio"] for command in batch["commands"]}, {"cocina", "comedor"})

        ack = api.acknowledge_device_command(
            batch["command_id"],
            api.DeviceCommandAckRequest(
                device_id=pairing["device_id"],
                status="executed",
                detail="batch LED listo",
            ),
            authorization,
        )
        self.assertTrue(ack["ok"])
        self.assertEqual(len(ack["deliveries"]), 2)
        self.assertEqual({delivery["status"] for delivery in ack["deliveries"]}, {"executed"})

        for delivery in confirmed["deliveries"]:
            status = api.get_device_command_status(delivery["command_id"])
            self.assertEqual(status["delivery"]["status"], "executed")

        idle = api.poll_device_commands(pairing["device_id"], authorization)
        self.assertEqual(idle["status"], "idle")

    def test_all_lights_plan_prepares_four_http_commands(self):
        self.pair_esp32("ESP32 multiambiente")
        plan = self.compound_light_plan("apaga todas las luces")

        self.assertTrue(plan["can_execute"])
        self.assertEqual(len(plan["comandos_luces"]), 4)
        self.assertEqual(len(plan["delivery_previews"]), 4)
        self.assertEqual({command["accion"] for command in plan["comandos_luces"]}, {"OFF"})



if __name__ == "__main__":
    unittest.main()
