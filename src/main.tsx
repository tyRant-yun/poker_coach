import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./app/App";
import { AnalysisPage } from "./modules/analysis/AnalysisPage";
import { LegacyGate } from "./modules/analysis/LegacyGate";
import "./styles/global.css";

const router = createBrowserRouter([
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
