import { spawn } from 'child_process'

function run(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit', shell: true })
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`)
  })
  return child
}

run('api', 'node', ['server.js'])
run('web', 'vite', [])
