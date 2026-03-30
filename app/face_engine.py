from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

FACE_SIZE = (200, 200)
LABELS_FILE = "labels_map.json"
MODEL_FILE = "lbph_model.yml"


class FaceEngine:
    """Reconhecimento facial incremental com LBPH (OpenCV), sem dependências pesadas."""

    def __init__(self, base_dir: Path, max_distance: float = 92.0):
        self.base_dir = base_dir
        self.images_dir = base_dir / "images"
        self.max_distance = max_distance
        self._lock = threading.Lock()
        self.images_dir.mkdir(parents=True, exist_ok=True)
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        self._cascade = cv2.CascadeClassifier(cascade_path)
        self._recognizer = cv2.face.LBPHFaceRecognizer_create(radius=2, neighbors=8)
        self._label_to_person: dict[int, str] = {}
        self._person_to_label: dict[str, int] = {}
        self._load_or_train()

    def _paths(self) -> tuple[Path, Path]:
        return self.base_dir / LABELS_FILE, self.base_dir / MODEL_FILE

    def _load_labels(self) -> bool:
        labels_path, _ = self._paths()
        if not labels_path.is_file():
            return False
        data = json.loads(labels_path.read_text(encoding="utf-8"))
        self._label_to_person = {int(k): v for k, v in data["label_to_person"].items()}
        self._person_to_label = {v: int(k) for k, v in self._label_to_person.items()}
        return True

    def _save_labels(self) -> None:
        labels_path, _ = self._paths()
        payload = {"label_to_person": {str(k): v for k, v in self._label_to_person.items()}}
        labels_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _save_model(self) -> None:
        _, model_path = self._paths()
        self._recognizer.write(str(model_path))

    def _collect_training(self) -> tuple[list[np.ndarray], list[int]]:
        faces: list[np.ndarray] = []
        labels: list[int] = []
        for person_dir in sorted(self.images_dir.iterdir()):
            if not person_dir.is_dir():
                continue
            pid = person_dir.name
            if pid not in self._person_to_label:
                continue
            label = self._person_to_label[pid]
            for img_path in sorted(person_dir.glob("*")):
                if img_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                    continue
                arr = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
                if arr is None:
                    continue
                arr = cv2.resize(arr, FACE_SIZE)
                faces.append(arr)
                labels.append(label)
        return faces, labels

    def _train_from_disk(self) -> None:
        if not self._load_labels():
            self._label_to_person = {}
            self._person_to_label = {}
        faces, labels = self._collect_training()
        if not faces:
            self._recognizer = cv2.face.LBPHFaceRecognizer_create(radius=2, neighbors=8)
            return
        self._recognizer.train(faces, np.array(labels, dtype=np.int32))

    def _load_or_train(self) -> None:
        labels_path, model_path = self._paths()
        if model_path.is_file() and labels_path.is_file():
            self._load_labels()
            try:
                self._recognizer.read(str(model_path))
                return
            except cv2.error:
                pass
        self._train_from_disk()
        if (self.base_dir / LABELS_FILE).is_file() and any(self.images_dir.iterdir()):
            self._save_model()

    def next_label(self) -> int:
        if not self._label_to_person:
            return 0
        return max(self._label_to_person.keys()) + 1

    def register_person_id(self, person_id: str) -> int:
        if person_id in self._person_to_label:
            return self._person_to_label[person_id]
        label = self.next_label()
        self._label_to_person[label] = person_id
        self._person_to_label[person_id] = label
        self._save_labels()
        return label

    def detect_primary_face(
        self, image_bgr: np.ndarray
    ) -> Optional[tuple[np.ndarray, tuple[int, int, int, int]]]:
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        faces = self._cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(64, 64))
        if len(faces) == 0:
            return None
        x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
        face = gray[y : y + h, x : x + w]
        face_r = cv2.resize(face, FACE_SIZE)
        return face_r, (int(x), int(y), int(w), int(h))

    def extract_face_gray(self, image_bgr: np.ndarray) -> Optional[np.ndarray]:
        det = self.detect_primary_face(image_bgr)
        return det[0] if det else None

    def predict(self, face_gray: np.ndarray) -> tuple[Optional[str], float]:
        if not self._label_to_person:
            return None, float("inf")
        try:
            label, confidence = self._recognizer.predict(face_gray)
        except cv2.error:
            return None, float("inf")
        if confidence > self.max_distance:
            return None, float(confidence)
        person_id = self._label_to_person.get(int(label))
        return person_id, float(confidence)

    def save_face_image(self, person_id: str, face_gray: np.ndarray) -> Path:
        folder = self.images_dir / person_id
        folder.mkdir(parents=True, exist_ok=True)
        idx = len(list(folder.glob("*.jpg")))
        out = folder / f"face_{idx:04d}.jpg"
        cv2.imwrite(str(out), face_gray)
        return out

    def add_training_face(self, person_id: str, face_gray: np.ndarray, is_new_person: bool) -> None:
        with self._lock:
            if is_new_person:
                self.register_person_id(person_id)
            label = self._person_to_label[person_id]
            self.save_face_image(person_id, face_gray)
            try:
                self._recognizer.update([face_gray], np.array([label], dtype=np.int32))
            except cv2.error:
                faces, labels = self._collect_training()
                if faces:
                    self._recognizer = cv2.face.LBPHFaceRecognizer_create(radius=2, neighbors=8)
                    self._recognizer.train(faces, np.array(labels, dtype=np.int32))
            self._save_model()

    def has_training_data(self) -> bool:
        return bool(self._label_to_person)

    def stats(self) -> dict:
        return {
            "cadastros": len(self._person_to_label),
            "modelo_pronto": self.has_training_data(),
        }
