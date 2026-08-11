import json
from pathlib import Path

from atarang_api.app import app


def main() -> None:
    destination = Path(__file__).parents[3] / "packages" / "contracts" / "openapi" / "atarang-api-v1.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
