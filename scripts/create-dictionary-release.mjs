import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1 || !process.argv[index + 1]) throw new Error(`缺少 --${name} 参数`)
  return process.argv[index + 1]
}

const repository = argument('repository')
const keyPath = resolve(argument('key'))
const dictionaryPath = resolve(process.argv.includes('--dictionary') ? argument('dictionary') : 'src-tauri/resources/dictionary.sqlite')
const outputRoot = resolve(process.argv.includes('--output') ? argument('output') : '.release')

const database = new DatabaseSync(dictionaryPath, { readOnly: true })
const version = database.prepare("SELECT value FROM dictionary_metadata WHERE key = 'version'").get()?.value
database.close()
if (!version || !/^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version)) throw new Error('词库版本为空或包含不安全字符')

const tag = `dictionary-${version}`
const outputDirectory = resolve(outputRoot, tag)
const archivePath = resolve(outputDirectory, 'dictionary.sqlite.zst')
mkdirSync(outputDirectory, { recursive: true })
rmSync(archivePath, { force: true })
execFileSync('zstd', ['-19', '--force', dictionaryPath, '-o', archivePath], { stdio: 'inherit' })

const archive = readFileSync(archivePath)
const sha256 = createHash('sha256').update(archive).digest('hex')
const publishedAt = new Date().toISOString()
const url = `https://github.com/${repository}/releases/download/${tag}/dictionary.sqlite.zst`
const manifest = {
  schemaVersion: 1,
  dictionaryVersion: version,
  publishedAt,
  url,
  size: statSync(archivePath).size,
  sha256,
  signature: '',
}
const payload = [manifest.schemaVersion, manifest.dictionaryVersion, manifest.publishedAt, manifest.url, manifest.size, manifest.sha256].join('\n')
const privateKey = createPrivateKey(readFileSync(keyPath))
manifest.signature = sign(null, Buffer.from(payload), privateKey).toString('base64')

writeFileSync(resolve(outputDirectory, 'dictionary-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(resolve(outputRoot, 'tag.txt'), `${tag}\n`)
const publicDer = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
writeFileSync(resolve(outputRoot, 'public-key.txt'), `${publicDer.subarray(-32).toString('base64')}\n`)
console.log(`已生成 ${outputDirectory}`)
console.log(`应用构建公钥：${publicDer.subarray(-32).toString('base64')}`)
