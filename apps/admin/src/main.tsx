import { createRoot } from "react-dom/client";
import "./app.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("#root не найден");

createRoot(container).render(<App />);
