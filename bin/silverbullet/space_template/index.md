Welcome to BlackBullet 👋

This is your space. Every page is a plain Markdown file in your notes folder, so nothing is locked in: edit the files with any tool, keep them in git, back them up like any other folder.

A few things to try:
* Type `/` on an empty line to insert a block (heading, task, table, database view, …).
* Press `Ctrl-q q` (`Cmd-q q` on macOS) for a quick note; it lands in `Inbox/` and shows up below.
* Press `Ctrl-q j` for today's journal page.
* Press `Ctrl-Shift-f` to search everything (meaning-based as well as word-based), and open the ? button in the header for the guide.
* Link pages with `[[Page name]]`; the graph and the related-notes panel use those links.

This page is only a starting point. Change it, or delete it entirely.

# Recent quick notes
${widgets.commandButton("Create quick note", "Quick Note")}

${some(query[[
  from p = index.subPages("Inbox")
  order by p.lastModified desc
  limit 10 select templates.fullPageItem(p)
]]) or "_No quick notes yet!_"}

# Recent journal entries
${widgets.commandButton("Today's entry", "Journal: Today")}

${some(query[[
  from j = index.pages(config.get("journal.tag"))
  where j.tag == "page"
  order by j.date desc
  limit 14
  select templates.pageItem(j)
]]) or "_No journal entries yet!_"}

# Recent incomplete tasks
${some(query[[
  from t = index.tasks()
  where not t.done
  order by t.pageLastModified
  desc limit 10
  select templates.taskItem(t)
]]) or "_All tasks done!_"}

# Recently modified pages
${query[[
  from p = index.contentPages()
  order by p.lastModified desc
  limit 10
  select templates.fullPageItem(p)
]]}
