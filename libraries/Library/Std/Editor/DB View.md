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
| `database` | The name of a database declared with `database.define` (see below). The source, the kind of each property, the board order and the title then come from it, and **+ New** adds a row |
| `source` | `projects` (pages tagged `project`, with their task counts), `tasks`, or `tag:<name>` (pages with that tag; `tag: <name>` also works). Not needed with `database` |
| `view` | `table` (default), `board`, `calendar` |
| `title` | A heading; defaults to the database's title, else the source |
| `group` | Board: the attribute whose values are the columns (default `status`) |
| `order` | Board: the order of the columns, e.g. `[active, someday, done]` (default for `status`, or the database's `order`); other values follow |
| `date` | Calendar: the attribute a card sits on (default `due`) |
| `columns` | Table: attributes to show, in order, e.g. `[title, status, due]` |
| `sort` | Table: an attribute, `-due` for descending |
| `where` | Only rows whose attributes equal these, e.g. `{status: active}` |
| `limit` | Most rows loaded (default 500) |
| `weekStart` | Calendar: `0` Sunday (default) or `1` Monday |

# A database
A database is a folder of pages that share a tag and a declared set of properties. Declare it in `CONFIG` (the API is documented in [[Library/Std/APIs/Database]]):

```lua
database.define {
  name = "projects",
  tag = "project",
  folder = "Projects/",
  template = "Templates/Project",
  title = "Projects",
  properties = {
    { key = "status", type = "select", options = {"active", "someday", "done"}, default = "active", label = "Status" },
    { key = "due",    type = "date" },
    { key = "area",   type = "page" },
  },
  order = {"active", "someday", "done"},
}
```

Then a block only needs its name:

````
```db
database: projects
view: board
```
````

With a database the view knows its columns: `status` is a select with exactly those options, `due` is a date, `area` is a link to a page. Only pages under `folder` are rows. Attributes the database does not declare are still shown and their kind guessed as before.

**+ New** (in the header) asks for a title and makes the page `<folder><title>` with `tags: [<tag>]`, every property's `default`, and the body of the `template` page when there is one; then opens it. A title that names an existing page is refused. Characters a page name cannot carry (`/ # @ | < > $ [ ]`, control characters) and a trailing `.<letters or digits>` are dropped, and the title is cut to 100 characters. A block whose `source` or `tag` is not the database's tag is not that database's view: it has no **+ New**.

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
