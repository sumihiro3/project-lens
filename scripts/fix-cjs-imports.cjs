#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

/**
 * .cjsファイル内のrequire文を.cjs拡張子に修正する
 */
function fixCjsImports(directory) {
  const files = fs.readdirSync(directory, { withFileTypes: true })

  files.forEach((file) => {
    const fullPath = path.join(directory, file.name)

    if (file.isDirectory()) {
      // 再帰的にディレクトリを処理
      fixCjsImports(fullPath)
    }
    else if (file.name.endsWith('.cjs')) {
      // .cjsファイルの内容を読み取り
      let content = fs.readFileSync(fullPath, 'utf8')

      // 相対パスのrequire文を.cjs拡張子付きに修正
      content = content.replace(
        /require\(["'](\.\.?\/.+?)["']\)/g,
        (match, relativePath) => {
          // 既に拡張子がある場合はスキップ
          if (relativePath.endsWith('.cjs') || relativePath.endsWith('.js')) {
            return match
          }

          // ディレクトリ構造を確認してindex.cjsがある場合は適切なパスに修正
          const fullPathDir = path.resolve(path.dirname(fullPath), relativePath)
          const indexPath = path.join(fullPathDir, 'index.cjs')

          if (fs.existsSync(indexPath)) {
            return `require("${relativePath}/index.cjs")`
          }
          else {
            return `require("${relativePath}.cjs")`
          }
        },
      )

      // import文も処理（dynamic import等）
      content = content.replace(
        /import\(["'](\.\.?\/.+?)["']\)/g,
        (match, relativePath) => {
          if (relativePath.endsWith('.cjs') || relativePath.endsWith('.js')) {
            return match
          }
          return `import("${relativePath}.cjs")`
        },
      )

      // from句のimport文も処理
      content = content.replace(
        /from\s+["'](\.\.?\/.+?)["']/g,
        (match, relativePath) => {
          if (relativePath.endsWith('.cjs') || relativePath.endsWith('.js')) {
            return match
          }

          // ディレクトリ構造を確認してindex.cjsがある場合は適切なパスに修正
          const fullPathDir = path.resolve(path.dirname(fullPath), relativePath)
          const indexPath = path.join(fullPathDir, 'index.cjs')

          if (fs.existsSync(indexPath)) {
            return `from "${relativePath}/index.cjs"`
          }
          else {
            return `from "${relativePath}.cjs"`
          }
        },
      )

      // ファイルに書き戻し
      fs.writeFileSync(fullPath, content)
      console.log(`Fixed imports in: ${fullPath}`)
    }
  })
}

// dist-electronディレクトリの処理
const distElectronPath = path.join(__dirname, '..', 'dist-electron')
if (fs.existsSync(distElectronPath)) {
  console.log('Fixing CJS imports...')
  fixCjsImports(distElectronPath)
  console.log('CJS imports fixed successfully!')
}
else {
  console.log('dist-electron directory not found')
}
