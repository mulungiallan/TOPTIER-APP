const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, process.env.NEXT_DIST_DIR || '.next')
const standalone = path.join(buildDir, 'standalone')

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-standalone] Skipping missing source: ${src}`)
    return
  }
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.mkdirSync(path.dirname(destPath), { recursive: true })
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

console.log('[copy-standalone] Copying static assets into standalone build...')
copyDir(path.join(buildDir, 'static'), path.join(standalone, '.next', 'static'))
copyDir(path.join(root, 'public'), path.join(standalone, 'public'))
console.log('[copy-standalone] Done.')
