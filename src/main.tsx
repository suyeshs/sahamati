import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { GitHubProvider } from "./context/GitHubContext";
import { LocalProjectProvider } from "./context/LocalProjectContext";
import { ThemeProvider } from "./context/ThemeContext";
import App from "./App";
import "./App.css";

// Mark the Tauri window so the shell can go transparent for macOS vibrancy.
if ("__TAURI_INTERNALS__" in window) {
  document.body.classList.add("tauri");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <GitHubProvider>
          <LocalProjectProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </LocalProjectProvider>
        </GitHubProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
