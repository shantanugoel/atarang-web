import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./app/router";
import { recoverIncompleteImports } from "./storage/importer";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

// Registered from the site root, so its scope is the whole app. It used to be
// registered from its hashed /runtime/ URL, where the scope was /runtime/ and
// the navigation fallback and precache therefore applied to nothing.
if ("serviceWorker" in navigator && isSecureContext && location.port !== "3000") {
  void navigator.serviceWorker.register("/service-worker.js", { type: "module" });
  // One-time cleanup of that older, narrower registration.
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) if (new URL(registration.scope).pathname !== "/") void registration.unregister();
  });
}
void recoverIncompleteImports();
