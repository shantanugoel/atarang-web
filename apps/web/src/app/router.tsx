import { createBrowserRouter, Link, Navigate, useNavigate, useRouteError } from "react-router";
import { WarningCircle } from "@phosphor-icons/react";
import { AppShell } from "./AppShell";
import { StudioPage } from "../features/studio/StudioPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import styles from "./AppShell.module.css";

/**
 * Recovery for the two ways a route can fail to draw. Without these the
 * framework's own developer page is what a mistyped URL or a stale bookmark
 * reaches — black screen, "Hey developer 👋", advice about ErrorBoundary, and
 * no way back. The Studio's own "Song not found" state is the model.
 *
 * A crash gets plain anchors: it renders when the shell above the router is
 * what failed, so a full load is the recovery that always works. A wrong URL
 * gets router links, because the session is intact and the song is still
 * playing — reloading to leave a typo would be the only thing that stopped it.
 */
function Recovery({ title, body, detail, hardLinks = false }: { title: string; body: string; detail?: string; hardLinks?: boolean }) {
  const navigate = useNavigate();
  return (
    <div className={styles.recovery}>
      <WarningCircle aria-hidden />
      <strong>{title}</strong>
      <p>{body}</p>
      <div>
        {hardLinks
          ? <><a href="/library">Go to Library</a><a href="/studio">Go to Studio</a></>
          // Back keeps the song. "Go to Studio" would not: with no song in the
          // path the Studio falls back to the bundled demo, so offering it here
          // would swap out whatever the user was playing.
          : <><Link to="/library">Go to Library</Link><button onClick={() => void navigate(-1)}>Go back</button></>}
      </div>
      {detail && <details><summary>Technical detail</summary><pre>{detail}</pre></details>}
    </div>
  );
}

function RouteCrash() {
  const error = useRouteError();
  return <Recovery
    hardLinks
    title="This screen could not be drawn"
    body="Your songs, stems and takes are stored separately and were not affected."
    detail={(error instanceof Error ? error.stack ?? error.message : String(error)) || "No detail was reported."}
  />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    errorElement: <RouteCrash />,
    children: [
      { index: true, element: <Navigate to="/studio" replace /> },
      { path: "studio/:songId?", element: <StudioPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "settings", element: <SettingsPage /> },
      // Inside the shell, so a mistyped URL keeps the navigation it needs.
      { path: "*", element: <Recovery title="Page not found" body="That address is not part of Atarang. Nothing in your library changed, and anything playing is still playing." /> },
    ],
  },
]);
