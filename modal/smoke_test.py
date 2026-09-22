#!/usr/bin/env python3
# smoke_test.py — OFFLINE validation of the MELEK private-brain contract + auth.
#
# The model load needs a Modal GPU, so this does NOT exercise generation. It exercises everything
# that is pure Python and MUST be right for the .mjs `modal-client.mjs` to match: the request parse,
# the response shape, the bearer check, message assembly, and the batch schedule constants. Stdlib
# only — runs anywhere with no `modal`, no `vllm`, no network:
#
#   python3 modal/smoke_test.py
#
# This is the Python analogue of the repo's offline .mjs suite: no network, soft-fail, deterministic.
import unittest

import brain_lib as L


class TestBearer(unittest.TestCase):
    def test_open_when_no_token_configured(self):
        self.assertTrue(L.check_bearer("", ""))
        self.assertTrue(L.check_bearer("Bearer anything", ""))

    def test_exact_match_required_when_configured(self):
        self.assertTrue(L.check_bearer("secret-abc", "secret-abc"))
        self.assertTrue(L.check_bearer("Bearer secret-abc", "secret-abc"))
        self.assertFalse(L.check_bearer("secret-abd", "secret-abc"))
        self.assertFalse(L.check_bearer("", "secret-abc"))
        self.assertFalse(L.check_bearer("Bearer ", "secret-abc"))
        self.assertFalse(L.check_bearer(None, "secret-abc"))

    def test_length_mismatch_is_rejected(self):
        self.assertFalse(L.check_bearer("short", "a-much-longer-token"))

    def test_bearer_from_header(self):
        self.assertEqual(L.bearer_from_header("Bearer xyz"), "xyz")
        self.assertEqual(L.bearer_from_header("bearer xyz"), "xyz")
        self.assertEqual(L.bearer_from_header("xyz"), "")
        self.assertEqual(L.bearer_from_header(""), "")
        self.assertEqual(L.bearer_from_header(None), "")


class TestNormalizeMessages(unittest.TestCase):
    def test_system_prepended(self):
        msgs = L.normalize_messages([{"role": "user", "content": "hi"}], system="be brief")
        self.assertEqual(msgs[0], {"role": "system", "content": "be brief"})
        self.assertEqual(msgs[1], {"role": "user", "content": "hi"})

    def test_unknown_role_becomes_user(self):
        msgs = L.normalize_messages([{"role": "wizard", "content": "hi"}])
        self.assertEqual(msgs[0]["role"], "user")

    def test_empty_content_dropped(self):
        msgs = L.normalize_messages([{"role": "user", "content": "  "},
                                     {"role": "user", "content": "real"}])
        self.assertEqual(len(msgs), 1)
        self.assertEqual(msgs[0]["content"], "real")

    def test_two_systems_merge(self):
        msgs = L.normalize_messages([{"role": "system", "content": "b"},
                                     {"role": "user", "content": "hi"}], system="a")
        self.assertEqual(msgs[0]["role"], "system")
        self.assertIn("a", msgs[0]["content"])
        self.assertIn("b", msgs[0]["content"])
        self.assertEqual(sum(1 for m in msgs if m["role"] == "system"), 1)

    def test_non_list_is_safe(self):
        self.assertEqual(L.normalize_messages(None), [])
        self.assertEqual(L.normalize_messages("nope"), [])

    def test_content_length_guarded(self):
        big = "x" * (L.MAX_CONTENT_CHARS + 5000)
        msgs = L.normalize_messages([{"role": "user", "content": big}])
        self.assertLessEqual(len(msgs[0]["content"]), L.MAX_CONTENT_CHARS)


class TestParseChatRequest(unittest.TestCase):
    def test_happy_path(self):
        req = L.parse_chat_request({"messages": [{"role": "user", "content": "hello"}],
                                    "system": "be Hathor", "max_tokens": 128, "temperature": 0.5})
        self.assertTrue(req["ok"])
        self.assertFalse(req["warmup"])
        self.assertEqual(req["max_tokens"], 128)
        self.assertEqual(req["temperature"], 0.5)
        self.assertEqual(req["messages"][0]["role"], "system")

    def test_max_tokens_clamped(self):
        req = L.parse_chat_request({"messages": [{"role": "user", "content": "hi"}],
                                    "max_tokens": 999999})
        self.assertEqual(req["max_tokens"], L.MAX_TOKENS_CEILING)
        req2 = L.parse_chat_request({"messages": [{"role": "user", "content": "hi"}],
                                     "max_tokens": -4})
        self.assertEqual(req2["max_tokens"], 1)

    def test_defaults_applied(self):
        req = L.parse_chat_request({"messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(req["max_tokens"], L.MAX_TOKENS_DEFAULT)
        self.assertEqual(req["temperature"], L.TEMPERATURE_DEFAULT)

    def test_warmup_without_messages_is_ok(self):
        req = L.parse_chat_request({"warmup": True})
        self.assertTrue(req["ok"])
        self.assertTrue(req["warmup"])

    def test_no_user_message_rejected(self):
        req = L.parse_chat_request({"messages": [], "system": "just a system"})
        self.assertFalse(req["ok"])
        self.assertEqual(req["error"], "no user message")

    def test_non_dict_body_rejected(self):
        req = L.parse_chat_request("not json")
        self.assertFalse(req["ok"])
        self.assertEqual(req["messages"], [])

    def test_bad_temperature_falls_back(self):
        req = L.parse_chat_request({"messages": [{"role": "user", "content": "hi"}],
                                    "temperature": "hot"})
        self.assertEqual(req["temperature"], L.TEMPERATURE_DEFAULT)


class TestShapeResponse(unittest.TestCase):
    def test_shape(self):
        r = L.shape_response("hello world", model="Qwen/Qwen2.5-7B-Instruct",
                             usage={"completion_tokens": 2})
        self.assertTrue(r["ok"])
        self.assertEqual(r["text"], "hello world")
        self.assertEqual(r["model"], "Qwen/Qwen2.5-7B-Instruct")
        self.assertFalse(r["warmup"])
        self.assertEqual(r["usage"], {"completion_tokens": 2})

    def test_none_text_is_empty_string(self):
        self.assertEqual(L.shape_response(None)["text"], "")

    def test_error_response(self):
        e = L.error_response("unauthorized", "unauthorized")
        self.assertFalse(e["ok"])
        self.assertEqual(e["code"], "unauthorized")
        self.assertEqual(e["text"], "")


class TestScheduleConstants(unittest.TestCase):
    def test_cron_is_twice_daily_before_noon_and_midnight(self):
        # "30 11,23 * * *" — 11:30 and 23:30, i.e. 30 min before 12:00 and 00:00
        parts = L.BATCH_CRON.split()
        self.assertEqual(len(parts), 5)
        self.assertEqual(parts[0], "30")
        self.assertEqual(sorted(parts[1].split(",")), ["11", "23"])
        self.assertEqual(L.BATCH_TZ, "America/Chicago")


if __name__ == "__main__":
    unittest.main(verbosity=2)
