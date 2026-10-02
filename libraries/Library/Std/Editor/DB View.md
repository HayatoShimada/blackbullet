#meta

Database views over your pages and tasks: a table you can edit in place, a board you can drag cards across, and a calendar you can drag cards onto. Put a `db` code block anywhere:

````
```db
source: projects
view: board
group: status
```
````

The view is a sandboxed widget (the `db-view` plug); everything it changes is written back to the Markdown (a page's frontmatter, or the task's own line), and refused if the page changed since the view read it.

# The block
A YAML mapping:

| Key | Meaning |
| --- | --- |
| `source` | `projects` (pages tagged `project`, with their task counts), `tasks`, or `tag:<name>` (pages with that tag; `tag: <name>` also works) |
| `view` | `table` (default), `board`, `calendar` |
| `title` | A heading; defaults to the source |
| `group` | Board: the attribute whose values are the columns (default `status`) |
| `order` | Board: the order of the columns, e.g. `[active, someday, done]` (default for `status`); other values follow |
| `date` | Calendar: the attribute a card sits on (default `due`) |
| `columns` | Table: attributes to show, in order, e.g. `[title, status, due]` |
| `sort` | Table: an attribute, `-due` for descending |
| `where` | Only rows whose attributes equal these, e.g. `{status: active}` |
| `limit` | Most rows loaded (default 500) |
| `weekStart` | Calendar: `0` Sunday (default) or `1` Monday |

# What can be changed
* **Table**: double-click a cell (or focus it and press Enter) to edit; Enter saves, Esc cancels. A task's checkbox toggles its `[ ]` / `[x]`. An empty cell clears the attribute. The name, tags and counts are not edited here.
* **Board**: drag a card to another column to set the `group` attribute (the empty column clears it).
* **Calendar**: drag a card to a day to set the `date` attribute; the _日付なし_ box clears it.
* A **task** can change only its done state and its `[due: ...]`.

# Implementation
```space-lua
-- priority: 10
codeWidget.define {
  language = "db",
  render = function(bodyText, pageName)
    local w = system.invokeFunction("db-view.render", bodyText, pageName)
    return widget.sandbox {
      html = w.html,
      script = w.script,
      markdown = bodyText,
    }
  end,
}
```
