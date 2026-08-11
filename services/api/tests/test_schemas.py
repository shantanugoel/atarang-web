import pytest
from pydantic import ValidationError

from atarang_api.schemas import CreateJobRequest


def test_youtube_allows_fetch_only_browser_processing():
    request = CreateJobRequest.model_validate(
        {
            "source": {"kind": "youtube", "url": "https://youtu.be/Ajxn0PKbv7I"},
            "processingMode": "browser",
            "requestedOutputVariants": ["flac"],
        }
    )
    assert request.processing_mode == "browser"


def test_upload_rejects_browser_processing_mode():
    with pytest.raises(ValidationError):
        CreateJobRequest.model_validate(
            {
                "source": {"kind": "upload", "fileName": "song.wav", "size": 1024},
                "processingMode": "browser",
            }
        )
