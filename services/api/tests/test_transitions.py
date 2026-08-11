import pytest

from atarang_api.schemas import JobState
from atarang_api.transitions import ALLOWED, TransitionSnapshot, transition


def test_every_declared_transition_is_accepted():
    for source, targets in ALLOWED.items():
        for target in targets:
            result = transition(TransitionSnapshot(source, 0.2, "test"), target, progress=0.3)
            assert result.state == target


def test_unknown_transition_and_progress_regression_are_rejected():
    with pytest.raises(ValueError, match="invalid transition"):
        transition(TransitionSnapshot(JobState.QUEUED, 0.2, "queued"), JobState.READY)
    with pytest.raises(ValueError, match="monotonic"):
        transition(
            TransitionSnapshot(JobState.QUEUED, 0.5, "queued"),
            JobState.PREPROCESSING,
            progress=0.4,
        )


def test_worker_attempts_are_bounded():
    with pytest.raises(ValueError, match="at most two"):
        transition(
            TransitionSnapshot(JobState.SEPARATING, 0.5, "separating", attempt=2),
            JobState.QUEUED,
            attempt=3,
        )


def test_youtube_acquisition_can_finish_as_fetch_only():
    result = transition(
        TransitionSnapshot(JobState.ACQUIRING_YOUTUBE, 0.2, "acquiring_youtube"),
        JobState.READY,
        progress=1,
        stage="ready",
    )
    assert result.state == JobState.READY
