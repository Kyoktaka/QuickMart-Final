"""Bridge regressions using local HTTP and mocked USB, never reader hardware."""
import argparse
import http.client
import importlib.util
import json
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("quickmart_bridge", ROOT / "rfid-bridge/rfid_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

DESCRIPTOR = bytes.fromhex(
    "05 01 09 06 A1 01 05 07 19 E0 29 E7 15 00 25 01 75 01 95 08 81 02 "
    "95 01 75 08 81 01 95 05 75 01 05 08 19 01 29 05 91 02 95 01 75 03 "
    "91 01 95 06 75 08 15 00 25 65 05 07 19 00 29 65 81 00 C0"
)


def type_epc(parser, text, enter=True):
    for char in text:
        code = next(k for k, pair in bridge.KEYMAP.items() if char.lower() == pair[0])
        parser.feed([0, 0, code, 0, 0, 0, 0, 0])
        parser.feed([0] * 8)
    if enter:
        parser.feed([0, 0, 0x28, 0, 0, 0, 0, 0])
        parser.feed([0] * 8)


class ParserTests(unittest.TestCase):
    def test_verified_layout_only(self):
        self.assertTrue(bridge.keyboard_report_layout(DESCRIPTOR))
        self.assertFalse(bridge.keyboard_report_layout(b"\x85\x01" + DESCRIPTOR))
        self.assertFalse(bridge.keyboard_report_layout(DESCRIPTOR[:-2]))
        self.assertFalse(bridge.keyboard_report_layout(b"\xfe\x01\x00\x00"))

    def test_exact_epc_and_key_release_framing(self):
        reads = []
        parser = bridge.ReportParser(lambda raw: reads.append("".join(raw).upper()))
        epc = "E28011700000021905AC150B"
        type_epc(parser, epc)
        type_epc(parser, epc)
        self.assertEqual(reads, [epc, epc], "Repeated physical reads must reach presence tracking")
        with self.assertRaises(ValueError):
            parser.feed([0] * 9)

    def test_no_overflow_or_unknown_key_suffix(self):
        reads = []
        parser = bridge.ReportParser(lambda raw: reads.append("".join(raw)))
        type_epc(parser, "A" * 120)
        self.assertEqual(reads, [])
        type_epc(parser, "E28011", enter=False)
        parser.feed([0, 0, 0x2C, 0, 0, 0, 0, 0])  # Space is not an EPC key.
        parser.feed([0] * 8)
        type_epc(parser, "700000021905AC150B")
        self.assertEqual(reads, [], "An invalid frame must never publish a plausible suffix")

    def test_capture_boundary_drops_partial_frame(self):
        with bridge.lock:
            bridge.queue.clear()
            bridge.lease.update(owner=None, until=0)
        parser = bridge.ReportParser(capture_owner=True)
        type_epc(parser, "E28011", enter=False)
        with bridge.lock:
            bridge.lease.update(owner="1" * 32, until=time.monotonic() + 8)
        type_epc(parser, "700000021905AC150B")
        self.assertEqual(len(bridge.queue), 0, "A scan begun while capture was off must stay excluded")
        type_epc(parser, "E28011700000021905AC150B")
        self.assertEqual(len(bridge.queue), 1)


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.token = "a" * 43
        cls.origin = "http://localhost:8080"
        cls.server = bridge.create_server(0, cls.token, [cls.origin])
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self):
        with bridge.lock:
            bridge.queue.clear()
            bridge.lease.update(owner=None, until=0)
            bridge.state.update(connected=True, total=0)

    def request(self, method, path, owner="1" * 32, **changes):
        headers = {"Origin": self.origin, bridge.TOKEN_HEADER: self.token, bridge.OWNER_HEADER: owner}
        headers.update(changes)
        headers = {k: v for k, v in headers.items() if v is not None}
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        connection.request(method, path, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        result = response.status, dict(response.getheaders()), json.loads(raw) if raw else None
        connection.close()
        return result

    def test_preflight_exact_origin_no_wildcard(self):
        status, headers, _ = self.request("OPTIONS", "/scans")
        self.assertEqual(status, 204)
        self.assertEqual(headers["Access-Control-Allow-Origin"], self.origin)
        self.assertNotIn("*", headers["Access-Control-Allow-Headers"])
        status, headers, _ = self.request("OPTIONS", "/scans", Origin="https://untrusted.example")
        self.assertEqual(status, 403)
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_token_origin_and_host_required(self):
        self.assertEqual(self.request("POST", "/claim", **{bridge.TOKEN_HEADER: "wrong"})[0], 401)
        self.assertEqual(self.request("POST", "/claim", **{bridge.TOKEN_HEADER: None})[0], 401)
        self.assertEqual(self.request("POST", "/claim", Origin=None)[0], 403)
        self.assertEqual(self.request("POST", "/claim", Origin="https://untrusted.example")[0], 403)
        self.assertEqual(self.request("POST", "/claim", Host="attacker.example")[0], 403)
        self.assertEqual(self.request("POST", "/claim", owner="invalid")[0], 422)

    def test_other_owner_cannot_drain_clear_or_release(self):
        self.assertEqual(self.request("POST", "/claim")[0], 200)
        bridge.push_epc("E280AABB1122")
        other = "2" * 32
        self.assertEqual(self.request("POST", "/claim", owner=other)[0], 409)
        self.assertEqual(self.request("GET", "/scans", owner=other)[0], 409)
        self.assertEqual(self.request("POST", "/release", owner=other)[0], 409)
        self.assertEqual(self.request("POST", "/clear")[0], 404)
        self.assertEqual(len(bridge.queue), 1)
        status, _, data = self.request("GET", "/scans")
        self.assertEqual(status, 200)
        self.assertEqual(data["epcs"], ["E280AABB1122"])
        self.assertEqual(len(bridge.queue), 0)

    def test_off_stale_and_released_reads_do_not_leak(self):
        self.assertIsNone(bridge.push_epc("E280AABB1122"))
        self.request("POST", "/claim")
        with bridge.lock:
            bridge.queue.append((time.monotonic() - 10, "E280STALE001"))
        bridge.push_epc("E280AABB1122")
        self.assertEqual(self.request("GET", "/scans")[2]["epcs"], ["E280AABB1122"])
        self.request("POST", "/release")
        self.assertIsNone(bridge.push_epc("E280AABB1122"))
        self.assertEqual(self.request("GET", "/scans")[0], 409)

    def test_expired_lease_reclaim_discards_stale_queue(self):
        self.request("POST", "/claim")
        bridge.push_epc("E280AABB1122")
        with bridge.lock:
            bridge.lease["until"] = time.monotonic() - 1
        self.assertEqual(self.request("POST", "/claim", owner="2" * 32)[0], 200)
        self.assertEqual(len(bridge.queue), 0)


class DeviceTests(unittest.TestCase):
    def setUp(self):
        endpoint = types.SimpleNamespace(bEndpointAddress=0x81, bmAttributes=3, wMaxPacketSize=8)

        class Interface(list):
            bInterfaceNumber = 2
            bAlternateSetting = 0
            bInterfaceClass = 3
            bInterfaceSubClass = 1
            bInterfaceProtocol = 1

        self.interface = Interface([endpoint])
        self.claims = []
        self.descriptor = DESCRIPTOR
        self.device = types.SimpleNamespace(
            get_active_configuration=lambda: [self.interface],
            ctrl_transfer=lambda *args: [0] if args[1] == 0x0A else self.descriptor,
            set_configuration=lambda: self.fail("USB configuration must never be changed"),
        )
        usb = types.ModuleType("usb")
        usb.__path__ = []
        core = types.ModuleType("usb.core")
        core.find = lambda **kwargs: [self.device]
        util = types.ModuleType("usb.util")
        util.ENDPOINT_IN = 0x80
        util.ENDPOINT_TYPE_INTR = 3
        util.endpoint_direction = lambda address: address & 0x80
        util.endpoint_type = lambda attributes: attributes & 3
        util.claim_interface = lambda dev, interface: self.claims.append(interface)
        usb.core, usb.util = core, util
        self.modules = patch.dict(sys.modules, {"usb": usb, "usb.core": core, "usb.util": util})
        self.modules.start()

    def tearDown(self):
        self.modules.stop()

    def test_explicit_confirmed_matching_interface_only(self):
        with self.assertRaises(RuntimeError):
            bridge.open_reader(0x1234, 0x5678, 2)
        with self.assertRaises(RuntimeError):
            bridge.open_reader(0x1234, 0x5678, 0, confirmed=True)
        self.assertEqual(self.claims, [])
        self.assertEqual(bridge.open_reader(0x1234, 0x5678, 2, confirmed=True)[2], 2)
        self.assertEqual(self.claims, [2])

    def test_unsupported_descriptor_or_protocol_never_claimed(self):
        self.descriptor = b"\x85\x01" + DESCRIPTOR
        with self.assertRaises(RuntimeError):
            bridge.open_reader(0x1234, 0x5678, 2, confirmed=True)
        self.descriptor = DESCRIPTOR
        self.interface.bInterfaceProtocol = 2
        with self.assertRaises(RuntimeError):
            bridge.open_reader(0x1234, 0x5678, 2, confirmed=True)
        self.assertEqual(self.claims, [])

    def test_placeholder_configuration_refused(self):
        args = argparse.Namespace(vid=None, pid=None, interface=None, port=None,
                                  origin=None, serial=None, confirm_reader_interface=False)
        with self.assertRaises(ValueError):
            bridge.load_config(args)
        args.vid, args.pid, args.interface = "0x1234", "0x5678", 2
        args.confirm_reader_interface = True
        args.origin = ["*"]
        with self.assertRaises(ValueError):
            bridge.load_config(args)
        args.origin = ["http://localhost:8080"]
        self.assertEqual(bridge.load_config(args)[:4], (0x1234, 0x5678, 2, 5757))


if __name__ == "__main__":
    unittest.main()
