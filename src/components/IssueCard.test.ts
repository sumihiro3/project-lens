import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import IssueCard from './IssueCard.vue'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'

// Setup Vuetify stubs
const globalStubs = {
  'v-card': { template: '<div class="v-card"><slot></slot></div>' },
  'v-card-title': { template: '<div class="v-card-title"><slot></slot></div>' },
  'v-card-text': { template: '<div class="v-card-text"><slot></slot></div>' },
  'v-chip': { template: '<div class="v-chip"><slot></slot></div>', props: ['color'] },
  'v-btn': { template: '<button class="v-btn" @click="$emit(\'click\')"><slot></slot></button>' },
  'v-tooltip': { template: '<div class="v-tooltip"><slot name="activator" props="{}"></slot></div>' },
  'v-icon': { template: '<i class="v-icon"><slot></slot></i>' }
}

// Mock invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

// Mock shell open
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn()
}))

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: any) => key + (params ? JSON.stringify(params) : '')
  })
}))

describe('IssueCard.vue (課題カード)', () => {
  const mockIssue = {
    id: 1,
    issueKey: 'PROJ-123',
    summary: 'Test Issue Summary',
    relevance_score: 85,
    workspace_id: 1,
    priority: { name: 'High' },
    status: { name: 'In Progress' },
    assignee: { name: 'Test User' },
    dueDate: '2023-12-31T00:00:00Z',
    updated: '2023-12-01T00:00:00Z',
    description: 'Test Description'
  }

  const globalMountOptions = {
    stubs: globalStubs,
    mocks: {
      $t: (key: string, params?: any) => key + (params ? JSON.stringify(params) : '')
    }
  }

  it('課題の基本情報（キー、要約）を表示すること', () => {
    const wrapper = mount(IssueCard, {
      props: { issue: mockIssue },
      global: globalMountOptions
    })

    expect(wrapper.text()).toContain('PROJ-123')
    expect(wrapper.text()).toContain('Test Issue Summary')
  })

  it('スコアを表示すること', () => {
    const wrapper = mount(IssueCard, {
      props: { issue: mockIssue },
      global: globalMountOptions
    })

    expect(wrapper.text()).toContain('issue.score{"score":85}')
  })

  it('優先度、ステータス、担当者を表示すること', () => {
    const wrapper = mount(IssueCard, {
      props: { issue: mockIssue },
      global: globalMountOptions
    })

    expect(wrapper.text()).toContain('High')
    expect(wrapper.text()).toContain('In Progress')
    expect(wrapper.text()).toContain('Test User')
  })

  it('クリック時にブラウザで開く処理を実行すること', async () => {
    const wrapper = mount(IssueCard, {
      props: { issue: mockIssue },
      global: globalMountOptions
    })

    // Mock workspace response
    vi.mocked(invoke).mockResolvedValue({
      id: 1,
      domain: 'example.backlog.com',
      api_key: 'dummy',
      project_keys: 'PROJ'
    })

    // Click behavior is on the title span or button
    // The title span has @click="openInBrowser"
    const title = wrapper.find('.clickable-title')
    await title.trigger('click')

    expect(invoke).toHaveBeenCalledWith('get_workspace_by_id', { workspaceId: 1 })
    // Wait for async operation
    await new Promise(process.nextTick)
    expect(open).toHaveBeenCalledWith('https://example.backlog.com/view/PROJ-123')
  })
})
