import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "@/lib/auth";
import { recoverStaleChunk } from "@/lib/staleChunkRecovery";

// Vite emits this for missing old lazy chunks after a release. Do not let a
// stale tab strand the admin on a permanently broken route.
window.addEventListener("vite:preloadError", (event) => {
  if (recoverStaleChunk((event as Event & { payload?: unknown }).payload)) {
    event.preventDefault();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
