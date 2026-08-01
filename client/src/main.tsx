import { createRoot } from "react-dom/client";
import App from "./App";
import { loadData } from "./lib/data";
import "./index.css";

// Start downloading the core payload immediately — every page needs it, and
// waiting for React to mount before fetching serializes the download behind
// the JS parse. Combined with the <link rel="preload"> in index.html, the data
// is usually in flight before this module even executes.
loadData();

// Cinema editorial is dark-only.
document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);

// Offline + instant repeat loads. Registered after paint so it never competes
// with the core payload for bandwidth, and only in production — in dev the
// Vite module graph must always come from the server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* offline support is an enhancement; never block the app on it */
    });
  });
}
