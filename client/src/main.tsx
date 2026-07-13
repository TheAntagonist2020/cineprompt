import { createRoot } from "react-dom/client";
import App from "./App";
import { loadData } from "./lib/data";
import "./index.css";

// Start downloading data.json immediately — every page needs it, and waiting
// for React to mount before fetching serializes a ~7 MB download behind the
// JS parse. Combined with the <link rel="preload"> in index.html, the data is
// usually in flight before this module even executes.
loadData();

// Cinema editorial is dark-only.
document.documentElement.classList.add("dark");

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
