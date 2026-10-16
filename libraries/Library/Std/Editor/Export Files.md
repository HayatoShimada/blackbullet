#meta

Export a page as a file: **PDF**, **Word** (.docx), or **Markdown with images** (a .zip of the page and the images it shows). Pick one from ${widgets.commandButton("Export: Page Or Selection")} (`Ctrl-e`; a selection exports only the selection), from the tree's row menu (**Export…**), or run ${widgets.commandButton("Export: PDF")}, ${widgets.commandButton("Export: Word")} or ${widgets.commandButton("Export: Markdown with Images")}.

Queries and transclusions are written out as their results. PDF and Word are made by the search sidecar (`memoSidecar`), which must be running; the .zip is made in the browser.

```space-lua
-- priority: 10
local function exporter(format, name, description)
  service.define {
    selector = "export",
    match = { name = name, description = description, priority = 5 },
    run = function(data)
      system.invokeFunction("export.exportPage", format, data)
    end
  }
end

exporter("pdf", "File: PDF", "For reading and printing")
exporter("docx", "File: Word", "To edit in Word (.docx)")
exporter("zip", "File: Markdown with Images", "The page and its images in a .zip")
```
