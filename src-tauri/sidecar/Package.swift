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
            path: "Sources/projectlens-ai-sidecar"
        )
    ]
)
