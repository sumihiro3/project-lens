# ProjectLens

[日本語 (Japanese)](README_JP.md)

**ProjectLens** is a desktop application designed to efficiently manage and visualize Backlog issues. With an AI-based scoring system, it automatically prioritizes and notifies you of issues that are important to you.

## Key Features

### 📊 Smart Scoring
- AI-driven relevance scoring system
- Considers factors such as priority, due date, and assignee
- Automatic notification for high-score issues (80+ points)

### 🎯 Advanced Filtering & Sorting
- Filter by status, priority, assignee, and project
- Filter by due date (Overdue, Today, This Week, This Month)
- Multiple sorting options (Relevance Score, Due Date, Priority, Updated Date)
- Weighted priority sorting (High -> Normal -> Low)

### 🎨 Intuitive UI
- Color-coded ribbons for each project
- Relative time display (e.g., "Just now", "1 hour ago")
- Dark mode support
- Open Backlog ticket in browser with one click

### 🔄 Automatic Sync
- Background synchronization every 5 minutes
- Simultaneous management of multiple projects (up to 5)
- Automatic restoration of window size and position

### 🌐 Multi-language Support
- Japanese and English interface
- Language switching capability

### 🏢 Workspace Management
- Enable/Disable toggle for each workspace
- Temporarily hide unnecessary issues

### 📊 System Observability
- Visualization of Backlog API usage (Progress Bar)
- Log file management and easy access

## Tech Stack

### Frontend
- **Nuxt 4** - Vue.js Framework
- **Vue 3** - Reactive UI Framework
- **Vuetify 3** - Material Design Component Library
- **TypeScript** - Type-safe development
- **vue-i18n** - Internationalization support

### Backend
- **Tauri 2** - Desktop Application Framework
- **Rust** - Fast and safe backend processing
- **SQLite** - Local database
- **reqwest** - HTTP client (Backlog API)

### Plugins
- `tauri-plugin-sql` - Database management
- `tauri-plugin-notification` - System notifications
- `tauri-plugin-shell` - Browser integration
- `tauri-plugin-window-state` - Window state persistence

## Setup

### Prerequisites
- Node.js 18+
- Rust 1.77.2+
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run tauri:dev

# Production build
npm run tauri:build
```

## Usage

### Initial Setup
1. Launch the app and open Settings (⚙️ icon)
2. Enter your Backlog domain (e.g., `example.backlog.com`)
3. Enter your API Key (Get it from your Backlog personal settings)
4. Select project keys to monitor (up to 5)
5. Save and sync

### Viewing Issues
- Issues are displayed on the dashboard sorted by relevance score
- Narrow down conditions with the filter bar
- Change sort order with the sort button
- Open the Backlog ticket page by clicking the ticket title or "Open" button

### Notifications
- Notifications appear when new high-priority issues (score 80+) are detected
- Notification sound plays (macOS)

## Project Structure

```
ProjectLens/
├── src/                      # Frontend Source
│   ├── components/          # Vue Components
│   ├── composables/         # Vue Composition API
│   ├── locales/            # i18n Resources
│   ├── pages/              # Page Components
│   ├── plugins/            # Nuxt Plugins
│   └── utils/              # Utility Functions
├── src-tauri/               # Backend Source (Rust)
│   ├── src/
│   │   ├── backlog.rs      # Backlog API Client
│   │   ├── commands.rs     # Tauri Commands
│   │   ├── db.rs           # Database Client
│   │   ├── log_commands.rs # Log Management Commands
│   │   ├── rate_limit.rs   # API Rate Limit Management
│   │   ├── scheduler.rs    # Background Scheduler
│   │   └── scoring.rs      # Scoring Logic
│   └── Cargo.toml          # Rust Dependencies
├── docs/                    # Documentation
│   ├── ARCHITECTURE.md     # Architecture Design
│   ├── COMPONENTS.md       # Component Specifications
│   ├── COMPONENT_RULES.md  # Component Rules
│   └── REQUIREMENTS.md     # Requirements Definition
├── README.md               # This file
└── README_JP.md            # Japanese README
```

## Documentation

- [Requirements](docs/REQUIREMENTS.md) - Project requirements and functional specifications
- [Architecture](docs/ARCHITECTURE.md) - System architecture details
- [Component Specs](docs/COMPONENTS.md) - UI component descriptions
- [Component Rules](docs/COMPONENT_RULES.md) - Development rules

## License

This project is intended for personal use.

## Developer Information

### Debugging
- Frontend: Use browser developer tools
- Backend: Logs are output via `tauri-plugin-log`

### Database
- SQLite database is stored at `~/Library/Application Support/com.tep-lab.project-lens/projectlens.db` (macOS)

### Build
```bash
# Development build (with debug info)
npm run tauri:dev

# Release build (optimized)
npm run tauri:build
```
