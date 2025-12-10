import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useIssues } from './useIssues'

// Mock invoke
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args)
}))

describe('useIssues (課題管理)', () => {
  const { issues, loading, loadIssues, syncIssues } = useIssues()

  beforeEach(() => {
    issues.value = []
    loading.value = false
    mockInvoke.mockReset()
  })

  it('loadIssues が get_issues を呼び出すこと', async () => {
    const mockData = [{ id: 1, summary: 'Test' }]
    mockInvoke.mockResolvedValue(mockData)

    await loadIssues()

    expect(mockInvoke).toHaveBeenCalledWith('get_issues')
    expect(issues.value).toEqual(mockData)
    expect(loading.value).toBe(false)
  })

  it('syncIssues が fetch_issues の後に get_issues を呼び出すこと', async () => {
    mockInvoke.mockResolvedValueOnce(undefined) // fetch_issues
    mockInvoke.mockResolvedValueOnce([{ id: 1 }]) // get_issues inside loadIssues

    await syncIssues()

    expect(mockInvoke).toHaveBeenCalledWith('fetch_issues')
    // syncIssues calls loadIssues internally
    expect(mockInvoke).toHaveBeenCalledWith('get_issues')
    expect(loading.value).toBe(false)
  })

  it('エラー時に適切にハンドリングすること', async () => {
    const error = new Error('Failed')
    mockInvoke.mockRejectedValue(error)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

    await loadIssues()

    expect(issues.value).toEqual([])
    expect(loading.value).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
