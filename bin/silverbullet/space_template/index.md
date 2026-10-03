Your notes live here as Markdown files. Start with one of these.

${widgets.commandButton("Quick note", "Quick Note")} ${widgets.commandButton("Today's journal", "Journal: Today")} ${widgets.button("Search", function()
  local commands = system.listCommands()
  editor.invokeCommand(commands["Search: Notes"] and "Search: Notes" or "Memo: Search")
end)}

${(function()
  -- Phones have no keyboard shortcuts to learn; the buttons above are the way in.
  if editor.isMobile() then return "" end
  local commands = system.listCommands()
  local search = commands["Search: Notes"] or commands["Memo: Search"]
  local key = search and search.key
  if type(key) == "table" then key = key[1] end
  local hint = "`Ctrl-q q` quick note, `Ctrl-q j` today's journal"
  if key then hint = hint .. ", `" .. key .. "` search" end
  return "_" .. hint .. ". The ? button in the header opens the guide._"
end)()}

# Due soon
${some(query[[
  from t = index.tasks()
  where not t.done and t.due
    and not string.find(t.page, "^Templates/")
    and not string.find(t.page, "^Library/")
    and not string.find(t.page, "^Trash/")
  order by t.due
  limit 10
  select templates.taskItem(t)
]]) or "_Nothing due. Tasks you write as `* [ ]` anywhere show up here._"}

# Projects
${(function()
  local defined = false
  for _, name in ipairs(database.list()) do
    if name == "projects" then defined = true end
  end
  if not defined then
    return "Projects can be a database: pages with a Status, a Due date and an Area that you see as a table, a board or a calendar."
  end
  local body = "database: projects\nview: table\nwhere:\n  status: active\nsort: due\nlimit: 5\n"
  local w = system.invokeFunction("db-view.render", body, editor.getCurrentPage())
  return widget.sandbox { html = w.html, script = w.script, markdown = body }
end)()}

${(function()
  for _, name in ipairs(database.list()) do
    if name == "projects" then return "" end
  end
  return widgets.button("Create the Projects database", function()
    local commands = system.listCommands()
    editor.invokeCommand(commands["Database: New Database"] and "Database: New Database" or "Database: Define in CONFIG")
  end)
end)()}

# Inbox
${some(query[[
  from p = index.subPages("Inbox")
  order by p.lastModified desc
  limit 10 select templates.fullPageItem(p)
]]) or "_No quick notes yet. A quick note is saved to Inbox as you type._"}

# Recent journal entries
${some(query[[
  from j = index.pages(config.get("journal.tag"))
  where j.tag == "page"
  order by j.date desc
  limit 7
  select templates.pageItem(j)
]]) or "_No journal entries yet. Today's journal starts one._"}

# Recently modified pages
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 10
  select templates.fullPageItem(p)
]]}
