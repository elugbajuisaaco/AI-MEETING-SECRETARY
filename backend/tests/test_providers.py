import os
import unittest
from unittest.mock import patch

from backend.main import MeetingResult, ProviderChain


class FakeProvider:
    def __init__(self, error=None):
        self.error = error
        self.called = False

    def transcribe_and_summarize(self, audio_path, mime_type):
        self.called = True
        if self.error:
            raise self.error
        return MeetingResult(title="Fallback result")


class ProviderChainTests(unittest.TestCase):
    @patch.dict(os.environ, {"PROVIDER_ORDER": "gemini,groq"})
    def test_503_falls_back_to_groq(self):
        gemini, groq = FakeProvider(RuntimeError("unavailable")), FakeProvider()
        gemini.error.status_code = 503
        with patch("backend.main.time.sleep"):
            result, provider = ProviderChain({"gemini": gemini, "groq": groq}, "req-1").transcribe_and_summarize("audio", "audio/webm")
        self.assertEqual(provider, "groq")
        self.assertEqual(result.title, "Fallback result")
        self.assertTrue(groq.called)

    @patch.dict(os.environ, {"PROVIDER_ORDER": "gemini,groq"})
    def test_400_does_not_fall_back(self):
        gemini, groq = FakeProvider(RuntimeError("bad request")), FakeProvider()
        gemini.error.status_code = 400
        with self.assertRaises(RuntimeError):
            ProviderChain({"gemini": gemini, "groq": groq}, "req-2").transcribe_and_summarize("audio", "audio/webm")
        self.assertFalse(groq.called)


if __name__ == "__main__":
    unittest.main()
