# Phase 2 設計: ページ階層・サイドバー

状態: 設計案(2026-10-02)。実装は未着手。開発メモの Phase 2 を、`client/navigator/` の調査結果で修正したもの。

## 1. 調査で分かったこと(計画の前提が変わる)

| 計画の記述 | 実際(upstream の現状) |
|---|---|
| frontmatter の `parent` でツリーを作る | ツリーは**ページ名のパス**で決まる(`Projects/Foo` は `Projects` の子)。`parent` は存在しない |
| ドラッグで移動(ファイル移動 + リンク書換え) | **実装済み**。`planMove`(`plug-api/ui/tree_model.ts`)→ `engine.move` → `moveByRename`(`client/navigator/views/space_tree.ts`)→ `index.renamePageCommand` / `renamePrefixCommand`。衝突検出・自分の子孫への移動拒否も入っている |
| frontmatter の `icon` | `pageDecoration.icon`(Feather 名 / SVG)が既にあり、ツリー・ピッカー・補完・リンクに出る。絵文字は未対応(要確認) |
| `cover` | 無い |
| `@` でページ/日付メンション | `@name` は **Identity(人・宛先)のメンション**(`docs/At-Mention.md`、`client/codemirror/at_mention.ts`)。ページ/日付ではない |
| 並べ替え | `pageDecoration.tree.priority`(数値、兄弟間のみ)と `tree.hide` がある。手動並べ替えの UI は無い |

結論: Phase 2 の大半は「新規実装」ではなく「既存ツリーの磨き込み + 2 つの新規要素(ページヘッダ、メンションの拡張)」になる。

## 2. 設計判断

1. **`parent` frontmatter は導入しない。** 階層の正はファイルパスのまま。理由: 「Markdown が唯一の正」「既存スペースと互換」(HANDOFF の決定事項)に反しない唯一の方法で、移動は既存の rename がリンク書換えまで面倒を見る。`parent` を足すと、パスと二重の真実ができて食い違う。
2. **アイコンは `pageDecoration.icon` を使う。** 新しいトップレベルキーは作らない。絵文字リテラルを受け付けるようにする(アイコン解決は `client/navigator/ui/icon_resolver.ts` と `client/lib/icon.ts` の周辺。要調査)。
3. **カバーは `pageDecoration.cover`(画像パス or URL)として新設する。** 画像の実体はスペース内ファイル(Phase 5 の画像ネイティブ化と同じ保存先)。
4. **並べ替えは Phase 2 では「ピン留め(priority)」まで。** 任意位置へのドラッグ並べ替えは、兄弟全員の priority を書き換える(= 多数ファイルの frontmatter 変更、git 差分が大きい)ため 2b に送る。
5. **`@` は拡張する。** Identity の補完候補にページと日付(今日・明日・昨日など)を混ぜ、ページ/日付を選ぶと `[[Page]]` / 日付リンクを挿入する。Identity のメンション(`@ada`)の意味は変えない。→ 未決事項 A。

## 3. スコープ

### 2a(最初に出す)
- **サイドバー既定表示**: `std.spaceTree` を lhs ドックに常設(既に `dock: "lhs"` 定義。起動時に開く既定を決める)。
- **アイコン**: 絵文字対応。ツリーの行・ページヘッダ・補完に反映。
- **ピン留め**: 行アクション「Pin」で `pageDecoration.tree.priority` を frontmatter に書く(上位に浮く)。
- **「Move to…」アクション**: ページピッカーで移動先フォルダを選ぶ。ドラッグが使えないタッチ端末と、キーボード操作のため(ユーザビリティ優先)。内部は既存の `moveByRename`。
- **移動の取り消し**: 移動直後の通知に「Undo」を出し、逆 rename で戻す。
- **ページヘッダ**: ページ上部(`page-top` ドック)にアイコン + タイトル + カバー。アイコン/カバーの選択 UI(ピッカー)。

### 2b(後)
- ドラッグでの任意位置への並べ替え。
- `@` メンションの拡張(未決事項 A の判断後)。

### やらない
- `parent` による階層。サイドバーの独自ツリー実装(既存を使う)。上流の navigator の全面書き換え。

## 4. UI 設計ルールへの落とし込み

UI 設計ルール(Root 階層 / Passive View / イベントの連鎖 / ステートマシンの Mediator)を、Phase 2 の新規部分に次のように適用する。

### 4.1 階層(Root 配下)

```
NavRoot(既存 nav_root.tsx)
├─ SidebarPanel
│   ├─ FilterInput
│   ├─ TreeView(既存 plug-api/ui/tree_view.tsx)
│   │   └─ RowItem(chevron / icon / label / actions)
│   └─ MoveToPicker(2a で追加)
└─ PageHeader(page-top ドック、2a で追加)
    ├─ IconButton → IconPicker
    ├─ Title
    └─ CoverImage → CoverPicker
```

### 4.2 Passive View
- 各コンポーネントは props(描画パラメータ)だけを受け取り、状態を持たない。持ってよいのは描画専用のローカル状態(hover、はみ出し計測など。既存 `RowItem` / `TrailingChips` がこの形)。
- ユーザー操作は `emit(event)` で親へ投げるだけ。`datastore` / `editor` / `system` を直接呼ばない。
- 既存の `RowItem` は概ねこの形。`tree_view.tsx` の drop ハンドラは `onMove` を呼ぶ形なので、その接点を `emit` に置き換える。

### 4.3 Chain of Responsibility
- イベントは子 → 親へバブルする。各階層は自分が扱えるものだけ処理し、残りを `next` に渡す。最上位が Mediator。
- イベント種別(案): `row.select` `row.toggle` `row.action` `drag.start` `drag.over` `drag.drop` `drag.cancel` `move.request` `move.undo` `icon.pick` `cover.pick`。
- 行レベルは `row.toggle` だけ自分で処理(展開状態)、`drag.*` と `row.action` は上へ。

### 4.4 Mediator(ステートマシン)
状態と遷移は純関数 `transition(state, event) → { state, effects }`。副作用(rename、通知、datastore 書込み)は `effects` として返し、実行は Mediator の外側。これでスナップショットなしに単体テストできる。

| 状態 | 受理するイベント → 遷移先 |
|---|---|
| Idle | `drag.start` → Dragging / `row.action(move)` → Picking / `row.action(pin)` → Idle + effect |
| Dragging | `drag.over(folder)` → Dragging(target 更新、700ms でスプリングロード)/ `drag.drop` → Moving / `drag.cancel` → Idle |
| Picking(移動先選択) | `move.request` → Moving / キャンセル → Idle |
| Moving | 完了 → Idle + 「Undo」通知 / 衝突・失敗 → Idle + エラー通知(`planMove` の collision を再利用) |
| Idle(Undo 猶予中) | `move.undo` → Moving(逆 rename)/ タイムアウト → Idle |

- 同時に 1 つの操作しか進行しない(Moving 中のイベントは破棄)。二重ドロップで二重 rename が走る事故を防ぐ。
- 既存の裁定は `tree_commands.ts` / `keyboard.ts` / `activation.ts` に分散している。Phase 2 では**新規部分から** Mediator 経由にし、既存を全面改修はしない(上流マージの衝突を避けるため)。既存との接点だけをアダプタで繋ぐ。
- Phase 1 の UI(検索パネル、グラフ)を遡って合わせるかは、引き続きオーナー判断。

### 4.5 ユーザビリティ(設計しやすさより優先する点)
- キーボードだけで全操作できる(移動・ピン・アイコン変更)。
- ドラッグ中はドロップ先をハイライトし、不可(自分の子孫・衝突)の行は視覚的に無効にする。
- 移動は必ず Undo できる。多数のリンクを書き換えるため、確認ダイアログより取り消しを優先する。
- タッチ端末ではドラッグに頼らず「Move to…」を主導線にする。

## 5. 配置と上流との距離
- 新規コードは `client/navigator/ui/mediator/`(状態機械)と `client/navigator/ui/components/`(PageHeader / Picker)に**追加**する。既存ファイルへの変更は接点のみ(`tree_view.tsx` の drop、`space_tree.ts` のアクション追加)。
- ページヘッダの置き場所(`page-top` ドック、`client/navigator/page_widget_*` と `page_slots.ts`)は、実装前に読み込んで確認する(未調査)。

## 6. 検証計画
- 単体: `transition()` を状態 × イベントの表で網羅。`planMove` の既存テストは回帰基準。
- E2E(Playwright、Phase 1 と同じ構成: コピーしたスペース + `--network host`): ドラッグ移動 → リンク書換え → Undo、Move to…、ピン、アイコン変更、カバー設定。`/srv/*` には触れない。
- 確認項目: 移動後に他ページの `[[リンク]]` が正しく書き換わる、衝突時にファイルが変わらない、Undo で元の名前・リンクに戻る、モバイル幅でのレイアウト、ダークテーマ。

## 7. リスク
- 移動は多数ページを書き換える。スペースは git 管理だが、同時編集中のページとの競合(`server-merge` の 3-way マージ)は未検証。
- 絵文字アイコンはアイコン解決の変更が要る可能性があり、上流との差分が増える。
- 日本語ページ名・長い階層でのツリー性能は未検証(数百ページ規模)。

## 8. 未決事項(オーナー判断)
- **A. `@` の拡張**: Identity とページ/日付を同じ `@` で混ぜるか、別のトリガー(例: `[[` 内の日付候補)にするか。推奨: 混ぜる(Notion の操作感に近い)。ただし Identity の補完が汚れるので、先にプレビューで確認する。
- **B. 手動並べ替えの方式**: 2b で priority の振り直しを許容するか、並べ替えは諦めてピン留めのみにするか。
- **C. Phase 1 の UI を遡って Mediator 化するか**。
