"""Local and S3-compatible storage for uploaded meeting media."""

import hashlib
import hmac
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Iterator, Protocol
from urllib.parse import urlencode

ROOT = Path(__file__).parent


class StorageProvider(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def signed_url(self, key: str, meeting_id: str, expires_in: int, download: bool = False) -> str: ...
    def materialize(self, key: str) -> Iterator[Path]: ...


def safe_key(key: str) -> str:
    path = PurePosixPath(key)
    if path.is_absolute() or ".." in path.parts or not key or "\\" in key:
        raise ValueError("Invalid media storage key")
    return str(path)


class LocalStorageProvider:
    def __init__(self, root: Path, secret: str):
        self.root = root.resolve()
        self.secret = secret.encode()
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, key: str) -> Path:
        path = (self.root / safe_key(key)).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("Invalid media storage key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self.path_for(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def delete(self, key: str) -> None:
        self.path_for(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self.path_for(key).is_file()

    def signature(self, key: str, meeting_id: str, expires: int, download: bool) -> str:
        payload = f"{meeting_id}:{key}:{expires}:{int(download)}".encode()
        return hmac.new(self.secret, payload, hashlib.sha256).hexdigest()

    def signed_url(self, key: str, meeting_id: str, expires_in: int, download: bool = False) -> str:
        expires = int(time.time()) + expires_in
        query = urlencode({"expires": expires, "download": int(download), "signature": self.signature(key, meeting_id, expires, download)})
        return f"/api/media/{meeting_id}?{query}"

    @contextmanager
    def materialize(self, key: str):
        path = self.path_for(key)
        if not path.is_file():
            raise FileNotFoundError("Saved audio is no longer available")
        yield path


class S3StorageProvider:
    def __init__(self):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise RuntimeError("Install backend requirements to use S3-compatible storage") from exc
        self.bucket = os.getenv("S3_BUCKET", "").strip()
        if not self.bucket:
            raise RuntimeError("S3_BUCKET is required when STORAGE_PROVIDER=s3")
        self.client = boto3.client(
            "s3",
            endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
            region_name=os.getenv("S3_REGION", "auto"),
            aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID") or None,
            aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY") or None,
            config=Config(s3={"addressing_style": os.getenv("S3_ADDRESSING_STYLE", "path")}),
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=safe_key(key), Body=data, ContentType=content_type)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=safe_key(key))

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError
        try:
            self.client.head_object(Bucket=self.bucket, Key=safe_key(key))
            return True
        except ClientError as exc:
            if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return False
            raise

    def signed_url(self, key: str, meeting_id: str, expires_in: int, download: bool = False) -> str:
        params = {"Bucket": self.bucket, "Key": safe_key(key)}
        if download:
            suffix = Path(key).suffix or ".audio"
            params["ResponseContentDisposition"] = f"attachment; filename=meeting-{meeting_id}{suffix}"
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires_in)

    @contextmanager
    def materialize(self, key: str):
        suffix = Path(key).suffix or ".audio"
        with tempfile.TemporaryDirectory(prefix="meeting-audio-") as directory:
            path = Path(directory) / f"source{suffix}"
            self.client.download_file(self.bucket, safe_key(key), str(path))
            yield path


def create_storage_provider(secret: str) -> StorageProvider:
    provider = os.getenv("STORAGE_PROVIDER", "local").strip().lower()
    if provider == "local":
        root = Path(os.getenv("LOCAL_STORAGE_DIR", str(ROOT / "data")))
        if not root.is_absolute():
            root = ROOT / root
        return LocalStorageProvider(root, secret)
    if provider in {"s3", "r2", "supabase"}:
        return S3StorageProvider()
    raise RuntimeError("STORAGE_PROVIDER must be local, s3, r2, or supabase")
