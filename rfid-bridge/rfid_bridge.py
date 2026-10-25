"""QuickMart RFID bridge.

Reads the UHF reader RAW over USB (WinUSB via Zadig) so Windows never sees it as a
keyboard -> EPC never types into any field. Serves EPCs on http://127.0.0.1:5757.
QuickMart (assets/js/rfid-scanner.js) polls only while scanning is enabled = the valve.

Usage:
  python rfid_bridge.py --list                    show USB devices (find VID:PID)
  python rfid_bridge.py --vid 0x1234 --pid 0x5678 --interface 2 --confirm-reader-interface --origin http://localhost run
  Add --debug to the confirmed-interface command to print raw reports locally.
Or configure actual vid, pid, interface, allowed_origins and explicit
confirm_reader_interface in rfid_bridge.json beside this file/exe.

Actual VID, PID and interface configuration plus explicit independent-interface
confirmation are required. The bridge never installs drivers, detaches a kernel
driver, changes configurations, or guesses a keyboard interface. The current
parser accepts only a verified 8-byte boot-keyboard input layout. Run --list for
read-only descriptors, then use --interface N --confirm-reader-interface and
--origin http://localhost after manual device identification and compatibility
checks. Pair the browser using the random token printed at each startup.
"""
import argparse
import collections
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

HOST = "127.0.0.1"
DEFAULT_PORT = 5757
MIN_EPC_LEN = 6
MAX_AGE_S = 3.0        # scans older than this are dropped (stale = scanned while valve closed)
IDLE_FLUSH_S = 0.4     # flush buffer if reader sends no Enter; tolerate throttled HID keys
MAX_QUEUE = 500
MAX_EPC_LEN = 100
LEASE_S = 8.0
TOKEN_HEADER = "X-QuickMart-Bridge-Token"
OWNER_HEADER = "X-QuickMart-Bridge-Owner"
EPC_PATTERN = re.compile(r"[A-Z0-9:_-]{6,100}\Z")
OWNER_PATTERN = re.compile(r"[a-f0-9]{32}\Z")

KEYMAP = {}
for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
    KEYMAP[4 + i] = (c, c.upper())
for i, (plain, shifted) in enumerate(zip("1234567890", "!@#$%^&*()")):
    KEYMAP[30 + i] = (plain, shifted)
KEYMAP[0x2D] = ("-", "_")
KEYMAP[0x33] = (";", ":")
ENTER_CODES = (0x28, 0x58)

lock = threading.Lock()
queue = collections.deque(maxlen=MAX_QUEUE)   # (monotonic_time, epc)
state = {"connected": False, "device": None, "last_error": None, "total": 0}
lease = {"owner": None, "until": 0.0}
DEBUG = False


def push_epc(raw, expected_owner=None):
    epc = "".join(raw).strip().upper()
    if not EPC_PATTERN.fullmatch(epc):
        return None
    with lock:
        # Output outside a browser capture lease is discarded at the source.
        if lease["owner"] is None or time.monotonic() >= lease["until"]:
            return None
        if expected_owner is not None and lease["owner"] != expected_owner:
            return None
        queue.append((time.monotonic(), epc))
        state["total"] += 1
    if DEBUG:
        print("[EPC]", epc, flush=True)
    return epc


class ReportParser:
    """Turns 8-byte HID keyboard reports into EPC strings."""

    def __init__(self, on_epc=push_epc, capture_owner=False):
        self.buf = []
        self.prev = set()
        self.last_key_at = 0.0
        self.on_epc = on_epc
        self.invalid = False
        self.capture_owner = capture_owner
        self.frame_owner = None

    def feed(self, data):
        data = list(data)
        # A leading report ID requires a different verified descriptor/parser;
        # never strip an arbitrary ninth byte and guess a keyboard layout.
        if len(data) != 8:
            raise ValueError("Expected a verified 8-byte keyboard input report.")
        if data[0] & ~0x22 or any(k in (1, 2, 3) for k in data[2:8]):
            self.buf = []
            self.invalid = True
            self.prev = set()
            return
        shift = bool(data[0] & 0x22)
        keys = [k for k in data[2:8] if k]
        new = [k for k in keys if k not in self.prev]
        self.prev = set(keys)
        for k in new:
            if k in ENTER_CODES:
                self.flush()
            elif k in KEYMAP:
                if not self.buf and self.capture_owner:
                    with lock:
                        self.frame_owner = lease["owner"] if lease["until"] > time.monotonic() else None
                char = KEYMAP[k][1 if shift else 0]
                if re.fullmatch(r"[A-Za-z0-9:_-]", char):
                    self.buf.append(char)
                    if len(self.buf) > MAX_EPC_LEN:
                        self.buf = []
                        self.invalid = True
                else:
                    self.buf = []
                    self.invalid = True
                self.last_key_at = time.monotonic()
            else:
                self.buf = []
                self.invalid = True

    def idle(self):
        if (self.buf or self.invalid) and time.monotonic() - self.last_key_at >= IDLE_FLUSH_S:
            self.flush()

    def flush(self):
        buf, self.buf = self.buf, []
        invalid, self.invalid = self.invalid, False
        if not invalid and buf and EPC_PATTERN.fullmatch("".join(buf).upper()):
            if self.capture_owner:
                if self.frame_owner is not None:
                    self.on_epc(buf, expected_owner=self.frame_owner)
            else:
                self.on_epc(buf)
        self.frame_owner = None


# ---------------------------------------------------------------- USB side
def get_backend():
    try:
        import libusb_package
        return libusb_package.get_libusb1_backend()
    except Exception:
        return None


def list_devices():
    import usb.core
    for d in usb.core.find(find_all=True, backend=get_backend()) or []:
        try:
            name = d.product
        except Exception:
            name = "?"
        print("%04x:%04x  %s" % (d.idVendor, d.idProduct, name))
        try:
            for intf in d.get_active_configuration():
                print("  interface=%d alternate=%d class=%d subclass=%d protocol=%d" % (
                    intf.bInterfaceNumber, intf.bAlternateSetting, intf.bInterfaceClass,
                    intf.bInterfaceSubClass, intf.bInterfaceProtocol))
        except Exception as exc:
            print("  Interface descriptors unavailable:", type(exc).__name__)


def keyboard_report_layout(descriptor):
    """Accept only the modifier/reserved/6-key 8-byte input layout.

    LED output is harmless. Report IDs, long items and ambiguous global stacks
    need a different parser. They are rejected before any interface is claimed.
    """
    data = bytes(descriptor)
    usage_page = size = count = 0
    inputs = []
    i = 0
    while i < len(data):
        prefix = data[i]
        i += 1
        if prefix == 0xFE:
            return False
        length = (0, 1, 2, 4)[prefix & 3]
        if i + length > len(data):
            return False
        value = int.from_bytes(data[i:i + length], "little")
        i += length
        kind, tag = (prefix >> 2) & 3, prefix >> 4
        if kind == 1:
            if tag == 0:
                usage_page = value
            elif tag == 7:
                size = value
            elif tag == 9:
                count = value
            elif tag in (8, 10, 11):
                return False
        elif kind == 0 and tag == 8:
            inputs.append((usage_page, size, count, value & 3))
    return inputs == [(7, 1, 8, 2), (7, 8, 1, 1), (7, 8, 6, 0)]


def open_reader(vid, pid, interface=None, confirmed=False, serial=None):
    import usb.core
    import usb.util
    if not confirmed or interface is None:
        raise RuntimeError("Confirm the actual independent reader interface before USB access.")
    devices = list(usb.core.find(find_all=True, idVendor=vid, idProduct=pid, backend=get_backend()) or [])
    if serial:
        devices = [d for d in devices if d.serial_number == serial]
    if not devices:
        return None, None, None
    if len(devices) != 1:
        raise RuntimeError("More than one matching USB device; configure its actual serial number.")
    dev = devices[0]
    # Read-only descriptor access; the device must already be configured.
    # The old implementation changed configuration (or ignored the error when
    # already configured). Neither action proves that a keyboard is safe to claim.
    cfg = dev.get_active_configuration()
    matches = [i for i in cfg if i.bInterfaceNumber == interface and i.bAlternateSetting == 0]
    if len(matches) != 1:
        raise RuntimeError("Configured interface/alternate setting was not found.")
    intf = matches[0]
    if (intf.bInterfaceClass, intf.bInterfaceSubClass, intf.bInterfaceProtocol) != (3, 1, 1):
        raise RuntimeError("Only a verified boot-keyboard HID reader interface is supported.")
    active_alternate = list(dev.ctrl_transfer(0x81, 0x0A, 0, interface, 1))
    if active_alternate != [0]:
        raise RuntimeError("The verified interface must already use alternate setting zero.")
    descriptor = dev.ctrl_transfer(0x81, 0x06, 0x2200, interface, 4096)
    if not keyboard_report_layout(descriptor):
        raise RuntimeError("Unsupported HID input descriptor; use the vendor integration instead.")
    endpoints = [ep for ep in intf
                 if usb.util.endpoint_direction(ep.bEndpointAddress) == usb.util.ENDPOINT_IN
                 and usb.util.endpoint_type(ep.bmAttributes) == usb.util.ENDPOINT_TYPE_INTR
                 and ep.wMaxPacketSize >= 8]
    if len(endpoints) != 1:
        raise RuntimeError("Expected exactly one keyboard interrupt IN endpoint.")
    usb.util.claim_interface(dev, interface)
    return dev, endpoints[0], interface


def is_timeout(exc):
    import usb.core
    t = getattr(usb.core, "USBTimeoutError", None)
    return (t is not None and isinstance(exc, t)) or getattr(exc, "errno", None) in (110, 10060)


def reader_loop(vid, pid, interface, serial=None):
    try:
        import usb.core
        import usb.util
    except ImportError:
        with lock:
            state.update(connected=False, last_error="Install rfid-bridge/requirements.txt before USB access.")
        print("[USB] Install the bridge requirements before USB access.", flush=True)
        return
    while True:
        dev = None
        claimed = None
        try:
            dev, ep, claimed = open_reader(vid, pid, interface, confirmed=True, serial=serial)
            if dev is None:
                with lock:
                    state.update(connected=False, last_error="Configured reader not found.")
                time.sleep(2)
                continue
            with lock:
                state.update(connected=True, last_error=None, device="%04x:%04x interface %d" % (vid, pid, interface))
            print("[USB] verified reader interface open", flush=True)
            parser = ReportParser(capture_owner=True)
            while True:
                try:
                    data = dev.read(ep.bEndpointAddress, ep.wMaxPacketSize, timeout=50)
                except usb.core.USBError as exc:
                    if is_timeout(exc):
                        parser.idle()
                        continue
                    raise
                if DEBUG:
                    print("[RAW]", list(data), flush=True)
                parser.feed(data)
        except Exception as exc:
            with lock:
                state.update(connected=False, last_error=str(exc))
                queue.clear()
            print("[USB] lost:", exc, flush=True)
        finally:
            if dev is not None:
                try:
                    if claimed is not None:
                        usb.util.release_interface(dev, claimed)
                    usb.util.dispose_resources(dev)
                except Exception:
                    pass
        time.sleep(2)


# ---------------------------------------------------------------- HTTP side
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def origin_allowed(self):
        return self.headers.get("Origin") in self.server.allowed_origins

    def host_allowed(self):
        return self.headers.get("Host", "").lower() in {
            "127.0.0.1:%d" % self.server.server_port,
            "localhost:%d" % self.server.server_port,
        }

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.origin_allowed():
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        if not self.host_allowed() or not self.origin_allowed():
            self._send(403, {"error": "Bridge host or origin is not allowed."})
            return False
        token = self.headers.get(TOKEN_HEADER, "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token) or not hmac.compare_digest(token, self.server.pairing_token):
            self._send(401, {"error": "Bridge pairing token required."})
            return False
        return True

    def owner(self):
        owner = self.headers.get(OWNER_HEADER, "")
        return owner if OWNER_PATTERN.fullmatch(owner) else None

    def owns_lease(self, owner, now):
        return owner is not None and lease["owner"] == owner and lease["until"] > now

    def do_OPTIONS(self):
        if not self.host_allowed() or not self.origin_allowed():
            self._send(403, {"error": "Bridge host or origin is not allowed."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", TOKEN_HEADER + ", " + OWNER_HEADER)
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if not self.authorized():
            return
        path = self.path.split("?")[0]
        if path == "/scans":
            now, owner = time.monotonic(), self.owner()
            with lock:
                if self.owns_lease(owner, now):
                    lease["until"] = now + LEASE_S
                    epcs = [e for t, e in queue if now - t <= MAX_AGE_S]
                    queue.clear()
                    payload = {"epcs": epcs, "connected": state["connected"]}
                else:
                    payload = None
            if payload is None:
                self._send(409, {"error": "Capture lease required."})
            else:
                self._send(200, payload)
        elif path == "/status":
            with lock:
                payload = dict(state, queued=len(queue))
            self._send(200, payload)
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.authorized():
            return
        path = self.path.split("?")[0]
        owner, now = self.owner(), time.monotonic()
        if not owner:
            self._send(422, {"error": "Valid capture owner required."})
            return
        if path == "/claim":
            with lock:
                available = lease["owner"] is None or lease["until"] <= now or lease["owner"] == owner
                if available:
                    if lease["owner"] != owner or lease["until"] <= now:
                        queue.clear()
                    lease.update(owner=owner, until=now + LEASE_S)
            self._send(200, {"status": "claimed"}) if available else self._send(409, {"error": "Another tab owns capture."})
        elif path == "/release":
            with lock:
                owned = lease["owner"] == owner
                if owned:
                    lease.update(owner=None, until=0.0)
                    queue.clear()
            self._send(200, {"status": "released"}) if owned else self._send(409, {"error": "Capture lease required."})
        else:
            self._send(404, {"error": "not found"})


def create_server(port, token, allowed_origins):
    server = ThreadingHTTPServer((HOST, port), Handler)
    server.daemon_threads = True
    server.pairing_token = token
    server.allowed_origins = set(allowed_origins)
    return server


def app_dir():
    return os.path.dirname(sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__))


def load_config(args):
    cfg = {}
    path = os.path.join(app_dir(), "rfid_bridge.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cfg = json.load(f)
    if not isinstance(cfg, dict):
        raise ValueError("Bridge configuration must be a JSON object.")
    vid = args.vid if args.vid is not None else cfg.get("vid")
    pid = args.pid if args.pid is not None else cfg.get("pid")
    interface = args.interface if args.interface is not None else cfg.get("interface")
    port = args.port if args.port is not None else cfg.get("port", DEFAULT_PORT)
    origins = args.origin or cfg.get("allowed_origins", [])
    confirmed = args.confirm_reader_interface or cfg.get("confirm_reader_interface") is True
    serial = args.serial or cfg.get("serial")
    if vid is None or pid is None or interface is None or not confirmed:
        raise ValueError("Configure actual VID, PID and interface; confirm independent reader access explicitly.")
    numeric = lambda v: int(v, 0) if isinstance(v, str) else int(v)
    vid, pid, interface, port = map(numeric, (vid, pid, interface, port))
    if not (0 < vid <= 65535 and 0 < pid <= 65535 and 0 <= interface <= 255 and 1024 <= port <= 65535):
        raise ValueError("Invalid USB identity, interface or HTTP port; placeholder VID/PID are not accepted.")
    if not isinstance(origins, list) or not origins or any(not isinstance(o, str) or not valid_origin(o) for o in origins):
        raise ValueError("Configure exact localhost application origins, including the port when present.")
    return vid, pid, interface, port, origins, serial


def valid_origin(origin):
    try:
        u = urlsplit(origin)
        return (u.scheme in ("http", "https") and u.hostname in ("localhost", "127.0.0.1", "::1")
                and not u.username and not u.password and not u.path and not u.query and not u.fragment
                and (u.port is None or 1 <= u.port <= 65535))
    except ValueError:
        return False


def main():
    global DEBUG
    ap = argparse.ArgumentParser(description="QuickMart RFID bridge")
    ap.add_argument("--list", action="store_true", help="list USB devices and exit")
    ap.add_argument("--vid")
    ap.add_argument("--pid")
    ap.add_argument("--interface", type=int)
    ap.add_argument("--serial")
    ap.add_argument("--confirm-reader-interface", action="store_true")
    ap.add_argument("--origin", action="append", help="exact localhost application origin")
    ap.add_argument("--port", type=int)
    ap.add_argument("--debug", action="store_true", help="print raw HID reports")
    ap.add_argument("run", nargs="?")
    args = ap.parse_args()
    DEBUG = args.debug
    if args.list:
        list_devices()
        return
    try:
        vid, pid, interface, port, origins, serial = load_config(args)
    except (ValueError, TypeError, OSError) as exc:
        ap.error(str(exc))
    token = os.environ.get("QUICKMART_RFID_BRIDGE_TOKEN") or secrets.token_urlsafe(32)
    if not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", token):
        ap.error("QUICKMART_RFID_BRIDGE_TOKEN must contain 32-128 URL-safe random characters.")
    server = create_server(port, token, origins)
    threading.Thread(target=reader_loop, args=(vid, pid, interface, serial), daemon=True).start()
    print("[HTTP] bridge on http://%s:%d" % (HOST, port), flush=True)
    print("[PAIR] In QuickMart's browser console run:", flush=True)
    print("RFIDScanner.configureBridge(%s)" % json.dumps({"token": token, "port": port}), flush=True)
    print("[USB] No driver/configuration changes are performed. Physical verification is required.", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
