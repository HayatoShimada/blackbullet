import { afterEach, expect, test, vi } from "vitest";
import { PathPageNavigator } from "./navigator.ts";
import type { Client } from "./client.ts";

type PopstateListener = (event: PopStateEvent) => Promise<void>;

function setupNavigator() {
  let popstate: PopstateListener | undefined;
  let currentHistoryState = { path: "Current.md" };
  const location = { href: "http://example.test/Current" };
  vi.stubGlobal("location", location);
  vi.stubGlobal("document", { baseURI: "http://example.test/" });
  vi.stubGlobal(
    "PopStateEvent",
    class {
      state: unknown;
      constructor(_name: string, init: { state: unknown }) {
        this.state = init.state;
      }
    },
  );
  vi.stubGlobal(
    "addEventListener",
    vi.fn((name: string, listener: PopstateListener) => {
      if (name === "popstate") popstate = listener;
    }),
  );
  vi.stubGlobal(
    "dispatchEvent",
    vi.fn((event: PopStateEvent) => {
      void popstate!(event);
      return true;
    }),
  );
  const history = {
    replaceState: vi.fn(
      (state: { path: string }, _unused: string, url: string) => {
        currentHistoryState = state;
        location.href = url;
      },
    ),
    pushState: vi.fn(
      (state: { path: string }, _unused: string, url: string) => {
        currentHistoryState = state;
        location.href = url;
      },
    ),
    go: vi.fn((_delta: number) => {
      currentHistoryState = { path: "Current.md" };
      location.href = "http://example.test/Current";
      void popstate!(
        new PopStateEvent("popstate", { state: currentHistoryState }),
      );
    }),
  };
  vi.stubGlobal("history", history);
  const flashNotification = vi.fn();
  let shownPath = "Current.md";
  const client = {
    getIndexRef: () => ({ path: "index.md" }),
    currentPath: () => shownPath,
    editorView: {
      state: { selection: { main: { head: 0, anchor: 0 } } },
      scrollDOM: { scrollTop: 0 },
    },
    ui: { flashNotification },
  } as unknown as Client;
  const navigator = new PathPageNavigator(client);
  return {
    navigator,
    showPage: (path: string) => {
      shownPath = path;
    },
    history,
    location,
    flashNotification,
    emitPopstate: async (path: string) => {
      currentHistoryState = { path };
      location.href = `http://example.test/${path.replace(/\.md$/, "")}`;
      await popstate!(
        new PopStateEvent("popstate", { state: currentHistoryState }),
      );
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("failed programmatic navigation rolls history back without reloading the retained page", async () => {
  const { navigator, history, location, flashNotification } = setupNavigator();
  const loaded: string[] = [];
  navigator.subscribe(async ({ path }) => {
    loaded.push(path);
    throw new Error("Offline");
  });

  await navigator.navigate({ path: "Other.md" });

  expect(location.href).toBe("http://example.test/Current");
  expect(history.go).toHaveBeenCalledWith(-1);
  expect(loaded).toEqual(["Other.md"]);
  expect(flashNotification).toHaveBeenCalledWith(
    "Failed to navigate: Offline",
    "error",
  );
});

test("failed browser history navigation restores the displayed page URL", async () => {
  const { navigator, history, location, flashNotification, emitPopstate } =
    setupNavigator();
  navigator.subscribe(async () => {
    throw new Error("Offline");
  });

  await emitPopstate("Other.md");

  expect(location.href).toBe("http://example.test/Current");
  expect(history.replaceState).toHaveBeenLastCalledWith(
    { path: "Current.md" },
    "",
    "http://example.test/Current",
  );
  expect(flashNotification).toHaveBeenCalledWith(
    "Failed to navigate: Offline",
    "error",
  );
});

test("goBackFrom returns to the page an in-app navigation came from, once", async () => {
  const { navigator, history, showPage } = setupNavigator();
  navigator.subscribe(async () => {});

  // Nothing was opened from inside the app yet: do not touch the history.
  expect(navigator.goBackFrom("Other.md")).toBe(false);

  await navigator.navigate({ path: "Other.md" });
  showPage("Other.md");
  history.go.mockClear();

  // A different page is on screen: not ours to go back from.
  expect(navigator.goBackFrom("Third.md")).toBe(false);
  expect(history.go).not.toHaveBeenCalled();

  expect(navigator.goBackFrom("Other.md")).toBe(true);
  expect(history.go).toHaveBeenCalledWith(-1);

  // Back on the first page the arrival no longer applies.
  showPage("Current.md");
  expect(navigator.goBackFrom("Other.md")).toBe(false);
});

test("goBackFrom ignores a failed navigation and an in-place replace", async () => {
  const { navigator, showPage } = setupNavigator();
  navigator.subscribe(async () => {
    throw new Error("Offline");
  });
  await navigator.navigate({ path: "Other.md" });
  showPage("Other.md");
  expect(navigator.goBackFrom("Other.md")).toBe(false);

  const second = setupNavigator();
  second.navigator.subscribe(async () => {});
  await second.navigator.navigate({ path: "Other.md" }, true);
  second.showPage("Other.md");
  expect(second.navigator.goBackFrom("Other.md")).toBe(false);
});
