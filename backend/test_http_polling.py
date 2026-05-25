import os
from datetime import timedelta
from pathlib import Path
import unittest


TEST_DB_PATH = Path("/tmp/afcr_devices_http_polling_test.db")
os.environ["DEVICES_DB_PATH"] = str(TEST_DB_PATH)
os.environ["AI_PROVIDER"] = "disabled-for-tests"

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


if __name__ == "__main__":
    unittest.main()
