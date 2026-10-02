#meta/api

A library to easily build DOM objects through the magic of Lua meta tables.

# Usage

```lua
-- any HTML tag can be used here
dom.span {
  -- tag attributes can be set like this:
  class = "my-class",
  id = "my-id",
  -- Plain text body elements can be added like this (rendered as markdown)
  "Span content",
  -- Use __rawText to add plain text without markdown processing
  __rawText = "1. This won't become a list",
  -- And elements can be nested
  dom.strong { "I am strong" },
  -- Widgets can also be embedded
  widget.html "<b>Bold</b>",
  widget.html(dom.marquee { "nested widget" })
}
```

# Examples
${widget.html(dom.marquee{
  "I'm in a ",
  dom.span {
    style="color:red;",
    "marquee"
  }
})}

# Implementation
```space-lua
-- priority: 50

local function appendHtmlNode(parent, html)
  local htmlNode = js.window.document.createElement("dummy")
  parent.appendChild(htmlNode)
  htmlNode.outerHTML = html
end

dom =  setmetatable({}, {
  __index = function(self, tag)
    return function(spec)
      local node = js.window.document.createElement(tag)
      for key, val in pairs(spec) do
        if type(key) == "string" then
          if key == "__rawText" then
            node.appendChild(js.window.document.createTextNode(val))
          elseif key:startsWith("on") then
            node.addEventListener(key:sub(3), val)
          else
            node.setAttribute(key, val)
          end
        elseif type(val) == "string" then
          appendHtmlNode(node, markdown.markdownToHtml(val, {expand=true}))
        else
          if val._isWidget then
            if type(val.html) == "string" then
              appendHtmlNode(node, val.html)
            else
              node.appendChild(val.html)
            end
          else
            node.appendChild(val)
          end
        end
      end
      return node
    end
  end
})
```
