const fs = require('fs')
const path = require('path')

// HTMLファイルのパスを修正
function fixElectronPaths() {
  const outputDir = '.output/public'
  const indexPath = path.join(outputDir, 'index.html')
  
  if (fs.existsSync(indexPath)) {
    let content = fs.readFileSync(indexPath, 'utf8')
    
    // 絶対パスを相対パスに変更
    content = content.replace(/href="\/_nuxt\//g, 'href="./_nuxt/')
    content = content.replace(/src="\/_nuxt\//g, 'src="./_nuxt/')
    
    // CSSファイルのパス問題: 存在しないCSSファイルのリンクを修正または除去
    const cssRegex = /<link[^>]*href="[^"]*\.css[^"]*"[^>]*>/g
    const cssLinks = content.match(cssRegex)
    if (cssLinks) {
      cssLinks.forEach(link => {
        const hrefMatch = link.match(/href="([^"]*)"/)
        if (hrefMatch) {
          const originalPath = hrefMatch[1].replace('./', '')
          const fullPath = path.join(outputDir, originalPath)
          
          if (!fs.existsSync(fullPath)) {
            // _nuxt/assets/entry-*.css -> _nuxt/entry-*.css に修正を試行
            const fixedPath = originalPath.replace('_nuxt/assets/', '_nuxt/')
            const fixedFullPath = path.join(outputDir, fixedPath)
            
            if (fs.existsSync(fixedFullPath)) {
              console.log(`✅ CSSファイルパスを修正: ${originalPath} -> ${fixedPath}`)
              const fixedLink = link.replace(hrefMatch[1], './' + fixedPath)
              content = content.replace(link, fixedLink)
            } else {
              console.log(`⚠ 存在しないCSSファイルのリンクを除去: ${originalPath}`)
              content = content.replace(link, '')
            }
          } else {
            console.log(`✅ CSSファイル存在確認: ${originalPath}`)
          }
        }
      })
    }
    
    // baseURLの設定も修正
    content = content.replace(/baseURL:"\/"/, 'baseURL:"./"')
    content = content.replace(/buildAssetsDir:"\/_nuxt\/"/, 'buildAssetsDir:"./_nuxt/"')
    
    fs.writeFileSync(indexPath, content, 'utf8')
    console.log('✓ Electron用のパス修正が完了しました')
  } else {
    console.log('⚠ index.htmlが見つかりませんでした')
  }
  
  // 他のHTMLファイルも修正
  const files = ['200.html', '404.html']
  files.forEach(file => {
    const filePath = path.join(outputDir, file)
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8')
      content = content.replace(/href="\/_nuxt\//g, 'href="./_nuxt/')
      content = content.replace(/src="\/_nuxt\//g, 'src="./_nuxt/')
      content = content.replace(/baseURL:"\/"/, 'baseURL:"./"')
      content = content.replace(/buildAssetsDir:"\/_nuxt\/"/, 'buildAssetsDir:"./_nuxt/"')
      fs.writeFileSync(filePath, content, 'utf8')
      console.log(`✓ ${file}のパス修正が完了しました`)
    }
  })
}

fixElectronPaths()