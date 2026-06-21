import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagementWindow } from './ManagementWindow'
import { api } from './api'

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}))

vi.mock('./api', () => ({
  api: {
    getQueryStats: vi.fn(),
    getRecentQueries: vi.fn(),
    listFavoriteFolders: vi.fn(),
    renameFavoriteFolder: vi.fn(),
    deleteFavoriteFolder: vi.fn(),
    createFavoriteFolder: vi.fn(),
    removeFavorite: vi.fn(),
    focusMainWindow: vi.fn(),
    metadata: vi.fn(),
    checkDictionaryUpdate: vi.fn(),
    installDictionaryUpdate: vi.fn(),
  },
  getErrorMessage: (error: unknown) => String(error),
}))

const folder = {
  id: 7,
  name: '常用',
  createdAt: '2026-01-01T00:00:00Z',
  entries: [],
}

describe('ManagementWindow favorite folder actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getQueryStats).mockResolvedValue([])
    vi.mocked(api.getRecentQueries).mockResolvedValue([])
    vi.mocked(api.listFavoriteFolders).mockResolvedValue([folder])
    vi.mocked(api.renameFavoriteFolder).mockResolvedValue(undefined)
    vi.mocked(api.deleteFavoriteFolder).mockResolvedValue(undefined)
    vi.mocked(api.metadata).mockResolvedValue({ version: '2025.11', builtAt: '2026-01-01', sources: 'FreeDict', license: 'CC BY-SA' })
    vi.mocked(api.checkDictionaryUpdate).mockResolvedValue({ configured: false, currentVersion: '2025.11', updateAvailable: false })
  })

  async function openFavorites() {
    render(<ManagementWindow />)
    fireEvent.click(screen.getByRole('button', { name: '收藏夹' }))
    await screen.findByRole('heading', { name: '常用' })
  }

  it('renames a folder through the in-app dialog', async () => {
    await openFavorites()
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    const input = screen.getByRole('textbox', { name: '收藏夹名称' })
    fireEvent.change(input, { target: { value: '学习' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(api.renameFavoriteFolder).toHaveBeenCalledWith(7, '学习'))
  })

  it('deletes a folder only after confirmation', async () => {
    await openFavorites()
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('确定删除“常用”吗')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(api.deleteFavoriteFolder).toHaveBeenCalledWith(7))
  })

  it('checks for dictionary updates only after the user requests it', async () => {
    render(<ManagementWindow />)
    fireEvent.click(screen.getByRole('button', { name: '关于词库与许可' }))
    await screen.findByRole('heading', { name: '词库与许可' })
    expect(api.checkDictionaryUpdate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }))
    await screen.findByText('当前构建未配置可信更新源。')
    expect(api.checkDictionaryUpdate).toHaveBeenCalledOnce()
  })
})
