#meta

A Notion-style page header: a cover image and a large icon above the page, driven by the page's `pageDecoration` frontmatter:

```yaml
pageDecoration:
  icon: 📚
  cover: Images/desk.jpg   # a file in the space, or an https:// URL
```
A page with neither shows no header, apart from the folder line on a phone (below). The icon is the same `pageDecoration.icon` the tree, the top bar and links already use, and it takes an emoji, a Feather name or an SVG; only an emoji is drawn large here.

The cover is 180 px tall (120 px on a phone) with rounded corners; a large icon sits on its lower edge, overlapping it by 24 px. When the page lives in a folder, a quiet _Projects ›_ line sits above the header (a quick note, which the top bar titles _Quick note · 11:17_, gets its day: _2026-10-02 ›_). The top bar already shows that trail on a wide screen, so the line only appears on a phone, where the top bar leaves it out to give the page name the room.

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

-- "Projects/Plans/Spring Launch" -> "Projects › Plans ›", or nil for a page at the top level.
-- A quick note ("Inbox/2026-10-02/11-17-18") is titled "Quick note · 11:17" by the top bar, with
-- the day as the dim part: the trail here says the same, "2026-10-02 ›", not the path.
function pageHeader.crumb(page)
  page = tostring(page or "")
  local day = string.match(page, "^.*/(%d%d%d%d%-%d%d%-%d%d)/%d%d%-%d%d%-%d%d$")
  if day then
    return day .. " ›"
  end
  local folder = string.match(page, "^(.*)/[^/]+$")
  if not folder or folder == "" then
    return nil
  end
  return string.gsub(folder, "/", " › ") .. " ›"
end

function pageHeader.markdown()
  -- Read from the text, not from the page's object: space.getPageMeta carries
  -- no frontmatter, and the index can lag behind an edit.
  local page = editor.getCurrentPage()
  if not page then
    return nil
  end
  local decoration = pageHeader.decoration()
  local lines = {}
  local crumb = pageHeader.crumb(page)
  local hasCover = type(decoration.cover) == "string" and decoration.cover != ""
  local hasIcon = isEmoji(decoration.icon)
  -- Always written: the style below hides it from 601 px up, where the top bar carries the
  -- trail, so a resize or a rotation needs no new render.
  if crumb then
    table.insert(lines, '<span class="sb-page-crumb">' .. crumb .. "</span>")
  end
  if hasCover then
    local src = decoration.cover
    if not isUrl(src) then
      -- The renderer resolves a space path itself (to /.fs/...): no leading slash.
      src = string.gsub(src, "^/+", "")
    end
    table.insert(lines, "![cover](" .. src .. ")")
  end
  if hasIcon then
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

/* The markdown renderer wraps each paragraph in span.p and separates them with <br>: the
   spacing here is set by margins instead. */
.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) .wrapper > br {
  display: none;
}

.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) .wrapper > span.p {
  display: block;
}

.sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) img[alt="cover"] {
  display: block;
  width: 100%;
  height: 180px;
  object-fit: cover;
  border-radius: var(--sb-radius-2, 8px);
}

/* #sb-main: the editor's own widget typography is scoped under it. */
#sb-main .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) h1 {
  margin: 0.2em 0 0;
  font-size: 64px;
  line-height: 1.1;
}

/* the icon sits on the cover's lower edge, 24 px of it over the picture */
#sb-main .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) span.p:has(> img[alt="cover"]) ~ h1 {
  position: relative;
  margin-top: -24px;
  margin-bottom: 12px;
  padding-left: 16px;
}

/* the folder trail above the header: dim, small, and only where the top bar leaves it out */
#sb-main .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) .sb-page-crumb {
  display: block;
  margin-bottom: 8px;
  font-size: 12.5px;
  color: var(--sb-ink-2, var(--subtle-color));
}

@media (max-width: 600px) {
  .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) img[alt="cover"] {
    height: 120px;
  }
}

@media (min-width: 601px) {
  #sb-main .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]) span.p:has(> .sb-page-crumb) {
    display: none;
  }

  /* a header that is only the crumb has nothing left to show here: no empty frame */
  #sb-main .sb-page-widget:has(.sb-page-widget-fold[title$=" Page header"]):not(:has(img[alt="cover"], h1)) {
    display: none;
  }
}
```
