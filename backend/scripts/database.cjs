const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function initializeDatabase() {
  const backend = path.resolve(__dirname, '..')
  const envFile = path.join(backend, '.env')
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile)
  const databaseUrl = process.env.DATABASE_URL || 'file:./dev.db'
  if (!databaseUrl.startsWith('file:')) throw new Error('DATABASE_URL must be a SQLite file URL')
  const [filename, parameters] = databaseUrl.slice(5).split('?')
  const database = path.resolve(backend, 'prisma', filename)
  fs.mkdirSync(path.dirname(database), { recursive: true })
  fs.closeSync(fs.openSync(database, 'a'))
  process.env.DATABASE_URL = `file:${database}${parameters ? `?${parameters}` : ''}`
  const prismaCli = require.resolve('prisma/build/index.js')
  const schema = path.join(backend, 'prisma/schema.prisma')
  execFileSync(process.execPath, [prismaCli, 'generate', '--schema', schema], { env: process.env, stdio: 'inherit' })
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema], { env: process.env, stdio: 'inherit' })
}
module.exports = { initializeDatabase }
if (require.main === module) initializeDatabase()
