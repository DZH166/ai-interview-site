"""Recover removed question IDs from the pinned original bank without redirects.

The archive preserves source objects verbatim; it is not part of the active bank.
Run explicitly after reviewing the baseline and removed-ID diff.
"""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = "511ad83"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf-8")


def recover():
    baseline = git("rev-parse", BASELINE).strip()
    names = git("ls-tree", "-r", "--name-only", baseline, "--", "data/questions").splitlines()
    original = []
    for name in names:
        if name.endswith(".json"):
            original.extend(json.loads(git("show", baseline + ":" + name)))
    active = {
        q["id"]
        for path in (ROOT / "data/questions").glob("*.json")
        for q in json.loads(path.read_text(encoding="utf-8"))
    }
    archived = [q for q in original if q["id"] not in active]
    assert len({q["id"] for q in archived}) == len(archived), "Duplicate original IDs"
    payload = {"version": 1, "baseline": baseline, "questions": archived}
    (ROOT / "data/legacy-questions.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Archived {len(archived)} original questions from {baseline}; active bank unchanged.")


if __name__ == "__main__":
    recover()
