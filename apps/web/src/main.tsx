import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Niches from "./Niches";
import ClipMine from "./App";
const App = import.meta.env.VITE_APP_MODE === "clipmine" ? ClipMine : Niches;
if (import.meta.env.VITE_APP_MODE === "clipmine")
  document.title = "ClipMine — Find the gold in every video";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
