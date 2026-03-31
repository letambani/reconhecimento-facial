from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import create_person, get_person, init_db
from app.face_engine import FaceEngine
from app.legacy_import import import_root_portraits

ROOT = Path(__file__).resolve().parent.parent
DB_DIR = ROOT / "Banco-de-dados-fotos"
STATIC_DIR = ROOT / "docs"

init_db(DB_DIR)
engine = FaceEngine(DB_DIR)
import_root_portraits(DB_DIR, engine)

app = FastAPI(title="Reconhecimento facial — PM São José")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def decode_upload(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Imagem inválida ou corrompida.")
    return img


def _form_bool(v: str) -> bool:
    return str(v).lower() in ("1", "true", "on", "yes")


def _confianca_exibicao_pct(confidence: float) -> int:
    """Converte distância LBPH em percentual exibível (maior = melhor match aproximado)."""
    if confidence == float("inf"):
        return 0
    pct = int(round(100 - confidence * 0.72))
    return max(48, min(98, pct))


@app.post("/api/identificar")
async def identificar(
    foto: UploadFile = File(...),
    aprender: str = Form(default="true"),
):
    learn = _form_bool(aprender)
    raw = await foto.read()
    bgr = decode_upload(raw)
    det = engine.detect_primary_face(bgr)
    if det is None:
        raise HTTPException(
            status_code=422,
            detail="Nenhum rosto detectado. Ajuste a iluminação e posição.",
        )
    face, bbox = det
    ih, iw = bgr.shape[:2]
    rosto = {"x": bbox[0], "y": bbox[1], "w": bbox[2], "h": bbox[3]}
    imagem_meta = {"largura": int(iw), "altura": int(ih)}

    person_id, confidence = engine.predict(face)
    aprendeu = False

    if person_id and learn:
        is_new = False
        engine.add_training_face(person_id, face, is_new_person=is_new)
        aprendeu = True

    if not person_id:
        return {
            "reconhecido": False,
            "confianca": confidence if confidence != float("inf") else None,
            "pessoa": None,
            "aprendeu": False,
            "rosto": rosto,
            "imagem": imagem_meta,
        }

    return {
        "reconhecido": True,
        "confianca": confidence,
        "confianca_exibicao_pct": _confianca_exibicao_pct(confidence),
        "pessoa": get_person(DB_DIR, person_id),
        "aprendeu": aprendeu,
        "rosto": rosto,
        "imagem": imagem_meta,
    }


@app.post("/api/cadastro-rapido")
async def cadastro_rapido(
    foto: UploadFile = File(...),
    nome: str = Form(...),
    rg: str = Form(default=""),
    observacoes: str = Form(default=""),
):
    nome = nome.strip()
    if len(nome) < 2:
        raise HTTPException(status_code=400, detail="Informe um nome válido.")

    raw = await foto.read()
    bgr = decode_upload(raw)
    face = engine.extract_face_gray(bgr)
    if face is None:
        raise HTTPException(
            status_code=422,
            detail="Nenhum rosto detectado na foto para cadastro.",
        )

    person_id = create_person(DB_DIR, nome=nome, rg=rg or None, observacoes=observacoes or None)
    engine.add_training_face(person_id, face, is_new_person=True)

    return {"ok": True, "pessoa": get_person(DB_DIR, person_id)}


@app.get("/api/pessoa/{person_id}/avatar")
def pessoa_avatar(person_id: str):
    folder = DB_DIR / "images" / person_id
    if not folder.is_dir():
        raise HTTPException(status_code=404, detail="Sem fotos no cadastro.")
    paths = sorted(folder.glob("face_*.jpg"))
    if not paths:
        for ext in ("*.jpg", "*.jpeg", "*.png"):
            paths = sorted(folder.glob(ext))
            if paths:
                break
    if not paths:
        raise HTTPException(status_code=404, detail="Sem imagens.")
    first = paths[0]
    mt = "image/jpeg" if first.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return FileResponse(first, media_type=mt)


@app.get("/api/pessoa/{person_id}")
def api_pessoa(person_id: str):
    row = get_person(DB_DIR, person_id)
    if not row:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada.")
    return row


@app.get("/api/status")
def status():
    return engine.stats()


app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
