export type Language = 'en' | 'zh'

export interface EntrySummary {
  id: string
  headword: string
  language: Language
  ipa?: string
  pronunciation?: string
  traditional?: string
}

export interface SenseGroup {
  partOfSpeech?: string
  definitions: string[]
}

export interface DictionaryEntry extends EntrySummary {
  normalizedHeadword: string
  source: string
  senses: SenseGroup[]
}

export interface RecentQuery {
  entryId: string
  headword: string
  language: Language
  queriedAt: string
}

export interface QueryStat {
  entryId: string
  headword: string
  language: Language
  queryCount: number
  lastQueriedAt: string
  available: boolean
}

export interface FavoriteEntry {
  entryId: string
  headword: string
  language: Language
  addedAt: string
  available: boolean
}

export interface FavoriteFolder {
  id: number
  name: string
  createdAt: string
  entries: FavoriteEntry[]
}

export interface AppSettings {
  alwaysOnTop: boolean
}

export interface Metadata {
  version: string
  builtAt: string
  sources: string
  license: string
}

export interface DictionaryUpdateInfo {
  configured: boolean
  currentVersion: string
  latestVersion?: string
  publishedAt?: string
  downloadSize?: number
  updateAvailable: boolean
}
