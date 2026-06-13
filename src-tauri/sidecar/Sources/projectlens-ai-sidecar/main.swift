// ProjectLens AI sidecar — FoundationModels guided generation 常駐プロセス
//
// 概要:
//   stdin から JSON Lines（1行=1リクエスト）を読み、種別に応じて処理し、
//   stdout に1行 JSON で結果を返す常駐プロセス。FoundationModels の
//   LanguageModelSession + @Generable による guided generation で、Rust 側の
//   `AiAnalysisOutput`（summary / risk_level / suggestion）と一致する構造化出力を生成する。
//
// 入出力契約（Rust 側 src-tauri/src/ai/mod.rs・src-tauri/src/ai/embedding.rs と一致させること）:
//   入力（1行 = 1 JSON オブジェクト）:
//     - 可用性チェック: {"type":"availability"}
//     - 分析:          {"type":"analyze","issue_key":"PROJ-1","summary":"...",
//                       "description_head":"...","status":"...","due_date":"2026-06-30","lang":"ja"}
//                       （due_date は省略可。description_head は Rust 側で切り詰め済み）
//     - 埋め込み:       {"type":"embed","texts":["...","..."],"prefix":"query|passage"}
//                       （v0.4。texts はプレフィックス未付与・切り詰め済み。下記「埋め込みの契約」参照）
//     - 終了:          {"type":"shutdown"}（EOF でも終了する）
//   出力（1行 = 1 JSON オブジェクト。改行区切り）:
//     - availability: {"type":"availability","available":true,"reason":"available"}
//                     reason は available / appleIntelligenceNotEnabled / modelNotReady /
//                     deviceNotEligible / unavailableOther / unsupportedOS のいずれか
//     - analyze 成功: {"type":"result","summary":"...","risk_level":"high|medium|low","suggestion":"..."}
//     - embed 成功:    {"type":"embedding","vectors":[[...384個のf32...], ...]}
//                      （v0.4。vectors は入力 texts と同順・同数。各ベクトルは EMBEDDING_DIM 次元）
//     - 失敗:         {"type":"error","message":"..."}
//     - 入力不正:     {"type":"error","message":"..."}
//
// 埋め込みの契約（FR-V04-001。二重付与の防止が要点）:
//   - `multilingual-e5-small` は入力先頭に `query: ` / `passage: ` を付与する仕様。
//     **プレフィックス付与は本 sidecar 側で行う**（Rust 側 EmbeddingInput は `prefix` フィールドで
//     どちらを付けるかを渡すだけで、texts には付与しない）。これにより付与点を一箇所に固定し、
//     Rust と sidecar の双方で付けてしまう「二重付与」を防ぐ。Rust 側 `EmbedPrefix::as_str()` の
//     文字列（"query: " / "passage: "）と本ファイルの `EmbedPrefix.literal` を一致させること。
//   - 埋め込みはオンデバイス完結（NFR-V04-001）。外部送信しない。
//   - 埋め込みモデルは Apple Silicon 前提（NFR-V04-004）。Intel・非対応環境では Rust 側が
//     埋め込みを無効化し本 sidecar に embed を送らない前提のため、ここではフォールバックを設けない。
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
//
//   埋め込みモデル（v0.4 既定 = OS 組み込み `NLContextualEmbedding`）について:
//     NaturalLanguage フレームワークの文脈埋め込み（日本語/CJK 対応・512 次元）を mean-pooling して
//     文ベクトルを得る。モデルアセットは OS が提供するため**アプリ同梱は不要**（多くの macOS 26 環境で
//     `hasAvailableAssets == true`）。アセット未取得・利用不可時は embed が
//     `{"type":"error","message":"..."}` を返し、Rust 側が検索機能のみ degrade する。
//     より高精度なモデル（HuggingFace からの DL）は将来の差し替え候補（有料機能候補。EmbeddingBackend で抽象化済み）。

import Foundation
import NaturalLanguage
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

/// 入力リクエスト。`type` で分岐し、analyze 時のみ分析フィールドを、embed 時のみ埋め込みフィールドを参照する。
struct SidecarRequest: Decodable {
    let type: String
    let issueKey: String?
    let summary: String?
    let descriptionHead: String?
    let status: String?
    let dueDate: String?
    let lang: String?
    /// 埋め込み対象テキスト群（type == "embed" のとき）。プレフィックス未付与・切り詰め済み。
    let texts: [String]?
    /// 付与するプレフィックス種別（type == "embed" のとき。`query` / `passage`）。
    let prefix: String?

    enum CodingKeys: String, CodingKey {
        case type
        case issueKey = "issue_key"
        case summary
        case descriptionHead = "description_head"
        case status
        case dueDate = "due_date"
        case lang
        case texts
        case prefix
    }
}

/// e5 系モデルが要求する入力プレフィックス。
///
/// Rust 側 `EmbedPrefix`（`src-tauri/src/ai/embedding.rs`）と1対1で対応させる。
/// JSON 上は `"query"` / `"passage"` の小文字文字列で受け取り、`literal` がモデルへ渡す
/// 実プレフィックス（末尾スペース込み）を返す。Rust 側 `EmbedPrefix::as_str()` と一致させること。
enum EmbedPrefix: String {
    case query
    case passage

    /// モデル入力の先頭へ連結するプレフィックス文字列（末尾スペース込み）。
    var literal: String {
        switch self {
        case .query: return "query: "
        case .passage: return "passage: "
        }
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

/// embed 成功時のレスポンス（Rust `EmbeddingOutput` + 識別用 `type`）。
///
/// `vectors` は入力 `texts` と**同順・同数**で対応する。各ベクトルは [`EMBEDDING_DIM`] 次元。
struct EmbeddingResponse: Encodable {
    let type = "embedding"
    let vectors: [[Float]]
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

// MARK: - 埋め込み処理（FR-V04-001）

/// 埋め込みモデルの出力次元数。
///
/// OS 組み込み `NLContextualEmbedding(language: .japanese)` は 512 次元。Rust 側 `EMBEDDING_DIM`
/// （`src-tauri/src/ai/embedding.rs`）と一致させること。出力ベクトルがこの次元と異なる場合はエラーとして扱う。
let EMBEDDING_DIM = 512

/// オンデバイス埋め込みモデルの抽象。
///
/// macOS 組み込みの `NLContextualEmbedding`（NaturalLanguage）でトークン文脈ベクトルを得て、
/// それを mean-pooling し 512 次元の文ベクトルへ変換する。モデルアセットは OS が提供するため
/// **アプリ同梱は不要**。アセット未取得・ロード失敗時は `load()` が `nil` を返し、embed 要求は
/// `{"type":"error"}` で応答する（プロトコルは成立、推論のみ degrade）。
///
/// 言語は日本語中心の課題コーパスに合わせ `.japanese`（CJK）固定とし、全ベクトルを同一空間に
/// 保って比較可能にする（英語混在文も同モデルで埋め込む）。メモリ常駐抑制（NFR-V04-003）のため
/// 初回 embed 時に遅延ロードし、プロセス常駐中は再利用する。
struct EmbeddingModel {
    let embedding: NLContextualEmbedding

    /// OS 組み込みの文脈埋め込みを遅延ロードする。利用不可なら `nil` を返す（推論のみ degrade）。
    ///
    /// - Returns: ロード済みモデル、または利用不可時 `nil`。
    static func load() -> EmbeddingModel? {
        guard let e = NLContextualEmbedding(language: .japanese) else { return nil }
        // アセット未取得時はこの場で DL を同期待ちせず degrade する（多くの macOS 26 環境では配置済み）。
        guard e.hasAvailableAssets else { return nil }
        do { try e.load() } catch { return nil }
        return EmbeddingModel(embedding: e)
    }

    /// テキスト群を 512 次元ベクトル群へ変換する（トークン文脈ベクトルの mean-pooling）。
    ///
    /// 入力と同順・同数のベクトルを返す。`NLContextualEmbedding` は e5 系の `query:` / `passage:`
    /// プレフィックスを用いないため、入力はプレフィックス無しのテキストをそのまま渡す。
    ///
    /// - Parameter texts: 切り詰め済みテキスト群（プレフィックス不要）。
    /// - Returns: 各テキストに対応する 512 次元ベクトル群。
    /// - Throws: 推論失敗・トークン0件時にエラー。
    func embed(_ texts: [String]) throws -> [[Float]] {
        try texts.map { text in
            let result = try embedding.embeddingResult(for: text, language: .japanese)
            var sum = [Double](repeating: 0, count: EMBEDDING_DIM)
            var count = 0
            result.enumerateTokenVectors(in: text.startIndex..<text.endIndex) { vector, _ in
                let n = min(EMBEDDING_DIM, vector.count)
                for i in 0..<n { sum[i] += vector[i] }
                count += 1
                return true
            }
            guard count > 0 else { throw EmbeddingError.emptyTokens }
            return sum.map { Float($0 / Double(count)) }
        }
    }
}

/// 埋め込み処理のエラー。
enum EmbeddingError: Error, CustomStringConvertible {
    /// 入力テキストからトークンが1つも得られなかった。
    case emptyTokens
    /// 出力次元が想定（[`EMBEDDING_DIM`]）と一致しない。
    case dimensionMismatch(Int)

    var description: String {
        switch self {
        case .emptyTokens:
            return "embedding produced no tokens for the input text"
        case .dimensionMismatch(let got):
            return "embedding dimension mismatch: expected \(EMBEDDING_DIM), got \(got)"
        }
    }
}

/// 遅延ロードした埋め込みモデルを保持する holder（プロセス常駐中に再利用。NFR-V04-003）。
///
/// runLoop は readLine() による単一スレッドの直列処理であり、embed 要求が並行することはない
/// （プロトコルが1要求=1応答を厳守）。よってロックなしの可変状態を安全に扱えるため
/// `@unchecked Sendable` とする（既存 sidecar の直列化前提と同じ保証）。
final class EmbeddingModelHolder: @unchecked Sendable {
    /// nil = 未ロード。
    private var model: EmbeddingModel?
    /// true = ロード試行済みで未同梱（毎回ロードを試みない）。
    private var loadFailed = false

    /// モデルを遅延ロードして返す。未同梱なら `nil`。
    ///
    /// - Returns: ロード済みモデル、または未同梱時 `nil`。
    func obtain() -> EmbeddingModel? {
        if model == nil && !loadFailed {
            model = EmbeddingModel.load()
            if model == nil { loadFailed = true }
        }
        return model
    }
}

/// 1件の embed リクエストを処理し、埋め込みベクトルまたはエラーを stdout へ書き出す。
///
/// プレフィックス（`query: ` / `passage: `）は**この sidecar 側で付与する**（二重付与防止。冒頭契約参照）。
/// 入力 `texts` と同順・同数のベクトル群を 1 行 JSON（`{"type":"embedding","vectors":[[...]]}`）で返す。
///
/// - Parameters:
///   - request: 埋め込みリクエスト（type == "embed"）。
///   - holder: 遅延ロード済みモデルを保持する holder（runLoop が1つ生成して使い回す）。
func handleEmbed(_ request: SidecarRequest, holder: EmbeddingModelHolder) {
    guard let texts = request.texts else {
        writeError("embed request missing 'texts'")
        return
    }
    // prefix はワイヤ契約として受け取り検証するが、NLContextualEmbedding は e5 系プレフィックスを
    // 用いないため埋め込み計算には使用しない（将来 e5 系バックエンドを足したとき再び利用する）。
    guard let prefixRaw = request.prefix, EmbedPrefix(rawValue: prefixRaw) != nil else {
        writeError("embed request missing or invalid 'prefix' (expected 'query' or 'passage')")
        return
    }
    if texts.isEmpty {
        // 空入力は空配列で正常応答（呼び出し側でゼロ件をハンドルできる）。
        writeLine(EmbeddingResponse(vectors: []))
        return
    }

    // モデルを遅延ロード（プロセス常駐中に再利用。NFR-V04-003）。
    guard let model = holder.obtain() else {
        // OS 組み込み埋め込みが利用不可（アセット未取得等。推論のみ degrade）。
        // Rust 側は error を受けて検索機能を degrade する（NFR-V04-005）。
        writeError("embedding unavailable (NLContextualEmbedding assets not ready)")
        return
    }

    do {
        // NLContextualEmbedding は e5 系プレフィックスを用いないため texts をそのまま渡す。
        let vectors = try model.embed(texts)
        // 次元・件数の契約を検証してから返す（Rust 側 BLOB レイアウトの前提を守る）。
        guard vectors.count == texts.count else {
            writeError(
                "embedding count mismatch: expected \(texts.count), got \(vectors.count)")
            return
        }
        if let bad = vectors.first(where: { $0.count != EMBEDDING_DIM }) {
            writeError(EmbeddingError.dimensionMismatch(bad.count).description)
            return
        }
        writeLine(EmbeddingResponse(vectors: vectors))
    } catch {
        writeError("embedding failed: \(error)")
    }
}

// MARK: - メインループ

/// stdin を JSON Lines として読み、1行ずつ処理する常駐ループ。
///
/// readLine() はブロッキング read であり、入力が無い間は CPU を消費しない（NFR-V03-003）。
/// EOF（stdin クローズ）または {"type":"shutdown"} で正常終了する。
func runLoop() async {
    let decoder = JSONDecoder()
    // 埋め込みモデルの遅延ロード holder。初回 embed まではロードしない（NFR-V04-003）。
    let embeddingHolder = EmbeddingModelHolder()

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
        case "embed":
            handleEmbed(request, holder: embeddingHolder)
        case "shutdown":
            return
        default:
            writeError("unknown request type: \(request.type)")
        }
    }
    // readLine() が nil を返した = stdin が EOF。正常終了する。
}

await runLoop()
