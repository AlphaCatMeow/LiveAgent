import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";
import "react-complex-tree/lib/style-modern.css";
import "streamdown/styles.css";
import "./styles.css";

document.documentElement.dataset.liveagentWebui = "gateway";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
