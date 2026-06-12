//! AI 可用性チェックと状態管理（FR-V03-002）
//!
//! AI 機能が利用可能かを判定し、結果を**理由別の enum**でフロントへ返すための層。
//! 判定は以下の2段で行う:
//!
//! 1. **OS 要件**: macOS 26 以上か（[`detect_macos_major_version`]）。Apple Silicon の macOS 26 以降でのみ
//!    FoundationModels が動作するため、まず OS バージョンで足切りする。non-macOS では即 [`UnsupportedOS`] になる。
//! 2. **モデル可用性**: sidecar の availability 要求（`SystemLanguageModel.availability`）の結果を受け取り、
//!    Apple Intelligence 有効・モデル準備状況を反映する（[`FoundationModelsBackend::availability`]）。
//!
//! # 非阻害（NFR-V03-002 / NFR-V03-004）
//! 可用性判定は**失敗しても全体を止めない**。OS バージョン取得失敗・sidecar 起動失敗・問い合わせ失敗は
//! すべて `Unavailable` 系の値（[`AiAvailability`]）に落として返し、`Err` で呼び出し側を止めない。
//! これにより AI 非対応・途中無効化環境でも既存機能を一切阻害しない。
//!
//! # 将来バックエンド（FR-V03-002）
//! [`AiAvailability::other_backend_available`] に「別のバックエンドを利用できる」案内用フラグを持たせる。
//! v0.3 では FoundationModels 単独のため**常に `false`**。v0.4 で MLX 等を追加した際、OS 非対応や
//! モデル未準備でも別バックエンドへ誘導できる構造を前置きする。
//!
//! [`UnsupportedOS`]: AiAvailabilityReason::UnsupportedOS
//! [`FoundationModelsBackend::availability`]: super::foundation_models::FoundationModelsBackend::availability

use super::foundation_models::{AvailabilityInfo, FoundationModelsBackend};
use serde::{Deserialize, Serialize};

/// AI 機能が利用可能になる最小の macOS メジャーバージョン（NFR-V03-002）。
///
/// FoundationModels は macOS 26 以降（Apple Silicon）でのみ動作するため、これ未満は [`AiAvailabilityReason::UnsupportedOS`] とする。
pub const MIN_SUPPORTED_MACOS_MAJOR: u32 = 26;

/// AI 機能の可用性を表す理由別の状態（FR-V03-002）。
///
/// フロントは `reason` を見て理由別メッセージ（「macOS 26 以降が必要」等）と
/// Apple Intelligence 設定画面への導線を出し分ける。`serde` で `camelCase` のタグ付き列挙
/// （`{"reason":"available"}` / `{"reason":"unsupportedOs"}` 等）にシリアライズされ、
/// フロント（`useAiSettings.ts` の `AiAvailabilityReason`）の camelCase キーと一致する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiAvailabilityReason {
    /// 利用可能。AI 機能を有効化できる。
    Available,
    /// macOS バージョンが要件（[`MIN_SUPPORTED_MACOS_MAJOR`] 以上）を満たさない、または macOS 以外の OS。
    ///
    /// camelCase の既定変換では末尾の `OS` が `unsupportedOS` になりフロントの `unsupportedOs` と
    /// 不一致になるため、明示的に `unsupportedOs` へ rename する。
    #[serde(rename = "unsupportedOs")]
    UnsupportedOS,
    /// Apple Intelligence が無効。設定画面で有効化が必要。
    AppleIntelligenceDisabled,
    /// モデルが準備中（ダウンロード中等）。準備完了後に利用可能になる見込み。
    ModelNotReady,
    /// デバイスが対象外（非対応ハードウェア等）。
    DeviceNotEligible,
    /// 上記以外の理由で利用不可（問い合わせ失敗・sidecar 異常・未知の理由コード等）。
    Unavailable,
}

/// AI 可用性の判定結果（FR-V03-002）。フロントへ返すシリアライズ可能な構造。
///
/// 理由別の状態（[`AiAvailabilityReason`]）に加え、人間可読の補足コード（`detail`）と
/// 将来バックエンド案内用フラグ（`other_backend_available`）を持つ。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAvailability {
    /// 推論が利用可能か（[`AiAvailabilityReason::Available`] のときのみ `true`）。
    pub available: bool,
    /// 利用可否の理由（フロントの理由別メッセージ・導線の出し分けに用いる）。
    pub reason: AiAvailabilityReason,
    /// 補足の理由コード文字列（sidecar が返した生の `reason` 等。診断・ログ向け。
    /// macOS バージョン情報も含む場合がある。フロントの主分岐は [`AiAvailability::reason`] を使う）。
    pub detail: Option<String>,
    /// 検出した macOS メジャーバージョン（取得できなかった場合・非 macOS は `None`）。
    pub macos_major: Option<u32>,
    /// 別のバックエンド（v0.4 以降の MLX 等）を利用できるか。
    ///
    /// FR-V03-002 の「別のバックエンドを利用できます」案内のための前置き。
    /// **v0.3 では常に `false`**（FoundationModels 単独のため）。
    pub other_backend_available: bool,
}

impl AiAvailability {
    /// 利用可能な状態を生成する。
    ///
    /// # 引数
    /// * `macos_major` - 検出した macOS メジャーバージョン。
    ///
    /// # 戻り値
    /// `available = true` の [`AiAvailability`]。
    fn available(macos_major: u32) -> Self {
        Self {
            available: true,
            reason: AiAvailabilityReason::Available,
            detail: None,
            macos_major: Some(macos_major),
            other_backend_available: false,
        }
    }

    /// 利用不可の状態を生成する（理由・補足・検出 OS バージョンを指定）。
    ///
    /// # 引数
    /// * `reason` - 利用不可の理由（[`AiAvailabilityReason::Available`] 以外）。
    /// * `detail` - 補足の理由コード・メッセージ（無ければ `None`）。
    /// * `macos_major` - 検出した macOS メジャーバージョン（取得不可・非 macOS は `None`）。
    ///
    /// # 戻り値
    /// `available = false` の [`AiAvailability`]。
    fn unavailable(
        reason: AiAvailabilityReason,
        detail: Option<String>,
        macos_major: Option<u32>,
    ) -> Self {
        Self {
            available: false,
            reason,
            detail,
            macos_major,
            // v0.3 では別バックエンドは存在しない。v0.4 で MLX 追加時にここを更新する。
            other_backend_available: false,
        }
    }
}

/// sidecar の availability 理由コード文字列を [`AiAvailabilityReason`] へマップする。
///
/// Swift sidecar（`SystemLanguageModel.availability`）が返す理由コードを Rust の理由別 enum に正規化する。
/// 未知のコードは [`AiAvailabilityReason::Unavailable`] に落とす（前方互換）。
///
/// # 引数
/// * `code` - sidecar が返した理由コード（`available` / `appleIntelligenceNotEnabled` /
///   `modelNotReady` / `deviceNotEligible` / `unavailableOther` / `unsupportedOS` 等）。
///
/// # 戻り値
/// 対応する [`AiAvailabilityReason`]。
fn map_sidecar_reason(code: &str) -> AiAvailabilityReason {
    match code {
        "available" => AiAvailabilityReason::Available,
        "appleIntelligenceNotEnabled" => AiAvailabilityReason::AppleIntelligenceDisabled,
        "modelNotReady" => AiAvailabilityReason::ModelNotReady,
        "deviceNotEligible" => AiAvailabilityReason::DeviceNotEligible,
        "unsupportedOS" => AiAvailabilityReason::UnsupportedOS,
        // "unavailableOther" を含む未知コードはすべて Unavailable に集約する。
        _ => AiAvailabilityReason::Unavailable,
    }
}

/// 現在の macOS のメジャーバージョンを検出する。
///
/// `cfg(target_os = "macos")` では `sysctl kern.osproductversion`（例: `26.1`）を実行し、先頭の整数部を返す。
/// macOS 以外の OS や取得失敗時は `None` を返す（呼び出し側で [`AiAvailabilityReason::UnsupportedOS`] 扱いにする）。
///
/// # 戻り値
/// 検出した macOS メジャーバージョン。非 macOS・取得失敗時は `None`。
pub fn detect_macos_major_version() -> Option<u32> {
    #[cfg(target_os = "macos")]
    {
        // sysctl kern.osproductversion はカーネルバージョンではなく製品バージョン（例: 26.1）を返す。
        // uname の Darwin カーネル番号とは別物なので、製品バージョンを直接参照して取り違えを避ける。
        let output = std::process::Command::new("sysctl")
            .args(["-n", "kern.osproductversion"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let version = String::from_utf8_lossy(&output.stdout);
        let major = version.trim().split('.').next()?;
        major.parse::<u32>().ok()
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// AI 機能の可用性を判定する（FR-V03-002）。
///
/// 2段判定を行う:
/// 1. macOS バージョンが [`MIN_SUPPORTED_MACOS_MAJOR`] 以上か（[`detect_macos_major_version`]）。
///    満たさなければ sidecar に問い合わせず [`AiAvailabilityReason::UnsupportedOS`] を返す（無駄な sidecar 起動を避ける）。
/// 2. OS 要件を満たす場合のみ、sidecar の availability 要求で `SystemLanguageModel.availability` の結果を取得し、
///    理由コードを [`AiAvailabilityReason`] へマップする。
///
/// 判定はいかなる失敗でも `Err` を返さず、`Unavailable` 系の [`AiAvailability`] に落とす（NFR-V03-002 / NFR-V03-004）。
/// これにより AI 非対応・途中無効化環境でも既存機能を阻害しない。
///
/// # 引数
/// * `backend` - 可用性問い合わせに用いる FoundationModels バックエンド。
///
/// # 戻り値
/// 理由別の可用性状態 [`AiAvailability`]（常に値を返し、`Err` にはしない）。
pub async fn check_availability(backend: &FoundationModelsBackend) -> AiAvailability {
    // 1段目: macOS バージョン足切り。
    // sysctl 実行は同期ブロッキングのため、async ランタイムのワーカースレッドを止めないよう
    // spawn_blocking に逃がす。join 失敗時は取得不能（None）として扱う。
    let detected = tokio::task::spawn_blocking(detect_macos_major_version)
        .await
        .unwrap_or(None);
    let macos_major = match detected {
        Some(major) if major >= MIN_SUPPORTED_MACOS_MAJOR => major,
        Some(major) => {
            return AiAvailability::unavailable(
                AiAvailabilityReason::UnsupportedOS,
                Some(format!("macOS {major} < {MIN_SUPPORTED_MACOS_MAJOR}")),
                Some(major),
            );
        }
        None => {
            // 非 macOS、またはバージョン取得失敗。いずれも AI 非対応として扱い、既存機能は阻害しない。
            return AiAvailability::unavailable(
                AiAvailabilityReason::UnsupportedOS,
                Some("macOS version not detected".to_string()),
                None,
            );
        }
    };

    // 2段目: sidecar 経由で SystemLanguageModel.availability を問い合わせる。
    match backend.availability().await {
        Ok(AvailabilityInfo { available, reason }) => {
            // 補足には sidecar の生の理由コードを残す（診断・ログ向け）。
            let detail = Some(reason.clone());
            let mapped = map_sidecar_reason(&reason);
            if available && mapped == AiAvailabilityReason::Available {
                AiAvailability::available(macos_major)
            } else {
                // available=false、または reason が Available 以外（理由コード優先で状態を決める）。
                // available=false なのに reason=available という不整合は Unavailable に倒す。
                let mapped = if mapped == AiAvailabilityReason::Available {
                    AiAvailabilityReason::Unavailable
                } else {
                    mapped
                };
                AiAvailability::unavailable(mapped, detail, Some(macos_major))
            }
        }
        Err(e) => {
            // 問い合わせ自体の失敗（sidecar 未同梱・起動不能・一時停止・タイムアウト等）。
            // AI 機能のみ無効化し、本体はクラッシュさせない（NFR-V03-004）。
            log::warn!("AI availability query failed: {e}");
            AiAvailability::unavailable(
                AiAvailabilityReason::Unavailable,
                Some(e.to_string()),
                Some(macos_major),
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reason_serializes_to_camel_case_tag() {
        // フロント（useAiSettings.ts）が分岐に使う reason が camelCase でシリアライズされ、
        // フロントの型・i18n キーと一致すること（FR-V03-002 の理由別表示・導線の前提）。
        assert_eq!(
            serde_json::to_string(&AiAvailabilityReason::Available).unwrap(),
            r#""available""#
        );
        assert_eq!(
            serde_json::to_string(&AiAvailabilityReason::UnsupportedOS).unwrap(),
            r#""unsupportedOs""#
        );
        assert_eq!(
            serde_json::to_string(&AiAvailabilityReason::AppleIntelligenceDisabled).unwrap(),
            r#""appleIntelligenceDisabled""#
        );
    }

    #[test]
    fn availability_serializes_with_camel_case_fields() {
        // 構造体がコマンド層からそのまま返せる camelCase JSON になること。
        let value = AiAvailability::unavailable(
            AiAvailabilityReason::UnsupportedOS,
            Some("macOS 13 < 26".to_string()),
            Some(13),
        );
        let json = serde_json::to_string(&value).unwrap();
        assert!(json.contains(r#""available":false"#));
        assert!(json.contains(r#""reason":"unsupportedOs""#));
        assert!(json.contains(r#""macosMajor":13"#));
        // v0.3 では別バックエンドは常に false。
        assert!(json.contains(r#""otherBackendAvailable":false"#));
    }

    #[test]
    fn available_constructor_sets_flags() {
        let value = AiAvailability::available(26);
        assert!(value.available);
        assert_eq!(value.reason, AiAvailabilityReason::Available);
        assert_eq!(value.macos_major, Some(26));
        assert!(!value.other_backend_available);
    }

    #[test]
    fn maps_known_sidecar_reason_codes() {
        assert_eq!(
            map_sidecar_reason("available"),
            AiAvailabilityReason::Available
        );
        assert_eq!(
            map_sidecar_reason("appleIntelligenceNotEnabled"),
            AiAvailabilityReason::AppleIntelligenceDisabled
        );
        assert_eq!(
            map_sidecar_reason("modelNotReady"),
            AiAvailabilityReason::ModelNotReady
        );
        assert_eq!(
            map_sidecar_reason("deviceNotEligible"),
            AiAvailabilityReason::DeviceNotEligible
        );
        assert_eq!(
            map_sidecar_reason("unsupportedOS"),
            AiAvailabilityReason::UnsupportedOS
        );
    }

    #[test]
    fn maps_unknown_sidecar_reason_to_unavailable() {
        // unavailableOther や未知コードは Unavailable に集約する（前方互換）。
        assert_eq!(
            map_sidecar_reason("unavailableOther"),
            AiAvailabilityReason::Unavailable
        );
        assert_eq!(
            map_sidecar_reason("some-future-code"),
            AiAvailabilityReason::Unavailable
        );
    }
}
