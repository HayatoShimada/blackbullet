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
| `filter` | The filter box's starting phrase (written by **ビューを保存**) |
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

# Saving a view
The tab, sort and filter box live in the widget only, so they reset on every re-render. **ビューを保存** (enabled once they differ from the block) writes them back into the block as `view:`, `sort:` and `filter:`, leaving every other line and comment alone. It only runs when you click it. If the block was edited since it was drawn, or another identical `db` block exists on the page, nothing is written and you are told why.

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

**+ New** (in the header) asks for a title and makes the page `<folder><title>` with `tags: [<tag>]`, every property's `default`, and the `template` page when there is one (its `${...}` expanded, its own frontmatter merged; see [[Library/Std/APIs/Database]]); then opens it. **Shift+Enter** makes the row without opening it, for adding several in a row. A title that names an existing page is refused. Characters a page name cannot carry (`/ # @ | < > $ [ ]`, control characters) and a trailing `.<letters or digits>` are dropped, and the title is cut to 100 characters. A block whose `source` or `tag` is not the database's tag is not that database's view: it has no **+ New**.

# Finding your way
* **/database** (slash command) and **Database: Insert View**: pick a defined database and a view; a `db` block for it is inserted at the cursor.
* **Database: New Row**: pick a database, give a title, and the row is made and opened, without a view on screen.
* **Database: Define in CONFIG**: asks for a name and appends a starter `database.define` block to the `CONFIG` page, then opens it.
* **Database: Restore From Trash**: pick a page under `Trash/` that has `trashedFrom`; it is renamed back (links updated) and the two marks removed. Refused if a page already has the original name.
* `database.list()` names the defined databases (see [[Library/Std/APIs/Database]]).

# Rows
Every page row has a **…** button (a table's last cell, a board card's corner):
* **名前を変える** renames the page within its folder; links to it are updated. A name already taken is refused.
* **複製** copies the page to `<name> copy` (then `copy 2`, ...).
* **アーカイブ** sets `archived: true` in the page's frontmatter, which hides the row from every view; a block with `archived: true` shows archived rows (dimmed), where the button reads **アーカイブを戻す** and removes the flag.
* **ゴミ箱へ** asks to confirm, then moves the page to `Trash/<name>` (`Trash/<name> 2`, `3`, ... if that is taken) with `trashedFrom` and `trashedAt` in its frontmatter. Nothing is lost by one click: the row leaves the view, since pages under `Trash/` are never rows, and **Database: Restore From Trash** brings it back. To empty the trash, delete the pages under `Trash/` normally. Trashed pages are only hidden from db views: they keep their tags and stay in other queries and in Memo Search / Memo Ask until deleted for good.

Each is refused when the page changed since the view read it, or is no longer a row of the view. Tasks have no menu.

# Created and modified
`created` and `modified` (alias `lastModified`) are read-only attributes for `columns`, `sort` (`sort: -modified`) and the table's headers. A block that names a `database` and no `sort` is sorted by title (so an edited row stays put); a `modified` property declared by a database wins over the index time. Click a header to change it.

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
  name = "Database: Restore From Trash",
  run = function()
    local trashed = query[[
      from index.tag "page"
      where _.name:find("^Trash/") and _.trashedFrom
      order by (_.trashedAt or "") desc
    ]]
    if #trashed == 0 then
      editor.flashNotification("Nothing in the trash", "info")
      return
    end
    local options = {}
    for i, p in ipairs(trashed) do
      options[i] = { name = p.name, description = tostring(p.trashedFrom) .. " (" .. tostring(p.trashedAt or "") .. ")" }
    end
    local picked = editor.filterBox("Restore", options)
    if not picked then return end
    local ok, result = pcall(system.invokeFunction, "db-view.restoreTrashed", picked.name)
    if not ok then
      editor.flashNotification(tostring(result), "error")
      return
    end
    if result.ok then
      editor.flashNotification("Restored " .. result.page)
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
