export default defineI18nConfig(() => {
  return {
    legacy: false,
    locale: 'ja',
    fallbackLocale: 'ja',
    messages: {
      ja: {
        welcome: {
          title: 'ProjectLensへようこそ',
          subtitle: 'Backlogチケット管理を効率化するデスクトップアプリケーション',
          info: '現在開発中です。今後の機能追加をお楽しみに！',
        },
        features: {
          tickets: {
            title: 'チケット管理',
            description: 'Backlogのチケットを効率的に管理・追跡できます',
          },
          analytics: {
            title: '分析・レポート',
            description: 'プロジェクトの進捗を視覚的に把握できます',
          },
          tracking: {
            title: '時間管理',
            description: '作業時間を記録・管理してより効率的に',
          },
        },
        actions: {
          getStarted: '始める',
        },
        system: {
          title: 'システム情報',
        },
      },
      en: {
        welcome: {
          title: 'Welcome to ProjectLens',
          subtitle: 'Desktop application to streamline Backlog ticket management',
          info: 'Currently under development. Stay tuned for upcoming features!',
        },
        features: {
          tickets: {
            title: 'Ticket Management',
            description: 'Efficiently manage and track Backlog tickets',
          },
          analytics: {
            title: 'Analytics & Reports',
            description: 'Visualize project progress at a glance',
          },
          tracking: {
            title: 'Time Management',
            description: 'Record and manage work hours for better efficiency',
          },
        },
        actions: {
          getStarted: 'Get Started',
        },
        system: {
          title: 'System Information',
        },
      },
    },
  }
})
