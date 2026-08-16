import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const [, , platformArg, expectedArch] = process.argv
if (!platformArg || !['x64', 'arm64'].includes(expectedArch)) {
  throw new Error('usage: node scripts/verify-packaged-app.mjs <Windows|macOS|Linux> <x64|arm64>')
}

const platform = platformArg.toLowerCase()
const outputDir = path.resolve('dist-electron')
const directories = fs.readdirSync(outputDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)

let appDirectory
let executable

if (platform === 'windows') {
  appDirectory = directories.find(name => /^win.*-unpacked$/i.test(name))
  executable = appDirectory && path.join(outputDir, appDirectory, 'cctvdl.exe')
} else if (platform === 'macos') {
  appDirectory = directories.find(name => /^mac(?:-arm64)?$/i.test(name))
  const bundle = appDirectory && path.join(outputDir, appDirectory, 'cctvdl.app')
  executable = bundle && path.join(bundle, 'Contents', 'MacOS', 'cctvdl')
  if (bundle) run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle])
} else if (platform === 'linux') {
  appDirectory = directories.find(name => /^linux.*-unpacked$/i.test(name))
  executable = appDirectory && path.join(outputDir, appDirectory, 'cctvdl')
} else {
  throw new Error(`unsupported platform: ${platformArg}`)
}

if (!executable || !fs.existsSync(executable)) {
  throw new Error(`packaged ${platformArg} ${expectedArch} executable not found in ${outputDir}`)
}

run(executable, ['--smoke-test'], {
  ...process.env,
  CCTVDL_EXPECTED_ARCH: expectedArch
})

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
    windowsHide: true,
    timeout: 30_000
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}
