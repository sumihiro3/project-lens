// swift-tools-version: 6.0
//
// ProjectLens AI sidecar
//
// macOS 26 (Tahoe) 以降の FoundationModels フレームワークを用いて、課題1件の
// guided generation（@Generable）による構造化分析を行う常駐プロセス。
// Tauri 本体（Rust）から externalBin として同梱され、JSON Lines over
// stdin/stdout で通信する。詳細な入出力契約は README.md と Sources の main.swift を参照。
//
// ビルド要件: Xcode 26 以上 / macOS 26 SDK（FoundationModels を含む）。
// 検証機が無い場合は `swift build` の成功と入出力契約の明文化までを完了条件とする。
//
// v0.4: 埋め込み生成（multilingual-e5-small / Core ML）を追加。
//   - Core ML（CoreML フレームワーク）は Apple 同梱のため SwiftPM 依存の追加は不要。
//     mlx-swift のような外部パッケージを足さない方針（配布・ビルドの単純さと ANE 活用を優先）。
//   - 埋め込みモデル本体（`Resources/MultilingualE5Small.mlmodelc`）はサイズが大きい（NFR-V04-004:
//     配布 100〜250MB 増）ため、リポジトリには commit せず別手順で配置する（README.md 参照）。
//     `Resources/` ディレクトリ自体を `.copy` で同梱対象に登録することで、モデルを後から
//     置くだけで `Bundle.module` 経由で解決できるようにする（未配置でも `swift build` は成功する）。

import PackageDescription

let package = Package(
    name: "projectlens-ai-sidecar",
    platforms: [
        // FoundationModels は macOS 26 で導入される。AI 機能の対象環境（NFR-V03-002）に合わせる。
        .macOS("26.0")
    ],
    targets: [
        .executableTarget(
            name: "projectlens-ai-sidecar",
            path: "Sources/projectlens-ai-sidecar",
            // 埋め込みモデルを置くための Resources ディレクトリを同梱対象に登録する。
            // ディレクトリごと .copy することで、モデル（.mlmodelc）や語彙ファイルを後から
            // 追加するだけで `Bundle.module` から解決できる（モデル未配置でもビルドは通る）。
            resources: [
                .copy("Resources")
            ]
        )
    ]
)
