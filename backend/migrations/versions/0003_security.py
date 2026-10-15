"""Add email verification, password reset, and quota reservations."""

from alembic import op
import sqlalchemy as sa

revision = "0003_security"
down_revision = "0002_storage_key"
branch_labels = None
depends_on = None


def upgrade():
    user_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    for name, column in (
        ("email_verified_at", sa.Column("email_verified_at", sa.String(40))),
        ("verification_token_hash", sa.Column("verification_token_hash", sa.String(64))),
        ("verification_expires_at", sa.Column("verification_expires_at", sa.String(40))),
        ("reset_token_hash", sa.Column("reset_token_hash", sa.String(64))),
        ("reset_expires_at", sa.Column("reset_expires_at", sa.String(40))),
        ("session_version", sa.Column("session_version", sa.Integer(), nullable=False, server_default="0")),
    ):
        if name not in user_columns:
            op.add_column("users", column)
    # Existing accounts predate verification and remain usable.
    op.execute("UPDATE users SET email_verified_at=created_at WHERE email_verified_at IS NULL")

    meeting_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("meetings")}
    if "quota_month" not in meeting_columns:
        op.add_column("meetings", sa.Column("quota_month", sa.String(7), nullable=True))

    usage_columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("usage")}
    if "reserved" not in usage_columns:
        op.add_column("usage", sa.Column("reserved", sa.Integer(), nullable=False, server_default="0"))


def downgrade():
    op.drop_column("usage", "reserved")
    op.drop_column("meetings", "quota_month")
    op.drop_column("users", "reset_expires_at")
    op.drop_column("users", "reset_token_hash")
    op.drop_column("users", "verification_expires_at")
    op.drop_column("users", "verification_token_hash")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "session_version")
