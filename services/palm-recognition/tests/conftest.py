import atexit
import os
import tempfile
from pathlib import Path


TEST_FERNET_KEY = "nJ7StPpwWJgYr6B-gsFGHxKFyuw1PyomSnQlHDEMLqA="
if not os.environ.get("PALM_SERVICE_KEY"):
    os.environ["PALM_SERVICE_KEY"] = "test-palm-service-key-at-least-32-characters"
if not os.environ.get("PALM_TEMPLATE_ENCRYPTION_KEY"):
    os.environ["PALM_TEMPLATE_ENCRYPTION_KEY"] = TEST_FERNET_KEY

if "PALM_DATABASE_PATH" not in os.environ:
    descriptor, database_path = tempfile.mkstemp(prefix="nhp-palm-bootstrap-", suffix=".db")
    os.close(descriptor)
    Path(database_path).unlink(missing_ok=True)
    os.environ["PALM_DATABASE_PATH"] = database_path

    def cleanup_bootstrap_database() -> None:
        for suffix in ("", "-wal", "-shm"):
            Path(database_path + suffix).unlink(missing_ok=True)

    atexit.register(cleanup_bootstrap_database)
