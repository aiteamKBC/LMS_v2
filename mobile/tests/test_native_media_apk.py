"""Hermetic DEX table/code-item regression fixtures, with no APK downloads."""
import hashlib
import importlib.util
from pathlib import Path
import re
import struct
import tempfile
import unittest
import zipfile
import zlib

SPEC = importlib.util.spec_from_file_location(
    "native_media_apk", Path(__file__).resolve().parents[1] / "scripts/verify-native-media-apk.py")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)
V = VERIFY


def uleb(value):
    result = bytearray()
    while True:
        byte = value & 127
        value >>= 7
        result.append(byte | (128 if value else 0))
        if not value:
            return result


class Fixture:
    """Small checksummed DEX fixtures exercise actual class/code offsets and IDs."""
    def __init__(self):
        self.factory = (V.FACTORY, "<init>", "(Lokhttp3/Call$Factory;)V")
        self.legacy = (V.BUILDER, "<init>", "()V")
        self.decoy = (V.VIDEO, "unusedCookieHelper", V.TARGETS["video"][2])
        self.methods = list(V.CALLS.values()) + list(V.TARGETS.values()) + [self.factory, self.legacy, self.decoy]
        self.types = sorted({V.AUDIO, V.VIDEO, V.FACTORY, V.BUILDER, V.CLIENT, V.HANDLER, V.JAR,
                             "Lokhttp3/CookieJar;", "V"} |
                            {part for m in self.methods for part in re.findall(r"\[*(?:L[^;]+;|[VZBSCIJFD])", m[2])} |
                            {m[0] for m in self.methods})
        self.protos = sorted({m[2] for m in self.methods})
        self.strings = sorted(set(self.types) | {m[1] for m in self.methods} | {"httpClient", "V", "L"})
        self.methods.sort(key=lambda m: (self.types.index(m[0]), self.strings.index(m[1]), self.protos.index(m[2])))

    def invoke(self, member, registers=(), opcode=None, ranged=False):
        if opcode is None:
            opcode = 0x71 if member == V.CALLS["provider"] else 0x70 if member[1] == "<init>" else 0x6e
        if ranged:
            assert list(registers) == list(range(registers[0], registers[0] + len(registers)))
            return [opcode + 6 | len(registers) << 8, self.methods.index(member), registers[0]]
        packed = sum(register << (4 * index) for index, register in enumerate(registers[:4]))
        fifth = registers[4] << 8 if len(registers) == 5 else 0
        return [opcode | len(registers) << 12 | fifth, self.methods.index(member), packed]

    def new(self, register, descriptor):
        return [0x22 | register << 8, self.types.index(descriptor)]

    def chain(self, label, *, broken=None, ranged=False):
        invoke = self.invoke
        code = invoke(V.CALLS["provider"]) + [0x0c]
        code += invoke(V.CALLS["builder"], [0], ranged=ranged) + [0x0c]
        code += self.new(1, V.HANDLER) + invoke(V.CALLS["handler"], [1])
        code += self.new(2, V.JAR)
        code += invoke(V.CALLS["jar"], [2, 5 if broken == "handler" else 1])
        code += invoke(V.CALLS["cookieJar"], [0, 2]) + [0x0c]
        code += invoke(V.CALLS["build"], [0]) + [0x0c]
        if broken == "overwrite":
            code += [0x12]  # const/4 v0, 0 destroys the built client
        if label == "audio":
            code += [0x705b if broken != "sink" else 0x715b, 0, 0x0e]
        else:
            code += self.new(3, V.FACTORY)
            code += invoke(self.factory, [3, 5 if broken == "sink" else 0]) + [0x311]
        return code

    def old(self, label):
        code = self.new(0, V.BUILDER) + self.invoke(self.legacy, [0])
        code += self.invoke(V.CALLS["build"], [0]) + [0x0c]
        if label == "audio":
            return code + [0x705b, 0, 0x0e]
        return code + self.new(3, V.FACTORY) + self.invoke(self.factory, [3, 0]) + [0x311]

    def dex(self, definitions):
        # Header, string/type/proto/field/method/class tables precede data.
        classes = sorted({member[0] for member in definitions}, key=self.types.index)
        data = bytearray(112)
        def reserve(count, width):
            offset = len(data)
            data.extend(b"\0" * (count * width))
            return offset
        string_off = reserve(len(self.strings), 4)
        type_off = reserve(len(self.types), 4)
        proto_off = reserve(len(self.protos), 12)
        field_off = reserve(1, 8)
        method_off = reserve(len(self.methods), 8)
        class_off = reserve(len(classes), 32)
        data_off = len(data)
        def align():
            data.extend(b"\0" * (-len(data) % 4))
        for index, value in enumerate(self.strings):
            struct.pack_into("<I", data, string_off + 4 * index, len(data))
            data.extend(uleb(len(value)) + value.encode() + b"\0")
        for index, value in enumerate(self.types):
            struct.pack_into("<I", data, type_off + 4 * index, self.strings.index(value))
        for index, proto in enumerate(self.protos):
            args, result = proto[1:].split(")")
            parameters = re.findall(r"\[*(?:L[^;]+;|[ZBSCIJFD])", args)
            params_off = 0
            if parameters:
                align()
                params_off = len(data)
                data.extend(struct.pack("<I", len(parameters)))
                data.extend(struct.pack("<" + "H" * len(parameters), *[self.types.index(a) for a in parameters]))
            struct.pack_into("<III", data, proto_off + index * 12,
                             self.strings.index("V" if result == "V" else "L"), self.types.index(result), params_off)
        struct.pack_into("<HHI", data, field_off, self.types.index(V.AUDIO), self.types.index(V.CLIENT), self.strings.index("httpClient"))
        for index, member in enumerate(self.methods):
            struct.pack_into("<HHI", data, method_off + 8 * index,
                             self.types.index(member[0]), self.protos.index(member[2]), self.strings.index(member[1]))
        codes = {}
        for member, words in definitions.items():
            align()
            codes[member] = len(data)
            data.extend(struct.pack("<HHHHII", 8, 1, 5, 0, 0, len(words)))
            data.extend(struct.pack("<" + "H" * len(words), *words))
        for index, owner in enumerate(classes):
            offset = len(data)
            members = sorted([m for m in definitions if m[0] == owner], key=self.methods.index)
            data.extend(uleb(0) + uleb(0) + uleb(len(members)) + uleb(0))
            previous = 0
            for member in members:
                method_id = self.methods.index(member)
                data.extend(uleb(method_id - previous) + uleb(1) + uleb(codes[member]))
                previous = method_id
            struct.pack_into("<IIIIIIII", data, class_off + index * 32, self.types.index(owner), 1, 0xffffffff, 0, 0xffffffff, 0, offset, 0)
        data[:8] = b"dex\n039\0"
        struct.pack_into("<III", data, 32, len(data), 112, 0x12345678)
        for header, count, offset in [(56, len(self.strings), string_off), (64, len(self.types), type_off),
                                     (72, len(self.protos), proto_off), (80, 1, field_off),
                                     (88, len(self.methods), method_off), (96, len(classes), class_off)]:
            struct.pack_into("<II", data, header, count, offset)
        struct.pack_into("<II", data, 104, len(data) - data_off, data_off)
        data[12:32] = hashlib.sha1(data[32:]).digest()
        struct.pack_into("<I", data, 8, zlib.adler32(data[12:]) & 0xffffffff)
        return bytes(data)


class NativeMediaApkTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.apk = Path(self.temp.name) / "fixture.apk"

    def verify(self, definitions, *, second=None, second_name="classes2.dex"):
        with zipfile.ZipFile(self.apk, "w") as archive:
            archive.writestr("classes.dex", self.fixture.dex(definitions))
            if second:
                archive.writestr(second_name, self.fixture.dex(second))
        return V.verify_apk(self.apk)

    def both(self, **kwargs):
        return {target: self.fixture.chain(label, **kwargs) for label, target in V.TARGETS.items()}

    def test_both_actual_defined_methods_and_register_consumers_pass(self):
        result = self.verify(self.both())
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(set(result["methods"]), {"audio", "video"})
        self.assertTrue(all(m["registerFlowVerified"] for m in result["methods"].values()))
        self.assertFalse(result["physicalPlaybackVerified"])

    def test_definition_can_be_in_another_dex(self):
        methods = self.both()
        result = self.verify({V.TARGETS["audio"]: methods[V.TARGETS["audio"]]},
                             second={V.TARGETS["video"]: methods[V.TARGETS["video"]]})
        self.assertEqual(result["methods"]["video"]["dex"], "classes2.dex")

    def test_actual_old_default_builder_fails_despite_matching_pool_strings(self):
        with self.assertRaisesRegex(V.VerificationError, "audio:.*video:"):
            self.verify({target: self.fixture.old(label) for label, target in V.TARGETS.items()})

    def test_high_multidex_numbers_are_inspected(self):
        methods = self.both()
        for name in ("classes10.dex", "classes19.dex", "classes100.dex", "classes199.dex"):
            with self.subTest(name=name):
                result = self.verify({V.TARGETS["audio"]: methods[V.TARGETS["audio"]]},
                                     second={V.TARGETS["video"]: methods[V.TARGETS["video"]]}, second_name=name)
                self.assertEqual(result["methods"]["video"]["dex"], name)

    def test_high_multidex_duplicate_definition_cannot_hide(self):
        with self.assertRaisesRegex(V.VerificationError, "exactly one"):
            self.verify(self.both(), second=self.both(), second_name="classes100.dex")

    def test_helper_method_calls_cannot_satisfy_the_playback_method(self):
        definitions = {target: self.fixture.old(label) for label, target in V.TARGETS.items()}
        definitions[self.fixture.decoy] = self.fixture.chain("video")
        with self.assertRaisesRegex(V.VerificationError, "chain missing"):
            self.verify(definitions)

    def test_wrong_handler_object_is_rejected(self):
        with self.assertRaisesRegex(V.VerificationError, "chain missing"):
            self.verify(self.both(broken="handler"))

    def test_cookie_client_not_consumed_by_media_is_rejected(self):
        with self.assertRaisesRegex(V.VerificationError, "not used"):
            self.verify(self.both(broken="sink"))

    def test_overwriting_client_register_is_rejected(self):
        with self.assertRaisesRegex(V.VerificationError, "not used"):
            self.verify(self.both(broken="overwrite"))

    def test_audio_cookie_client_must_be_stored_on_this_instance(self):
        definitions = self.both()
        definitions[V.TARGETS["audio"]][-3] = 0x605b  # iput-object v0, v6; this is v7
        with self.assertRaisesRegex(V.VerificationError, "audio:.*not used"):
            self.verify(definitions)

    def test_video_must_return_the_factory_that_consumed_the_cookie_client(self):
        definitions = self.both()
        definitions[V.TARGETS["video"]][-1] = 0x411  # return-object v4 instead of the constructed v3
        with self.assertRaisesRegex(V.VerificationError, "returned factory"):
            self.verify(definitions)

    def test_unreachable_calls_after_return_do_not_count(self):
        definitions = self.both()
        definitions[V.TARGETS["audio"]] = [0x0e] + definitions[V.TARGETS["audio"]]
        with self.assertRaisesRegex(V.VerificationError, "audio:"):
            self.verify(definitions)

    def test_invocation_like_literal_words_do_not_count(self):
        # A const-wide operand deliberately contains an invoke opcode+method id.
        words = [0x18, 0x71, self.fixture.methods.index(V.CALLS["provider"]), 0, 0, 0x0e]
        definitions = self.both()
        definitions[V.TARGETS["audio"]] = words
        with self.assertRaisesRegex(V.VerificationError, "audio:"):
            self.verify(definitions)

    def test_range_invokes_resolve_actual_registers(self):
        self.assertEqual(self.verify(self.both(ranged=True))["status"], "PASS")

    def test_duplicate_target_definition_across_dex_is_rejected(self):
        with self.assertRaisesRegex(V.VerificationError, "exactly one"):
            self.verify(self.both(), second=self.both())

    def test_missing_target_definition_fails_even_if_referenced(self):
        with self.assertRaisesRegex(V.VerificationError, "exactly one"):
            self.verify({V.TARGETS["audio"]: self.fixture.chain("audio")})

    def test_truncated_instructions_fail_closed(self):
        with self.assertRaisesRegex(V.VerificationError, "Truncated"):
            list(V.instructions([0x71]))

    def test_payload_is_skipped_and_not_decoded_as_invokes(self):
        words = [0x300, 2, 3, 0, 0x71, 0, 0]
        self.assertEqual(len(list(V.instructions(words))), 1)

    def test_checksum_tampering_is_rejected(self):
        data = bytearray(self.fixture.dex(self.both()))
        data[-1] ^= 1
        with self.assertRaisesRegex(V.VerificationError, "signature mismatch"):
            V.Dex(data)


if __name__ == "__main__":
    unittest.main()

