#!/usr/bin/env node

/**
 * バージョン同期スクリプト
 * 
 * package.jsonのバージョンをCargo.tomlとtauri.conf.jsonに同期します。
 * npm versionコマンドの"version"フックから自動的に呼び出されます。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESモジュールでの__dirnameの代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ファイルパス
const packageJsonPath = path.join(__dirname, '../package.json');
const cargoTomlPath = path.join(__dirname, '../src-tauri/Cargo.toml');
const tauriConfPath = path.join(__dirname, '../src-tauri/tauri.conf.json');

/**
 * package.jsonからバージョンを読み取る
 */
function getPackageVersion() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const version = packageJson.version;

    if (!version) {
      throw new Error('package.jsonにversionフィールドが見つかりません');
    }

    // SemVerの基本的な検証
    const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    if (!semverRegex.test(version)) {
      throw new Error(`無効なバージョン形式: ${version}`);
    }

    return version;
  } catch (error) {
    console.error('❌ package.jsonの読み取りエラー:', error.message);
    process.exit(1);
  }
}

/**
 * Cargo.tomlのバージョンを更新
 */
function updateCargoToml(version) {
  try {
    let content = fs.readFileSync(cargoTomlPath, 'utf8');

    // versionフィールドを更新（[package]セクション内）
    const versionRegex = /^version\s*=\s*"[^"]*"/m;
    if (!versionRegex.test(content)) {
      throw new Error('Cargo.tomlにversionフィールドが見つかりません');
    }

    content = content.replace(versionRegex, `version = "${version}"`);
    fs.writeFileSync(cargoTomlPath, content, 'utf8');

    console.log(`✅ Cargo.toml のバージョンを ${version} に更新しました`);
  } catch (error) {
    console.error('❌ Cargo.tomlの更新エラー:', error.message);
    process.exit(1);
  }
}

/**
 * tauri.conf.jsonのバージョンを更新
 */
function updateTauriConf(version) {
  try {
    const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));

    tauriConf.version = version;

    // 2スペースインデントで保存
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');

    console.log(`✅ tauri.conf.json のバージョンを ${version} に更新しました`);
  } catch (error) {
    console.error('❌ tauri.conf.jsonの更新エラー:', error.message);
    process.exit(1);
  }
}

/**
 * メイン処理
 */
function main() {
  console.log('🔄 バージョン同期を開始します...');

  const version = getPackageVersion();
  console.log(`📦 package.json のバージョン: ${version}`);

  updateCargoToml(version);
  updateTauriConf(version);

  console.log('✨ バージョン同期が完了しました');
}

// スクリプトを実行
main();
