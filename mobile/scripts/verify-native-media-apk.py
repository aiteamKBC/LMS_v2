#!/usr/bin/env python3
"""Verify the actual Expo audio/video cookie transport inside an Android APK.

No Android SDK or third-party Python dependencies are required. This reads DEX
class_data/code_item instructions, resolves method/field IDs, and follows object
registers from the RN provider through the platform cookie jar into the media
client's consumer. Strings or calls in another method cannot satisfy the check.

This is a bounded verifier for the pinned, non-minified native build, not a
general DEX VM or a physical playback test. Changed/obfuscated compiler output
must be reviewed instead of weakening the check.
DEX format: https://source.android.com/docs/core/runtime/dalvik-bytecode
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys
import zipfile
import zlib

PROVIDER = "Lcom/facebook/react/modules/network/OkHttpClientProvider;"
HANDLER = "Lcom/facebook/react/modules/network/ForwardingCookieHandler;"
JAR = "Lokhttp3/JavaNetCookieJar;"
CLIENT = "Lokhttp3/OkHttpClient;"
BUILDER = "Lokhttp3/OkHttpClient$Builder;"
FACTORY = "Landroidx/media3/datasource/okhttp/OkHttpDataSource$Factory;"
AUDIO = "Lexpo/modules/audio/AudioModule;"
VIDEO = "Lexpo/modules/video/DataSourceUtilsKt;"
TARGETS = {
    "audio": (AUDIO, "<init>", "()V"),
    "video": (VIDEO, "buildOkHttpDataSourceFactory",
              "(Landroid/content/Context;Lexpo/modules/video/records/VideoSource;)" + FACTORY),
}
CALLS = {
    "provider": (PROVIDER, "getOkHttpClient", "()" + CLIENT),
    "builder": (CLIENT, "newBuilder", "()" + BUILDER),
    "handler": (HANDLER, "<init>", "()V"),
    "jar": (JAR, "<init>", "(Ljava/net/CookieHandler;)V"),
    "cookieJar": (BUILDER, "cookieJar", "(Lokhttp3/CookieJar;)" + BUILDER),
    "build": (BUILDER, "build", "()" + CLIENT),
}


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


class Dex:
    def __init__(self, data):
        self.data = data
        require(data[:8] in [b"dex\n" + v + b"\0" for v in (b"035", b"037", b"038", b"039", b"040")],
                "Unsupported standard DEX version")
        require(len(data) >= 112 and self.u32(32) == len(data) and self.u32(36) == 112
                and self.u32(40) == 0x12345678, "Invalid DEX header")
        require(hashlib.sha1(data[32:]).digest() == data[12:32], "DEX signature mismatch")
        require(zlib.adler32(data[12:]) & 0xffffffff == self.u32(8), "DEX checksum mismatch")
        self.strings = [self.string(self.u32(offset)) for offset in self.table(56, 4)]
        self.types = [self.strings[self.u32(offset)] for offset in self.table(64, 4)]
        self.protos = []
        for offset in self.table(72, 12):
            parameters = self.u32(offset + 8)
            args = [] if not parameters else [
                self.types[self.u16(parameters + 4 + 2 * i)] for i in range(self.u32(parameters))
            ]
            self.protos.append("(" + "".join(args) + ")" + self.types[self.u32(offset + 4)])
        self.fields = [(self.types[self.u16(o)], self.strings[self.u32(o + 4)],
                        self.types[self.u16(o + 2)]) for o in self.table(80, 8)]
        self.methods = [(self.types[self.u16(o)], self.strings[self.u32(o + 4)],
                         self.protos[self.u16(o + 2)]) for o in self.table(88, 8)]

    def u16(self, offset):
        require(0 <= offset <= len(self.data) - 2, "Truncated DEX uint16")
        return struct.unpack_from("<H", self.data, offset)[0]

    def u32(self, offset):
        require(0 <= offset <= len(self.data) - 4, "Truncated DEX uint32")
        return struct.unpack_from("<I", self.data, offset)[0]

    def table(self, header, width):
        count, offset = self.u32(header), self.u32(header + 4)
        require(offset + count * width <= len(self.data), "DEX table exceeds file")
        return range(offset, offset + count * width, width)

    def uleb(self, offset):
        value = 0
        for shift in range(0, 35, 7):
            require(offset < len(self.data), "Truncated DEX ULEB")
            byte = self.data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if not byte & 128:
                return value, offset
        raise VerificationError("Invalid DEX ULEB")

    def string(self, offset):
        _, start = self.uleb(offset)
        end = self.data.find(b"\0", start)
        require(end != -1, "Unterminated DEX string")
        # Required descriptors and member names are ASCII. Other MUTF-8 strings
        # are irrelevant to verification and are never used as evidence.
        return self.data[start:end].decode("utf-8", errors="replace")

    def definitions(self):
        wanted = set(TARGETS.values())
        for offset in self.table(96, 32):
            owner = self.types[self.u32(offset)]
            if owner not in {AUDIO, VIDEO}:
                continue
            pos = self.u32(offset + 24)
            require(pos != 0, "Target class has no definitions")
            counts = []
            for _ in range(4):
                value, pos = self.uleb(pos)
                counts.append(value)
            for _ in range(counts[0] + counts[1]):
                _, pos = self.uleb(pos)
                _, pos = self.uleb(pos)
            for count in counts[2:]:
                method_index = 0
                for _ in range(count):
                    difference, pos = self.uleb(pos)
                    method_index += difference
                    _, pos = self.uleb(pos)  # access flags
                    code_offset, pos = self.uleb(pos)
                    method = self.methods[method_index]
                    require(method[0] == owner, "Class data points outside its class")
                    if method in wanted:
                        require(code_offset != 0, "Target method has no executable body")
                        size = self.u32(code_offset + 12)
                        start = code_offset + 16
                        require(start + size * 2 <= len(self.data), "Truncated method body")
                        words = struct.unpack_from("<" + str(size) + "H", self.data, start)
                        registers_size = self.u16(code_offset)
                        ins_size = self.u16(code_offset + 2)
                        require(registers_size >= ins_size, "Invalid method register counts")
                        yield method, words, registers_size - ins_size


WIDTHS = {}
for width, groups in {
    1: [(0x00, 0x01), (0x04, 0x04), (0x07, 0x07), (0x0a, 0x12),
        (0x1d, 0x1e), (0x21, 0x21), (0x27, 0x28), (0x7b, 0x8f), (0xb0, 0xcf)],
    2: [(0x02, 0x02), (0x05, 0x05), (0x08, 0x08), (0x13, 0x13),
        (0x15, 0x16), (0x19, 0x1a), (0x1c, 0x1c), (0x1f, 0x20),
        (0x22, 0x23), (0x29, 0x29), (0x2d, 0x3d), (0x44, 0x6d),
        (0x90, 0xaf), (0xd0, 0xe2), (0xfe, 0xff)],
    3: [(0x03, 0x03), (0x06, 0x06), (0x09, 0x09), (0x14, 0x14),
        (0x17, 0x17), (0x1b, 0x1b), (0x24, 0x26), (0x2a, 0x2c),
        (0x6e, 0x72), (0x74, 0x78), (0xfc, 0xfd)],
    4: [(0xfa, 0xfb)],
    5: [(0x18, 0x18)],
}.items():
    for first, last in groups:
        WIDTHS.update({opcode: width for opcode in range(first, last + 1)})


def instructions(words):
    """Walk instruction boundaries, including payloads; never scan arbitrary words."""
    pc = 0
    while pc < len(words):
        first = words[pc]
        opcode = first & 255
        width = WIDTHS.get(opcode)
        require(width is not None, "Unsupported DEX opcode")
        if opcode == 0 and first:
            require(pc + 2 <= len(words), "Truncated payload")
            if first == 0x100:
                width = 4 + 2 * words[pc + 1]
            elif first == 0x200:
                width = 2 + 4 * words[pc + 1]
            elif first == 0x300:
                require(pc + 4 <= len(words), "Truncated array payload")
                width = 4 + (words[pc + 1] * (words[pc + 2] | words[pc + 3] << 16) + 1) // 2
            else:
                raise VerificationError("Unknown DEX payload")
        require(pc + width <= len(words), "Truncated DEX instruction")
        yield pc, opcode, words[pc:pc + width]
        pc += width


def invoke_registers(opcode, words):
    if 0x74 <= opcode <= 0x78:
        return list(range(words[2], words[2] + (words[0] >> 8)))
    count = words[0] >> 12
    require(count <= 5, "Invalid invoke argument count")
    packed = words[2]
    return [(packed >> (4 * i)) & 15 for i in range(4)][:count] + (
        [(words[0] >> 8) & 15] if count == 5 else [])


def reachable_instructions(words):
    decoded = {pc: (opcode, units) for pc, opcode, units in instructions(words)}
    reached, pending = set(), [0]
    signed = lambda value, bits: value - (1 << bits) if value & (1 << (bits - 1)) else value
    while pending:
        pc = pending.pop()
        if pc in reached:
            continue
        require(pc in decoded, "Branch enters a non-instruction boundary")
        opcode, units = decoded[pc]
        require(not (opcode == 0 and units[0]), "Executable branch enters data payload")
        reached.add(pc)
        following = pc + len(units)
        if opcode in (0x0e, 0x0f, 0x10, 0x11, 0x27):
            continue
        if opcode in (0x28, 0x29, 0x2a):
            relative = (signed(units[0] >> 8, 8) if opcode == 0x28 else
                        signed(units[1], 16) if opcode == 0x29 else signed(units[1] | units[2] << 16, 32))
            pending.append(pc + relative)
            continue
        if 0x32 <= opcode <= 0x3d:
            pending.append(pc + signed(units[1], 16))
        if opcode in (0x2b, 0x2c):
            payload = pc + signed(units[1] | units[2] << 16, 32)
            require(payload in decoded and decoded[payload][1][0] == (0x100 if opcode == 0x2b else 0x200), "Invalid switch payload")
            payload_units = decoded[payload][1]
            count = payload_units[1]
            start = 4 if opcode == 0x2b else 2 + 2 * count
            for index in range(count):
                pos = start + 2 * index
                pending.append(pc + signed(payload_units[pos] | payload_units[pos + 1] << 16, 32))
        require(following in decoded, "Executable method falls outside its body")
        pending.append(following)
    return [(pc, opcode, units) for pc, (opcode, units) in decoded.items() if pc in reached]


def verify_body(dex, words, label, this_register):
    registers, pending, evidence = {}, None, {}
    this_object = {"kind": "this"}
    if label == "audio":
        registers[this_register] = this_object
    factory_returns = []
    built, consumed = None, None
    for pc, opcode, units in reachable_instructions(words):
        first = units[0]
        if opcode in range(0x6e, 0x73) or opcode in range(0x74, 0x79):
            member = dex.methods[units[1]]
            args = invoke_registers(opcode, units)
            values = [registers.get(register) for register in args]
            pending = None
            if member == CALLS["provider"] and not args and opcode in (0x71, 0x77):
                pending = {"kind": "provider"}
                evidence = {"provider": pc}
            elif member == CALLS["builder"] and opcode in (0x6e, 0x74) and len(values) == 1 and values[0] and values[0]["kind"] == "provider":
                pending = {"kind": "builder", "jar": None}
                evidence["builder"] = pc
            elif member == CALLS["handler"] and opcode in (0x70, 0x76) and len(values) == 1 and values[0] and values[0].get("type") == HANDLER:
                values[0]["kind"] = "handler"
                evidence["handler"] = pc
            elif member == CALLS["jar"] and opcode in (0x70, 0x76) and len(values) == 2 and values[0] and values[0].get("type") == JAR and values[1] and values[1]["kind"] == "handler":
                values[0]["kind"] = "jar"
                evidence["jar"] = pc
            elif member == CALLS["cookieJar"] and opcode in (0x6e, 0x74) and len(values) == 2 and values[0] and values[0]["kind"] == "builder" and values[1] and values[1]["kind"] == "jar":
                values[0]["jar"] = values[1]
                pending = values[0]
                evidence["cookieJar"] = pc
            elif member == CALLS["build"] and opcode in (0x6e, 0x74) and len(values) == 1 and values[0] and values[0]["kind"] == "builder" and values[0]["jar"]:
                pending = built = {"kind": "cookie_client"}
                evidence["build"] = pc
            elif (label == "video" and opcode in (0x70, 0x76) and member == (FACTORY, "<init>", "(Lokhttp3/Call$Factory;)V")
                  and len(values) == 2 and values[0] and values[0].get("type") == FACTORY
                  and built is not None and values[1] is built):
                values[0]["kind"] = "cookie_factory"
                consumed = pc
            continue
        if opcode == 0x0c:
            registers[first >> 8] = pending
            pending = None
            continue
        pending = None
        if opcode in (0x07, 0x08, 0x09):
            destination, source = ((first >> 8 & 15, first >> 12) if opcode == 0x07 else
                                   (first >> 8, units[1]) if opcode == 0x08 else (units[1], units[2]))
            registers[destination] = registers.get(source)
        elif opcode == 0x22:
            registers[first >> 8] = {"kind": "allocated", "type": dex.types[units[1]]}
        elif opcode == 0x5b:
            field = dex.fields[units[1]]
            if (label == "audio" and field == (AUDIO, "httpClient", CLIENT) and built is not None
                    and registers.get(first >> 8 & 15) is built and registers.get(first >> 12) is this_object):
                consumed = pc
        elif opcode == 0x11 and label == "video":
            factory_returns.append((registers.get(first >> 8) or {}).get("kind") == "cookie_factory")
        elif opcode == 0x1f:
            pass  # check-cast preserves the object identity
        else:
            # Invalidate every defined register-writing opcode; unrelated
            # method calls/constants cannot borrow evidence from an old value.
            destination = None
            if opcode in (0x01, 0x04, 0x12, 0x20, 0x21, 0x23) or 0x52 <= opcode <= 0x58 or 0x7b <= opcode <= 0x8f or 0xb0 <= opcode <= 0xd7:
                destination = first >> 8 & 15
            elif opcode in (0x02, 0x05, 0x0a, 0x0b, 0x0d) or 0x13 <= opcode <= 0x1c or 0x44 <= opcode <= 0x4a or 0x60 <= opcode <= 0x66 or 0x90 <= opcode <= 0xaf or 0xd8 <= opcode <= 0xe2 or opcode in (0xfe, 0xff):
                destination = first >> 8
            elif opcode in (0x03, 0x06):
                destination = units[1]
            if destination is not None:
                registers.pop(destination, None)
                # Treat wide values conservatively without retaining a stale
                # tracked object in the second register of a wide destination.
                if opcode in (0x04, 0x05, 0x06, 0x0b, 0x16, 0x17, 0x18, 0x19, 0x45, 0x53, 0x61):
                    registers.pop(destination + 1, None)
    require(set(evidence) == set(CALLS) and consumed is not None,
            label + ": native cookie-client chain missing or not used by media consumer")
    if label == "video":
        require(factory_returns and all(factory_returns), "video: returned factory does not use the cookie client")
    return {"invokeOffsets": evidence, "mediaConsumerOffset": consumed,
            "registerFlowVerified": True,
            "consumerIdentity": "this.httpClient" if label == "audio" else "returned OkHttpDataSource.Factory"}


def verify_apk(path):
    found = {label: [] for label in TARGETS}
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        dex_names = [name for name in names if re.fullmatch(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex", name)]
        require(dex_names and len(set(dex_names)) == len(dex_names), "Missing or duplicate APK DEX entries")
        for name in dex_names:
            dex = Dex(archive.read(name))
            for member, words, this_register in dex.definitions():
                label = next(label for label, target in TARGETS.items() if member == target)
                found[label].append((name, dex, words, this_register))
        results, failures = {}, []
        for label, matches in found.items():
            require(len(matches) == 1, label + ": expected exactly one defined target method")
            name, dex, words, this_register = matches[0]
            try:
                results[label] = {"dex": name, "method": "".join(TARGETS[label]),
                                  **verify_body(dex, words, label, this_register)}
            except VerificationError as error:
                failures.append(str(error))
        require(not failures, "; ".join(failures))
    return {"status": "PASS", "apkSha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
            "methods": results, "physicalPlaybackVerified": False,
            "scope": "Defined native method invokes and register flow into media consumers"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    apk_hash = None
    try:
        apk_hash = hashlib.sha256(args.apk.read_bytes()).hexdigest()
        result = verify_apk(args.apk)
        code = 0
    except (VerificationError, OSError, IndexError, struct.error, zipfile.BadZipFile) as error:
        result = {"status": "FAIL", "error": str(error), "apkSha256": apk_hash,
                  "physicalPlaybackVerified": False}
        code = 1
    if args.report:
        args.report.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())

