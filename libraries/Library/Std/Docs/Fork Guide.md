---
tags: meta
description: BlackBullet の使い方
---

BlackBullet の使い方です。ヘッダー右端の「?」、または ${widgets.commandButton("Help: Fork Guide")} で、いつでもこのページを開けます。このページは読み取り専用で開き、ほかのページへ移ると元に戻ります(誤って書き換えないためです)。

# 用語
画面・コマンド・このガイドは、同じ言葉を使います。「English」の列は、画面に出る表記そのままです。

| 用語 | English | 意味 |
| --- | --- | --- |
| ページ | Page | 1 つの Markdown ファイル |
| フォルダ | Folder | ページをまとめる場所 |
| タグ | Tag | `#word` |
| データベース | Database | 同じプロパティを持つページの集まり |
| プロパティ | Property | 行が持つ、型のある項目 |
| 行 | Row | データベースの 1 ページ |
| ビュー | View(Table · Board · Calendar) | データベースの見え方 |
| タスク | Task | `* [ ]` の行 |
| ジャーナル | Journal: Today | 1 日 1 ページ |
| クイックノート / 受信箱 | Quick note / Inbox | すぐ書く / その置き場 |
| テンプレート | Template | New が複製するページ |
| 検索 | Search: Notes | 節ごとの検索 |
| 関連ノート | Related notes(Search: Related Notes) | 近いページ |
| グラフ | Graph | ページのつながり |
| 質問 | Ask: Notes | ノートを根拠にした答え |
| 文書 | Document | Markdown 以外のファイル |
| ゴミ箱 | Move to trash · Trash: Restore · Trash: Empty | 消す前の置き場 |
| ホーム | Home | `index` ページ |
| パネル | Panel | 端や下に開く部品 |

* ページの名前は最後のパスの部分(「Spring Launch」)で、フォルダは薄い「Projects ›」で添えます。ページを移すと、リンクも追従します。
* データベースは、1 つのフォルダに置かれ、テンプレートを持ちます。プロパティは選択・日付・ページ・数・文字のどれかで、Status・Due・Area のように使います。「+ New」は「Row in Projects…」を作ります。
* ビューは、` ```db ` ブロックです。「Save view」で、並べ替えや絞り込みをブロックへ書き戻せます。
* ジャーナルは `Journal/` の 1 日 1 ページで、「今日」が入口です。クイックノートの置き場所は `Inbox/` です。
* 関連ノートの印は、Similar・Linked・Similar · Linked の 3 つです。
* 文書(PDF・画像・Word など)は、検索と表示はできますが、編集はしません。
* UI から消したものは、まず `Trash/` へ入り、戻せます。完全な削除は、ゴミ箱の中でだけです。
* パネルは、Tree・Related notes・Ask・Search などです。

# キー
Mac では、`Ctrl-k` のように `Ctrl` で始まるキーを `Cmd` に読み替えます(`Ctrl-/` なら `Cmd-/`)。ただし「Ctrl-q」で始まるキーは、Mac でも `Ctrl-q` のままです(`Cmd-q` はブラウザの終了です)。`Ctrl-q` を押して離してから、次のキーを押します。

| やりたいこと | キー |
| --- | --- |
| 名前でページを開く | `Ctrl-k` |
| コマンドを探す | `Ctrl-/` |
| ツリーを開閉 | `Ctrl-o` |
| クイックノート | `Ctrl-q q` |
| 今日のジャーナル | `Ctrl-q j`(前の日・次の日は `Ctrl-q p` / `Ctrl-q n`) |
| 検索(Search: Notes) | `Ctrl-q s` |
| 質問(Ask: Notes) | `Ctrl-q a` |
| 関連ノートを開閉(Search: Related Notes) | `Ctrl-q r` |
| グラフ | `Ctrl-Shift-g` |
| 新規作成(New) | `Ctrl-Alt-n` |
| テンプレートから作る | `Ctrl-q t` |
| メニューや入力を閉じる・戻る | `Esc` |
| エディタからヘッダーやパネルへ出る | `Esc` のあと `Tab` |

コマンドパレットには、いまのキーがいつも表示されます。

# 書き留める
* クイックノート(`Ctrl-q q`)は、空のページを開いて、すぐ書けます。打つたびに保存されます。`Esc` で、開く前のページへ戻ります。置き場所は受信箱(Inbox)です。
* クイックノートのタイトルは、パスではなく「Quick note · 11:17」と出ます(日付は薄い「2026-10-02 ›」)。
* ジャーナル(`Ctrl-q j`)は、今日のページです。
* 受信箱は、あとで整理する場所です。ツリーからフォルダへドラッグするか、「Move to…」で移します。AI(MCP の `add_inbox`)が書き込む先も、同じ受信箱です。

# 作る(New)
ツリーの「+」と、コマンド ${widgets.commandButton("New")}(`Ctrl-Alt-n`)は、同じ一覧を同じ順序で出します。

| 項目 | できること |
| --- | --- |
| Page here | 選んでいるフォルダに、新しいページを作ります |
| Row in <データベース名>… | そのデータベースの行を、テンプレートから作って開きます(データベースごとに 1 項目) |
| Quick note | クイックノートを開きます |
| Journal: Today | 今日のジャーナルを開きます |

# ツリー(左のサイドバー)
`Ctrl-o` で開閉します。標準で起動時に開きます。行の操作は、マウスでは行にのせたときだけ、タッチでは行の「⋯」から出ます。

| やりたいこと | 操作 |
| --- | --- |
| ページを別のフォルダへ移動 | 行の左端の「⠿」(ホバーで表示)をつかんで、フォルダの上へドロップ。リンクも自動で書き換わります |
| 同じフォルダ内で並べ替え | 「⠿」をつかんで、兄弟の行の上端または下端へドロップ(挿入ラインが出ます) |
| 移動先を選んで移動 | 「⋯」の「Move to…」から、フォルダを選びます(タッチ端末はこちら) |
| 先頭に出す | 「⋯」の「Pin」。外すときは「Unpin」(名前順に戻ります) |
| 名前を変える | 「⋯」の「Rename」。このページへのリンクも更新されます |
| フォルダの中に新しいページ | フォルダの「⋯」の「New page here」、または「+」 |
| 消す | 「⋯」の「Move to trash」(一番下の赤い項目)。ゴミ箱を参照してください |
| 直前の移動・並べ替えを取り消す | コマンド `Tree: Undo Move`(実行から 8 秒以内。下のボタンからも実行できます) |

* ${widgets.commandButton("Tree: Undo Move")}
* 並べ替えは、同じフォルダの中だけです。別のフォルダの行へドロップすると、移動になります。
* 並び順は、各ページの frontmatter の `pageDecoration.tree.priority`(数が大きいほど上)で決まります。並べ替えると、関係するページの frontmatter が書き換わります。
* ページを持たないフォルダ、文書、読み取り専用のページは順序を持てません。置けない位置は、理由が表示されて何も変わりません。
* 上の入力欄(Open…)で絞り込んでいる間は、並べ替えできません。

# ゴミ箱
消す操作は、すべて「Move to trash」です。ページは `Trash/<名前>` へ移り、元の場所と日付が frontmatter(`trashedFrom` / `trashedAt`)に残ります。

* 確認のあとに移り、下に「Moved to trash」と「Undo」のボタンが 8 秒出ます。「Undo」で元の場所へ戻ります。
* 時間が過ぎたあとは、${widgets.commandButton("Trash: Restore")} で、ゴミ箱の中から選んで戻します。
* ${widgets.commandButton("Trash: Empty")} は、ゴミ箱の中を完全に消します。確認が出ます。完全な削除は、ゴミ箱の中でだけできます。
* データベースの行の「⋯」にも「Move to trash」があり、同じ場所へ移ります。ゴミ箱のページは、データベースのビューには出ません。

# ページのヘッダ(アイコンとカバー)
ページの上に、カバー画像と大きなアイコンを表示します。どちらも無いページには何も出ません。カバーは高さ 180px(スマホは 120px)で、アイコンはその下端に 24px 重なります。

* ${widgets.commandButton("Page: Set Icon")}: 絵文字(例: 📚)か Feather のアイコン名。空にすると外します。
* ${widgets.commandButton("Page: Set Cover")}: スペース内の画像から選ぶか、URL を入力します。
* ${widgets.commandButton("Page: Remove Cover")}

frontmatter に直接書くこともできます:

```yaml
pageDecoration:
  icon: 📚
  cover: Images/desk.jpg
```

ヘッダのバー(折りたたみ・×)は、ヘッダにマウスを載せたときだけ出ます。フォルダの中のページは、画面が狭いときだけ、ヘッダの上に「Projects ›」が出ます(広い画面では上のバーにあります)。

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
* 読み取り専用のページでは、移動はできません(折りたたみはできます)。

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

# データベースとビュー(Table · Board · Calendar)
ページに ```` ```db ```` のコードブロックを書くと、データベースやタスクを Table・Board・Calendar で表示し、**その場で書き換え**られます。`/db` で雛形を挿入できます。例は [[Library/Std/Examples/Project Board]] と [[Library/Std/Examples/Task List]] にあります。

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
| `database:` | `database.define` で定義したデータベース(下記) |

| ビュー | できること |
| --- | --- |
| Table(`view: table`) | ヘッダのクリックで並べ替え。編集できるセルは、ホバーで鉛筆が出ます(タッチは 1 回タップ)。`Enter` で保存、`Esc` で取消。タスクのチェックで完了の切替 |
| Board(`view: board`) | `group`(既定は、タスクならページ、データベースなら最初の選択プロパティ)の値ごとの列。カードを別の列へドラッグすると、その属性を書き換える。列の順は `order` |
| Calendar(`view: calendar`) | `date`(既定 `due`)の日にカードを置く。カードを別の日へドラッグすると期限を書き換える。「No date」へ落とすと消える |

* ヘッダは左から、タイトルと件数・Table / Board / Calendar・「Filter…」・「+ New」・「⋯」です。「⋯」に「Save view」(いまのタブ・並べ替え・絞り込みをブロックへ書き戻す)と「Reload」があります。
* 書き換えは Markdown のファイルへ直接書かれます(ページの frontmatter、またはタスクの行)。
* **表示を読んだあとにページが変わっていたら、書き込みません**(「ページが変わっています」と出て、表示を読み直します)。
* タスクで書き換えられるのは、完了と期限だけです。ページの名前・タグ・タスク数は表では編集しません。
* 期限は ISO の日付(`2026-10-14`)で書き、遅れているものには「overdue」と文字が付きます。完了したものは、遅れていても灰色です。
* 完了のチェックは、行を残したまま「Done · Undo」を 8 秒出します。「Undo」で未完了に戻ります。
* 行の「⋯」(Row actions)は、「Rename」(被リンクも更新)・「Duplicate」・「Archive」/「Unarchive」・「Move to trash」(一番下)です。アーカイブした行は、ブロックに `archived: true` を書かない限り表示されません。
* 作成日時・更新日時(`created` / `modified`)は読み取り専用の列で、`sort: -modified` のように並べ替えにも使えます。
* `where` では `{due: {before: today}}` や `status: [{not: done}, {not: someday}]` のように、等しい以外の条件(`not lt lte gt gte before after contains empty`)も書けます。
* Board の列や Calendar の日の「+」で、その列の値・その日の日付が入った行をその場で作れます。スマホではカードを長押ししてドラッグします。
* 設定(`columns` `where` `sort` `limit` `weekStart` など)の一覧は、ページ [[Library/Std/Editor/DB View]] にあります。
* ${widgets.commandButton("Database: Insert View")}(`/database`): データベースとビューを選んで `db` ブロックを挿入します。${widgets.commandButton("Database: New Row")}: 行を作ります。${forkGuide.newDatabaseButton()}: [[CONFIG]] にデータベース定義の雛形を追記して開きます。
* `database.define` でデータベース(プロパティの型・既定値・置き場・テンプレート)を定義すると、ビューに「+ New」が出て行を追加でき、New の「Row in …」にも出ます(詳細は [[Library/Std/APIs/Database]])。

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

# 検索(Search)
検索は、ページの中の見出しごとの節を、言葉と意味の両方から探します。検索サービス(`./setup.sh` が一緒に起動するもの)が要ります。設定は [[CONFIG]] ページの `memoSidecar` です(詳細は [[Library/Std/Editor/Memo Search]])。サービスが無いときも、検索の画面は開いて、何が止まっていて何をすればよいかを書き、「Open a page named … instead」で名前でページを開けます。

* ${widgets.commandButton("Search: Notes")}(`Ctrl-q s`): 検索を開きます。1 行目に件数(「9 sections for launch」)が出て、結果は `ページ › 節` と、一致した文が並びます。結果が多いときは、画面の中でスクロールします。ページは名前(パスの最後の部分)で出し、フォルダは薄く右に添えます。`Enter` でその節へ移動します。
* 検索語の頭に `in:Projects/`(`folder:` でも可)や `kind:pdf` を書くと、範囲を絞れます。入力すると、ヒントが出ます。
* PDF・Word・Excel・PowerPoint・OpenDocument・HTML の中身も検索できます(結果に `PDF p.3` のような位置が付きます)。
* ${widgets.commandButton("Search: Related Notes")}(`Ctrl-q r`): ページ下部に、関連ノート(Related notes)を出します。1 行目に件数が出て、各ページは名前(パスの最後の部分)と、薄いフォルダ、Similar(意味が近い)・Linked(リンクされている)・Similar · Linked の印で並びます。
* ${widgets.commandButton("Graph: Explore")}(`Ctrl-Shift-g`): 明示リンクに加えて、意味の近いページ(Similar pages)同士を破線でつなぎます。${widgets.commandButton("Graph: Global Page Map")} は、ページ全体の地図です。

# 質問(Ask)
${widgets.commandButton("Ask: Notes")}(`Ctrl-q a`)は、質問を入力すると、ノートの関連する節を根拠に AI が答えます。出典は `[1]` のリンクで、押すとその節へ移ります。答えのあとに、引用した出典と、送ったが引用されなかった節、入力サイズの目安が付きます。設定は `memoAsk`(詳細は [[Library/Std/Editor/Memo Ask]])です。

* 最初は、Ask の画面が「Ask needs an Anthropic API key」と書いて、「Set up Ask」を出します。${widgets.commandButton("Ask: Set up")} は、API キーとモデルを入力すると、[[CONFIG]] に書き込みます(キーは平文で保存されます)。
* 質問に関係する節だけを Anthropic API に送ります。秘匿(`:confidential`)スペースのノートは、`memoAsk.allowConfidential = true` にしない限り送りません。
* ${widgets.commandButton("Ask: Follow-up")}: 直前の答えの続きを質問します(前のやり取りの質問と答えだけを送り、前のノートは送り直しません。検索語を作り直すため、直前の質問と答えの冒頭も API に送ります)。${widgets.commandButton("Ask: New Conversation")} で会話を忘れます。
* ${widgets.commandButton("Ask: Save Answer")}: 答えを `Ask/<日付> <質問>` ページに出典つきで保存します。${widgets.commandButton("Ask: History")} で、このセッションの直近の答えを開き直せます。
* 質問の頭に `#タグ` `in:フォルダ/`(`folder:` でも可)`kind:pdf` `area:` `status:` `since:2026-01-01` を書くと、範囲を絞れます。

# スマホで使う
スマホは、書き留める・読む・チェックする・探す・ページを移す、ための道具です。ツリー(左上のボタンで開くドロワー)の上に、指 1 本で押せるボタンが 3 つ並びます。

| ボタン | できること |
| --- | --- |
| Search | 検索を開きます |
| + New | 新規作成の一覧(Page here · Row in … · Quick note · Journal: Today)を開きます |
| Journal | 今日のジャーナルを開きます |

* 行の操作は、各行の「⋯」(44px)から出ます。ドラッグの代わりに「Move to…」を使います。
* Table は、狭い画面ではカードの並びになります(名前、そのあとに「Status active · Due 2026-10-14」)。セルは 1 回タップで編集できます。
* データベースの定義、CONFIG の編集、ビューの保存、ブロックのドラッグ、グラフの探索は、パソコン向けです。

# 設定

| 設定 | 内容 |
| --- | --- |
| `actionButtons` | ヘッダーのボタン。このフォークでは「?」(ヘルプ)を足してあります。自前の `actionButtons` を書くと表全体が置き換わるので、`{icon = "help-circle", description = "Help", command = "Help: Fork Guide"}` も書いてください |
| `view.defaults` | ビューごとの既定(ドック、開閉、幅)。このフォークでは `std.spaceTree` が起動時に開く既定です。自前の `view.defaults` を書くと表全体が置き換わるので、`["std.spaceTree"] = {open = true}` も書いてください |
| `memoSidecar` | 検索サービスの接続(`url` / `token` / `space`)。`debug = true` で、検索結果に順位の数値を出します。`pdfPages = true` で、PDF の結果を `ファイル.pdf#page=N` で開きます(既定は off) |
| `memoAsk` | Ask の設定(`apiKey` / `model` / `maxTokens` / `k` / `allowConfidential` / `defaultScope` / `maxInputTokens` / `maxTurns` / `expand` / `minScoreRatio` / `instructions`) |

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
  "New",
  "Trash: Restore",
  "Trash: Empty",
  "Page: Set Icon",
  "Page: Set Cover",
  "Page: Remove Cover",
  "Search: Notes",
  "Search: Related Notes",
  "Graph: Explore",
  "Graph: Global Page Map",
  "Ask: Notes",
  "Ask: Follow-up",
  "Ask: New Conversation",
  "Ask: Save Answer",
  "Ask: History",
  "Ask: Set up",
  "Database: Insert View",
  "Database: New Row",
  "Database: Define in CONFIG",
  -- the planned name of the one above: listed once a library registers it
  "Database: New Database",
  "Help: Fork Guide",
}

-- A binding is a string, or a list of them.
local function keys(binding)
  if type(binding) == "table" then
    return table.concat(binding, ", ")
  end
  return binding or ""
end

-- The button that makes a database: whichever of its two names is registered, so the guide
-- never shows a dead button across the rename.
function forkGuide.newDatabaseButton()
  local commands = system.listCommands()
  local name = commands["Database: New Database"] and "Database: New Database" or "Database: Define in CONFIG"
  return widgets.commandButton(name)
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

-- The guide is for reading: it opens read-only (nothing to change by accident) and gives the
-- editor back as soon as another page is shown. The option lives in memory only, so it never
-- outlasts the tab. Someone who is already read-only is left as they are.
local GUIDE = "Library/Std/Docs/Fork Guide"
local guideForcedReadOnly = false

-- The first line after the frontmatter: the cursor starts outside the frontmatter, on the guide's text.
local GUIDE_TEXT_START = GUIDE .. "@L6"

-- Putting the cursor on that line scrolls it into view, which on a phone leaves the title off
-- screen and on a desktop tucks the first line under the top bar. The guide is read from the
-- top, so the scroller goes back to 0 once the page is in place (and again a moment later, when
-- the editor has settled).
local function guideToTop()
  local scroller = js.window.document.querySelector(".cm-scroller")
  if scroller then
    scroller.scrollTop = 0
  end
end

command.define {
  name = "Help: Fork Guide",
  run = function()
    editor.navigate(GUIDE_TEXT_START)
    guideToTop()
    js.window.setTimeout(guideToTop, 120)
    js.window.setTimeout(guideToTop, 400)
    if system.getMode() == "rw" and not editor.getUiOption("forcedROMode") then
      editor.setUiOption("forcedROMode", true)
      guideForcedReadOnly = true
      editor.rebuildEditorState()
    end
  end,
}

event.listen {
  name = "editor:pageLoaded",
  run = function()
    if guideForcedReadOnly and editor.getCurrentPage() != GUIDE then
      guideForcedReadOnly = false
      editor.setUiOption("forcedROMode", false)
      editor.rebuildEditorState()
    end
  end,
}
```
