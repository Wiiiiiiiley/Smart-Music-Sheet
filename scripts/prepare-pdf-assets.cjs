const fs = require('node:fs')
const path = require('node:path')
const source = path.dirname(require.resolve('pdfjs-dist/package.json'))
const destination = path.resolve(__dirname, '../frontend/public/pdfjs')
for (const directory of ['cmaps', 'standard_fonts']) {
  fs.cpSync(path.join(source, directory), path.join(destination, directory), { recursive: true })
}
