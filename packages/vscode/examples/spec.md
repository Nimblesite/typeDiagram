# TODO List App — Specification

A minimal single-user TODO list application. Users create lists, add tasks, mark them complete, set due dates, attach tags, and filter/search across their workspace. Data persists locally; sync is out of scope for v1.

## Overview

The app is organized around a **Workspace** that owns many **TodoLists**. Each list owns many **Tasks**. Tasks carry status, priority, optional due dates, optional descriptions, and tags. The UI is a three-pane layout (sidebar of lists, task table, detail pane) backed by a command/event architecture.

---

## 1. Domain Model

The core nouns of the app and how they nest.

```typediagram
typeDiagram

# Top-level container — one per user, persisted to disk
type Workspace {
  id:         WorkspaceId
  name:       String
  lists:      List<TodoList>
  tags:       List<Tag>
  settings:   WorkspaceSettings
  created_at: Timestamp
  updated_at: Timestamp
}

type TodoList {
  id:          ListId
  name:        String
  description: Option<String>
  color:       ListColor
  tasks:       List<Task>
  archived:    Bool
  created_at:  Timestamp
}

type Task {
  id:          TaskId
  list_id:     ListId
  title:       String
  description: Option<String>
  status:      TaskStatus
  priority:    Priority
  due:         Option<DueDate>
  tags:        List<TagId>
  position:    Int
  created_at:  Timestamp
  updated_at:  Timestamp
  completed_at: Option<Timestamp>
}

type Tag {
  id:    TagId
  label: String
  color: TagColor
}

type WorkspaceSettings {
  theme:           Theme
  default_view:    ViewMode
  week_start:      Weekday
  show_completed:  Bool
  notifications:   NotificationPrefs
}

alias WorkspaceId = String
alias ListId      = String
alias TaskId      = String
alias TagId       = String
alias Timestamp   = String
```

---

## 2. Task State, Priority & Scheduling

Enumerations and small value types that describe a single task's lifecycle.

```typediagram
typeDiagram

# A task moves through these states
union TaskStatus {
  Pending
  InProgress { started_at: Timestamp }
  Blocked    { reason: String }
  Done       { completed_at: Timestamp }
  Cancelled  { reason: Option<String> }
}

union Priority {
  Low
  Medium
  High
  Urgent
}

# Due dates are richer than just a date
union DueDate {
  OnDate     { date: Date }
  OnDateTime { at: Timestamp, timezone: String }
  Recurring  { rule: RecurrenceRule, next: Date }
}

type RecurrenceRule {
  freq:     Frequency
  interval: Int
  until:    Option<Date>
  weekdays: Option<List<Weekday>>
}

union Frequency {
  Daily
  Weekly
  Monthly
  Yearly
}

union Weekday {
  Mon
  Tue
  Wed
  Thu
  Fri
  Sat
  Sun
}

alias Date = String
```

---

## 3. Filtering, Sorting & Views

How the user slices their tasks. Every view is a pure function of `Workspace + ViewSpec`.

```typediagram
typeDiagram

type ViewSpec {
  scope:  ViewScope
  filter: TaskFilter
  sort:   SortSpec
  group:  Option<GroupBy>
}

union ViewScope {
  AllLists
  SingleList { list_id: ListId }
  Today
  Upcoming   { days: Int }
  Overdue
  Tag        { tag_id: TagId }
  Search     { query: String }
}

type TaskFilter {
  status:        Option<List<TaskStatus>>
  priority:      Option<List<Priority>>
  tags_any:      Option<List<TagId>>
  tags_all:      Option<List<TagId>>
  has_due_date:  Option<Bool>
  text_contains: Option<String>
}

type SortSpec {
  key:   SortKey
  order: SortOrder
}

union SortKey {
  Position
  CreatedAt
  UpdatedAt
  DueDate
  Priority
  Title
}

union SortOrder {
  Asc
  Desc
}

union GroupBy {
  None
  ByList
  ByStatus
  ByPriority
  ByDueBucket
  ByTag
}

union ViewMode {
  Table
  Board
  Calendar
}
```

---

## 4. Commands (Write Path)

Every state mutation flows through a single tagged-union command type. The reducer pattern-matches on it.

```typediagram
typeDiagram

union Command {
  CreateList    { name: String, color: ListColor }
  RenameList    { list_id: ListId, name: String }
  ArchiveList   { list_id: ListId }
  DeleteList    { list_id: ListId }

  CreateTask    { list_id: ListId, title: String, priority: Priority }
  EditTask      { task_id: TaskId, patch: TaskPatch }
  MoveTask      { task_id: TaskId, to_list: ListId, position: Int }
  CompleteTask  { task_id: TaskId, at: Timestamp }
  ReopenTask    { task_id: TaskId }
  DeleteTask    { task_id: TaskId }

  AddTag        { task_id: TaskId, tag_id: TagId }
  RemoveTag     { task_id: TaskId, tag_id: TagId }
  CreateTag     { label: String, color: TagColor }

  UpdateSettings { patch: SettingsPatch }
}

# Patches are partial updates — every field is optional
type TaskPatch {
  title:       Option<String>
  description: Option<String>
  priority:    Option<Priority>
  due:         Option<DueDate>
  status:      Option<TaskStatus>
}

type SettingsPatch {
  theme:          Option<Theme>
  default_view:   Option<ViewMode>
  show_completed: Option<Bool>
}
```

---

## 5. Events (Read Path & History)

Commands produce events. Events are the source of truth for undo/redo and audit.

```typediagram
typeDiagram

type Event {
  id:        EventId
  at:        Timestamp
  payload:   EventPayload
  causation: Option<CommandId>
}

union EventPayload {
  ListCreated     { list: TodoList }
  ListRenamed     { list_id: ListId, name: String }
  ListArchived    { list_id: ListId }
  ListDeleted     { list_id: ListId }

  TaskCreated     { task: Task }
  TaskEdited      { task_id: TaskId, patch: TaskPatch }
  TaskMoved       { task_id: TaskId, from: ListId, to: ListId }
  TaskCompleted   { task_id: TaskId, at: Timestamp }
  TaskReopened    { task_id: TaskId }
  TaskDeleted     { task_id: TaskId }

  TagAdded        { task_id: TaskId, tag_id: TagId }
  TagRemoved      { task_id: TaskId, tag_id: TagId }
  TagCreated      { tag: Tag }

  SettingsUpdated { patch: SettingsPatch }
}

alias EventId   = String
alias CommandId = String
```

---

## 6. UI State

Ephemeral UI state — selection, modals, drag/drop, etc. Separate from domain state.

```typediagram
typeDiagram

type UiState {
  selected_list:    Option<ListId>
  selected_task:    Option<TaskId>
  view:             ViewSpec
  sidebar_open:     Bool
  detail_pane_open: Bool
  modal:            Option<Modal>
  drag:             Option<DragState>
  toast:            Option<Toast>
}

union Modal {
  NewList        { draft: NewListDraft }
  EditTask       { task_id: TaskId, draft: TaskPatch }
  ConfirmDelete  { target: DeleteTarget }
  TagPicker      { task_id: TaskId }
  Settings
}

union DeleteTarget {
  List { list_id: ListId }
  Task { task_id: TaskId }
  Tag  { tag_id: TagId }
}

type NewListDraft {
  name:  String
  color: ListColor
}

type DragState {
  task_id:    TaskId
  origin:     ListId
  hover_list: Option<ListId>
  hover_pos:  Option<Int>
}

type Toast {
  kind:    ToastKind
  message: String
  ttl_ms:  Int
}

union ToastKind {
  Info
  Success
  Warning
  Error
}
```

---

## 7. Persistence & Storage

How state hits disk. The store is pluggable so we can swap LocalStorage for IndexedDB or a file backend.

```typediagram
typeDiagram

type StorageDriver {
  kind:    StorageKind
  version: Int
}

union StorageKind {
  Memory
  LocalStorage { namespace: String }
  IndexedDb    { db_name: String, store: String }
  FileSystem   { path: String }
}

union LoadResult {
  Loaded         { workspace: Workspace, schema_version: Int }
  Empty
  MigrationNeeded { from: Int, to: Int }
  Corrupt        { error: StorageError }
}

union SaveResult {
  Saved      { at: Timestamp }
  Failed     { error: StorageError }
  Throttled  { retry_after_ms: Int }
}

union StorageError {
  QuotaExceeded
  PermissionDenied
  Serialization { message: String }
  Io            { message: String }
}
```

---

## 8. Notifications

Reminders for due tasks. Permission flow and delivery channels.

```typediagram
typeDiagram

type NotificationPrefs {
  enabled:        Bool
  remind_before:  List<ReminderOffset>
  channels:       List<NotificationChannel>
  quiet_hours:    Option<QuietHours>
}

union ReminderOffset {
  AtDueTime
  Minutes { value: Int }
  Hours   { value: Int }
  Days    { value: Int }
}

union NotificationChannel {
  Browser
  System
  Email { address: EmailAddress }
}

type QuietHours {
  start: TimeOfDay
  end:   TimeOfDay
}

union PermissionStatus {
  Granted
  Denied
  Default
  Unsupported
}

alias EmailAddress = String
alias TimeOfDay    = String
```

---

## 9. Theming & Visual Tokens

Small enums that pin down the visual surface area.

```typediagram
typeDiagram

union Theme {
  Light
  Dark
  System
}

union ListColor {
  Slate
  Red
  Amber
  Green
  Teal
  Blue
  Indigo
  Pink
}

union TagColor {
  Neutral
  Red
  Yellow
  Green
  Blue
  Purple
}
```

---

## 10. Result & Option

Generic helpers used everywhere — no exceptions cross module boundaries.

```typediagram
typeDiagram

union Option<T> {
  Some { value: T }
  None
}

union Result<T, E> {
  Ok  { value: T }
  Err { error: E }
}
```
