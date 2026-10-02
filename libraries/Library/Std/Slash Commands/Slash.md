#meta

Some convenient slash commands for editing Markdown files.

```space-lua
-- priority: 10

local function headerSlashCommand(level)
  local line = editor.getCurrentLine()
  local cleanText = string.gsub(line.textWithCursor, "^#+%s*", "")
  editor.replaceRange(line.from, line.to,
    string.rep("#", level) .. " " .. cleanText, true)
end

slashCommand.define {
  name = "h1",
  run = function()
    headerSlashCommand(1)
  end
}

slashCommand.define {
  name = "h2",
  run = function()
    headerSlashCommand(2)
  end
}

slashCommand.define {
  name = "h3",
  run = function()
    headerSlashCommand(3)
  end
}

slashCommand.define {
  name = "h4",
  run = function()
    headerSlashCommand(4)
  end
}

slashCommand.define {
  name = "frontmatter",
  run = function()
    editor.insertAtPos([==[---
|^|
---
]==], 0, true)
  end
}

slashCommand.define {
  name = "task",
  run = function()
    local line = editor.getCurrentLine()
    local ws, prefix, rest = string.match(line.textWithCursor, "^(%s*)([%-%*]?)%s*(.+)$")
    editor.replaceRange(line.from, line.to, ws .. "* [ ] " .. rest, true)
  end
}

slashCommand.define {
  name = "space-lua",
  description = "Insert Space Lua script",
  run = function()
    editor.insertAtCursor([==[```space-lua
|^|
```]==], false, true)
  end
}

-- Block commands: turn the current line into another kind of block. A line
-- keeps its text and loses the marker of the kind it was.
local function blockSlashCommand(marker)
  local line = editor.getCurrentLine()
  local ws, rest = string.match(line.textWithCursor, "^(%s*)(.*)$")
  rest = string.gsub(rest, "^#+%s+", "")
  rest = string.gsub(rest, "^[%-%*%+]%s+%[.%]%s+", "")
  rest = string.gsub(rest, "^[%-%*%+]%s+", "")
  rest = string.gsub(rest, "^%d+[%.%)]%s+", "")
  rest = string.gsub(rest, "^>%s*", "")
  editor.replaceRange(line.from, line.to, ws .. marker .. rest, true)
end

slashCommand.define {
  name = "bullet",
  description = "Bulleted list item",
  run = function()
    blockSlashCommand("- ")
  end
}

slashCommand.define {
  name = "numbered",
  description = "Numbered list item",
  run = function()
    blockSlashCommand("1. ")
  end
}

slashCommand.define {
  name = "quote",
  description = "Quote",
  run = function()
    blockSlashCommand("> ")
  end
}

slashCommand.define {
  name = "image",
  description = "Insert an image",
  run = function()
    editor.insertAtCursor("![|^|]()", false, true)
  end
}

slashCommand.define {
  name = "page-link",
  description = "Link to a page",
  run = function()
    editor.insertAtCursor("[[|^|]]", false, true)
  end
}

slashCommand.define {
  name = "date",
  description = "Link to today's journal page",
  run = function()
    local prefix = config.get("journal.prefix", "Journal/")
    editor.insertAtCursor("[[" .. prefix .. os.date("%Y-%m-%d") .. "]]", false, true)
  end
}
```
