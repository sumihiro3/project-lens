#!/usr/bin/env node

/**
 * ビルド成果物を dist/ ディレクトリに整理するスクリプト
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// tauri.conf.json からバージョンを取得
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src-tauri/tauri.conf.json'), 'utf8')
);
const version = tauriConfig.version;

console.log(`📦 バージョン: ${version}`);
console.log('📂 配布ファイルを整理しています...');

// 出力ディレクトリを作成
const distDir = path.join(__dirname, `../dist/v${version}`);
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

let filesCopied = 0;

// macOS DMG
const dmgDir = path.join(__dirname, '../src-tauri/target/release/bundle/dmg');
if (fs.existsSync(dmgDir)) {
  const dmgFiles = fs.readdirSync(dmgDir).filter(f => f.endsWith('.dmg'));
  dmgFiles.forEach(file => {
    const src = path.join(dmgDir, file);
    const dest = path.join(distDir, `ProjectLens-${version}-macOS.dmg`);
    fs.copyFileSync(src, dest);
    console.log(`✓ ${dest}`);
    filesCopied++;
  });
}

// macOS App Bundle (zip化)
const macosDir = path.join(__dirname, '../src-tauri/target/release/bundle/macos');
if (fs.existsSync(macosDir)) {
  const appPath = path.join(macosDir, 'ProjectLens.app');
  if (fs.existsSync(appPath)) {
    const zipPath = path.join(distDir, `ProjectLens-${version}-macOS.app.zip`);
    try {
      execSync(`cd "${macosDir}" && zip -r "${zipPath}" ProjectLens.app`, { stdio: 'inherit' });
      console.log(`✓ ${zipPath}`);
      filesCopied++;
    } catch (error) {
      console.error('App Bundle の zip 化に失敗しました:', error.message);
    }
  }
}

// Windows MSI (将来用)
const msiDir = path.join(__dirname, '../src-tauri/target/release/bundle/msi');
if (fs.existsSync(msiDir)) {
  const msiFiles = fs.readdirSync(msiDir).filter(f => f.endsWith('.msi'));
  msiFiles.forEach(file => {
    const src = path.join(msiDir, file);
    const dest = path.join(distDir, `ProjectLens-${version}-Windows.msi`);
    fs.copyFileSync(src, dest);
    console.log(`✓ ${dest}`);
    filesCopied++;
  });
}

if (filesCopied > 0) {
  console.log(`\n✅ ${filesCopied}個のファイルを整理しました`);
  console.log(`📦 配布ファイル: ${distDir}`);
} else {
  console.log('\n⚠️  配布ファイルが見つかりませんでした');
}
