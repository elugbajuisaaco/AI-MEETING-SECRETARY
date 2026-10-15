"""Add provider-neutral media storage keys."""

from alembic import op
import sqlalchemy as sa

revision = "0002_storage_key"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("meetings")}
    if "storage_key" not in columns:
        op.add_column("meetings", sa.Column("storage_key", sa.Text(), nullable=True))


def downgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("meetings")}
    if "storage_key" in columns:
        op.drop_column("meetings", "storage_key")
