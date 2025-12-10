import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getPriorityColor,
  getStatusColor,
  getDueDateColor,
  parseDueDate,
  formatDate,
  isOverdue,
  isToday,
  isThisWeek,
  isThisMonth,
  getProjectColor,
  getChipTextColor,
  formatRelativeTime
} from './issueHelpers'

describe('issueHelpers', () => {
  describe('getPriorityColor (優先度の色取得)', () => {
    it('優先度「High」「高」の場合は赤を返すこと', () => {
      expect(getPriorityColor('High')).toBe('red')
      expect(getPriorityColor('高')).toBe('red')
    })

    it('優先度「Normal」「中」の場合は青を返すこと', () => {
      expect(getPriorityColor('Normal')).toBe('blue')
      expect(getPriorityColor('中')).toBe('blue')
    })

    it('その他の優先度の場合はグレーを返すこと', () => {
      expect(getPriorityColor('Low')).toBe('grey')
      expect(getPriorityColor(undefined)).toBe('grey')
    })
  })

  describe('getStatusColor (ステータスの色取得)', () => {
    it('完了系のステータスなら緑を返すこと', () => {
      expect(getStatusColor('完了')).toBe('green')
      expect(getStatusColor('Closed')).toBe('green')
      expect(getStatusColor('Done')).toBe('green')
    })

    it('進行中のステータスならオレンジを返すこと', () => {
      expect(getStatusColor('処理中')).toBe('orange')
      expect(getStatusColor('In Progress')).toBe('orange')
    })

    it('その他のステータスならグレーを返すこと', () => {
      expect(getStatusColor('Open')).toBe('grey')
      expect(getStatusColor(undefined)).toBe('grey')
    })
  })

  describe('日付関連関数', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    describe('parseDueDate (日付パース)', () => {
      it('有効な日付文字列をパースできること', () => {
        const date = parseDueDate('2023-01-01')
        expect(date).toBeInstanceOf(Date)
        expect(date?.getFullYear()).toBe(2023)
      })

      it('無効な日付文字列の場合はnullを返すこと', () => {
        expect(parseDueDate('invalid')).toBeNull()
        expect(parseDueDate(undefined)).toBeNull()
      })
    })

    describe('isOverdue (期限切れ判定)', () => {
      it('今日より前の日付ならtrueを返すこと', () => {
        // 今日を2023-01-15とする
        vi.setSystemTime(new Date('2023-01-15T00:00:00Z'))

        const pastDate = new Date('2023-01-14T00:00:00Z')
        const futureDate = new Date('2023-01-16T00:00:00Z')
        const todayDate = new Date('2023-01-15T00:00:00Z')

        expect(isOverdue(pastDate)).toBe(true)
        expect(isOverdue(futureDate)).toBe(false)
        expect(isOverdue(todayDate)).toBe(false)
      })
    })

    describe('isToday (今日判定)', () => {
      it('日付が今日ならtrueを返すこと', () => {
        vi.setSystemTime(new Date('2023-01-15T12:00:00Z'))

        const todayDate = new Date('2023-01-15T09:00:00Z')
        const tomorrowDate = new Date('2023-01-16T09:00:00Z')

        expect(isToday(todayDate)).toBe(true)
        expect(isToday(tomorrowDate)).toBe(false)
      })
    })

    describe('isThisWeek (今週判定)', () => {
      it('日付が今週以内ならtrueを返すこと', () => {
        // 今日を水曜日 2023-01-11 とする
        vi.setSystemTime(new Date('2023-01-11T12:00:00Z'))

        const todayDate = new Date('2023-01-11T12:00:00Z')
        // 日曜日 00:00 は週の範囲内として判定されるべき
        const thisSunday = new Date('2023-01-15T00:00:00Z')
        const nextMonday = new Date('2023-01-16T12:00:00Z')
        const yesterday = new Date('2023-01-10T12:00:00Z')

        expect(isThisWeek(todayDate)).toBe(true)
        expect(isThisWeek(thisSunday)).toBe(true)
        expect(isThisWeek(nextMonday)).toBe(false)
        expect(isThisWeek(yesterday)).toBe(false)
      })
    })

    describe('getDueDateColor (期限の色取得)', () => {
      it('期限の状態に応じて正しい色を返すこと', () => {
        vi.setSystemTime(new Date('2023-01-15T00:00:00Z'))

        // 期限切れ
        expect(getDueDateColor('2023-01-14')).toBe('red')
        // 今日
        expect(getDueDateColor('2023-01-15')).toBe('orange')
        // 今週 (1/18水曜は、1/22日曜終わりの週に含まれる)
        expect(getDueDateColor('2023-01-18')).toBe('yellow')
        // 未来
        expect(getDueDateColor('2023-02-01')).toBe('grey')
      })
    })
  })

  describe('getProjectColor (プロジェクトカラー取得)', () => {
    it('同じキーに対しては一貫して同じ色を返すこと', () => {
      const color1 = getProjectColor('PROJ-123')
      const color2 = getProjectColor('PROJ-123')
      expect(color1).toBe(color2)
    })

    it('undefinedの場合はデフォルトのグレーを返すこと', () => {
      expect(getProjectColor(undefined)).toBe('#9E9E9E')
    })
  })

  describe('getChipTextColor (チップの文字色取得)', () => {
    it('明るい背景なら黒文字を返すこと', () => {
      expect(getChipTextColor('#FFFFFF')).toBe('#000000')
      expect(getChipTextColor('#FFFF00')).toBe('#000000') // Yellow
    })

    it('暗い背景なら白文字を返すこと', () => {
      expect(getChipTextColor('#000000')).toBe('#ffffff')
      expect(getChipTextColor('#000080')).toBe('#ffffff') // Navy
    })
  })

  describe('formatRelativeTime (相対時間フォーマット)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2023-01-01T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const mockT = (key: string, params?: { count: number }) => {
      if (params) return `${key}:${params.count}`
      return key
    }

    it('数秒前の場合は「たった今」を返すこと', () => {
      const date = new Date('2023-01-01T11:59:50Z') // 10秒前
      expect(formatRelativeTime(date.toISOString(), mockT)).toBe('common.justNow')
    })

    it('数分前の場合は分数を返すこと', () => {
      const date = new Date('2023-01-01T11:50:00Z') // 10分前
      expect(formatRelativeTime(date.toISOString(), mockT)).toBe('common.minutesAgo:10')
    })

    it('数日前の場合は日数を返すこと', () => {
      const date = new Date('2022-12-30T12:00:00Z') // 2日前
      expect(formatRelativeTime(date.toISOString(), mockT)).toBe('common.daysAgo:2')
    })

    it('1週間以上前の場合は日付フォーマットで返すこと', () => {
      const date = new Date('2022-12-01T12:00:00Z')
      expect(formatRelativeTime(date.toISOString(), mockT)).not.toContain('common.')
    })
  })
})
