import { render } from "preact";
import { PreviewShell } from "./preview-shell";
import "@fontsource-variable/inter";
import "./style.css";
import "./theme.css";
import "./polish.css";
import "./review.css";

render(<PreviewShell />, document.getElementById("root")!);
