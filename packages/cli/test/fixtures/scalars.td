type AuditEvent {
  id: Uuid
  createdAt: DateTime
  amount: Decimal
  parent: Option<Uuid>
  history: List<DateTime>
}
