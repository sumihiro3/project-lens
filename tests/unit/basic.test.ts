import { describe, expect, it } from 'vitest'
import i18nConfig from '../../i18n/i18n.config'

const config = await i18nConfig()
const { ja, en } = config.messages

describe('Basic Application Tests', () => {
  it('should load Japanese locale data', () => {
    expect(ja.welcome.title).toBe('ProjectLensへようこそ')
    expect(ja.features.tickets.title).toBe('チケット管理')
    expect(ja.actions.getStarted).toBe('始める')
  })

  it('should load English locale data', () => {
    expect(en.welcome.title).toBe('Welcome to ProjectLens')
    expect(en.features.tickets.title).toBe('Ticket Management')
    expect(en.actions.getStarted).toBe('Get Started')
  })

  it('should have consistent locale structure', () => {
    const jaKeys = Object.keys(ja)
    const enKeys = Object.keys(en)

    expect(jaKeys).toEqual(enKeys)
    expect(jaKeys).toContain('welcome')
    expect(jaKeys).toContain('features')
    expect(jaKeys).toContain('actions')
  })

  it('should have required welcome properties', () => {
    expect(ja.welcome).toHaveProperty('title')
    expect(ja.welcome).toHaveProperty('subtitle')
    expect(ja.welcome).toHaveProperty('info')

    expect(en.welcome).toHaveProperty('title')
    expect(en.welcome).toHaveProperty('subtitle')
    expect(en.welcome).toHaveProperty('info')
  })

  it('should have required feature properties', () => {
    expect(ja.features.tickets).toHaveProperty('title')
    expect(ja.features.tickets).toHaveProperty('description')
    expect(ja.features.analytics).toHaveProperty('title')
    expect(ja.features.tracking).toHaveProperty('title')

    expect(en.features.tickets).toHaveProperty('title')
    expect(en.features.tickets).toHaveProperty('description')
    expect(en.features.analytics).toHaveProperty('title')
    expect(en.features.tracking).toHaveProperty('title')
  })
})
