// Pipeline stage names are for logs. These are for the person watching a
// progress bar wondering whether anything is wrong. The server can send stages
// this list has not seen, so unknown ones degrade to readable words.
const STAGE_LABELS: Record<string, string> = {
  preflight: "Checking storage",
  loading_model: "Loading the model",
  separating: "Separating the four stems",
  packaging: "Verifying the result",
  publishing: "Saving to your library",
  creating: "Starting the job",
  uploading: "Uploading audio",
  importing_source: "Importing to your library",
};

export const stageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage.replaceAll("_", " ");
