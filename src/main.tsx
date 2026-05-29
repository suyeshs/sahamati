import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { GitHubProvider } from "./context/GitHubContext";
import { LocalProjectProvider } from "./context/LocalProjectContext";
import App from "./App";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <GitHubProvider>
        <LocalProjectProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LocalProjectProvider>
      </GitHubProvider>
    </AuthProvider>
  </React.StrictMode>
);
