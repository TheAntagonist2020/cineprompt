import { createRoot } from "react-dom/client";
import LogApp from "./app";
import "../index.css";

document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(<LogApp />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}
