import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { PlayPage } from "./modules/play/PlayPage";
import { App } from "./app/App";
import { AnalysisPage } from "./modules/analysis/AnalysisPage";
import { RealAnalysisPage } from "./modules/analysis/RealAnalysisPage";
import { LegacyGate } from "./modules/analysis/LegacyGate";
import "./styles/global.css";

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/play" replace /> },
  { path: "/play", element: <PlayPage /> },
  { path: "/hands", element: <PlayPage /> },
  { path: "/solver/real", element: <RealAnalysisPage /> },
  { path: "/solver", element: <AnalysisPage /> },
  {
    path: "*",
    element: (
      <LegacyGate>
        <App />
      </LegacyGate>
    ),
  },
]);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
