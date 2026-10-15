"""Validate uploaded media and prepare provider-safe audio inputs."""

import json
import subprocess
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path


class MediaValidationError(Exception):
    def __init__(self, detail: str, status_code: int = 415):
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


@dataclass(frozen=True)
class MediaInfo:
    mime_type: str
    duration_seconds: float
    is_video: bool


def _duration_label(seconds: float) -> str:
    total = max(1, round(seconds))
    minutes, remainder = divmod(total, 60)
    if not minutes:
        return f"{remainder} second{'s' if remainder != 1 else ''}"
    if not remainder:
        return f"{minutes} minute{'s' if minutes != 1 else ''}"
    return f"{minutes} minute{'s' if minutes != 1 else ''} {remainder} seconds"


def _container(header: bytes) -> str:
    if header.startswith(b"\x1a\x45\xdf\xa3"):
        return "webm"
    if len(header) >= 12 and header[:4] == b"RIFF" and header[8:12] == b"WAVE":
        return "wav"
    if header.startswith(b"OggS"):
        return "ogg"
    if len(header) >= 2 and header[0] == 0xFF and header[1] & 0xF6 == 0xF0:
        return "aac"
    if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0):
        return "mp3"
    if len(header) >= 8 and header[4:8] == b"ftyp":
        return "quicktime" if b"qt  " in header[4:16] else "mp4"
    raise MediaValidationError("This file’s contents are not a supported audio or video format.")


def inspect_media(path: str | Path, max_duration_seconds: int) -> MediaInfo:
    media_path = Path(path)
    if not media_path.is_file() or media_path.stat().st_size == 0:
        raise MediaValidationError("The uploaded media file is empty.", 400)
    with media_path.open("rb") as source:
        container = _container(source.read(32))
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,duration", "-of", "json", str(media_path)],
            capture_output=True, text=True, check=True, timeout=30,
        )
    except FileNotFoundError as exc:
        raise MediaValidationError("FFmpeg and FFprobe are required to validate media uploads. Install them and restart the backend.", 503) from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaValidationError("Media inspection timed out. Try a shorter or simpler audio/video file.", 422) from exc
    except subprocess.CalledProcessError as exc:
        raise MediaValidationError("This file is damaged or uses an unsupported audio/video codec.") from exc
    try:
        details = json.loads(probe.stdout)
        streams = details.get("streams") or []
        format_names = (details.get("format") or {}).get("format_name", "")
        has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
        is_video = any(stream.get("codec_type") == "video" for stream in streams)
        duration = float((details.get("format") or {}).get("duration") or 0)
        if duration <= 0:
            duration = max((float(stream.get("duration") or 0) for stream in streams), default=0)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise MediaValidationError("Could not read the media metadata. Try exporting the file again.") from exc
    if not has_audio:
        raise MediaValidationError("This file has no audio track to transcribe.")
    if duration <= 0:
        raise MediaValidationError("Could not determine the media duration. Try exporting the file again.")
    if duration > max_duration_seconds:
        raise MediaValidationError(f"This recording is {_duration_label(duration)} long. The maximum duration is {_duration_label(max_duration_seconds)}.", 413)
    if container == "webm":
        suffix = "webm" if "webm" in format_names else "x-matroska"
        mime_type = f"video/{suffix}" if is_video else f"audio/{suffix}"
    elif container in ("mp4", "quicktime"):
        mime_type = "video/quicktime" if is_video and container == "quicktime" else "video/mp4" if is_video else "audio/mp4"
    else:
        mime_type = {"wav": "audio/wav", "ogg": "audio/ogg", "mp3": "audio/mpeg", "aac": "audio/aac"}[container]
    return MediaInfo(mime_type=mime_type, duration_seconds=duration, is_video=is_video)


def inspect_media_bytes(data: bytes, max_duration_seconds: int) -> MediaInfo:
    with tempfile.NamedTemporaryFile(suffix=".media", delete=False) as staged:
        staged.write(data)
        staged_path = Path(staged.name)
    try:
        return inspect_media(staged_path, max_duration_seconds)
    finally:
        staged_path.unlink(missing_ok=True)


@contextmanager
def provider_audio(path: str | Path, info: MediaInfo):
    source = Path(path)
    if not info.is_video:
        yield source, info.mime_type
        return
    with tempfile.TemporaryDirectory(prefix="meeting-audio-") as directory:
        output = Path(directory) / "extracted.mp3"
        try:
            subprocess.run(
                ["ffmpeg", "-v", "error", "-i", str(source), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", str(output)],
                capture_output=True, check=True, timeout=180,
            )
        except FileNotFoundError as exc:
            raise MediaValidationError("FFmpeg is required to extract audio from video uploads. Install it and restart the backend.", 503) from exc
        except subprocess.TimeoutExpired as exc:
            raise MediaValidationError("Audio extraction timed out. Try a shorter video.", 422) from exc
        except subprocess.CalledProcessError as exc:
            raise MediaValidationError("Could not extract audio from this video. Check that it contains a supported audio track.") from exc
        if not output.is_file() or output.stat().st_size == 0:
            raise MediaValidationError("Could not extract audio from this video. Check that it contains a supported audio track.")
        yield output, "audio/mpeg"
