import React from "react";
import ReactDOM from "react-dom/client";
import { init } from "@tma.js/sdk-react";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles.css";

try { init(); } catch { /* Local browser development. */ }

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? `${location.origin}/tonconnect-manifest.json`}>
      <BrowserRouter><App /></BrowserRouter>
    </TonConnectUIProvider>
  </React.StrictMode>
);
