"""Create users, meetings, and usage tables."""

from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("users"):
        op.create_table(
        "users",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        )
    if "uq_users_email_lower" not in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("users")}:
        op.create_index("uq_users_email_lower", "users", [sa.text("lower(email)")], unique=True)
    if not sa.inspect(op.get_bind()).has_table("meetings"):
        op.create_table(
        "meetings",
        sa.Column("id", sa.String(length=120), primary_key=True),
        sa.Column("user_id", sa.String(length=120), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("date", sa.String(length=40), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("category", sa.String(length=50), nullable=False, server_default="General"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("topics", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("decisions", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("action_items", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("transcript_segments", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("raw_transcript", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="completed"),
        sa.Column("provider_used", sa.String(length=40)),
        sa.Column("audio_path", sa.Text()),
        sa.Column("mime_type", sa.String(length=120)),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.CheckConstraint("status IN ('saved','processing','completed','failed')", name="ck_meetings_status"),
        )
    if "meetings_by_user_date" not in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("meetings")}:
        op.create_index("meetings_by_user_date", "meetings", ["user_id", sa.text("date DESC")])
    if not sa.inspect(op.get_bind()).has_table("usage"):
        op.create_table(
        "usage",
        sa.Column("user_id", sa.String(length=120), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("month", sa.String(length=7), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade():
    op.drop_table("usage")
    op.drop_index("meetings_by_user_date", table_name="meetings")
    op.drop_table("meetings")
    op.drop_index("uq_users_email_lower", table_name="users")
    op.drop_table("users")
