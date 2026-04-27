/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import "./styles.css";
import "./opencode-components.css";
import "highlight.js/styles/github-dark.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

render(() => <App />, root);
