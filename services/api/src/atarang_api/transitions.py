from dataclasses import dataclass, replace

from .schemas import JobState


ALLOWED: dict[JobState, frozenset[JobState]] = {
    JobState.CREATED: frozenset(
        {JobState.AWAITING_UPLOAD, JobState.ACQUIRING_YOUTUBE, JobState.CANCEL_REQUESTED, JobState.EXPIRED, JobState.FAILED}
    ),
    JobState.AWAITING_UPLOAD: frozenset(
        {JobState.VALIDATING, JobState.CANCEL_REQUESTED, JobState.EXPIRED, JobState.FAILED}
    ),
    JobState.ACQUIRING_YOUTUBE: frozenset(
        {JobState.VALIDATING, JobState.READY, JobState.CANCEL_REQUESTED, JobState.FAILED}
    ),
    JobState.VALIDATING: frozenset({JobState.QUEUED, JobState.CANCEL_REQUESTED, JobState.FAILED}),
    JobState.QUEUED: frozenset(
        {JobState.PREPROCESSING, JobState.CANCEL_REQUESTED, JobState.FAILED}
    ),
    JobState.PREPROCESSING: frozenset(
        {JobState.SEPARATING, JobState.QUEUED, JobState.CANCEL_REQUESTED, JobState.FAILED}
    ),
    JobState.SEPARATING: frozenset(
        {JobState.PACKAGING, JobState.QUEUED, JobState.CANCEL_REQUESTED, JobState.FAILED}
    ),
    JobState.PACKAGING: frozenset(
        {JobState.READY, JobState.QUEUED, JobState.CANCEL_REQUESTED, JobState.FAILED}
    ),
    JobState.CANCEL_REQUESTED: frozenset({JobState.CANCELLED, JobState.FAILED}),
    JobState.READY: frozenset({JobState.DELETING}),
    JobState.FAILED: frozenset({JobState.DELETING}),
    JobState.CANCELLED: frozenset({JobState.DELETING}),
    JobState.DELETING: frozenset({JobState.EXPIRED}),
    JobState.EXPIRED: frozenset(),
}


@dataclass(frozen=True)
class TransitionSnapshot:
    state: JobState
    progress: float
    stage: str
    attempt: int = 0


def transition(
    current: TransitionSnapshot,
    target: JobState,
    *,
    progress: float | None = None,
    stage: str | None = None,
    attempt: int | None = None,
) -> TransitionSnapshot:
    if target not in ALLOWED[current.state]:
        raise ValueError(f"invalid transition {current.state} -> {target}")
    next_progress = current.progress if progress is None else progress
    if next_progress < current.progress or not 0 <= next_progress <= 1:
        raise ValueError("progress must be monotonic and bounded")
    next_attempt = current.attempt if attempt is None else attempt
    if next_attempt < current.attempt or next_attempt > 2:
        raise ValueError("attempt must be monotonic and at most two")
    return replace(
        current,
        state=target,
        progress=next_progress,
        stage=stage or current.stage,
        attempt=next_attempt,
    )
