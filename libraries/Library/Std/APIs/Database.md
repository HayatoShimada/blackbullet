#meta/api

Implements the API for defining databases: a folder of pages that share a tag and a declared set of properties. A `db` block with `database: <name>` (see [[Library/Std/Editor/DB View]]) shows one as a table, a board or a calendar, knows what kind each property is, and can add a row with **+ New**.

# API

## database.define(def)
Defines a database. Options:
* `name` _(required)_: what a `db` block refers to it by (`database: projects`).
* `tag`: the tag its pages carry; default: the name.
* `folder`: where its pages live and where new rows are made, e.g. `Projects/`; default: `<name>/`. A trailing `/` is added when missing. Only pages under the folder are rows.
* `template`: a page that seeds a new row. Its body is expanded like a page template: `${...}` is evaluated, with `title`, `page` and `database` in scope (`${title}`, `${os.date("%Y-%m-%d")}`). Its own frontmatter is merged into the new row (also expanded), except keys that describe the template itself (`tags`, `command`, `key`, `mac`, `priority`, `suggestedName`, `confirmName`, `openIfExists`, `description`, `displayName`, `range`); a `frontmatter:` key, as in a page template, holds the page's own attributes. The row's tag and the properties' defaults win over the template's.
* `title`: shown as the view's heading; default: the name.
* `properties`: an ordered list of `{ key, type, label?, options?, default? }`. `type` is one of `text`, `select`, `date`, `number`, `boolean`, `page` (a link to another page). A `select` needs `options`. A `default` is written into every new row; for a `date`, `default = "today"` is the day the row is made. The options and the type of a property are enforced when a view writes it: a `select` takes only one of its options. Enforcement applies to writes made through a database-backed view (which names the database), not to edits made by hand.
* `order`: for a board, the order of its columns, e.g. `{"active", "someday", "done"}`.

The definition is stored as `config.databases.<name>` and the tag's schema is declared with `tag.define`, so the properties are validated and completed in frontmatter. If the tag already has a schema (a builtin's, or another database's on the same tag), the properties are merged into it: the database's win on a clash, and its other keys are kept.

A `default` must fit its property's type (and, for a `select`, be one of the options), keys must be unique, and `tags` is reserved; `database.define` fails otherwise.

## database.expandTemplate(text, ctx)
Expands the `${...}` in `text` with the fields of `ctx` in scope, as `template.new` does. The db view calls it to make a row from the database's `template`.

## database.list()
The names of the defined databases, sorted. Used by the commands in [[Library/Std/Editor/DB View]].

## database.viewBlock(name, view)
The Markdown of a `db` block that shows the database `name`, as a `table` (default), `board` or `calendar`. Insert it into a page to get the view.

## database.defineSnippet(name)
A `space-lua` block with a `database.define` call for a new database called `name`, with a `status` and a `due` property to start from. [[Library/Std/Editor/DB View]] appends it to `CONFIG` with the command **Database: Define in CONFIG**.

# Example
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

# Implementation

```space-lua
-- priority: 10
database = database or {}

config.define("databases", {
  description = "Databases: a folder of tagged pages with declared properties, shown by db blocks",
  type = "object",
  additionalProperties = {
    type = "object",
    properties = {
      name = { type = "string" },
      tag = { type = "string" },
      folder = { type = "string" },
      template = { type = "string" },
      title = { type = "string" },
      properties = {
        type = "array",
        items = {
          type = "object",
          properties = {
            key = { type = "string" },
            type = { type = "string", enum = {"text", "select", "date", "number", "boolean", "page"} },
            label = { type = "string" },
            options = { type = "array", items = { type = "string" } },
            default = {},
          },
          required = {"key", "type"},
        },
      },
      order = { type = "array", items = { type = "string" } },
    },
    required = {"name", "tag", "folder"},
  },
})

local propertyTypes = {
  text = true, select = true, date = true, number = true, boolean = true, page = true,
}

-- The frontmatter schema of one property, for tag.define.
local function propertySchema(p)
  if p.type == "select" then
    return { type = "string", enum = p.options }
  elseif p.type == "number" then
    return { type = "number" }
  elseif p.type == "boolean" then
    return { type = "boolean" }
  end
  return { type = "string" }
end

-- A copy of a list, or nil when it is empty: an empty Lua table reaches the
-- config as an object, which the schema would refuse as a list.
local function listOrNil(list)
  local out = {}
  for i, v in ipairs(list) do out[i] = v end
  if #out == 0 then return nil end
  return out
end

function database.define(spec)
  assert(type(spec) == "table", "database.define: expected a table")
  assert(type(spec.name) == "string" and spec.name ~= "", "database.define: name is required")
  local where = "database " .. spec.name .. ": "
  assert(spec.tag == nil or (type(spec.tag) == "string" and spec.tag ~= ""), where .. "tag must be a name")
  assert(spec.folder == nil or type(spec.folder) == "string", where .. "folder must be a string")
  assert(spec.template == nil or type(spec.template) == "string", where .. "template must be a page name")
  assert(spec.title == nil or type(spec.title) == "string", where .. "title must be a string")
  assert(spec.properties == nil or type(spec.properties) == "table", where .. "properties must be a list")
  assert(spec.order == nil or type(spec.order) == "table", where .. "order must be a list")
  for _, o in ipairs(spec.order or {}) do
    assert(type(o) == "string", where .. "order entries must be strings")
  end

  local properties = {}
  local schema = {}
  local seen = {}
  for i, p in ipairs(spec.properties or {}) do
    assert(type(p) == "table" and type(p.key) == "string" and p.key ~= "",
      where .. "property " .. i .. " needs a key")
    assert(propertyTypes[p.type],
      where .. "property " .. p.key .. " has an unknown type " .. tostring(p.type)
        .. " (text, select, date, number, boolean, page)")
    assert(p.key ~= "tags", where .. "property key 'tags' is reserved (it holds the tag)")
    assert(not seen[p.key], where .. "property " .. p.key .. " is declared twice")
    seen[p.key] = true
    local entry = { key = p.key, type = p.type }
    if p.type == "select" then
      assert(type(p.options) == "table" and #p.options > 0,
        where .. "select property " .. p.key .. " needs options")
      entry.options = listOrNil(p.options)
    end
    if p.label ~= nil then
      assert(type(p.label) == "string", where .. "property " .. p.key .. ": label must be a string")
      entry.label = p.label
    end
    if p.default ~= nil then
      local d = p.default
      local what = where .. "property " .. p.key .. ": default "
      if p.type == "number" then
        assert(type(d) == "number", what .. "must be a number")
      elseif p.type == "boolean" then
        assert(type(d) == "boolean", what .. "must be true or false")
      else
        assert(type(d) == "string", what .. "must be a string")
      end
      if p.type == "select" then
        local found = false
        for _, o in ipairs(p.options) do
          if o == d then found = true end
        end
        assert(found, what .. "must be one of the options")
      end
      entry.default = d
    end
    properties[i] = entry
    schema[p.key] = propertySchema(entry)
  end

  local folder = spec.folder or (spec.name .. "/")
  if folder ~= "" and folder:sub(-1) ~= "/" then folder = folder .. "/" end
  local tagName = spec.tag or spec.name

  config.set({"databases", spec.name}, {
    name = spec.name,
    tag = tagName,
    folder = folder,
    template = spec.template,
    title = spec.title,
    properties = listOrNil(properties),
    order = spec.order and listOrNil(spec.order) or nil,
  })
  -- tag.define replaces a tag's schema wholesale: start from the one the tag
  -- has (a builtin's, or another database's on the same tag) and add ours.
  local merged = { type = "object", properties = {} }
  local existing = config.get({"tags", tagName, "schema"}, nil)
  if type(existing) == "table" then
    for k, v in pairs(existing) do merged[k] = v end
    local props = {}
    if type(existing.properties) == "table" then
      for k, v in pairs(existing.properties) do props[k] = v end
    end
    merged.properties = props
  end
  for k, v in pairs(schema) do merged.properties[k] = v end
  tag.define {
    name = tagName,
    schema = merged,
  }
end

-- The text of a template with its ${...} expanded; ctx's fields are in scope.
function database.expandTemplate(text, ctx)
  return template.new(text, false)(ctx or {})
end

-- The names of the defined databases, sorted.
function database.list()
  local names = {}
  for name, _ in pairs(config.get({"databases"}, {})) do
    names[#names + 1] = name
  end
  table.sort(names)
  return names
end

-- A string with backslashes and double quotes escaped, in double quotes.
local function quote(text)
  local escaped = string.gsub(text, "\\", "\\\\")
  escaped = string.gsub(escaped, '"', '\\"')
  return '"' .. escaped .. '"'
end

-- A YAML scalar: plain when it is plain, else double-quoted.
local function yamlScalar(text)
  if text:match("^[%w_%-]+$") then return text end
  return quote(text)
end

local fence = string.rep("`", 3)

function database.viewBlock(name, view)
  view = view or "table"
  assert(view == "table" or view == "board" or view == "calendar",
    "database.viewBlock: view must be table, board or calendar")
  return fence .. "db\ndatabase: " .. yamlScalar(name) .. "\nview: " .. view .. "\n" .. fence .. "\n"
end

function database.defineSnippet(name)
  local quoted = quote(name)
  return fence .. "space-lua\n"
    .. "database.define {\n"
    .. "  name = " .. quoted .. ",\n"
    .. "  properties = {\n"
    .. '    { key = "status", type = "select", options = {"active", "someday", "done"}, default = "active" },\n'
    .. '    { key = "due", type = "date" },\n'
    .. "  },\n"
    .. "}\n"
    .. fence .. "\n"
end
```
