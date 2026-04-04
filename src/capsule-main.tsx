import React from "react";
import ReactDOM from "react-dom/client";
import "./lib/i18n";
import "./app.css";
import CapsuleApp from "./CapsuleApp";

document.body.dataset.capsule = "true";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CapsuleApp />
  </React.StrictMode>
);
