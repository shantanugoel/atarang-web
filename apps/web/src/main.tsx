import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { router } from "./app/router";
import { runtimeAssets } from "./generated/runtime-assets";
import { recoverIncompleteImports } from "./storage/importer";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

if ("serviceWorker" in navigator && isSecureContext && location.port !== "3000") {
  void navigator.serviceWorker.register(runtimeAssets.serviceWorker, { type: "module" });
}
void recoverIncompleteImports();
