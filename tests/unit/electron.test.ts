import { describe, expect, it, vi } from 'vitest'
import { app, BrowserWindow } from 'electron'

// Mock Electron modules
vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    quit: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    loadFile: vi.fn(),
    on: vi.fn(),
    webContents: {
      openDevTools: vi.fn(),
    },
  })),
  ipcMain: {
    handle: vi.fn(),
  },
}))

describe('Electron App', () => {
  it('should create app instance', () => {
    expect(app).toBeDefined()
  })

  it('should create BrowserWindow', () => {
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
    })
    expect(window).toBeDefined()
    expect(BrowserWindow).toHaveBeenCalledWith({
      width: 1200,
      height: 800,
    })
  })

  it('should handle app ready event', async () => {
    await app.whenReady()
    expect(app.whenReady).toHaveBeenCalled()
  })
})
