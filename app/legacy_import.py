"""Importa retratos na raiz de Banco-de-dados-fotos (ex.: Nome.jpeg) para cadastros com rosto."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from app.database import create_person, list_nomes
from app.face_engine import FaceEngine

_LEGACY_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def import_root_portraits(base_dir: Path, engine: FaceEngine) -> int:
    """
    Cria cadastros a partir de arquivos na raiz (não dentro de /images).
    Idempotente: ignora se já existir pessoa com o mesmo nome (nome = nome do arquivo sem extensão).
    """
    known = list_nomes(base_dir)
    added = 0
    for path in sorted(base_dir.iterdir()):
        if not path.is_file() or path.suffix.lower() not in _LEGACY_EXTS:
            continue
        nome = path.stem.strip()
        if len(nome) < 2 or nome in known:
            continue
        raw = path.read_bytes()
        arr = np.frombuffer(raw, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        face = engine.extract_face_gray(bgr)
        if face is None:
            continue
        person_id = create_person(
            base_dir,
            nome=nome,
            rg=None,
            observacoes="Importado automaticamente do arquivo no acervo.",
        )
        engine.add_training_face(person_id, face, is_new_person=True)
        known.add(nome)
        added += 1
    return added
