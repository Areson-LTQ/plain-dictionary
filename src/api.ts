import { invoke } from '@tauri-apps/api/core'
import type {
  AppSettings,
  DictionaryEntry,
  DictionaryUpdateInfo,
  EntrySummary,
  FavoriteFolder,
  Metadata,
  QueryStat,
  RecentQuery,
} from './types'

export const api = {
  searchEntries: (query: string, limit = 12) =>
    invoke<EntrySummary[]>('search_entries', { query, limit }),
  getEntry: (entryId: string) =>
    invoke<DictionaryEntry>('get_entry', { entryId }),
  recordQuery: (entryId: string) => invoke<void>('record_query', { entryId }),
  getRecentQueries: () => invoke<RecentQuery[]>('get_recent_queries', { limit: 20 }),
  getQueryStats: () => invoke<QueryStat[]>('get_query_stats'),
  listFavoriteFolders: () => invoke<FavoriteFolder[]>('list_favorite_folders'),
  createFavoriteFolder: (name: string) => invoke<number>('create_favorite_folder', { name }),
  renameFavoriteFolder: (folderId: number, name: string) =>
    invoke<void>('rename_favorite_folder', { folderId, name }),
  deleteFavoriteFolder: (folderId: number) =>
    invoke<void>('delete_favorite_folder', { folderId }),
  addFavorite: (folderId: number, entryId: string) =>
    invoke<void>('add_favorite', { folderId, entryId }),
  removeFavorite: (folderId: number, entryId: string) =>
    invoke<void>('remove_favorite', { folderId, entryId }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  setAlwaysOnTop: (enabled: boolean) => invoke<void>('set_always_on_top', { enabled }),
  openManagementWindow: (tab: 'stats' | 'favorites') =>
    invoke<void>('open_management_window', { tab }),
  focusMainWindow: (entryId: string) => invoke<void>('focus_main_window', { entryId }),
  metadata: () => invoke<Metadata>('dictionary_metadata'),
  checkDictionaryUpdate: () => invoke<DictionaryUpdateInfo>('check_dictionary_update'),
  installDictionaryUpdate: () => invoke<DictionaryUpdateInfo>('install_dictionary_update'),
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
