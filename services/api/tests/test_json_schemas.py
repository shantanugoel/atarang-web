import json
from pathlib import Path

from jsonschema import Draft202012Validator


def test_every_canonical_schema_is_valid_draft_2020_12():
    root = Path(__file__).parents[3] / "packages" / "contracts" / "json-schema"
    names = []
    for path in sorted(root.glob("*.json")):
        Draft202012Validator.check_schema(json.loads(path.read_text()))
        names.append(path.name)
    assert names == [
        "backup-manifest-v1.json",
        "beat-grid-v1.json",
        "chord-analysis-v1.json",
        "correction-layer-v1.json",
        "lyrics-document-v1.json",
        "model-artifact-manifest-v1.json",
        "original-v1.json",
        "performance-manifest-v1.json",
        "practice-state-v1.json",
        "separation-manifest-v1.json",
        "user-chart-v1.json",
    ]
