import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./AppShell";
import { StudioPage } from "../features/studio/StudioPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { SettingsPage } from "../features/settings/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/studio" replace /> },
      { path: "studio/:songId?", element: <StudioPage /> },
      { path: "library", element: <LibraryPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
