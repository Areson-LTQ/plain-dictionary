import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { DatabaseSync } from 'node:sqlite'
import { parse } from 'node-html-parser'

const VERSION = '2025.11.23'
const ARCHIVE_NAME = `freedict-eng-zho-${VERSION}.stardict.tar.xz`
const DOWNLOAD_URL = `https://download.freedict.org/dictionaries/eng-zho/${VERSION}/${ARCHIVE_NAME}`
const EXPECTED_SHA512 = '059f9aca26fdc3a5a2c0c0e8fc92e111a34bf8fd438f70d267cccf35f5e47a2d45c46650999a1b3a48c3bffc3e16e0db897232128fe822d1bc59cf34f40b395c'
const PROJECT_ROOT = resolve(import.meta.dirname, '..')
const CACHE_DIR = join(PROJECT_ROOT, '.cache', 'dictionaries')
const EXTRACT_DIR = join(CACHE_DIR, `eng-zho-${VERSION}`)
const OUTPUT_PATH = join(PROJECT_ROOT, 'src-tauri', 'resources', 'dictionary.sqlite')
const LICENSE_PATH = join(PROJECT_ROOT, 'src-tauri', 'resources', 'licenses', 'FreeDict-eng-zho-COPYING.txt')

const POSITIONS = new Map([
  ['noun', '名词'], ['proper noun', '专有名词'], ['verb', '动词'],
  ['adjective', '形容词'], ['adverb', '副词'], ['pronoun', '代词'],
  ['preposition', '介词'], ['conjunction', '连词'], ['interjection', '感叹词'],
  ['determiner', '限定词'], ['article', '冠词'], ['numeral', '数词'],
  ['participle', '分词'], ['prefix', '前缀'], ['suffix', '后缀'],
  ['phrase', '短语'], ['proverb', '谚语'], ['abbreviation', '缩写'],
])

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function downloadSource() {
  const explicitSource = argument('--source')
  if (explicitSource) return resolve(explicitSource)

  mkdirSync(CACHE_DIR, { recursive: true })
  const archivePath = join(CACHE_DIR, ARCHIVE_NAME)
  if (!existsSync(archivePath) || sha512(archivePath) !== EXPECTED_SHA512) {
    console.log(`Downloading ${DOWNLOAD_URL}`)
    const response = await fetch(DOWNLOAD_URL)
    if (!response.ok) throw new Error(`FreeDict download failed: HTTP ${response.status}`)
    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
  }
  const actualHash = sha512(archivePath)
  if (actualHash !== EXPECTED_SHA512) throw new Error(`SHA-512 mismatch: ${actualHash}`)

  rmSync(EXTRACT_DIR, { recursive: true, force: true })
  mkdirSync(EXTRACT_DIR, { recursive: true })
  const result = spawnSync('tar', ['-xJf', archivePath, '-C', EXTRACT_DIR], { stdio: 'inherit' })
  if (result.status !== 0) throw new Error('Unable to extract the FreeDict archive with tar')
  return join(EXTRACT_DIR, 'eng-zho')
}

function sha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

function addToGroup(groups, partOfSpeech, definitions) {
  if (!definitions.length) return
  const group = groups.get(partOfSpeech) ?? new Set()
  definitions.forEach((definition) => group.add(definition))
  groups.set(partOfSpeech, group)
}

export function parseHtmlEntry(html) {
  const root = parse(html)
  const pronunciations = root.querySelectorAll('font[color="gray"]')
    .map((node) => node.text.trim())
    .filter(Boolean)
  const groups = new Map()
  const sections = root.childNodes.filter((node) => node.nodeType === 1)

  for (const section of sections) {
    const grammar = section.querySelector?.('.grammar')
    if (!grammar) continue
    const sourcePartOfSpeech = grammar.text.trim().toLowerCase()
    const partOfSpeech = POSITIONS.get(sourcePartOfSpeech) ?? sourcePartOfSpeech
    const definitions = section.querySelectorAll('div')
      .filter((node) => !node.querySelector('div') && !node.querySelector('.grammar'))
      .map((node) => node.text.trim().replace(/\s+/g, ' '))
      .filter((text) => /\p{Script=Han}/u.test(text))
    addToGroup(groups, partOfSpeech, definitions)
  }

  return {
    ipa: pronunciations[0] ? `/${pronunciations[0]}/` : null,
    groups,
  }
}

export function readStarDict(sourceDir) {
  const index = gunzipSync(readFileSync(join(sourceDir, 'eng-zho.idx.gz')))
  const dictionary = readFileSync(join(sourceDir, 'eng-zho.dict'))
  const entries = new Map()
  let cursor = 0

  while (cursor < index.length) {
    const wordEnd = index.indexOf(0, cursor)
    if (wordEnd < 0 || wordEnd + 9 > index.length) break
    const headword = index.toString('utf8', cursor, wordEnd).trim()
    const offset = index.readUInt32BE(wordEnd + 1)
    const size = index.readUInt32BE(wordEnd + 5)
    cursor = wordEnd + 9
    if (!headword || offset + size > dictionary.length) continue

    const parsed = parseHtmlEntry(dictionary.toString('utf8', offset, offset + size))
    if (!parsed.groups.size) continue
    const normalized = headword.toLowerCase()
    const entry = entries.get(normalized) ?? { headword, normalized, ipa: parsed.ipa, groups: new Map() }
    if (!entry.ipa && parsed.ipa) entry.ipa = parsed.ipa
    for (const [partOfSpeech, definitions] of parsed.groups) {
      addToGroup(entry.groups, partOfSpeech, [...definitions])
    }
    entries.set(normalized, entry)
  }
  return entries
}

export function buildDatabase(entries, sourceDir) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  mkdirSync(dirname(LICENSE_PATH), { recursive: true })
  rmSync(OUTPUT_PATH, { force: true })
  const db = new DatabaseSync(OUTPUT_PATH)
  db.exec(`
    PRAGMA journal_mode=OFF;
    PRAGMA synchronous=OFF;
    CREATE TABLE entries (
      id TEXT PRIMARY KEY, headword TEXT NOT NULL, normalized_headword TEXT NOT NULL,
      language TEXT NOT NULL CHECK(language IN ('en', 'zh')), ipa TEXT,
      pronunciation TEXT, traditional TEXT, source TEXT NOT NULL
    );
    CREATE INDEX idx_entries_headword ON entries(language, normalized_headword);
    CREATE TABLE senses (
      id INTEGER PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      part_of_speech TEXT, definition TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_senses_entry ON senses(entry_id, position);
    CREATE TABLE entry_search (
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
      term TEXT NOT NULL, normalized_term TEXT NOT NULL,
      PRIMARY KEY(entry_id, normalized_term)
    );
    CREATE INDEX idx_entry_search_term ON entry_search(normalized_term);
    CREATE TABLE dictionary_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)

  const insertEntry = db.prepare('INSERT INTO entries(id, headword, normalized_headword, language, ipa, pronunciation, traditional, source) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)')
  const insertSense = db.prepare('INSERT INTO senses(entry_id, part_of_speech, definition, position) VALUES (?, ?, ?, ?)')
  const insertSearch = db.prepare('INSERT OR IGNORE INTO entry_search(entry_id, term, normalized_term) VALUES (?, ?, ?)')
  const chineseEntries = new Map()

  db.exec('BEGIN')
  try {
    for (const entry of entries.values()) {
      const entryId = `en:${entry.normalized}`
      insertEntry.run(entryId, entry.headword, entry.normalized, 'en', entry.ipa, 'FreeDict + WikDict')
      insertSearch.run(entryId, entry.headword, entry.normalized)
      let position = 0
      for (const [partOfSpeech, definitions] of entry.groups) {
        for (const definition of definitions) {
          insertSense.run(entryId, partOfSpeech, definition, position++)
          if (/\p{Script=Han}/u.test(definition) && definition.length <= 40) {
            const related = chineseEntries.get(definition) ?? new Set()
            related.add(entry.headword)
            chineseEntries.set(definition, related)
          }
        }
      }
    }

    for (const [headword, relatedWords] of chineseEntries) {
      const entryId = `zh:${headword}`
      insertEntry.run(entryId, headword, headword, 'zh', null, 'FreeDict reverse index')
      insertSearch.run(entryId, headword, headword)
      let position = 0
      for (const word of relatedWords) insertSense.run(entryId, null, word, position++)
    }

    const insertMetadata = db.prepare('INSERT INTO dictionary_metadata(key, value) VALUES (?, ?)')
    insertMetadata.run('version', `freedict-eng-zho-${VERSION}`)
    insertMetadata.run('built_at', new Date().toISOString())
    insertMetadata.run('sources', `FreeDict English-Chinese ${VERSION}; WikDict; Wiktionary; DBnary`)
    insertMetadata.run('license', 'CC BY-SA 3.0 Unported. See bundled FreeDict-eng-zho-COPYING.txt.')
    db.exec('COMMIT')
    db.exec('PRAGMA optimize; VACUUM;')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }

  copyFileSync(join(sourceDir, 'COPYING'), LICENSE_PATH)
  console.log(`Built ${OUTPUT_PATH}`)
  console.log(`English entries: ${entries.size}; Chinese reverse entries: ${chineseEntries.size}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const sourceDir = await downloadSource()
  const entries = readStarDict(sourceDir)
  buildDatabase(entries, sourceDir)
}
