import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import FilterSummaryBar from './FilterSummaryBar.vue'

// Vuetify stubs
const globalStubs = {
  'v-tooltip': { template: '<div><slot name="activator" props="{}"></slot></div>' },
  'v-alert': { template: '<div class="v-alert" @click="$emit(\'click\')"><slot name="prepend"></slot><slot></slot><slot name="append"></slot></div>' },
  'v-icon': { template: '<i class="v-icon"><slot></slot></i>' },
  'v-chip': { template: '<div class="v-chip"><slot></slot></div>' },
  'v-menu': { template: '<div class="v-menu"><slot name="activator" props="{}"></slot><slot></slot></div>' },
  'v-btn': { template: '<button class="v-btn" @click="$emit(\'click\')"><slot></slot></button>' },
  'v-list': { template: '<div class="v-list"><slot></slot></div>' },
  'v-list-subheader': { template: '<div class="v-list-subheader"><slot></slot></div>' },
  'v-list-item': { template: '<div class="v-list-item" :data-value="value" @click="$emit(\'click\')"><slot name="prepend"></slot><slot></slot></div>', props: ['value', 'active'] },
  'v-list-item-title': { template: '<div class="v-list-item-title"><slot></slot></div>' },
  'v-divider': { template: '<hr class="v-divider" />' }
}

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: any) => {
      if (key === 'filters.summary.noFilter') return 'フィルターなし'
      return key + (params ? JSON.stringify(params) : '')
    }
  })
}))

describe('FilterSummaryBar.vue (フィルター概要バー)', () => {
  const createMockFilters = () => reactive({
    searchQuery: '',
    statusFilter: 'all',
    dueDateFilter: '',
    dueSoonDays: null,
    stagnantDays: null,
    minScore: 0,
    selectedPriorities: [],
    selectedAssignees: [],
    selectedProjects: [],
    sortKey: 'relevance_score',
    sortOrder: 'desc' as const
  })

  const globalMountOptions = {
    stubs: globalStubs,
    mocks: {
      $t: (key: string, params?: any) => {
        if (key === 'filters.summary.noFilter') return 'フィルターなし'
        return key + (params ? JSON.stringify(params) : '')
      }
    }
  }

  it('デフォルトでステータスフィルター（全て）が表示されること', () => {
    const wrapper = mount(FilterSummaryBar, {
      props: {
        filters: createMockFilters(),
        totalCount: 10,
        filteredCount: 10
      },
      global: globalMountOptions
    })

    // statusFilter: 'all' is default, so it shows up in summary
    expect(wrapper.text()).toContain('filters.summary.status')
    expect(wrapper.text()).toContain('filters.summary.count{"filtered":10,"total":10}')
  })

  it('検索クエリがある場合、その内容を表示すること', () => {
    const filters = createMockFilters()
    filters.searchQuery = 'TestQuery'

    const wrapper = mount(FilterSummaryBar, {
      props: { filters, totalCount: 10, filteredCount: 5 },
      global: globalMountOptions
    })

    expect(wrapper.text()).toContain('filters.summary.search{"query":"TestQuery"}')
  })

  it('クリック時に open-filter-dialog イベントを発火すること', async () => {
    const wrapper = mount(FilterSummaryBar, {
      props: {
        filters: createMockFilters(),
        totalCount: 10,
        filteredCount: 10
      },
      global: globalMountOptions
    })

    await wrapper.find('.v-alert').trigger('click')
    expect(wrapper.emitted('open-filter-dialog')).toBeTruthy()
  })

  it('ソートキーを変更できること', async () => {
    const filters = createMockFilters()
    const wrapper = mount(FilterSummaryBar, {
      props: { filters, totalCount: 10, filteredCount: 10 },
      global: globalMountOptions
    })

    // Find the list item for 'priority' (value="priority")
    // Using data-value attribute from updated stub
    const priorityItem = wrapper.findAll('.v-list-item').find(w => w.attributes('data-value') === 'priority')

    expect(priorityItem?.exists()).toBe(true)
    if (priorityItem) {
      await priorityItem.trigger('click')
      expect(filters.sortKey).toBe('priority')
      expect(filters.sortOrder).toBe('desc') // selectSortKey sets order to desc
    }
  })
})
