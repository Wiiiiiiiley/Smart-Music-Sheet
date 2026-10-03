require('./database.cjs').initializeDatabase()
if (process.argv.includes('--dev')) {
  const { spawn } = require('node:child_process')
  const path = require('node:path')
  const child = spawn(process.execPath, [require.resolve('tsx/cli'), 'watch', 'src/index.ts'], {
    cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit',
  })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', code => process.exit(code || 0))
} else {
  const { httpServer } = require('../dist/index.js')
  const port = Number(process.env.PORT) || 3001
  httpServer.listen(port, () => console.log(`🎼 EduTempo 后端服务运行在端口 ${port}`))
}
