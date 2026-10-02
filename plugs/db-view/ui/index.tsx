import { render } from "preact";
import type { ViewModel } from "../src/functions.ts";
import { App } from "./components/app.tsx";
import { useDb } from "./mediator/use_db.ts";

declare const __DB: ViewModel;

function Root({ model }: { model: ViewModel }) {
  const { state, emit } = useDb(model);
  return <App state={state} emit={emit} />;
}

/** The host sizes the frame from what the view says it needs. The panel's own
 * poll gives up after a couple of seconds, so a row that appears later (a new
 * row's input, a created card, a longer list) would be clipped: tell the host
 * on every change of the content's height, once per frame. */
function followHeight(): void {
  // The panel re-runs this script when the page re-renders the widget: one
  // observer at a time.
  const w = window as unknown as { __dbHeight?: ResizeObserver };
  w.__dbHeight?.disconnect();
  let last = -1;
  const post = () => {
    const height = Math.max(
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
    );
    if (height === last) return;
    last = height;
    window.parent.postMessage({ type: "setHeight", height }, "*");
  };
  w.__dbHeight = new ResizeObserver(post);
  w.__dbHeight.observe(document.body);
  post();
}

const root = document.getElementById("db-root");
if (!root) throw new Error("db-root not found");
render(<Root model={__DB} />, root);
followHeight();
