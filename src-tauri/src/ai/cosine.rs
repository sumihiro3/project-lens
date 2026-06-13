//! コサイン類似度計算（v0.4 / FR-V04-004）
//!
//! 埋め込みベクトル（v0.4 既定 = `NLContextualEmbedding` / 512次元）どうしの類似度を、外部依存を増やさず
//! f32 演算の純粋関数として総当たりで計算するための最小モジュール。`search_similar_issues`
//! コマンド（[`crate::commands`]）が、クエリ課題の埋め込みと同一ワークスペースの全埋め込み
//! （コーパス完了課題を含む）との類似度を求めるために用いる。
//!
//! # 設計方針
//! - **純粋関数**: 入出力以外の状態を持たない [`cosine_similarity`] に閉じ込め、in-process で
//!   単体テスト可能にする。DB アクセス・I/O は呼び出し側（コマンド）の責務とする。
//! - **f32・1パス**: NFR-V04-002（数千件で 100ms 目安）を意識し、ノルムと内積を1回の走査で
//!   求める。ベクトルのロードは呼び出し側で1回だけ行う前提（本関数はスライス参照のみ受け取る）。
//! - **ゼロベクトル・次元不一致対策**: いずれかのノルムが 0、または次元が一致しない場合は、
//!   未定義の `NaN` を返さず `0.0`（無相関）を返す。これにより上位N抽出のソートが破綻しない。

/// 2つのベクトルのコサイン類似度を返す（純粋関数。FR-V04-004）。
///
/// `dot(a, b) / (||a|| * ||b||)` を f32 で計算する。内積と両ノルムを1回の走査で求める。
///
/// # 引数
/// * `a` - 一方のベクトル（通常はクエリ課題の埋め込み）。
/// * `b` - 他方のベクトル（通常は被検索課題の埋め込み）。
///
/// # 戻り値
/// コサイン類似度（おおむね `-1.0..=1.0`）。次元が一致しない、またはどちらかのノルムが 0
/// （ゼロベクトル）の場合は `0.0` を返す（`NaN` を返さない・無相関扱い）。
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    // 次元不一致は比較不能。無相関として 0.0 を返し、呼び出し側のソートを壊さない。
    if a.len() != b.len() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for (&x, &y) in a.iter().zip(b.iter()) {
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    // ゼロベクトル対策: ノルムが 0 だと 0 除算で NaN/Inf になるため 0.0 を返す。
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a.sqrt() * norm_b.sqrt())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// f32 比較の許容誤差（平方根を含む演算のため厳密一致は避ける）。
    const EPS: f32 = 1e-6;

    #[test]
    fn identical_vectors_have_similarity_one() {
        let a = [1.0, 2.0, 3.0];
        assert!((cosine_similarity(&a, &a) - 1.0).abs() < EPS);
    }

    #[test]
    fn orthogonal_vectors_have_similarity_zero() {
        let a = [1.0, 0.0];
        let b = [0.0, 1.0];
        assert!(cosine_similarity(&a, &b).abs() < EPS);
    }

    #[test]
    fn opposite_vectors_have_similarity_minus_one() {
        let a = [1.0, 2.0, 3.0];
        let b = [-1.0, -2.0, -3.0];
        assert!((cosine_similarity(&a, &b) - (-1.0)).abs() < EPS);
    }

    #[test]
    fn scaled_vectors_have_similarity_one() {
        // 大きさが違っても向きが同じなら 1.0（正規化されている）。
        let a = [1.0, 2.0, 3.0];
        let b = [2.0, 4.0, 6.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < EPS);
    }

    #[test]
    fn zero_vector_returns_zero_not_nan() {
        let a = [0.0, 0.0, 0.0];
        let b = [1.0, 2.0, 3.0];
        let s = cosine_similarity(&a, &b);
        assert_eq!(s, 0.0);
        assert!(!s.is_nan());
        // 両方ゼロでも NaN を返さない。
        let z = cosine_similarity(&a, &a);
        assert_eq!(z, 0.0);
        assert!(!z.is_nan());
    }

    #[test]
    fn dimension_mismatch_returns_zero() {
        let a = [1.0, 2.0, 3.0];
        let b = [1.0, 2.0];
        assert_eq!(cosine_similarity(&a, &b), 0.0);
    }

    #[test]
    fn known_value_matches_hand_computation() {
        // a=[1,0], b=[1,1] → dot=1, |a|=1, |b|=√2 → 1/√2 ≈ 0.70710677
        let a = [1.0, 0.0];
        let b = [1.0, 1.0];
        assert!((cosine_similarity(&a, &b) - std::f32::consts::FRAC_1_SQRT_2).abs() < EPS);
    }
}
