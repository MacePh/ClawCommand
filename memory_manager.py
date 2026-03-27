from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent
MEMORY_DIR = BASE_DIR / "memory"
TASKS_DIR = BASE_DIR / "tasks"
SESSIONS_DIR = BASE_DIR / "sessions"
DECISIONS_DIR = BASE_DIR / "decisions"
SKILLS_DIR = BASE_DIR / "skills"
LOGS_DIR = BASE_DIR / "logs"
INDEX_FILE = BASE_DIR / "index.json"

DIRECTORIES = [
    MEMORY_DIR,
    TASKS_DIR,
    SESSIONS_DIR,
    DECISIONS_DIR,
    SKILLS_DIR,
    LOGS_DIR,
]

INDEX_TEMPLATE: dict[str, list[dict[str, Any]]] = {
    "tasks": [],
    "sessions": [],
    "decisions": [],
    "skills": [],
    "logs": [],
    "memory": [],
}


def _ensure_structure() -> None:
    for directory in DIRECTORIES:
        directory.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        _write_json(INDEX_FILE, INDEX_TEMPLATE)


def _iso_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_json(path: Path, data: Any) -> None:
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _normalize_record(record_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    record = dict(payload)
    record.setdefault("id", str(uuid.uuid4()))
    record.setdefault("created_at", _iso_timestamp())
    record.setdefault("tags", [])
    record["record_type"] = record_type
    return record


def _record_path(directory: Path, record_id: str) -> Path:
    return directory / f"{record_id}.json"


def _update_index(section: str, record: dict[str, Any]) -> None:
    index = _read_json(INDEX_FILE, dict(INDEX_TEMPLATE))
    entries = [entry for entry in index.get(section, []) if entry.get("id") != record["id"]]
    entries.append(
        {
            "id": record["id"],
            "created_at": record["created_at"],
            "tags": record.get("tags", []),
            "keywords": _extract_keywords(record),
        }
    )
    index[section] = entries
    _write_json(INDEX_FILE, index)


def _extract_keywords(record: dict[str, Any]) -> list[str]:
    keywords: set[str] = set()
    for value in record.values():
        if isinstance(value, str):
            for token in value.lower().split():
                cleaned = token.strip(".,:;!?()[]{}\"'")
                if cleaned:
                    keywords.add(cleaned)
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, str):
                    cleaned = item.lower().strip()
                    if cleaned:
                        keywords.add(cleaned)
    return sorted(keywords)


def _save_record(section: str, directory: Path, payload: dict[str, Any]) -> dict[str, Any]:
    _ensure_structure()
    record = _normalize_record(section[:-1] if section.endswith("s") else section, payload)
    _write_json(_record_path(directory, record["id"]), record)
    _update_index(section, record)
    return record


def _matches_query(record: dict[str, Any], query_terms: list[str]) -> bool:
    if not query_terms:
        return True
    keywords = set(_extract_keywords(record))
    tags = {str(tag).lower() for tag in record.get("tags", [])}
    return all(term in keywords or term in tags for term in query_terms)


def _search_records(directory: Path, query: str, limit: int) -> list[dict[str, Any]]:
    _ensure_structure()
    query_terms = [term.strip().lower() for term in query.split() if term.strip()]
    results: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json"), reverse=True):
        record = _read_json(path, {})
        if _matches_query(record, query_terms):
            results.append(record)
        if len(results) >= limit:
            break
    return results


def save_task(task_data: dict) -> dict[str, Any]:
    return _save_record("tasks", TASKS_DIR, task_data)


def retrieve_tasks(query: str, limit: int = 5) -> list[dict[str, Any]]:
    return _search_records(TASKS_DIR, query, limit)


def save_session(session_data: dict) -> dict[str, Any]:
    return _save_record("sessions", SESSIONS_DIR, session_data)


def save_decision(decision_data: dict) -> dict[str, Any]:
    return _save_record("decisions", DECISIONS_DIR, decision_data)


def load_context(query: str) -> dict[str, list[dict[str, Any]]]:
    return {
        "tasks": _search_records(TASKS_DIR, query, 5),
        "decisions": _search_records(DECISIONS_DIR, query, 5),
        "skills": _search_records(SKILLS_DIR, query, 5),
    }


_ensure_structure()
