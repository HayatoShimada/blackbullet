---
tags: meta
description: このフォークで追加された操作とコマンドの一覧と使い方
---

このフォークで追加された操作の使い方です。ヘッダー右端の「?」ボタン、または ${widgets.commandButton("Help: Fork Guide")} で、いつでもこのページを開けます。

# ツリー(左のサイドバー)
`Ctrl-o`(Mac は `Cmd-o`)で開閉します。標準で起動時に開きます。

| やりたいこと | 操作 |
| --- | --- |
| ページを別のフォルダへ移動 | 行の左端の「⠿」(ホバーで表示)をつかんで、フォルダの上へドロップ。リンクも自動で書き換わります |
| 同じフォルダ内で並べ替え | 「⠿」をつかんで、兄弟の行の上端または下端へドロップ(挿入ラインが出ます) |
| 移動先を選んで移動 | 行の右側のアイコン「Move to…」から、フォルダを選ぶ(タッチ端末はこちら) |
| 先頭に出す | 行の右側のアイコン「Pin」。外すときは「Unpin」(名前順に戻ります) |
| 直前の移動・並べ替えを取り消す | コマンド `Tree: Undo Move`(実行から 8 秒以内。下のボタンからも実行できます) |
| 名前を変える / 削除 | 行の右側のアイコン |
| フォルダの中に新しいページ | フォルダ行の「+」 |

* ${widgets.commandButton("Tree: Undo Move")}
* 並べ替えは、同じフォルダの中だけです。別のフォルダの行へドロップすると、移動になります。
* 並び順は、各ページの frontmatter の `pageDecoration.tree.priority`(数が大きいほど上)で決まります。並べ替えると、関係するページの frontmatter が書き換わります。
* ページを持たないフォルダ、文書(画像など)、読取専用のページは順序を持てません。それが邪魔で置けない位置は、理由が表示されて何も変わりません。
* 検索ボックスで絞り込んでいる間は、並べ替えできません。

# ページのヘッダ(アイコンとカバー)
ページの上に、カバー画像と大きなアイコンを表示します。どちらも無いページには何も出ません。

* ${widgets.commandButton("Page: Set Icon")}: 絵文字(例: 📚)か Feather のアイコン名。空にすると外します。
* ${widgets.commandButton("Page: Set Cover")}: スペース内の画像から選ぶか、URL を入力します。
* ${widgets.commandButton("Page: Remove Cover")}

frontmatter に直接書くこともできます:

```yaml
pageDecoration:
  icon: 📚
  cover: Images/desk.jpg
```

ヘッダのバー(折りたたみ・×)は、ヘッダにマウスを載せたときだけ出ます。

# 本文のブロック操作
本文の各ブロック(段落、見出しの節、リスト項目、引用、コード、表など)の左の余白に、操作の目印が出ます(ホバーで表示)。表示できる幅が必要なので、エディタの幅が約 880px 以上のときだけ出ます。

| やりたいこと | 操作 |
| --- | --- |
| ブロックを移動 | 行の左の「⠿」をつかんで、移動先の行の間へドロップ(挿入ラインが出ます)。`Ctrl-z` で元に戻ります |
| 見出しを節ごと移動 | 見出しの「⠿」をつかむ。見出しと、次の同位以上の見出しの手前までの本文が一緒に動きます |
| リスト項目を移動 | 項目の「⠿」をつかむ。子の項目も一緒に動きます |
| リストの階層を変える | 「⠿」をつかんだまま、横に動かす。右へ 1 段ぶんで 1 つ深く、左へで浅くなります(動かす前の位置が基準です) |
| 折りたたみ | 見出し・子を持つリスト項目の左の「▾」(折りたたむと「▸」)。ページを開き直すと元に戻ります(状態は保存しません) |
| やめる | ドラッグ中に `Esc` |

* 段落や見出しなどは、リストの途中には置けません(リストが分かれてしまうため)。
* リスト項目は、上の項目より 2 段以上深くはできず、下の項目より浅くもできません(下の項目が子になってしまうため)。範囲の外へ動かしても、許される深さに収まります。
* 読取専用のページでは、移動はできません(折りたたみはできます)。

## `/` でブロックを作る
行の先頭などで `/` を打つと、メニューが出ます。このフォークで加えたものです。

| 入力 | 内容 |
| --- | --- |
| `/bullet` | 箇条書き(行の既存のマーカーは置き換わります) |
| `/numbered` | 番号リスト |
| `/quote` | 引用 |
| `/image` | 画像(`![]()`) |
| `/page-link` | ページへのリンク(`[[]]`) |
| `/date` | 今日のジャーナルページへのリンク |

見出し(`/h1` 〜 `/h4`)、タスク(`/task`)、コールアウト(`/note-admonition` など)、水平線(`/hr`)、表(`/table`)は、元からあるものです。

# データベースビュー(表・ボード・カレンダー)
ページに ```` ```db ```` のコードブロックを書くと、プロジェクトやタスクを表・ボード・カレンダーで表示し、**その場で書き換え**られます。`/db` で雛形を挿入できます。例は [[Library/Std/Examples/Project Board]] と [[Library/Std/Examples/Task List]] にあります。

````
```db
source: projects
view: board
group: status
```
````

| `source` | 内容 |
| --- | --- |
| `projects` | `tags: project` のページ(`status` `due` `area` `goal` と、未完了/完了のタスク数) |
| `tasks` | タスク(本文、完了、期限、タグ、ページ) |
| `tag:<名前>` | そのタグのページ |

| ビュー | できること |
| --- | --- |
| 表(`view: table`) | ヘッダのクリックで並べ替え。セルをダブルクリックして編集(`Enter` で保存、`Esc` で取消)。タスクのチェックで完了の切替 |
| ボード(`view: board`) | `group`(既定 `status`)の値ごとの列。カードを別の列へドラッグすると、その属性を書き換える。列の順は `order`(`status` の既定は active → someday → done) |
| カレンダー(`view: calendar`) | `date`(既定 `due`)の日にカードを置く。カードを別の日へドラッグすると期限を書き換える。「日付なし」へ落とすと消える |

* 書き換えは Markdown のファイルへ直接書かれます(ページの frontmatter、またはタスクの行)。
* **表示を読んだあとにページが変わっていたら、書き込みません**(「ページが変わっています」と出て、表示を読み直します)。
* タスクで書き換えられるのは、完了と期限だけです。ページの名前・タグ・タスク数は表では編集しません。
* 設定(`columns` `where` `sort` `limit` `weekStart` など)の一覧は、ページ [[Library/Std/Editor/DB View]] にあります。
* `database.define` でデータベース(列の型・既定値・置き場)を定義すると、ビューに「+ New」が出て行を追加できます(詳細は [[Library/Std/APIs/Database]])。

# `@` で人・日付・ページを呼ぶ
本文で `@` を打つと、候補が出ます。選ぶと次のように入ります。

| 候補 | 入るもの |
| --- | --- |
| 人・宛先(`@ada` など) | `@ada`(従来どおりのメンション) |
| 日付(Today / Tomorrow / Yesterday、または `@2026-12-24` のように日付を打つ) | `[[Journal/2026-10-02]]` のような、その日のジャーナルページへのリンク |
| ページ | `[[ページ名]]`(別名があれば `[[ページ名|別名]]`) |

* 日付の「Journal/」は、設定 `journal.prefix` に従います。
* `@今日` `@明日` `@昨日` のように日本語でも絞り込めます。
* ページの候補は `[[` で出るものと同じです(更新が新しい順、別名つき)。
* frontmatter の中では、従来どおり `recipients:` 用の補完だけが出ます。

# 検索と関連ノート
検索サイドカー(`memo-mcp`)が必要です。設定は [[CONFIG]] ページに `memoSidecar` を書きます(詳細は [[Library/Std/Editor/Memo Search]])。

* ${widgets.commandButton("Memo: Search")}(`Ctrl-Shift-f` / `Cmd-Shift-f`): 見出しごとの節を検索。`Enter` でその節へ移動します。
* ${widgets.commandButton("Memo: Related Notes")}: ページ下部に、意味の近いページとリンク先を表示します。
* ${widgets.commandButton("Memo: Ask")}: 質問を入力すると、ノートの関連する節を根拠に AI が答えます(出典は `[1]` のリンク)。設定は `memoAsk {apiKey, model}`(詳細は [[Library/Std/Editor/Memo Ask]])。その質問に関係する節だけを Anthropic API に送り、秘匿(`:confidential`)スペースのノートは `memoAsk.allowConfidential = true` にしない限り送りません。
* グラフ(`Ctrl-Shift-g`): 明示リンクに加えて、意味の近いページ同士を破線でつなぎます。

# 設定

| 設定 | 内容 |
| --- | --- |
| `actionButtons` | ヘッダーのボタン。このフォークでは「?」(ヘルプ)を足してあります。自前の `actionButtons` を書くと表全体が置き換わるので、`{icon = "help-circle", description = "Help", command = "Help: Fork Guide"}` も書いてください |
| `view.defaults` | ビューごとの既定(ドック、開閉、幅)。このフォークでは `std.spaceTree` が起動時に開く既定です。自前の `view.defaults` を書くと表全体が置き換わるので、`["std.spaceTree"] = {open = true}` も書いてください |
| `memoSidecar` | 検索サイドカーの接続(`url` / `token` / `space`) |
| `memoAsk` | Memo: Ask の設定(`apiKey` / `model` / `maxTokens` / `k` / `allowConfidential`) |

# このフォークのコマンド一覧
このフォークで追加したコマンドです(登録されているものだけを、キーの割り当てとともに表示します)。

${forkGuide.commandTable()}

# 実装
```space-lua
-- priority: 10
forkGuide = forkGuide or {}

-- The commands this fork added, by name (an explicit list: the "Page:" prefix
-- is shared with upstream commands). Add a new command here to list it.
local FORK_COMMANDS = {
  "Navigate: Tree",
  "Tree: Undo Move",
  "Page: Set Icon",
  "Page: Set Cover",
  "Page: Remove Cover",
  "Memo: Search",
  "Memo: Related Notes",
  "Memo: Ask",
  "Help: Fork Guide",
}

-- A binding is a string, or a list of them.
local function keys(binding)
  if type(binding) == "table" then
    return table.concat(binding, ", ")
  end
  return binding or ""
end

function forkGuide.commandTable()
  local commands = system.listCommands()
  local rows = {}
  for _, name in ipairs(FORK_COMMANDS) do
    local def = commands[name]
    if def then
      table.insert(rows, {
        Command = name,
        Key = keys(def.key),
        Mac = keys(def.mac),
      })
    end
  end
  return rows
end

command.define {
  name = "Help: Fork Guide",
  run = function()
    editor.navigate("Library/Std/Docs/Fork Guide")
  end,
}
```
