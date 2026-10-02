import { SectionNav } from "./section_nav.tsx";
import { Field } from "./field.tsx";
import { Input } from "./input.tsx";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { Tabs } from "./tabs.tsx";

test("route tabs preserve links and identify the current page without tab roles", () => {
  const html = render(
    h(Tabs, {
      label: "Settings",
      items: [{ label: "Server", href: "/settings/server", active: true }],
    }),
  );
  expect(html).toContain('href="/settings/server"');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain('role="tab"');
});

test("section navigation preserves disabled links and unsaved sections on mobile", () => {
  const html = render(
    h(SectionNav, {
      active: "general",
      label: "Preferences",
      items: [
        { id: "general", label: "General", href: "/general", dirty: true },
        {
          id: "restricted",
          label: "Restricted",
          href: "/restricted",
          disabled: true,
        },
      ],
      onSelect() {},
    }),
  );
  expect(html).toContain('href="/general"');
  expect(html).not.toContain('href="/restricted"');
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('data-dirty="true"');
  expect(html).toContain("General •");
});

test("field connects its existing input to its label and validation feedback", () => {
  const html = render(
    h(Field, {
      label: "Endpoint",
      hint: "Use an HTTPS URL",
      error: "Invalid URL",
      children: h(Input, { id: "endpoint", value: "invalid" }),
    }),
  );
  expect(html).toContain('for="endpoint"');
  expect(html).toContain('aria-describedby="endpoint-hint endpoint-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('value="invalid"');
});

test("an enabled tab remains a keyboard entry point when the first tab is disabled", () => {
  const html = render(
    h(Tabs, {
      items: [{ label: "Unavailable", disabled: true }, { label: "General" }],
    }),
  );
  expect(html).toMatch(/tabindex="0"[^>]*>General<\/button>/);
});
