import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, test } from "vitest";
import { extractSpaceLuaFromPageText } from "../boot_config.ts";
import { evalStatement } from "./eval.ts";
import { parseBlock } from "./parse.ts";
import { LuaEnv, LuaStackFrame } from "./runtime.ts";
import { luaBuildStandardEnv } from "./stdlib.ts";

// Everything the library touches outside the standard library is stubbed in Lua, so each
// case below is one Lua chunk: stubs, then the library, then the assertions.
const PRELUDE = `
schemas = {}
databases = {}
config = {
  define = function(key, schema) schemas[key] = schema end,
  set = function(path, value)
    assert(path[1] == "databases", "config.set path " .. tostring(path[1]))
    databases[path[2]] = value
  end,
  get = function(path, default)
    if path[1] == "tags" then
      local t = tagsDefined[path[2]]
      return t and t.schema or default
    end
    if #path == 1 then return databases end
    return databases[path[2]] or default
  end,
}
tagsDefined = {}
tag = { define = function(spec) tagsDefined[spec.name] = spec end }
`;

let librarySource = "";

beforeAll(async () => {
  const page = await readFile(
    new URL("../../libraries/Library/Std/APIs/Database.md", import.meta.url),
    "utf8",
  );
  librarySource = extractSpaceLuaFromPageText(page);
});

async function runLua(testBody: string) {
  const env = new LuaEnv(luaBuildStandardEnv());
  const block = parseBlock(`${PRELUDE}\n${librarySource}\n${testBody}`);
  const frame = LuaStackFrame.createWithGlobalEnv(env, block.ctx);
  await evalStatement(block, env, frame);
}

describe("Database library", () => {
  test("expandTemplate expands a text with the context in scope", async () => {
    await runLua(`
      -- template.new is the real one's shape: (text, stripIndent) -> fn(env)
      local seen
      template = { new = function(text, strip)
        seen = strip
        return function(env)
          return (string.gsub(text, "%$%{(%w+)%}", function(k) return env[k] end))
        end
      end }
      local out = database.expandTemplate("# \${title} in \${database}", { title = "Launch", database = "projects" })
      assert(out == "# Launch in projects", out)
      -- indentation is kept: a template's body is not a code block to dedent
      assert(seen == false, "stripIndent must be off")
      assert(database.expandTemplate("plain") == "plain")
    `);
  });

  test("declares the databases config and the define function", async () => {
    await runLua(`
      assert(schemas.databases.type == "object", "databases schema")
      assert(type(database.define) == "function")
    `);
  });

  test("define stores the normalized spec and declares the tag's schema", async () => {
    await runLua(`
      database.define {
        name = "projects",
        tag = "project",
        folder = "Projects",
        template = "Templates/Project",
        title = "Projects",
        properties = {
          { key = "status", type = "select", options = {"active", "done"}, default = "active", label = "Status" },
          { key = "due", type = "date" },
          { key = "area", type = "page" },
          { key = "n", type = "number" },
          { key = "flag", type = "boolean" },
        },
        order = {"active", "done"},
      }
      local d = databases.projects
      assert(d.name == "projects" and d.tag == "project", "name and tag")
      assert(d.folder == "Projects/", "folder gets its slash: " .. d.folder)
      assert(d.template == "Templates/Project" and d.title == "Projects")
      assert(#d.properties == 5, "all properties kept, in order")
      assert(d.properties[1].key == "status" and d.properties[1].type == "select")
      assert(d.properties[1].options[2] == "done" and d.properties[1].default == "active")
      assert(d.properties[1].label == "Status")
      assert(d.properties[2].key == "due" and d.properties[2].options == nil)
      assert(d.order[1] == "active" and d.order[2] == "done")

      local t = tagsDefined.project
      assert(t, "tag.define was called for the tag")
      local p = t.schema.properties
      assert(t.schema.type == "object")
      assert(p.status.type == "string" and p.status.enum[1] == "active" and p.status.enum[2] == "done")
      assert(p.due.type == "string" and p.area.type == "string")
      assert(p.n.type == "number" and p.flag.type == "boolean")
    `);
  });

  test("the tag and folder default to the name; no properties is none", async () => {
    await runLua(`
      database.define { name = "notes" }
      local d = databases.notes
      assert(d.tag == "notes" and d.folder == "notes/", d.folder)
      assert(d.properties == nil and d.order == nil and d.template == nil)
      assert(tagsDefined.notes, "tag declared under the name")
      database.define { name = "loose", folder = "" }
      assert(databases.loose.folder == "", "an empty folder stays empty")
    `);
  });

  test("an existing schema on the tag is merged, not replaced", async () => {
    await runLua(`
      tagsDefined.project = { name = "project", schema = {
        type = "object", required = {"a"}, properties = { old = { type = "string" }, status = { type = "number" } },
      } }
      database.define { name = "p", tag = "project", properties = { { key = "status", type = "text" }, { key = "due", type = "date" } } }
      local s = tagsDefined.project.schema
      assert(s.required[1] == "a", "other keys kept")
      assert(s.properties.old.type == "string", "old property kept")
      assert(s.properties.status.type == "string", "ours win")
      assert(s.properties.due.type == "string")
    `);
  });

  test("the spec is validated", async () => {
    await runLua(`
      local function fails(spec, what)
        local ok, err = pcall(database.define, spec)
        assert(not ok, "expected a failure: " .. what)
        assert(string.find(tostring(err), what, 1, true), tostring(err))
      end
      fails({}, "name is required")
      fails("x", "expected a table")
      fails({ name = "x", properties = { { type = "text" } } }, "needs a key")
      fails({ name = "x", properties = { { key = "k", type = "blob" } } }, "unknown type")
      fails({ name = "x", properties = { { key = "k", type = "select" } } }, "needs options")
      fails({ name = "x", properties = { { key = "k", type = "select", options = {} } } }, "needs options")
      fails({ name = "x", tag = 1 }, "tag must be a name")
      fails({ name = "x", properties = { { key = "n", type = "number", default = "a" } } }, "must be a number")
      fails({ name = "x", properties = { { key = "b", type = "boolean", default = 1 } } }, "true or false")
      fails({ name = "x", properties = { { key = "t", type = "text", default = {} } } }, "must be a string")
      fails({ name = "x", properties = { { key = "s", type = "select", options = {"a"}, default = "b" } } }, "one of the options")
      fails({ name = "x", properties = { { key = "k", type = "text" }, { key = "k", type = "date" } } }, "declared twice")
      fails({ name = "x", properties = { { key = "tags", type = "text" } } }, "reserved")
      fails({ name = "x", order = { 1 } }, "order entries")
      assert(databases.x == nil, "nothing stored on failure")
    `);
  });
});

test("the library page has the shape the embedded build expects", () => {
  expect(librarySource).toContain("function database.define");
  expect(librarySource).toContain('config.define("databases"');
});

describe("Database library helpers", () => {
  test("list names the databases, sorted", async () => {
    await runLua(`
      database.define { name = "b" }
      database.define { name = "a" }
      local names = database.list()
      assert(#names == 2 and names[1] == "a" and names[2] == "b", table.concat(names, ","))
    `);
  });

  test("viewBlock makes a db block, quoting what needs it", async () => {
    await runLua(`
      local f = string.rep("\`", 3)
      assert(database.viewBlock("projects") == f .. "db\\ndatabase: projects\\nview: table\\n" .. f .. "\\n",
        database.viewBlock("projects"))
      assert(database.viewBlock("my-notes_2", "board"):find("view: board", 1, true))
      assert(database.viewBlock("a b", "calendar"):find('database: "a b"', 1, true))
      assert(not pcall(database.viewBlock, "x", "gantt"), "an unknown view is refused")
    `);
  });

  test("defineSnippet is a space-lua block that defines the database", async () => {
    await runLua(`
      local snippet = database.defineSnippet("notes")
      local f = string.rep("\`", 3)
      assert(snippet:sub(1, 12) == f .. "space-lua", snippet)
      assert(snippet:find('name = "notes"', 1, true), snippet)
      assert(snippet:find("database.define {", 1, true))
      assert(snippet:sub(-4) == f .. "\\n")
      assert(database.defineSnippet('a"b'):find('name = "a\\\\"b"', 1, true), "quotes are escaped")
    `);
  });
});
