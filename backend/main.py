import base64
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import time
import logging
import threading
import uuid
from contextlib import nullcontext
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, EmailStr, Field
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

try:
    from backend.database import connect, engine
    from backend.storage import LocalStorageProvider, create_storage_provider
    from backend.email_provider import create_email_provider
    from backend.media import MediaValidationError, inspect_media, inspect_media_bytes, provider_audio
except ModuleNotFoundError:
    from database import connect, engine
    from storage import LocalStorageProvider, create_storage_provider
    from email_provider import create_email_provider
    from media import MediaValidationError, inspect_media, inspect_media_bytes, provider_audio

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")
if engine.dialect.name == "sqlite" and engine.url.database != ":memory:":
    Path(engine.url.database).parent.mkdir(parents=True, exist_ok=True)
MAX_AUDIO_BYTES = max(1, int(os.getenv("MAX_AUDIO_BYTES", str(20 * 1024 * 1024))))
MAX_AUDIO_DURATION_SECONDS = max(1, int(os.getenv("MAX_AUDIO_DURATION_SECONDS", "7200")))
MAX_REQUESTS = int(os.getenv("RATE_LIMIT_PER_MINUTE", "12"))
SECRET = os.getenv("JWT_SECRET") or (secrets.token_urlsafe(48) if os.getenv("ENVIRONMENT") != "production" else "")
if not SECRET:
    raise RuntimeError("JWT_SECRET must be configured in production")
local_storage = LocalStorageProvider(ROOT / "data" / "audio", SECRET)
storage = create_storage_provider(SECRET)
email_provider = create_email_provider()
password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
app = FastAPI(title="AI Meeting Secretary API", version="2.0.0")
allowed_origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])
rate_buckets: dict[tuple[str, str], list[float]] = {}
logger = logging.getLogger(__name__)
jobs = ThreadPoolExecutor(max_workers=2)
active_meetings: set[str] = set()
active_meetings_lock = threading.Lock()


def max_audio_size_label() -> str:
    megabytes = MAX_AUDIO_BYTES / (1024 * 1024)
    return f"{megabytes:g} MB"


def init_db():
    required = {"users", "meetings", "usage"}
    existing = set(inspect(engine).get_table_names())
    if not required.issubset(existing):
        missing = ", ".join(sorted(required - existing))
        raise RuntimeError(f"Database tables are missing ({missing}); run 'alembic upgrade head' from backend.")


def recover_stuck_jobs():
    timeout_minutes = max(1, int(os.getenv("TRANSCRIPTION_JOB_TIMEOUT_MINUTES", "30")))
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=timeout_minutes)
    with connect() as db:
        rows = db.execute("SELECT id,user_id,quota_month,updated_at FROM meetings WHERE status='processing'").fetchall()
        stale_ids = []
        for row in rows:
            try:
                updated = datetime.fromisoformat(row["updated_at"].replace("Z", "+00:00"))
                if updated.tzinfo is None:
                    updated = updated.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                updated = datetime.min.replace(tzinfo=timezone.utc)
            if updated < cutoff:
                stale_ids.append(row["id"])
        for meeting_id in stale_ids:
            row = next(item for item in rows if item["id"] == meeting_id)
            cursor = db.execute("UPDATE meetings SET status='failed',error=?,quota_month=NULL,updated_at=? WHERE id=? AND status='processing'", (
                f"Transcription stopped unexpectedly. You can retry it. (Timed out after {timeout_minutes} minutes.)",
                datetime.now(timezone.utc).isoformat(), meeting_id,
            ))
            if cursor.rowcount:
                release_quota(db, row["user_id"], row["quota_month"], successful=False)
    if stale_ids:
        logger.warning("Recovered %s stuck transcription job(s) at startup", len(stale_ids))
def cleanup_expired_audio():
    retention = int(os.getenv("AUDIO_RETENTION_DAYS", "30"))
    if retention < 0:
        return
    cutoff = time.time() - retention * 86400
    with connect() as db:
        rows = db.execute("SELECT id,audio_path,storage_key,created_at,status FROM meetings WHERE audio_path IS NOT NULL OR storage_key IS NOT NULL").fetchall()
        for row in rows:
            if retention == 0:
                expired = row["status"] == "completed"
            else:
                try:
                    created = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).timestamp()
                except (TypeError, ValueError):
                    created = cutoff
                expired = created < cutoff
            if expired:
                delete_audio(row["storage_key"], row["audio_path"])
                db.execute("UPDATE meetings SET audio_path=NULL,storage_key=NULL WHERE id=?", (row["id"],))


def delete_audio(storage_key: str | None, legacy_path: str | None):
    if storage_key:
        storage.delete(storage_key)
    if legacy_path:
        Path(legacy_path).unlink(missing_ok=True)


def audio_materializer(storage_key: str | None, legacy_path: str | None):
    if storage_key:
        return storage.materialize(storage_key)
    if legacy_path and Path(legacy_path).is_file():
        return nullcontext(Path(legacy_path))
    raise FileNotFoundError("Saved audio is no longer available")


def reserve_transcription(db, user_id: str):
    month_key = datetime.now(timezone.utc).strftime("%Y-%m")
    limit = int(os.getenv("MONTHLY_TRANSCRIPTION_QUOTA", "60"))
    db.execute("INSERT OR IGNORE INTO usage(user_id,month,count,reserved) VALUES(?,?,0,0)", (user_id, month_key))
    cursor = db.execute("UPDATE usage SET reserved=reserved+1 WHERE user_id=? AND month=? AND count+reserved<?", (user_id, month_key, limit))
    if not cursor.rowcount:
        raise HTTPException(429, "Monthly transcription quota reached")
    return month_key


def release_quota(db, user_id: str, month_key: str | None, successful: bool):
    if not month_key:
        return
    db.execute(
        "UPDATE usage SET reserved=CASE WHEN reserved>0 THEN reserved-1 ELSE 0 END, count=count+? WHERE user_id=? AND month=?",
        (1 if successful else 0, user_id, month_key),
    )


init_db()
recover_stuck_jobs()
cleanup_expired_audio()


def rate_limit(request: Request):
    now = time.time()
    path = request.url.path
    action = path.rsplit("/", 1)[-1] if path.startswith("/api/auth/") else ("transcribe" if path.endswith("/transcribe") or path == "/api/transcribe" else "upload" if request.method == "POST" and path == "/api/meetings" else "api")
    key = (action, request.client.host if request.client else "unknown")
    hits = [stamp for stamp in rate_buckets.get(key, []) if now - stamp < 60]
    if len(hits) >= MAX_REQUESTS:
        raise HTTPException(429, "Too many requests. Please try again shortly.")
    hits.append(now)
    rate_buckets[key] = hits


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def make_token(user_id: str, session_version: int = 0) -> str:
    payload = b64url(json.dumps({"sub": user_id, "sv": session_version, "exp": int(time.time()) + 86400 * 7}, separators=(",", ":")).encode())
    sig = b64url(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return payload + "." + sig


def current_user(request: Request, authorization: str | None = Header(default=None)):
    try:
        cookie_token = request.cookies.get("meeting_session", "")
        if cookie_token:
            token, kind = cookie_token, "bearer"
        else:
            kind, token = (authorization or "").split(" ", 1)
        payload, signature = token.split(".", 1)
        expected = b64url(hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest())
        if kind.lower() != "bearer" or not hmac.compare_digest(signature, expected):
            raise ValueError()
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if int(claims["exp"]) <= time.time():
            raise ValueError()
        with connect() as db:
            row = db.execute("SELECT id,email,name,created_at,session_version FROM users WHERE id=?", (claims["sub"],)).fetchone()
        if not row or int(claims.get("sv", 0)) != row["session_version"]:
            raise ValueError()
        return dict(row)
    except Exception:
        raise HTTPException(401, "Sign in to continue")


class RegisterBody(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=12, max_length=256)


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class EmailBody(BaseModel):
    email: EmailStr


class ResetPasswordBody(BaseModel):
    token: str = Field(min_length=32, max_length=256)
    password: str = Field(min_length=12, max_length=256)


class RefineBody(BaseModel):
    meeting: dict[str, Any]
    instruction: str = Field(min_length=1, max_length=2000)


class MeetingBody(BaseModel):
    title: str = Field(default="Untitled Meeting", max_length=255)
    date: str | None = None
    durationSeconds: int = Field(default=0, ge=0, le=86400)
    category: str = Field(default="General", max_length=50)
    summary: str = Field(default="", max_length=100000)
    topics: list[str] = Field(default_factory=list, max_length=200)
    decisions: list[str] = Field(default_factory=list, max_length=200)
    actionItems: list[dict[str, Any]] = Field(default_factory=list, max_length=500)
    transcriptSegments: list[dict[str, Any]] = Field(default_factory=list, max_length=10000)
    rawTranscript: str = Field(default="", max_length=2_000_000)
    audioBase64: str | None = None
    mimeType: str = "audio/webm"
    transcribe_now: bool = False
    language: str = "en"
    meetingContext: str = ""


def user_response(user):
    return {"id": user["id"], "email": user["email"], "name": user["name"], "createdAt": user["created_at"]}


def issue_session(user, response: JSONResponse):
    response.set_cookie("meeting_session", make_token(user["id"], user.get("session_version", 0)), httponly=True, secure=os.getenv("ENVIRONMENT") == "production", samesite="strict", max_age=86400 * 7, path="/")
    return {"user": user_response(user)}


@app.post("/api/auth/register", dependencies=[Depends(rate_limit)])
def register(body: RegisterBody, response: JSONResponse):
    now = datetime.now(timezone.utc).isoformat()
    verification_token = secrets.token_urlsafe(32)
    user = {"id": "usr_" + secrets.token_urlsafe(18), "email": body.email.lower(), "name": body.name.strip(), "password_hash": password_hasher.hash(body.password), "created_at": now}
    try:
        with connect() as db:
            db.execute("INSERT INTO users (id,email,name,password_hash,created_at,verification_token_hash,verification_expires_at) VALUES(?,?,?,?,?,?,?)", (*user.values(), hashlib.sha256(verification_token.encode()).hexdigest(), (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()))
    except IntegrityError:
        raise HTTPException(409, "An account with this email already exists")
    url = f"{os.getenv('APP_BASE_URL', 'http://localhost:3000').rstrip('/')}/verify-email?token={verification_token}"
    try:
        email_provider.send(user["email"], "Verify your AI Meeting Secretary account", f"Verify your email within 24 hours: {url}")
    except Exception:
        logger.exception("Failed to send verification email")
        raise HTTPException(503, "Could not send the verification email. Try resending it shortly.")
    return {"message": "Check your email for a verification link."}


@app.post("/api/auth/login", dependencies=[Depends(rate_limit)])
def login(body: LoginBody, response: JSONResponse):
    with connect() as db:
        user = db.execute("SELECT * FROM users WHERE lower(email)=lower(?)", (body.email,)).fetchone()
    if not user:
        raise HTTPException(401, "Invalid email or password")
    try:
        password_hasher.verify(user["password_hash"], body.password)
    except (VerifyMismatchError, ValueError):
        raise HTTPException(401, "Invalid email or password")
    if not user["email_verified_at"]:
        raise HTTPException(403, "Verify your email before logging in")
    if password_hasher.check_needs_rehash(user["password_hash"]):
        with connect() as db:
            db.execute("UPDATE users SET password_hash=? WHERE id=?", (password_hasher.hash(body.password), user["id"]))
    return issue_session(dict(user), response)


@app.post("/api/auth/verify", dependencies=[Depends(rate_limit)])
def verify_email(token: str):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        row = db.execute("SELECT id FROM users WHERE verification_token_hash=? AND verification_expires_at>?", (token_hash, now)).fetchone()
        if not row:
            raise HTTPException(400, "This verification link is invalid or expired")
        cursor = db.execute("UPDATE users SET email_verified_at=?,verification_token_hash=NULL,verification_expires_at=NULL WHERE id=? AND verification_token_hash=? AND verification_expires_at>?", (now, row["id"], token_hash, now))
        if not cursor.rowcount:
            raise HTTPException(400, "This verification link is invalid or expired")
    return {"message": "Email verified. You can now log in."}


@app.post("/api/auth/verification/resend", dependencies=[Depends(rate_limit)])
def resend_verification(body: EmailBody):
    with connect() as db:
        user = db.execute("SELECT id,email,email_verified_at FROM users WHERE lower(email)=lower(?)", (body.email,)).fetchone()
        if not user or user["email_verified_at"]:
            return {"message": "If that account needs verification, a link will be sent."}
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        db.execute("UPDATE users SET verification_token_hash=?,verification_expires_at=? WHERE id=?", (hashlib.sha256(token.encode()).hexdigest(), expires, user["id"]))
    url = f"{os.getenv('APP_BASE_URL', 'http://localhost:3000').rstrip('/')}/verify-email?token={token}"
    try:
        email_provider.send(user["email"], "Verify your AI Meeting Secretary account", f"Verify your email within 24 hours: {url}")
    except Exception:
        logger.exception("Failed to resend verification email")
    return {"message": "If that account needs verification, a link will be sent."}


@app.post("/api/auth/password-reset", dependencies=[Depends(rate_limit)])
def request_password_reset(body: EmailBody):
    with connect() as db:
        user = db.execute("SELECT id,email FROM users WHERE lower(email)=lower(?)", (body.email,)).fetchone()
        if not user:
            return {"message": "If an account exists, a password reset link will be sent."}
        token = secrets.token_urlsafe(32)
        expires = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        db.execute("UPDATE users SET reset_token_hash=?,reset_expires_at=? WHERE id=?", (hashlib.sha256(token.encode()).hexdigest(), expires, user["id"]))
    url = f"{os.getenv('APP_BASE_URL', 'http://localhost:3000').rstrip('/')}/reset-password?token={token}"
    try:
        email_provider.send(user["email"], "Reset your AI Meeting Secretary password", f"Reset your password within one hour: {url}")
    except Exception:
        logger.exception("Failed to send password reset email")
    return {"message": "If an account exists, a password reset link will be sent."}


@app.post("/api/auth/password-reset/confirm", dependencies=[Depends(rate_limit)])
def confirm_password_reset(body: ResetPasswordBody):
    token_hash = hashlib.sha256(body.token.encode()).hexdigest()
    now = datetime.now(timezone.utc).isoformat()
    with connect() as db:
        row = db.execute("SELECT id FROM users WHERE reset_token_hash=? AND reset_expires_at>?", (token_hash, now)).fetchone()
        if not row:
            raise HTTPException(400, "This password reset link is invalid or expired")
        cursor = db.execute("UPDATE users SET password_hash=?,reset_token_hash=NULL,reset_expires_at=NULL,session_version=session_version+1,email_verified_at=COALESCE(email_verified_at,?) WHERE id=? AND reset_token_hash=? AND reset_expires_at>?", (password_hasher.hash(body.password), now, row["id"], token_hash, now))
        if not cursor.rowcount:
            raise HTTPException(400, "This password reset link is invalid or expired")
    return {"message": "Password updated. You can now log in."}


@app.post("/api/auth/logout")
def logout(response: JSONResponse):
    response.delete_cookie("meeting_session", path="/", httponly=True, secure=os.getenv("ENVIRONMENT") == "production", samesite="strict")
    return {"ok": True}


@app.delete("/api/auth/account", dependencies=[Depends(rate_limit)])
def delete_account(response: JSONResponse, user=Depends(current_user)):
    with connect() as db:
        rows = db.execute("SELECT storage_key,audio_path FROM meetings WHERE user_id=?", (user["id"],)).fetchall()
    try:
        for row in rows:
            delete_audio(row["storage_key"], row["audio_path"])
    except Exception:
        logger.exception("Failed to remove account media for user_id=%s", user["id"])
        raise HTTPException(503, "Could not remove all account recordings. Try again shortly.")
    with connect() as db:
        db.execute("DELETE FROM users WHERE id=?", (user["id"],))
    response.delete_cookie("meeting_session", path="/", httponly=True, secure=os.getenv("ENVIRONMENT") == "production", samesite="strict")
    return {"message": "Account and associated data deleted"}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return {"user": {k: user[k] for k in ("id", "email", "name", "created_at")} | {"createdAt": user["created_at"]}}


def parse_ai_json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    return json.loads(text)


def ai_prompt(context: str):
    return "Return only a JSON object with keys title, summary, topics (array), decisions (array), actionItems (array of task/assignee/dueDate), segments (array of speaker/timestamp/text), rawTranscript. Preserve transcript wording.\n" + context


class MeetingResult(BaseModel):
    title: str = "Untitled Meeting"
    summary: str = ""
    topics: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    actionItems: list[dict[str, Any]] = Field(default_factory=list)
    segments: list[dict[str, Any]] = Field(default_factory=list)
    rawTranscript: str = ""


class TranscriptionProvider(Protocol):
    name: str

    def transcribe_and_summarize(self, audio_path: str, mime_type: str) -> MeetingResult: ...


class GeminiProvider:
    name = "gemini"

    def __init__(self, context: str, language: str):
        self.context, self.language = context, language

    def transcribe_and_summarize(self, audio_path: str, mime_type: str) -> MeetingResult:
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise ProviderUnavailable("GEMINI_API_KEY is missing")
        from google import genai
        from google.genai import types
        audio = Path(audio_path).read_bytes()
        with genai.Client(api_key=key) as client:
            result = client.models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
                contents=[
                    types.Part.from_bytes(data=audio, mime_type=mime_type),
                    ai_prompt(f"Meeting language: {self.language}. Context: {self.context}"),
                ],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
        return MeetingResult.model_validate(parse_ai_json(result.text or "{}"))


class ProviderUnavailable(Exception):
    pass


def transient_error(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if hasattr(status, "value"):
        status = status.value
    is_timeout = isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower()
    return is_timeout or status == 429 or (isinstance(status, int) and 500 <= status <= 599)


def call_with_retries(fn):
    for attempt in range(3):
        try:
            return fn()
        except Exception as exc:
            if not transient_error(exc) or attempt == 2:
                raise
            time.sleep(0.5 * (2 ** attempt))


class GroqProvider:
    name = "groq"

    def __init__(self, context: str, language: str):
        self.context, self.language = context, language

    def transcribe_and_summarize(self, audio_path: str, mime_type: str) -> MeetingResult:
        key = os.getenv("GROQ_API_KEY")
        if not key:
            raise ProviderUnavailable("GROQ_API_KEY is missing")
        from groq import Groq
        client = Groq(api_key=key, max_retries=0, timeout=90)
        path = Path(audio_path)
        temp_dirs = []
        try:
            # Groq's upload limit is 25 MB. Use ffmpeg only when configured limits permit a larger file.
            files = [(path, 0.0)]
            if path.stat().st_size > 25 * 1024 * 1024:
                import subprocess
                chunk_dir = tempfile.TemporaryDirectory()
                temp_dirs.append(chunk_dir)
                pattern = str(Path(chunk_dir.name) / "chunk-%03d.mp3")
                subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-f", "segment", "-segment_time", "600", "-reset_timestamps", "1", "-c:a", "libmp3lame", "-b:a", "64k", pattern], check=True, timeout=180)
                files = [(chunk, index * 600.0) for index, chunk in enumerate(sorted(Path(chunk_dir.name).glob("chunk-*.mp3")))]
            transcripts = []
            for chunk, offset in files:
                with chunk.open("rb") as stream:
                    def transcribe_chunk():
                        stream.seek(0)
                        return client.audio.transcriptions.create(file=(chunk.name, stream, "audio/mpeg" if chunk.suffix == ".mp3" else mime_type), model=os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo"), response_format="verbose_json", timestamp_granularities=["segment"])
                    stt = call_with_retries(transcribe_chunk)
                for segment in getattr(stt, "segments", []) or []:
                    start = float(getattr(segment, "start", 0)) + offset
                    text = getattr(segment, "text", "").strip()
                    transcripts.append({"speaker": "Speaker 1", "timestamp": f"{int(start // 60):02d}:{int(start % 60):02d}", "text": text})
                if not getattr(stt, "segments", None):
                    transcripts.append({"speaker": "Speaker 1", "timestamp": f"{int(offset // 60):02d}:{int(offset % 60):02d}", "text": stt.text})
            transcript = " ".join(x["text"] for x in transcripts)
            chat = call_with_retries(lambda: client.chat.completions.create(model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"), response_format={"type": "json_object"}, messages=[{"role": "system", "content": "Analyze meeting transcripts and return valid JSON only."}, {"role": "user", "content": ai_prompt(f"Language: {self.language}. Context: {self.context}\nTRANSCRIPT:\n{transcript}") }]))
            data = parse_ai_json(chat.choices[0].message.content or "{}")
            data.setdefault("segments", transcripts)
            data.setdefault("rawTranscript", transcript)
            return MeetingResult.model_validate(data)
        finally:
            for temp_dir in temp_dirs:
                temp_dir.cleanup()


class ProviderChain:
    def __init__(self, providers: dict[str, TranscriptionProvider], request_id: str):
        self.providers, self.request_id = providers, request_id

    def transcribe_and_summarize(self, audio_path: str, mime_type: str):
        order = [x.strip().lower() for x in os.getenv("PROVIDER_ORDER", "gemini,groq").split(",") if x.strip()]
        last_error = None
        for name in order:
            provider = self.providers.get(name)
            if not provider:
                continue
            try:
                return provider.transcribe_and_summarize(audio_path, mime_type), name
            except ProviderUnavailable:
                continue
            except Exception as exc:
                last_error = exc
                if not transient_error(exc):
                    raise
                logger.warning("request_id=%s provider=%s transient failure; trying next provider", self.request_id, name)
        if last_error:
            raise last_error
        raise HTTPException(503, "No configured transcription provider is available")


def analyze_audio(audio: bytes, mime: str, context: str, language: str, request_id: str | None = None):
    request_id = request_id or str(uuid.uuid4())
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as audio_file:
        audio_file.write(audio)
        audio_path = audio_file.name
    try:
        info = inspect_media(audio_path, MAX_AUDIO_DURATION_SECONDS)
        providers = {"gemini": GeminiProvider(context, language), "groq": GroqProvider(context, language)}
        with provider_audio(audio_path, info) as (prepared_audio, audio_mime):
            return ProviderChain(providers, request_id).transcribe_and_summarize(str(prepared_audio), audio_mime)
    except MediaValidationError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc
    finally:
        Path(audio_path).unlink(missing_ok=True)


@app.post("/api/transcribe", dependencies=[Depends(rate_limit)])
async def transcribe(request: Request, language: str = "en", category: str = "General", meetingContext: str = ""):
    if len(meetingContext) > 2000 or len(language) > 30:
        raise HTTPException(422, "Request field is too long")
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_AUDIO_BYTES:
        raise HTTPException(413, f"Upload exceeds the {max_audio_size_label()} file size limit.")
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > MAX_AUDIO_BYTES:
            raise HTTPException(413, f"Upload exceeds the {max_audio_size_label()} file size limit.")
    if not chunks:
        raise HTTPException(400, "Audio data is required")
    data = bytes(chunks)
    mime = request.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip().lower()
    result, provider = analyze_audio(data, mime, f"Category: {category}. {meetingContext}", language, request.headers.get("x-request-id"))
    return result.model_dump() | {"provider_used": provider}


@app.post("/api/ai/refine", dependencies=[Depends(rate_limit)])
def refine(body: RefineBody):
    prompt = "Return JSON with summary, topics, decisions, actionItems.\nMeeting:\n" + json.dumps(body.meeting, ensure_ascii=False)[:100000] + "\nInstruction:\n" + body.instruction
    key = os.getenv("GEMINI_API_KEY")
    errors = []
    if key:
        try:
            from google import genai
            from google.genai import types
            with genai.Client(api_key=key) as client:
                result = client.models.generate_content(model=os.getenv("GEMINI_MODEL", "gemini-3.8-flash"), contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json"))
            return parse_ai_json(result.text or "{}")
        except Exception:
            errors.append("Gemini provider failed")
    if os.getenv("GROQ_API_KEY"):
        try:
            from groq import Groq
            out = Groq(api_key=os.getenv("GROQ_API_KEY")).chat.completions.create(model=os.getenv("GROQ_LLM_MODEL", "openai/gpt-oss-120b"), response_format={"type": "json_object"}, messages=[{"role": "user", "content": prompt}])
            return parse_ai_json(out.choices[0].message.content or "{}")
        except Exception:
            errors.append("Groq provider failed")
    if errors:
        raise HTTPException(502, "AI refinement failed")
    raise HTTPException(503, "AI provider is not configured")


MEETING_COLUMNS = ("title", "date", "durationSeconds", "category", "summary", "topics", "decisions", "actionItems", "transcriptSegments", "rawTranscript")
JSON_FIELDS = {"topics", "decisions", "actionItems", "transcriptSegments"}


def meeting_dict(row):
    item = dict(row)
    for field, column in {"topics": "topics", "decisions": "decisions", "actionItems": "action_items", "transcriptSegments": "transcript_segments"}.items():
        item[field] = json.loads(item.pop(column))
    item["durationSeconds"] = item.pop("duration_seconds")
    item["rawTranscript"] = item.pop("raw_transcript")
    item["providerUsed"] = item.pop("provider_used", None)
    audio_path = item.pop("audio_path", None)
    storage_key = item.pop("storage_key", None)
    item["audioAvailable"] = bool(audio_path or storage_key)
    item["mimeType"] = item.pop("mime_type", None)
    item.pop("user_id", None)
    return item


def db_values(data):
    mapping = {"durationSeconds": "duration_seconds", "actionItems": "action_items", "transcriptSegments": "transcript_segments", "rawTranscript": "raw_transcript"}
    out = {}
    for field in MEETING_COLUMNS:
        value = data.get(field)
        key = mapping.get(field, field)
        out[key] = json.dumps(value, ensure_ascii=False) if field in JSON_FIELDS else value
    return out


@app.get("/api/meetings")
def list_meetings(search: str = "", category: str = "All", user=Depends(current_user)):
    with connect() as db:
        rows = db.execute("SELECT * FROM meetings WHERE user_id=? ORDER BY date DESC", (user["id"],)).fetchall()
    result = [meeting_dict(row) for row in rows]
    if category and category != "All":
        result = [m for m in result if m["category"] == category]
    if search:
        q = search.casefold()
        result = [m for m in result if q in m["title"].casefold() or q in m["summary"].casefold() or any(q in x.casefold() for x in m["topics"])]
    return result


def start_transcription(meeting_id: str, user_id: str, request_id: str):
    with connect() as db:
        row = db.execute("SELECT * FROM meetings WHERE id=? AND user_id=?", (meeting_id, user_id)).fetchone()
    if not row:
        return
    with active_meetings_lock:
        if meeting_id in active_meetings:
            logger.warning("request_id=%s duplicate transcription suppressed for meeting_id=%s", request_id, meeting_id)
            return
        active_meetings.add(meeting_id)
    audio_path = row["audio_path"]
    storage_key = row["storage_key"]
    completed = False
    try:
        if not storage_key and (not audio_path or not Path(audio_path).exists()):
            raise FileNotFoundError("Saved audio is no longer available")
        with audio_materializer(storage_key, audio_path) as source_audio:
            media_info = inspect_media(source_audio, MAX_AUDIO_DURATION_SECONDS)
            providers = {"gemini": GeminiProvider(f"Category: {row['category']}", "en"), "groq": GroqProvider(f"Category: {row['category']}", "en")}
            with provider_audio(source_audio, media_info) as (normalized_audio, audio_mime):
                result, provider = ProviderChain(providers, request_id).transcribe_and_summarize(str(normalized_audio), audio_mime)
        result_data = result.model_dump()
        result_data["transcriptSegments"] = result_data.pop("segments", [])
        result_data["date"] = row["date"]
        result_data["durationSeconds"] = row["duration_seconds"]
        result_data["category"] = row["category"]
        values = db_values(result_data)
        with connect() as db:
            release_quota(db, user_id, row["quota_month"], successful=True)
            values.update(status="completed", provider_used=provider, error=None, quota_month=None, updated_at=datetime.now(timezone.utc).isoformat())
            db.execute("UPDATE meetings SET " + ",".join(f"{key}=?" for key in values) + " WHERE id=?", [*values.values(), meeting_id])
        completed = True
    except Exception as exc:
        logger.exception("request_id=%s meeting_id=%s transcription failed", request_id, meeting_id)
        detail = "Transcription failed. Check the backend logs and provider settings."
        if isinstance(exc, MediaValidationError):
            detail = exc.detail
        elif isinstance(exc, HTTPException) and exc.status_code == 503:
            detail = exc.detail
        else:
            status_code = getattr(exc, "status_code", None) or getattr(exc, "code", None)
            if hasattr(status_code, "value"):
                status_code = status_code.value
            if status_code == 400:
                detail = "The transcription provider rejected this media. Check its format and audio track."
            elif status_code in (401, 403):
                detail = "The transcription provider rejected its API key or access. Check the backend provider credentials."
            elif status_code == 404:
                detail = "The configured transcription model was not found. Check GEMINI_MODEL, GROQ_MODEL, and GROQ_WHISPER_MODEL."
            elif status_code == 413:
                detail = "This media is larger than the transcription provider allows. Try a smaller audio file."
            elif status_code == 429:
                detail = "The transcription provider rate limit or quota was reached. Try again later."
            elif isinstance(status_code, int) and status_code >= 500:
                detail = f"The transcription provider returned a server error ({status_code}). Try again shortly."
            elif isinstance(exc, TimeoutError) or "timeout" in type(exc).__name__.lower():
                detail = "The transcription provider timed out. Try again, or use a shorter recording."
            elif isinstance(exc, FileNotFoundError) and str(exc) == "Saved audio is no longer available":
                detail = str(exc)
            elif isinstance(exc, FileNotFoundError):
                detail = "FFmpeg is required to extract audio from video files. Install FFmpeg and restart the backend."
            elif isinstance(exc, ValueError) and str(exc) == "Saved audio is no longer available":
                detail = str(exc)
        with connect() as db:
            release_quota(db, user_id, row["quota_month"], successful=False)
            db.execute("UPDATE meetings SET status='failed',error=?,quota_month=NULL,updated_at=? WHERE id=?", (detail, datetime.now(timezone.utc).isoformat(), meeting_id))
    finally:
        try:
            if (storage_key or audio_path) and completed and int(os.getenv("AUDIO_RETENTION_DAYS", "30")) == 0:
                delete_audio(storage_key, audio_path)
                with connect() as db:
                    db.execute("UPDATE meetings SET audio_path=NULL,storage_key=NULL WHERE id=?", (meeting_id,))
        finally:
            with active_meetings_lock:
                active_meetings.discard(meeting_id)


@app.post("/api/meetings", status_code=201, dependencies=[Depends(rate_limit)])
def create_meeting(body: MeetingBody, user=Depends(current_user)):
    now = datetime.now(timezone.utc).isoformat()
    data = body.model_dump()
    data["date"] = data["date"] or now
    meeting_id = "meeting_" + secrets.token_urlsafe(14)
    audio_path = None
    storage_key = None
    mime_type = None
    if body.audioBase64:
        try:
            audio = base64.b64decode(body.audioBase64, validate=True)
        except Exception:
            raise HTTPException(400, "Invalid audio data")
        if not audio or len(audio) > MAX_AUDIO_BYTES:
            raise HTTPException(413, "Audio is empty." if not audio else f"Upload exceeds the {max_audio_size_label()} file size limit.")
        try:
            media_info = inspect_media_bytes(audio, MAX_AUDIO_DURATION_SECONDS)
        except MediaValidationError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc
        mime_type = media_info.mime_type
        data["durationSeconds"] = round(media_info.duration_seconds)
        ext = {"audio/webm": "webm", "video/webm": "webm", "audio/x-matroska": "mkv", "video/x-matroska": "mkv", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "video/mp4": "mp4", "video/quicktime": "mov", "audio/ogg": "ogg", "audio/aac": "aac"}.get(mime_type, "audio")
        storage_key = f"audio/{meeting_id}.{ext}"
    values = db_values(data)
    if body.transcribe_now and not (storage_key or audio_path):
        raise HTTPException(400, "Audio is required to start transcription")
    status = "processing" if body.transcribe_now else ("saved" if storage_key or audio_path else "completed")
    try:
        if storage_key:
            storage.put(storage_key, audio, mime_type)
        with connect() as db:
            quota_month = reserve_transcription(db, user["id"]) if body.transcribe_now else None
            db.execute("INSERT INTO meetings (id,user_id," + ",".join(values) + ",status,storage_key,audio_path,mime_type,quota_month,created_at,updated_at) VALUES (" + ",".join("?" for _ in range(len(values) + 9)) + ")", [meeting_id, user["id"], *values.values(), status, storage_key, audio_path, mime_type, quota_month, now, now])
            row = db.execute("SELECT * FROM meetings WHERE id=?", (meeting_id,)).fetchone()
    except Exception:
        delete_audio(storage_key, audio_path)
        raise
    if body.transcribe_now:
        jobs.submit(start_transcription, meeting_id, user["id"], str(uuid.uuid4()))
    return meeting_dict(row)


@app.post("/api/meetings/{meeting_id}/transcribe", status_code=202, dependencies=[Depends(rate_limit)])
def transcribe_meeting(meeting_id: str, user=Depends(current_user)):
    cleanup_expired_audio()
    with connect() as db:
        row = db.execute("SELECT status,audio_path,storage_key FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Meeting not found")
        if row["status"] in ("processing", "completed"):
            raise HTTPException(409, "Meeting is already processing or completed")
        if not row["audio_path"] and not row["storage_key"]:
            raise HTTPException(400, "Saved audio is unavailable")
        cursor = db.execute("UPDATE meetings SET status='processing',error=NULL,updated_at=? WHERE id=? AND user_id=? AND status IN ('saved','failed')", (datetime.now(timezone.utc).isoformat(), meeting_id, user["id"]))
        if not cursor.rowcount:
            raise HTTPException(409, "Meeting is already processing or completed")
        quota_month = reserve_transcription(db, user["id"])
        db.execute("UPDATE meetings SET quota_month=? WHERE id=?", (quota_month, meeting_id))
    jobs.submit(start_transcription, meeting_id, user["id"], str(uuid.uuid4()))
    return {"id": meeting_id, "status": "processing"}


@app.get("/api/meetings/{meeting_id}")
def get_meeting(meeting_id: str, user=Depends(current_user)):
    with connect() as db:
        row = db.execute("SELECT * FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(404, "Meeting not found")
    return meeting_dict(row)


@app.get("/api/meetings/{meeting_id}/audio-url")
def get_audio_urls(meeting_id: str, user=Depends(current_user)):
    with connect() as db:
        row = db.execute("SELECT storage_key,audio_path FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"])).fetchone()
    if not row:
        raise HTTPException(404, "Meeting not found")
    ttl = max(60, min(int(os.getenv("AUDIO_SIGNED_URL_TTL", "3600")), 604800))
    storage_key = row["storage_key"]
    if storage_key:
        playback = storage.signed_url(storage_key, meeting_id, ttl)
        download = storage.signed_url(storage_key, meeting_id, ttl, download=True)
    elif row["audio_path"]:
        legacy_key = f"legacy/{meeting_id}"
        playback = local_storage.signed_url(legacy_key, meeting_id, ttl)
        download = local_storage.signed_url(legacy_key, meeting_id, ttl, download=True)
    else:
        raise HTTPException(404, "Saved audio is no longer available")
    return {"playbackUrl": playback, "downloadUrl": download, "expiresIn": ttl}


@app.get("/api/media/{meeting_id}")
def get_local_media(meeting_id: str, expires: int, signature: str, download: bool = False):
    if expires < int(time.time()):
        raise HTTPException(403, "This media link has expired")
    with connect() as db:
        row = db.execute("SELECT storage_key,audio_path,mime_type,title FROM meetings WHERE id=?", (meeting_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Media not found")
    key = row["storage_key"] or f"legacy/{meeting_id}"
    expected = local_storage.signature(key, meeting_id, expires, download)
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(403, "Invalid media link")
    if row["storage_key"]:
        if not isinstance(storage, LocalStorageProvider):
            raise HTTPException(404, "Media not available through local storage")
        path = storage.path_for(row["storage_key"])
    elif row["audio_path"]:
        path = Path(row["audio_path"]).resolve()
        legacy_root = (ROOT / "data" / "audio").resolve()
        if not path.is_relative_to(legacy_root):
            raise HTTPException(404, "Media not found")
    else:
        raise HTTPException(404, "Media not found")
    if not path.is_file():
        raise HTTPException(404, "Media not found")
    suffix = path.suffix or ".audio"
    return FileResponse(path, media_type=row["mime_type"] or "application/octet-stream", filename=f"{meeting_id}{suffix}", content_disposition_type="attachment" if download else "inline")


@app.put("/api/meetings/{meeting_id}")
def update_meeting(meeting_id: str, body: MeetingBody, user=Depends(current_user)):
    with connect() as db:
        existing = db.execute("SELECT date FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"])).fetchone()
        if not existing:
            raise HTTPException(404, "Meeting not found")
        data = body.model_dump()
        data["date"] = data["date"] or existing["date"]
        values = db_values(data)
        values["updated_at"] = datetime.now(timezone.utc).isoformat()
        cursor = db.execute("UPDATE meetings SET " + ",".join(f"{key}=?" for key in values) + " WHERE id=? AND user_id=?", [*values.values(), meeting_id, user["id"]])
        row = db.execute("SELECT * FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"])).fetchone() if cursor.rowcount else None
    if not row:
        raise HTTPException(404, "Meeting not found")
    return meeting_dict(row)


@app.delete("/api/meetings/{meeting_id}")
def delete_meeting(meeting_id: str, user=Depends(current_user)):
    with connect() as db:
        row = db.execute("SELECT audio_path,storage_key FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(404, "Meeting not found")
        db.execute("DELETE FROM meetings WHERE id=? AND user_id=?", (meeting_id, user["id"]))
    delete_audio(row["storage_key"], row["audio_path"])
    return {"message": "Meeting deleted"}


@app.get("/api/health")
def health():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat(), "geminiConfigured": bool(os.getenv("GEMINI_API_KEY")), "groqConfigured": bool(os.getenv("GROQ_API_KEY"))}


@app.get("/api/upload-limits")
def upload_limits():
    return {"maxBytes": MAX_AUDIO_BYTES, "maxDurationSeconds": MAX_AUDIO_DURATION_SECONDS}


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred"})
