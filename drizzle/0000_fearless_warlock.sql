CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` integer,
	`details` text,
	`ip_address` text,
	`user_agent` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_logs_user_id_idx` ON `activity_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_action_idx` ON `activity_logs` (`action`);--> statement-breakpoint
CREATE INDEX `activity_logs_resource_type_idx` ON `activity_logs` (`resource_type`);--> statement-breakpoint
CREATE INDEX `activity_logs_resource_id_idx` ON `activity_logs` (`resource_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_created_at_idx` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_logs_resource_idx` ON `activity_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `activity_logs_user_action_idx` ON `activity_logs` (`user_id`,`action`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`note` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_user_issue_idx` ON `bookmarks` (`user_id`,`issue_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_user_id_idx` ON `bookmarks` (`user_id`);--> statement-breakpoint
CREATE INDEX `bookmarks_issue_id_idx` ON `bookmarks` (`issue_id`);--> statement-breakpoint
CREATE TABLE `cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cache_key_unique` ON `cache` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `cache_key_idx` ON `cache` (`key`);--> statement-breakpoint
CREATE INDEX `cache_expires_at_idx` ON `cache` (`expires_at`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backlog_comment_id` integer NOT NULL,
	`issue_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`content` text NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`backlog_data` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comments_backlog_comment_id_unique` ON `comments` (`backlog_comment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `comments_backlog_comment_id_idx` ON `comments` (`backlog_comment_id`);--> statement-breakpoint
CREATE INDEX `comments_issue_id_idx` ON `comments` (`issue_id`);--> statement-breakpoint
CREATE INDEX `comments_user_id_idx` ON `comments` (`user_id`);--> statement-breakpoint
CREATE INDEX `comments_is_internal_idx` ON `comments` (`is_internal`);--> statement-breakpoint
CREATE INDEX `comments_created_at_idx` ON `comments` (`created_at`);--> statement-breakpoint
CREATE TABLE `dashboards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`layout` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dashboards_user_name_idx` ON `dashboards` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `dashboards_user_id_idx` ON `dashboards` (`user_id`);--> statement-breakpoint
CREATE INDEX `dashboards_is_default_idx` ON `dashboards` (`is_default`);--> statement-breakpoint
CREATE INDEX `dashboards_is_public_idx` ON `dashboards` (`is_public`);--> statement-breakpoint
CREATE INDEX `dashboards_sort_order_idx` ON `dashboards` (`sort_order`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`original_name` text NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`issue_id` integer,
	`comment_id` integer,
	`is_temporary` integer DEFAULT false NOT NULL,
	`expires_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_path_unique` ON `files` (`path`);--> statement-breakpoint
CREATE UNIQUE INDEX `files_path_idx` ON `files` (`path`);--> statement-breakpoint
CREATE INDEX `files_hash_idx` ON `files` (`hash`);--> statement-breakpoint
CREATE INDEX `files_user_id_idx` ON `files` (`user_id`);--> statement-breakpoint
CREATE INDEX `files_issue_id_idx` ON `files` (`issue_id`);--> statement-breakpoint
CREATE INDEX `files_comment_id_idx` ON `files` (`comment_id`);--> statement-breakpoint
CREATE INDEX `files_is_temporary_idx` ON `files` (`is_temporary`);--> statement-breakpoint
CREATE INDEX `files_expires_at_idx` ON `files` (`expires_at`);--> statement-breakpoint
CREATE TABLE `issue_labels` (
	`issue_id` integer NOT NULL,
	`label_id` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`issue_id`, `label_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_labels_issue_id_idx` ON `issue_labels` (`issue_id`);--> statement-breakpoint
CREATE INDEX `issue_labels_label_id_idx` ON `issue_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backlog_issue_id` integer NOT NULL,
	`issue_key` text NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`issue_type` text NOT NULL,
	`assignee_id` integer,
	`creator_id` integer NOT NULL,
	`due_date` text,
	`start_date` text,
	`estimated_hours` real,
	`actual_hours` real,
	`tags` text DEFAULT '[]' NOT NULL,
	`is_bookmarked` integer DEFAULT false NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL,
	`custom_fields` text,
	`backlog_data` text NOT NULL,
	`last_sync_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issues_backlog_issue_id_unique` ON `issues` (`backlog_issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_issue_key_unique` ON `issues` (`issue_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_backlog_issue_id_idx` ON `issues` (`backlog_issue_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `issues_issue_key_idx` ON `issues` (`issue_key`);--> statement-breakpoint
CREATE INDEX `issues_project_id_idx` ON `issues` (`project_id`);--> statement-breakpoint
CREATE INDEX `issues_status_idx` ON `issues` (`status`);--> statement-breakpoint
CREATE INDEX `issues_priority_idx` ON `issues` (`priority`);--> statement-breakpoint
CREATE INDEX `issues_assignee_id_idx` ON `issues` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `issues_creator_id_idx` ON `issues` (`creator_id`);--> statement-breakpoint
CREATE INDEX `issues_due_date_idx` ON `issues` (`due_date`);--> statement-breakpoint
CREATE INDEX `issues_is_bookmarked_idx` ON `issues` (`is_bookmarked`);--> statement-breakpoint
CREATE INDEX `issues_is_archived_idx` ON `issues` (`is_archived`);--> statement-breakpoint
CREATE INDEX `issues_last_sync_at_idx` ON `issues` (`last_sync_at`);--> statement-breakpoint
CREATE INDEX `issues_title_search_idx` ON `issues` (`title`);--> statement-breakpoint
CREATE INDEX `issues_project_status_idx` ON `issues` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `issues_assignee_status_idx` ON `issues` (`assignee_id`,`status`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name_unique` ON `labels` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name_idx` ON `labels` (`name`);--> statement-breakpoint
CREATE INDEX `labels_is_system_idx` ON `labels` (`is_system`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`data` text,
	`is_read` integer DEFAULT false NOT NULL,
	`read_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_id_idx` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `notifications_type_idx` ON `notifications` (`type`);--> statement-breakpoint
CREATE INDEX `notifications_is_read_idx` ON `notifications` (`is_read`);--> statement-breakpoint
CREATE INDEX `notifications_created_at_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_unread_idx` ON `notifications` (`user_id`,`is_read`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backlog_project_id` integer NOT NULL,
	`project_key` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`color` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`settings` text,
	`last_sync_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_backlog_project_id_unique` ON `projects` (`backlog_project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_project_key_unique` ON `projects` (`project_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_backlog_project_id_idx` ON `projects` (`backlog_project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_project_key_idx` ON `projects` (`project_key`);--> statement-breakpoint
CREATE INDEX `projects_is_active_idx` ON `projects` (`is_active`);--> statement-breakpoint
CREATE INDEX `projects_is_favorite_idx` ON `projects` (`is_favorite`);--> statement-breakpoint
CREATE INDEX `projects_sort_order_idx` ON `projects` (`sort_order`);--> statement-breakpoint
CREATE INDEX `projects_last_sync_at_idx` ON `projects` (`last_sync_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`space_id` text NOT NULL,
	`remaining` integer NOT NULL,
	`total` integer NOT NULL,
	`reset_time` text NOT NULL,
	`window_start` text NOT NULL,
	`last_updated` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`endpoint` text,
	`method` text DEFAULT 'GET' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_space_id_idx` ON `rate_limits` (`space_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limits_space_endpoint_idx` ON `rate_limits` (`space_id`,`endpoint`,`method`);--> statement-breakpoint
CREATE INDEX `rate_limits_reset_time_idx` ON `rate_limits` (`reset_time`);--> statement-breakpoint
CREATE INDEX `rate_limits_last_updated_idx` ON `rate_limits` (`last_updated`);--> statement-breakpoint
CREATE INDEX `rate_limits_is_active_idx` ON `rate_limits` (`is_active`);--> statement-breakpoint
CREATE INDEX `rate_limits_active_space_idx` ON `rate_limits` (`is_active`,`space_id`);--> statement-breakpoint
CREATE INDEX `rate_limits_remaining_check` ON `rate_limits` (`remaining`);--> statement-breakpoint
CREATE INDEX `rate_limits_total_check` ON `rate_limits` (`total`);--> statement-breakpoint
CREATE TABLE `saved_searches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`query` text NOT NULL,
	`filters` text,
	`is_global` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_searches_user_name_idx` ON `saved_searches` (`user_id`,`name`);--> statement-breakpoint
CREATE INDEX `saved_searches_user_id_idx` ON `saved_searches` (`user_id`);--> statement-breakpoint
CREATE INDEX `saved_searches_is_global_idx` ON `saved_searches` (`is_global`);--> statement-breakpoint
CREATE INDEX `saved_searches_sort_order_idx` ON `saved_searches` (`sort_order`);--> statement-breakpoint
CREATE TABLE `search_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`query` text NOT NULL,
	`filters` text,
	`result_count` integer NOT NULL,
	`executed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `search_history_user_id_idx` ON `search_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `search_history_query_idx` ON `search_history` (`query`);--> statement-breakpoint
CREATE INDEX `search_history_executed_at_idx` ON `search_history` (`executed_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`data` text,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`user_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settings_key_user_idx` ON `settings` (`key`,`user_id`);--> statement-breakpoint
CREATE INDEX `settings_key_idx` ON `settings` (`key`);--> statement-breakpoint
CREATE INDEX `settings_user_id_idx` ON `settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` text NOT NULL,
	`project_id` integer,
	`sync_type` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`items_updated` integer DEFAULT 0 NOT NULL,
	`items_created` integer DEFAULT 0 NOT NULL,
	`items_deleted` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`error_details` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_logs_connection_id_idx` ON `sync_logs` (`connection_id`);--> statement-breakpoint
CREATE INDEX `sync_logs_project_id_idx` ON `sync_logs` (`project_id`);--> statement-breakpoint
CREATE INDEX `sync_logs_sync_type_idx` ON `sync_logs` (`sync_type`);--> statement-breakpoint
CREATE INDEX `sync_logs_status_idx` ON `sync_logs` (`status`);--> statement-breakpoint
CREATE INDEX `sync_logs_started_at_idx` ON `sync_logs` (`started_at`);--> statement-breakpoint
CREATE INDEX `sync_logs_completed_at_idx` ON `sync_logs` (`completed_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backlog_user_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`avatar` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen` text,
	`preferences` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_backlog_user_id_unique` ON `users` (`backlog_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_backlog_user_id_idx` ON `users` (`backlog_user_id`);--> statement-breakpoint
CREATE INDEX `users_email_idx` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_is_active_idx` ON `users` (`is_active`);--> statement-breakpoint
CREATE INDEX `users_last_seen_idx` ON `users` (`last_seen`);