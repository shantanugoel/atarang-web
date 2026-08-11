import argparse
import csv
import hashlib
import json
import os
import platform
import resource
import subprocess
import sys
import time
import wave
from pathlib import Path


def media_seconds(path: Path) -> float:
    with wave.open(str(path), "rb") as source:
        return source.getnframes() / source.getframerate()


def checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=5)
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--model", default="htdemucs")
    parser.add_argument("--device", choices=("cpu", "cuda"), required=True)
    arguments = parser.parse_args()
    if arguments.repetitions != 5 or arguments.warmups != 1:
        raise SystemExit("release evidence requires one warmup and five measured repetitions")
    arguments.output.mkdir(parents=True, exist_ok=True)
    records = []
    for source in arguments.inputs:
        duration = media_seconds(source)
        for index in range(arguments.warmups + arguments.repetitions):
            destination = arguments.output / f"{source.stem}-{index}"
            started = time.perf_counter()
            completed = subprocess.run(
                [sys.executable, "-m", "demucs.separate", "--device", arguments.device,
                 "--name", arguments.model, "--out", str(destination), str(source)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                env={**os.environ, "PYTHONHASHSEED": "0"},
            )
            elapsed = time.perf_counter() - started
            if completed.returncode:
                raise SystemExit(f"separation failed with exit code {completed.returncode}")
            if index >= arguments.warmups:
                records.append({
                    "input": source.name,
                    "inputSha256": checksum(source),
                    "durationSeconds": duration,
                    "repetition": index - arguments.warmups + 1,
                    "elapsedSeconds": elapsed,
                    "rtf": elapsed / duration,
                    "peakRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
                    "deviceClass": arguments.device,
                })
    environment = {
        "schema": "atarang.benchmark/1",
        "python": sys.version,
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "model": arguments.model,
        "imageDigest": os.environ.get("ATARANG_IMAGE_DIGEST", "unrecorded"),
        "modelArtifactSha256": os.environ.get("ATARANG_MODEL_ARTIFACT_SHA256", "unrecorded"),
        "ffmpeg": subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, check=True).stdout.splitlines()[0],
        "records": records,
    }
    (arguments.output / "results.json").write_text(json.dumps(environment, indent=2) + "\n")
    with (arguments.output / "results.csv").open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=records[0].keys())
        writer.writeheader()
        writer.writerows(records)


if __name__ == "__main__":
    run()
