import { render } from "preact";
import type { ViewModel } from "../src/functions.ts";
import { App } from "./components/app.tsx";
import { useDb } from "./mediator/use_db.ts";

declare const __DB: ViewModel;

function Root({ model }: { model: ViewModel }) {
  const { state, emit } = useDb(model);
  return <App state={state} emit={emit} />;
}

const root = document.getElementById("db-root");
if (!root) throw new Error("db-root not found");
render(<Root model={__DB} />, root);
