# Phase 4 設計: データベースビュー(テーブル / ボード / カレンダー)

状態: 設計確定(2026-10-02、オーナーの判断を「8. 決定」に記録)。実装は未着手。

## 1. 調査で分かったこと(計画の前提が変わる)

| 計画の記述 | 実際(upstream の現状) |
| --- | --- |
| frontmatter/タスクをテーブル表示 | **読み取り専用の表ビューが既にある**(`view.new { presentation = { mode = "table" } }`、`client/navigator/table_model.ts` / `table_view.tsx`。列の型は ref / number / boolean / url / text / markdown。boolean は無効化されたチェックボックス)。**セルの編集はできない** |
| ボード / カレンダー | **無い**。`presentation.mode` は list / tree / table のみ |
| `memo-mcp` の `list_projects` / `list_tasks` の項目を初期ビューに | 項目の定義は分かった。プロジェクト = `tags: project` のページ(`status` `due` `area` `goal` `summary` と、未完了/完了タスク数)。タスク = 行の `text` `due` `start` `completed` `tags` `done` と、ページ・行 |
| データ | SilverBullet の索引に `page`(frontmatter の属性つき)と `task`(`name` `state` `done` `page` `pos` `range` `tags`、インライン属性 `[due: ...]` など、`pageLastModified`)がある。`index.queryLuaObjects` で引ける |
| 部品を載せる場所 | **サンドボックス化したウィジェット**(`widget.sandbox { html, script }`)と、**コードウィジェット**(```` ```言語 ```` のコードブロックを Lua の `render` で描く)が使える。サンドボックスの中では `syscall(...)` が呼べて、高さは内容に合わせて自動で変わる。`plugs/object-graph/` が同じ作り(プラグが `html` + `script` を組み立てて iframe に渡す)で、テーマ用スタイルは `panelStyles()` で渡せる |

結論: 表の読み取りは既にあるので、Phase 4 の新規実装は **(1) 編集できる表、(2) ボード、(3) カレンダー、(4) 安全な書き込み(frontmatter とタスクの更新)** の 4 つ。既存の navigator の表ビューを拡張すると upstream の変更が広がる(`ViewMeta`、Lua のバリデーション、各ドックの描画)ため、**独立したプラグとして作る**。

## 2. 設計判断(私の推奨。未決は 8)

1. **新しいプラグ `plugs/db-view/`** を作る(`plugs/object-graph/` と同じ構成: `src/`(プラグ側の関数)+ `ui/`(Preact の TSX)+ `assets/`)。upstream への変更は、組込みプラグの登録 1 行(`plugs/builtin_plugs.ts`)だけ。
2. **ページに埋め込む入口は、コードブロック ```` ```db ````。** 中身は YAML で、どのデータをどう見せるかを書く。Space Lua のコードウィジェットの `render` が、プラグの関数 `db-view.render` を呼んで、`widget.sandbox { html, script }` を返す。
   ```
   ```db
   source: projects
   view: board
   group: status
   ```
   ```
3. **データの出どころ(`source`)は 3 種類。**
   - `projects`: `tags: project` のページ。列は `status` `due` `area` `goal` と、未完了・完了のタスク数。
   - `tasks`: タスク。列は本文、期限、タグ、ページ、完了。
   - `tag: <名前>`: そのタグのページ(汎用)。列は frontmatter の属性から導く。
4. **ビューは 3 種類(`view`)。**
   - `table`: 並べ替え(ヘッダのクリック)、絞り込み、**セルの編集**。
   - `board`: `group` で指定した属性(例: `status`)ごとの列にカードを並べ、**カードを列へドラッグして属性を書き換える**。
   - `calendar`: `date` で指定した属性(既定 `due`)で月表示。**カードを日付へドラッグして期限を書き換える**。月の前後移動。
5. **書き込みは Markdown の frontmatter とタスク行を直接書き換える**(Markdown が唯一の正)。
   - ページの属性: 既存の `index.patchFrontmatter` で 1 キーだけ更新(Phase 2 で直した YAML パッチャを使う)。
   - タスク: 完了の切替は、`range` の位置の `[ ]` / `[x]` を書き換える。期限は、行の `[due: ...]` を置換するか、無ければ末尾に足す。
   - **競合検出**: 各行(オブジェクト)が持つ最終更新日時(`pageLastModified`)を、書く直前のページの更新日時と比べ、違えば**書かずに**「ページが変わっています。更新してください」と出す(`memo-mcp` の `expected_modified` と同じ考え方)。タスクは、書き換える位置の文字が想定どおりかも確かめる。
6. **UI 設計ルール(Root 階層 / Passive View / Chain of Responsibility / ステートマシンの Mediator)に従う**(Phase 2・3 と同じ作り)。
   - Root(`App`)→ ヘッダ(ビュー切替、フィルタ)→ 本体(`TableView` / `BoardView` / `CalendarView`)→ 行・カード・セル。
   - 部品は props を描画し、`emit(event)` するだけ。`syscall` は呼ばない。
   - Mediator は純関数 `transition(state, event) → {state, effects}`。状態は「閲覧中 / セル編集中(行, 列) / ドラッグ中(カード, 候補の列または日) / 書込み中 / 競合」。効果は `write`(セルまたはカードの更新)、`reload`(再取得)、`navigate`、`notify`。
   - runner が効果を実行し、結果(成功 / 競合 / 失敗)をイベントとして戻す。書込み中の二重操作は無視する(同時に 1 件)。
   - 並べ替え・絞り込み・グループ化・月のグリッド計算・ドロップ先の判定・書き換えるテキストの計算は、すべて純関数にしてテストする。
7. **書き込みの失敗は元に戻す。** 画面は書き込みが成功してから更新する(楽観的に先に見せない)。失敗・競合のときは、元の値のまま通知を出す。

## 3. データ(行)の形
```ts
type DbRow = {
  id: string;          // ページ名、またはタスクの ref
  kind: "page" | "task";
  page: string;        // ページ名(タスクでは所属ページ)
  title: string;       // 表示名
  values: Record<string, unknown>;   // 属性(frontmatter、またはタスクの属性)
  modified: string;    // 最終更新日時(競合検出用)
  pos?: [number, number];  // タスクの本文範囲
  openTasks?: number;  // projects のとき
  doneTasks?: number;
};
```
`source` ごとに、プラグ側の関数がこの形に整える。画面は `DbRow` だけを知る。

## 4. セルの編集(テーブル)
- 属性の型は値から推定し、列の設定(`columns`)で上書きできる: `select`(候補つき: 例 `status` = active / someday / done)、`date`、`text`、`number`、`boolean`、`ref`。
- ダブルクリック(またはキーボードの `Enter`)で編集に入り、`Enter` で確定、`Esc` で取り消し。`select` は一覧から選ぶ。
- 確定すると `write` 効果。成功したら行を更新、競合なら通知して値を戻す。
- `name`(ページ名)の編集は対象外(リンク書換えを伴うので、ツリーの移動・名前変更を使う)。

## 5. ボード
- 列は `group` の値(出現順、または設定 `order` の順)+ 値が無いものの「(なし)」列。`status` は、既定で `active → someday → done` の順にする(`memo-mcp` の正規化に合わせる)。
- カード: タイトル(ページへのリンク)、期限(過ぎていれば強調)、`area`、タスクの進捗。
- カードを列へドラッグすると、その属性を書き換える。同じ列の中での並び順は、期限の早い順に自動で決める(手動の並べ替えは持たない)。

## 6. カレンダー
- 月のグリッド(日曜始まりか月曜始まりかは設定 `weekStart`、既定は日曜)。期限のあるカードをその日に置く。期限が無いものは「期限なし」の一覧に出す。
- カードを日付へドラッグすると、`date` の属性(既定 `due`)を書き換える。
- 前の月 / 次の月 / 今日。

## 7. 実装の順序
1. **純関数 + テスト**: 行の整形(`source` ごと)、並べ替え・絞り込み・グループ化、月のグリッド、`<due>` などの書き換えテキストの計算(frontmatter の 1 キー、タスクの完了切替と期限)。
2. **プラグ側の関数**: `db-view.render`(スペック → html + script)、`db-view.query`(再取得)、`db-view.updateCell` / `db-view.updateTask`(競合検出つきの書き込み)。
3. **Mediator と runner**(純関数 + テスト)。
4. **UI(TSX)**: テーブル(閲覧 → 並べ替え → 編集)→ ボード → カレンダー。
5. **コードウィジェットの登録と、初期ビュー**: `Projects`(ボード)と `Tasks`(テーブル)を、ページ(`Library/Std/...` の例)として用意。`Help: Fork Guide` を更新。
6. **実ブラウザでの確認**(コピーのスペースだけ。`/srv/*` には書かない)。

## 8. 決定(オーナー判断、2026-10-02)
- **A. 入口は ```` ```db ```` コードブロック。**
- **B. 書き込みは全部**(テーブルのセル編集、ボードのドラッグ=状態、カレンダーのドラッグ=期限、タスクの完了の切替)。競合検出つき。
- **C. `tasks` ソースを入れる。**
- **D. 初期ビューを用意する**(`Projects` = ボード、`Tasks` = テーブル。Library 内の例のページ)。
- **E. ボードの列の既定の順は `active → someday → done`**(`order` で上書き可。値が無いものは「(なし)」列)。推奨どおりとして進める。

## 9. リスク
- サンドボックスの iframe の中は、エディタのスタイルを引き継がない。`panelStyles()` と、ウィジェットの `theme` で合わせる(`object-graph` と同じ)。ダークテーマでの確認が要る。
- ドラッグ操作は iframe の中で完結させる(エディタ本体のドラッグとは干渉しない)。ただし、ページ内の他の操作(Phase 3 のブロックのドラッグ)との境界は実機で確認する。
- 書き込みで frontmatter を書き換えると、そのページが開かれていれば外部の変更として統合される(競合時の挙動は `server-merge` 次第。未検証)。
- タスクの位置(`range`)は、ページが編集されると古くなる。書く直前に更新日時と本文の一致を確かめ、合わなければ書かない。
- ページが多いと、一覧の取得が遅い。最初は件数の上限(既定 500)を置き、超えたら案内を出す。
