---
description: BlackBullet's query templates: a task or page is shown by its page name, never as Page@195.
tags: meta
---

Overrides two of the templates in [[^Library/Std/Infrastructure/Query Templates]] so that lists on the home page, in a tag page and in a query read as the user's notes do.

* `templates.taskItem` links to the task as before (the link still points at the exact line) but shows the last segment of its page name ("Spring Launch") instead of the reference ("Projects/Spring Launch@195").
* `templates.fullPageItem` shows the full page name, with an `@position` suffix removed when a reference carries one.

Loaded after the Std query templates (`priority: 5`); a space can still override either one the usual way.

```space-lua
-- priority: 5
-- SPDX-License-Identifier: GPL-2.0-only
templates.taskItem = template.new([==[
* [${state}] [[${string.find(ref, "[@#]") and ref or "$" .. ref}|${string.match(page or ref, "[^/]*$")}]] ${name}
]==])

templates.fullPageItem = template.new([==[
* [[${name}|${(string.gsub(name, "@%d+$", ""))}]]
]==])
```
