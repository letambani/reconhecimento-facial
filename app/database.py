import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Optional
from uuid import uuid4


def get_db_path(base_dir: Path) -> Path:
    return base_dir / "registry.db"


def init_db(base_dir: Path) -> None:
    base_dir.mkdir(parents=True, exist_ok=True)
    db_path = get_db_path(base_dir)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pessoas (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL,
                rg TEXT,
                observacoes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )
        conn.commit()


@contextmanager
def connect(base_dir: Path):
    init_db(base_dir)
    conn = sqlite3.connect(get_db_path(base_dir))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def create_person(
    base_dir: Path, nome: str, rg: Optional[str], observacoes: Optional[str]
) -> str:
    person_id = str(uuid4())
    with connect(base_dir) as conn:
        conn.execute(
            "INSERT INTO pessoas (id, nome, rg, observacoes) VALUES (?, ?, ?, ?)",
            (person_id, nome.strip(), (rg or "").strip() or None, (observacoes or "").strip() or None),
        )
        conn.commit()
    return person_id


def list_nomes(base_dir: Path) -> set[str]:
    with connect(base_dir) as conn:
        rows = conn.execute("SELECT nome FROM pessoas").fetchall()
    return {str(r[0]) for r in rows if r[0]}


def get_person(base_dir: Path, person_id: str) -> Optional[dict]:
    with connect(base_dir) as conn:
        row = conn.execute(
            "SELECT id, nome, rg, observacoes, created_at FROM pessoas WHERE id = ?",
            (person_id,),
        ).fetchone()
    if not row:
        return None
    return dict(row)
