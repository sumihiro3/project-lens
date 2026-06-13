// ProjectLens AI sidecar — FoundationModels guided generation 常駐プロセス
//
// 概要:
//   stdin から JSON Lines（1行=1リクエスト）を読み、種別に応じて処理し、
//   stdout に1行 JSON で結果を返す常駐プロセス。FoundationModels の
//   LanguageModelSession + @Generable による guided generation で、Rust 側の
//   `AiAnalysisOutput`（summary / risk_level / suggestion）と一致する構造化出力を生成する。
//
// 入出力契約（Rust 側 src-tauri/src/ai/mod.rs と一致させること）:
//   入力（1行 = 1 JSON オブジェクト）:
//     - 可用性チェック: {"type":"availability"}
//     - 分析:          {"type":"analyze","issue_key":"PROJ-1","summary":"...",
//                       "description_head":"...","status":"...","due_date":"2026-06-30","lang":"ja"}
//                       （due_date は省略可。description_head は Rust 側で切り詰め済み）
//     - 終了:          {"type":"shutdown"}（EOF でも終了する）
//   出力（1行 = 1 JSON オブジェクト。改行区切り）:
//     - availability: {"type":"availability","available":true,"reason":"available"}
//                     reason は available / appleIntelligenceNotEnabled / modelNotReady /
//                     deviceNotEligible / unavailableOther / unsupportedOS のいずれか
//     - analyze 成功: {"type":"result","summary":"...","risk_level":"high|medium|low","suggestion":"..."}
//     - analyze 失敗: {"type":"error","message":"..."}
//     - 入力不正:     {"type":"error","message":"..."}
//
// 設計上の注意:
//   - アイドル時（入力待ち）に CPU を消費しないよう、readLine() によるブロッキング read を用いる
//     （NFR-V03-003）。ポーリングや busy-wait は行わない。
//   - 遅延日数・期限切れ判定は LLM 出力に含めない（SQL 側で算出。FR-V03-005）。
//   - 1リクエスト=1レスポンスを厳守し、レスポンスは必ず1行 JSON（改行終端）で返す。
//
// ビルド要件と検証:
//   Xcode 26 以上 / macOS 26 SDK。検証機（macOS 26 + Apple Intelligence）が無い場合は、
//   `swift build` の成功と本ファイルが定義する入出力契約の明文化までを完了条件とする。
//   FoundationModels のモジュールが存在しない SDK では本ファイルはコンパイルできない
//   （`#if canImport(FoundationModels)` でフォールバックは設けない。AI 機能専用の sidecar であり、
//    非対応環境では Rust 側が sidecar を起動しないため）。

import Foundation
import FoundationModels

// MARK: - 構造化出力スキーマ（@Generable）

/// AI 分析の構造化出力。
///
/// FoundationModels の guided generation がこの構造に準拠した出力を保証する。
/// フィールドは Rust 側 `AiAnalysisOutput`（summary / risk_level / suggestion）と一致させる。
/// 遅延日数は SQL 側で算出するため、ここには含めない。
@Generable
struct AnalysisGeneration {
    /// 課題の1行要約。初心者にも分かる平易な日本語/英語で1文。
    @Guide(description: "One concise sentence summarizing the ticket.")
    var summary: String

    /// リスクレベル。
    @Guide(description: "Delay/escalation risk.")
    var riskLevel: GenerationRiskLevel

    /// 対応提案（次に取るべき具体的なアクション）。
    @Guide(description: "One or two sentences proposing the next concrete action.")
    var suggestion: String
}

/// 生成対象のリスクレベル列挙。
///
/// guided generation が列挙ケースのいずれかを必ず選ぶため、想定外の値が混入しない。
/// JSON 出力時は Rust 側 `RiskLevel`（serde lowercase: high / medium / low）に合わせて小文字化する。
@Generable
enum GenerationRiskLevel: String {
    case high
    case medium
    case low
}

// MARK: - JSON 入出力モデル

/// 入力リクエスト。`type` で分岐し、analyze 時のみ分析フィールドを参照する。
struct SidecarRequest: Decodable {
    let type: String
    let issueKey: String?
    let summary: String?
    let descriptionHead: String?
    let status: String?
    let dueDate: String?
    let lang: String?

    enum CodingKeys: String, CodingKey {
        case type
        case issueKey = "issue_key"
        case summary
        case descriptionHead = "description_head"
        case status
        case dueDate = "due_date"
        case lang
    }
}

/// analyze 成功時のレスポンス（Rust `AiAnalysisOutput` + 識別用 `type`）。
struct ResultResponse: Encodable {
    let type = "result"
    let summary: String
    let riskLevel: String
    let suggestion: String

    enum CodingKeys: String, CodingKey {
        case type
        case summary
        case riskLevel = "risk_level"
        case suggestion
    }
}

/// 可用性チェックのレスポンス。
struct AvailabilityResponse: Encodable {
    let type = "availability"
    let available: Bool
    let reason: String
}

/// エラーレスポンス（生成失敗・入力不正）。
struct ErrorResponse: Encodable {
    let type = "error"
    let message: String
}

// MARK: - 出力ユーティリティ

/// Encodable を1行 JSON にして stdout へ書き出し、即座にフラッシュする。
///
/// - Parameter value: 書き出すレスポンス。
/// 改行を1つだけ付与し、1リクエスト=1レスポンスの行単位契約を守る。
func writeLine<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    guard let data = try? encoder.encode(value),
        var json = String(data: data, encoding: .utf8)
    else {
        // エンコード不能時も契約を壊さないよう、最小限のエラー行を出す。
        FileHandle.standardOutput.write(Data("{\"type\":\"error\",\"message\":\"encode failed\"}\n".utf8))
        return
    }
    // JSON 内に改行が含まれることはないが、安全のため行区切りを明示する。
    json.append("\n")
    FileHandle.standardOutput.write(Data(json.utf8))
}

/// エラー行を出力する補助関数。
func writeError(_ message: String) {
    writeLine(ErrorResponse(message: message))
}

// MARK: - 可用性判定

/// SystemLanguageModel.availability を文字列の理由コードに変換する。
///
/// - Returns: (利用可能か, 理由コード) のタプル。理由コードは Rust/フロント側で
///   メッセージへマップする（FR-V03-002 の理由別表示に対応）。
func currentAvailability() -> (Bool, String) {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
        return (true, "available")
    case .unavailable(let reason):
        switch reason {
        case .appleIntelligenceNotEnabled:
            return (false, "appleIntelligenceNotEnabled")
        case .modelNotReady:
            return (false, "modelNotReady")
        case .deviceNotEligible:
            return (false, "deviceNotEligible")
        @unknown default:
            return (false, "unavailableOther")
        }
    }
}

// MARK: - 分析処理

/// 言語に応じた system 指示（instructions）を生成する。
///
/// 出力言語は UI 言語（ja/en）に追従する（FR-V03-005）。
func instructions(for lang: String) -> String {
    // instructions は guided generation のスキーマと合算してコンテキストを消費するため簡潔に保つ。
    // 出力言語の指定のみ行い、要約・リスク・提案の役割は @Generable の @Guide に委ねる。
    if lang == "en" {
        return "Analyze the project ticket. Respond in English."
    }
    // 既定は日本語。
    return "プロジェクトのチケットを分析してください。回答は日本語で行ってください。"
}

/// 1件の analyze リクエストを処理し、結果またはエラーを stdout へ書き出す。
///
/// - Parameter request: 分析リクエスト（type == "analyze"）。
/// 生成のたびに新しい LanguageModelSession を作り、リクエスト間で文脈を持ち越さない
/// （チケット単位の独立分析。コンテキスト肥大を避ける）。
func handleAnalyze(_ request: SidecarRequest) async {
    let lang = request.lang ?? "ja"

    // 入力プロンプトを組み立てる。本文（description_head）は Rust 側で切り詰め済みを受ける。
    var promptLines: [String] = []
    if let key = request.issueKey { promptLines.append("Issue: \(key)") }
    if let summary = request.summary { promptLines.append("Title: \(summary)") }
    if let status = request.status { promptLines.append("Status: \(status)") }
    if let due = request.dueDate { promptLines.append("Due: \(due)") }
    if let body = request.descriptionHead, !body.isEmpty {
        promptLines.append("Description: \(body)")
    }
    let prompt = promptLines.joined(separator: "\n")

    do {
        let session = LanguageModelSession(instructions: instructions(for: lang))
        let response = try await session.respond(
            to: prompt,
            generating: AnalysisGeneration.self
        )
        let gen = response.content
        writeLine(
            ResultResponse(
                summary: gen.summary,
                riskLevel: gen.riskLevel.rawValue,
                suggestion: gen.suggestion
            )
        )
    } catch {
        // 生成失敗は1行のエラーで返す。リトライ・スキップ判断は Rust 側ワーカーが行う。
        writeError("generation failed: \(error.localizedDescription)")
    }
}

// MARK: - メインループ

/// stdin を JSON Lines として読み、1行ずつ処理する常駐ループ。
///
/// readLine() はブロッキング read であり、入力が無い間は CPU を消費しない（NFR-V03-003）。
/// EOF（stdin クローズ）または {"type":"shutdown"} で正常終了する。
func runLoop() async {
    let decoder = JSONDecoder()

    while let line = readLine(strippingNewline: true) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty { continue }

        guard let data = trimmed.data(using: .utf8),
            let request = try? decoder.decode(SidecarRequest.self, from: data)
        else {
            writeError("invalid request line")
            continue
        }

        switch request.type {
        case "availability":
            let (available, reason) = currentAvailability()
            writeLine(AvailabilityResponse(available: available, reason: reason))
        case "analyze":
            await handleAnalyze(request)
        case "shutdown":
            return
        default:
            writeError("unknown request type: \(request.type)")
        }
    }
    // readLine() が nil を返した = stdin が EOF。正常終了する。
}

await runLoop()
