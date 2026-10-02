import { expect, test } from "vitest";
import { applyUrlPrefix, removeUrlPrefix } from "./url_prefix.ts";

test("url_prefix - removeUrlPrefix - with value", async () => {
  expect(removeUrlPrefix("http://myserver/sb/relevant", "/sb")).toEqual(
    "http://myserver/relevant",
  );
  expect(removeUrlPrefix("https://myserver/sb/relevant", "/sb")).toEqual(
    "https://myserver/relevant",
  );

  expect(removeUrlPrefix("http://myserver/sb/sb/relevant/sb", "/sb")).toEqual(
    "http://myserver/sb/relevant/sb",
  );
  expect(removeUrlPrefix("http://myserver/relevant/sb", "/sb")).toEqual(
    "http://myserver/relevant/sb",
  );

  expect(removeUrlPrefix("http://myserver/other/relevant", "/sb")).toEqual(
    "http://myserver/other/relevant",
  );
  expect(removeUrlPrefix("https://myserver/other/relevant", "/sb")).toEqual(
    "https://myserver/other/relevant",
  );

  expect(
    removeUrlPrefix("http://myserver/sb/sb/relevant/sb?param=arg", "/sb"),
  ).toEqual("http://myserver/sb/relevant/sb?param=arg");

  expect(removeUrlPrefix("ftp://myserver/sb/relevant", "/sb")).toEqual(
    "ftp://myserver/sb/relevant",
  );

  expect(removeUrlPrefix("/sb/relevant", "/sb")).toEqual("/relevant");

  expect(removeUrlPrefix("/sb/sb/relevant/sb", "/sb")).toEqual(
    "/sb/relevant/sb",
  );
  expect(removeUrlPrefix("/relevant/sb", "/sb")).toEqual("/relevant/sb");

  expect(removeUrlPrefix("/sb/sb/relevant/sb?param=arg", "/sb")).toEqual(
    "/sb/relevant/sb?param=arg",
  );
  expect(removeUrlPrefix("/relevant/sb?param=arg", "/sb")).toEqual(
    "/relevant/sb?param=arg",
  );

  expect(removeUrlPrefix("/other/relevant", "/sb")).toEqual("/other/relevant");

  expect(removeUrlPrefix("sb/relevant", "/sb")).toEqual("sb/relevant");
});

test("url_prefix - removeUrlPrefix - no value", async () => {
  expect(removeUrlPrefix("http://myserver/sb/relevant", "")).toEqual(
    "http://myserver/sb/relevant",
  );
  expect(removeUrlPrefix("https://myserver/sb/relevant")).toEqual(
    "https://myserver/sb/relevant",
  );

  expect(removeUrlPrefix("/sb/relevant", "")).toEqual("/sb/relevant");
  expect(removeUrlPrefix("/sb/relevant")).toEqual("/sb/relevant");

  expect(removeUrlPrefix("sb/relevant", "")).toEqual("sb/relevant");
  expect(removeUrlPrefix("sb/relevant")).toEqual("sb/relevant");
});

test("url_prefix - applyUrlPrefix - with value", async () => {
  expect(applyUrlPrefix("http://myserver/relevant", "/sb")).toEqual(
    "http://myserver/sb/relevant",
  );
  expect(applyUrlPrefix("https://myserver/relevant", "/sb")).toEqual(
    "https://myserver/sb/relevant",
  );

  expect(applyUrlPrefix("http://myserver/sb/relevant/sb", "/sb")).toEqual(
    "http://myserver/sb/sb/relevant/sb",
  );

  expect(
    applyUrlPrefix("http://myserver/sb/relevant/sb?param=arg", "/sb"),
  ).toEqual("http://myserver/sb/sb/relevant/sb?param=arg");

  expect(applyUrlPrefix("ftp://myserver/relevant", "/sb")).toEqual(
    "ftp://myserver/relevant",
  );

  expect(applyUrlPrefix("/relevant", "/sb")).toEqual("/sb/relevant");

  expect(applyUrlPrefix("/sb/relevant/sb", "/sb")).toEqual(
    "/sb/sb/relevant/sb",
  );

  expect(applyUrlPrefix("/sb/relevant/sb?param=arg", "/sb")).toEqual(
    "/sb/sb/relevant/sb?param=arg",
  );

  expect(applyUrlPrefix("relevant", "/sb")).toEqual("relevant");

  expect(applyUrlPrefix(new URL("http://myserver/relevant"), "/sb")).toEqual(
    new URL("http://myserver/sb/relevant"),
  );

  expect(
    applyUrlPrefix(new URL("http://myserver/relevant?param=arg"), "/sb"),
  ).toEqual(new URL("http://myserver/sb/relevant?param=arg"));
});

test("url_prefix - applyUrlPrefix - no value", async () => {
  expect(applyUrlPrefix("http://myserver/relevant", "")).toEqual(
    "http://myserver/relevant",
  );
  expect(applyUrlPrefix("https://myserver/relevant")).toEqual(
    "https://myserver/relevant",
  );

  expect(applyUrlPrefix("/relevant", "")).toEqual("/relevant");
  expect(applyUrlPrefix("/relevant")).toEqual("/relevant");

  expect(applyUrlPrefix("relevant", "")).toEqual("relevant");
  expect(applyUrlPrefix("relevant")).toEqual("relevant");
});
