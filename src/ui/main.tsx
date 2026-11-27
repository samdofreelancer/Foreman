import { render } from "solid-js/web"
import { App } from "./shell"
import "./styles.css"

const root = document.getElementById("root")
if (!root) throw new Error("Foreman UI root element is missing")

root.replaceChildren()
render(() => <App />, root)
