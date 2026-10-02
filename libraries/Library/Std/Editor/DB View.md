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
| `where` | Only rows whose attributes match, e.g. `{status: active}`; see *Filters* below for `not`, `lt` `lte` `gt` `gte` (also `before` / `after`), `contains`, `empty` and several conditions per key |
| `filter` | The filter box's starting phrase (written by **Save view**) |
| `archived` | `true` to show archived rows too (default: hidden for every source; a `where: {archived: ...}` also shows them) |
| `limit` | Most rows loaded (default 500) |
| `weekStart` | Calendar: `0` Sunday (default) or `1` Monday |

# Filters
A `where` value is plain equality, or an operator object. Every condition must hold:

```yaml
where:
  status: {not: done}              # not equal
  due: {before: today}             # overdue (also: after, lt, lte, gt, gte)
  owner: {empty: true}             # no value (false: has a value)
  area: {contains: dev}            # text contains, case-insensitive; lists: any item
  priority: {gte: 2, lt: 5}        # several operators on one key
  tags: [a, {not: b}]              # a list: several conditions on one key
```

`today` stands for today's date in any comparison (a plain `due: today` still means the text "today"). Numbers compare as numbers, everything else as text, which orders ISO dates right. A row without a value fails every comparison (use `empty: true` to find those).

# The header
One row: **Title · count**, the tabs **Table | Board | Calendar**, a **Filter…** box, **+ New** (only on a view of a database) and a **⋯** with **Edit source**, **Save view** and **Reload**. The host's own Edit/Reload bar is hidden on a `db` block (the view has its own header); **Edit source** puts the cursor in the block so its text shows for editing. On a phone the header takes two rows (title, **+ New**, **⋯**; then the tabs) with the filter below, and every control is 44 px.

# Saving a view
The tab, sort and filter box live in the widget only, so they reset on every re-render. **Save view** (in the **⋯** menu; enabled once they differ from the block) writes them back into the block as `view:`, `sort:` and `filter:`, leaving every other line and comment alone. It only runs when you choose it. If the block was edited since it was drawn, or another identical `db` block exists on the page, nothing is written and you are told why.

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

**+ New** (in the header) opens a title input as the first row of the table (the first card of its column on a board, a row above the grid in a calendar) and focuses it. **Enter** makes the page `<folder><title>` with `tags: [<tag>]`, every property's `default`, and the `template` page when there is one (its `${...}` expanded, its own frontmatter merged; see [[Library/Std/APIs/Database]]); then opens it. **Shift+Enter** makes the row without opening it, for adding several in a row; **Esc** cancels. A title that names an existing page is refused, with the reason under the input and your text kept. Characters a page name cannot carry (`/ # @ | < > $ [ ]`, control characters) and a trailing `.<letters or digits>` are dropped, and the title is cut to 100 characters. A block whose `source` or `tag` is not the database's tag is not that database's view: it has no **+ New**.

# Finding your way
* **/database** (slash command) and **Database: Insert View**: pick a defined database and a view; a `db` block for it is inserted at the cursor.
* **Database: New Row**: pick a database, give a title, and the row is made and opened, without a view on screen.
* **Database: Define in CONFIG**: asks for a name and appends a starter `database.define` block to the `CONFIG` page, then opens it.
* **Trash: Restore** (a space command, not part of this library): pick a page under `Trash/`; it is renamed back (links updated) and the two marks removed. Refused if a page already has the original name.
* `database.list()` names the defined databases (see [[Library/Std/APIs/Database]]).

# Rows
Every page row has a **⋯** button (a table's last cell, a board card's corner) that opens a menu next to it (Esc, a click elsewhere or Tab closes it; the first item is focused and the arrow keys move). The row never changes height while it is open:
* **Rename** renames the page within its folder; links to it are updated. A name already taken is refused.
* **Duplicate** copies the page to `<name> copy` (then `copy 2`, ...).
* **Archive** sets `archived: true` in the page's frontmatter, which hides the row from every view, and the view shows **Archived · Undo** for 8 seconds; a block with `archived: true` shows archived rows (dimmed), where the item reads **Unarchive** and removes the flag.
* **Move to trash** asks in a dialog ("Move *name* to trash? You can restore it from Trash."), then moves the page to `Trash/<name>` (`Trash/<name> 2`, `3`, ... if that is taken) with `trashedFrom` and `trashedAt` in its frontmatter. Nothing is lost by one click: the row leaves the view, since pages under `Trash/` are never rows, and **Trash: Restore** (command palette) brings it back, to its original name with links intact. **Trash: Empty** deletes what is in `Trash/` for good, after asking. Trashed pages are only hidden from db views: they keep their tags and stay in other queries and in Memo Search / Memo Ask until deleted for good.

Each is refused when the page changed since the view read it, or is no longer a row of the view. Tasks have no menu.

# Created and modified
`created` and `modified` (alias `lastModified`) are read-only attributes for `columns`, `sort` (`sort: -modified`) and the table's headers. A block that names a `database` and no `sort` is sorted by title (so an edited row stays put); a `modified` property declared by a database wins over the index time. Click a header to change it.

# What can be changed
* **Table**: click a cell (or its pencil, which shows on hover; a single tap on a touch screen; or focus the cell and press Enter or F2) to edit; Enter saves, Esc cancels, dates are ISO (`2026-10-14`). A task's checkbox toggles its `[ ]` / `[x]`: the row stays, struck through, with **Done · Undo** for 8 seconds, then leaves the list. An empty cell clears the attribute. The name, tags and counts are not edited here. A header cell sorts. Under 480 px wide the table is a list of cards (checkbox, name, one line of the other properties, **⋯**), so nothing scrolls sideways.
* **Board**: drag a card to another column to set the `group` attribute (the empty column clears it); the view says **Moved to *column* · Undo** for 8 seconds, and Undo writes the previous value back. Columns with no rows are not shown when the *None* column holds every row. A board of **tasks** is grouped by page (the project) unless you name a `group`, and its cards cannot be dragged to another page.
* **Calendar**: drag a card to a day to set the `date` attribute; the _No date_ box clears it; **Moved to *date* · Undo** works as on a board. The title reads like *October 2026*, with **‹ › Today**.
* A **task** can change only its done state and its `[due: ...]`. A date shows the word *overdue*, *today* or *tomorrow* beside it, so colour is never the only cue; a done row is grey and never red.
* An empty view says what to do next: *No rows yet. + New makes a page in Projects/ from Templates/Project.*, *Nothing matches "…".* with **Clear filter**, or *All done.* for open tasks.

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
      -- The view has its own header: the host's Reload/Edit bar stays away.
      cssClasses = { "sb-db-widget" },
    }
  end,
}

-- Asks for one of the defined databases; nil when there is none or none is picked.
local function pickDatabase()
  local names = database.list()
  if #names == 0 then
    editor.flashNotification("No databases are defined yet (Database: Define in CONFIG)", "error")
    return nil
  end
  local options = {}
  for i, name in ipairs(names) do
    options[i] = { name = name, description = config.get({"databases", name, "title"}, nil) }
  end
  local picked = editor.filterBox("Database", options)
  return picked and picked.name
end

local function insertView()
  local name = pickDatabase()
  if not name then return end
  local picked = editor.filterBox("View", {
    { name = "table" }, { name = "board" }, { name = "calendar" },
  })
  if not picked then return end
  editor.insertAtCursor(database.viewBlock(name, picked.name), false, true)
end

slashCommand.define {
  name = "database",
  description = "Insert a view of a database",
  run = insertView,
}

command.define {
  name = "Database: Insert View",
  run = insertView,
}

command.define {
  name = "Database: New Row",
  run = function()
    local name = pickDatabase()
    if not name then return end
    local def = config.get({"databases", name}, nil)
    local title = string.trim(some(editor.prompt("Title")) or "")
    if title == "" then return end
    local result = system.invokeFunction("db-view.createRow", {
      source = { kind = "tag", tag = def.tag },
      database = def,
      view = "table", group = "status", date = "due",
      where = {}, limit = 500, weekStart = 0,
    }, title)
    if result.ok then
      editor.navigate(result.page)
    else
      editor.flashNotification(result.message, "error")
    end
  end,
}

command.define {
  name = "Database: Define in CONFIG",
  run = function()
    local name = string.trim(some(editor.prompt("Database name")) or "")
    if name == "" then return end
    if name:find("[/\n]") or table.includes(database.list(), name) then
      editor.flashNotification("Invalid or already defined name", "error")
      return
    end
    local ok, text = pcall(space.readPage, "CONFIG")
    if not ok then text = "" end
    space.writePage("CONFIG", string.trim(text) .. "\n\n" .. database.defineSnippet(name))
    editor.navigate("CONFIG")
  end,
}
```

**Adding in place.** On a board each column has a **+** that makes a row with that column's value already set (`status: someday`); on a calendar each day has one that sets the date attribute to that day. Enter makes the row and keeps you on the view (so you can add the next one); the page does not open. A value that a property does not allow (a select option that is not declared, a date that is not a date) is refused, and so is such an edit of a cell: declared options and types are enforced on every write.

**Touch.** Cards are moved with pointer events, so the board and the calendar work on a phone: press and hold a card (about a quarter of a second), then drag it to a column or a day. With a mouse, drag past a few pixels. Below 600px the header wraps, the board scrolls sideways one column at a time, and the calendar's days stack as a list.
