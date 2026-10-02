#meta

A Notion-style page header: a cover image and a large icon above the page, driven by the page's `pageDecoration` frontmatter:

```yaml
pageDecoration:
  icon: 📚
  cover: Images/desk.jpg   # a file in the space, or an https:// URL
```
A page with neither shows no header. The icon is the same `pageDecoration.icon` the tree, the top bar and links already use, and it takes an emoji, a Feather name or an SVG; only an emoji is drawn large here.

# Commands
* ${widgets.commandButton("Page: Set Icon")}: asks for an emoji or a Feather icon name; an empty answer removes it.
* ${widgets.commandButton("Page: Set Cover")}: pick one of the image files in the space, or choose _Enter a URL…_.
* ${widgets.commandButton("Page: Remove Cover")}

The header is a page-top view (`page.header`) and can be turned off like any other: its open state is remembered per browser, and `view.defaults` can set it for the space.

# Implementation

## Frontmatter helpers
Only top-level keys can be patched, so `pageDecoration` is rewritten as a whole, keeping every other decoration it carries (`cssClasses`, `tree`, ...). A page left with nothing loses the key.

```space-lua
-- priority: 10
pageHeader = pageHeader or {}

local function currentDecoration(text)
  local fm = index.extractFrontmatter(text).frontmatter
  local decoration = {}
  if fm and type(fm.pageDecoration) == "table" then
    for k, v in pairs(fm.pageDecoration) do
      decoration[k] = v
    end
  end
  return decoration
end

-- `value = nil` removes the key.
function pageHeader.patch(text, key, value)
  local decoration = currentDecoration(text)
  decoration[key] = value
  local empty = true
  for _ in pairs(decoration) do
    empty = false
  end
  if empty then
    return index.patchFrontmatter(text, {
      { op = "delete-key", path = "pageDecoration" },
    })
  end
  return index.patchFrontmatter(text, {
    { op = "set-key", path = "pageDecoration", value = decoration },
  })
end

function pageHeader.set(key, value)
  local text = editor.getText()
  local updated = pageHeader.patch(text, key, value)
  if updated != text then
    editor.setText(updated)
  end
end

function pageHeader.decoration()
  return currentDecoration(editor.getText())
end

function pageHeader.current(key)
  return pageHeader.decoration()[key]
end
```

## Commands
```space-lua
-- priority: 10
command.define {
  name = "Page: Set Icon",
  requireMode = "rw",
  run = function()
    local current = pageHeader.current("icon") or ""
    local answer = editor.prompt("Icon (an emoji or a Feather icon name; empty removes it):", current)
    if answer == nil then
      return
    end
    answer = string.gsub(answer, "^%s+", "")
    answer = string.gsub(answer, "%s+$", "")
    if answer == "" then
      pageHeader.set("icon", nil)
    else
      pageHeader.set("icon", answer)
    end
  end,
}

local ENTER_URL = "Enter a URL…"

command.define {
  name = "Page: Set Cover",
  requireMode = "rw",
  run = function()
    local options = { { name = ENTER_URL, orderId = 0 } }
    for _, doc in ipairs(space.listDocuments()) do
      if string.startsWith(doc.contentType or "", "image/") then
        table.insert(options, { name = doc.name, orderId = 1 })
      end
    end
    local choice = editor.filterBox("Cover image", options, "Pick an image from the space.", "Image")
    if choice == nil then
      return
    end
    local cover = choice.name
    if cover == ENTER_URL then
      cover = editor.prompt("Cover image URL:", pageHeader.current("cover") or "https://")
      if cover == nil or cover == "" then
        return
      end
    end
    pageHeader.set("cover", cover)
  end,
}

command.define {
  name = "Page: Remove Cover",
  requireMode = "rw",
  run = function()
    pageHeader.set("cover", nil)
  end,
}
```

## The view
```space-lua
-- priority: 10
local function isUrl(s)
  return string.startsWith(s, "http://") or string.startsWith(s, "https://")
end

-- An icon written with letters only is a Feather name: the tree and the top
-- bar draw those, the header only draws an emoji (or any other non-ASCII glyph).
local function isEmoji(s)
  return type(s) == "string" and s != "" and string.find(s, "^[%w%-:%s]+$") == nil
    and string.find(s, "^%s*<svg") == nil
end

function pageHeader.markdown()
  -- Read from the text, not from the page's object: space.getPageMeta carries
  -- no frontmatter, and the index can lag behind an edit.
  if not editor.getCurrentPage() then
    return nil
  end
  local decoration = pageHeader.decoration()
  local lines = {}
  if type(decoration.cover) == "string" and decoration.cover != "" then
    local src = decoration.cover
    if not isUrl(src) then
      -- The renderer resolves a space path itself (to /.fs/...): no leading slash.
      src = string.gsub(src, "^/+", "")
    end
    table.insert(lines, "![cover](" .. src .. ")")
  end
  if isEmoji(decoration.icon) then
    table.insert(lines, "# " .. decoration.icon)
  end
  if #lines == 0 then
    return nil
  end
  return table.concat(lines, "\n\n")
end

view.define {
  name = "page.header",
  title = "Page header",
  dock = "page-top",
  defaultOpen = true,
  refreshOn = { "editor:pageLoaded", "page:saved" },
  content = function()
    return pageHeader.markdown()
  end,
}
```

## Style
The view is framed like any page widget. Here the frame is dropped: no border, and the title bar (fold, dock menu, ×) only shows while the pointer is over the header.

```space-style
/* The widget is found by its fold button's title: the frame names no view. */
.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) {
  position: relative;
  border: none;
}

.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) .sb-page-widget-bar {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  opacity: 0;
  border-radius: 4px;
  transition: opacity 0.15s;
}

.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]):hover .sb-page-widget-bar,
.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]):focus-within .sb-page-widget-bar {
  opacity: 1;
}

.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) .sb-page-widget-body {
  padding: 0;
}

.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) img[alt="cover"] {
  display: block;
  width: 100%;
  height: 200px;
  object-fit: cover;
  border-radius: 6px;
}

/* #sb-main: the editor's own widget typography is scoped under it. */
#sb-main .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) h1 {
  margin: 0.2em 0 0;
  font-size: 3rem;
  line-height: 1.1;
}
```
