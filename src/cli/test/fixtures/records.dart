typedef SessionData = ({String draft, String phase});
typedef WorkspaceState = ({Map<String, SessionData> sessions, Set<String> contextFiles, int? retries});
typedef Pair<T> = ({T first, List<T> rest});
typedef Email = String;
