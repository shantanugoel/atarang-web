import { create } from "zustand";
import type { ImportProgress } from "../../storage/importer";
import type { CloudProgress } from "../separation/cloudClient";

/**
 * A fetch that outlives the page that started it.
 *
 * Nothing cancels this job when the Library unmounts, so it always kept
 * running — but its progress, its Cancel button and whatever it failed with
 * were held in that page's own state. Opening the Studio while a video was
 * being fetched left the work going on invisibly, with no way to stop it and
 * no way to learn that it had failed.
 */
interface YoutubeJob {
  /** What the server is doing: fetching, separating, packaging. */
  cloud: CloudProgress | null;
  /** What this browser is doing with what came back. */
  imported: ImportProgress | null;
  controller: AbortController | null;
  error: string;
}

export const useYoutubeJob = create<YoutubeJob>(() => ({ cloud: null, imported: null, controller: null, error: "" }));
export const setYoutubeJob = useYoutubeJob.setState;
