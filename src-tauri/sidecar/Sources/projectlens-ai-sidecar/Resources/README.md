# Resources — 埋め込みモデル同梱ディレクトリ (v0.4)

ここに **multilingual-e5-small** の Core ML 版（コンパイル済み `.mlmodelc`）と語彙ファイルを置く。
`Package.swift` がこのディレクトリを `.copy("Resources")` で同梱対象に登録しているため、
ここに置いたファイルは `Bundle.module` 経由で sidecar から解決できる。

モデル本体はサイズが大きい（配布 100〜250MB 増。NFR-V04-004）ため **git には commit しない**
（`.gitignore` で `*.mlmodelc` / `*.mlpackage` を除外。この README のみ追跡する）。

## 置くファイル

| ファイル                       | 用途                                                          |
| ------------------------------ | ------------------------------------------------------------- |
| `MultilingualE5Small.mlmodelc` | コンパイル済み Core ML モデル（`main.swift` が basename で参照） |
| 語彙/トークナイザファイル      | 入力トークナイズ用（モデルの入力仕様に合わせて追加）          |

`main.swift` の `EMBEDDING_MODEL_RESOURCE`（既定 `"MultilingualE5Small"`）と basename を一致させること。

## モデルの入手と変換（手順の目安）

1. `intfloat/multilingual-e5-small`（Hugging Face）を取得する。**ライセンスは MIT**
   （intfloat / multilingual-e5-small）。配布時は LICENSE/帰属表記を同梱する（README.md 参照）。
2. `coremltools` で Core ML（`.mlpackage` → コンパイルで `.mlmodelc`）へ変換する。
   出力は `sentence_embedding`（384 次元）を返すよう mean pooling + L2 正規化を含める。
3. 生成した `.mlmodelc` と語彙ファイルをこのディレクトリに置く。
4. `main.swift` の `EmbeddingModel.embed(_:)` をモデルの入出力名に合わせて結線する
   （`input_ids` / `attention_mask` / `sentence_embedding` 等）。

モデル未配置でも `swift build` は成功し、embed 要求には
`{"type":"error","message":"embedding model not bundled ..."}` を返す
（プロトコルは成立、推論のみ degrade。NFR-V04-005）。
