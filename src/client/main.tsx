import "./style.css";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { connect, store } from "./store.ts";
import App from "./App.tsx";
const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
connect();
createRoot(root).render(
  <Provider store={store}>
    <App />
  </Provider>,
);
