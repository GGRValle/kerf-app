/**
 * Tracks selected F-37 timeline event id per packet for the V1.5 shell (hash routing).
 */
let lastPacketId: string | null = null;
let selectedEventId = '';

export function v15F37GetSelectedEventId(packetId: string, defaultFirstId: string): string {
  if (lastPacketId !== packetId) {
    lastPacketId = packetId;
    selectedEventId = defaultFirstId;
  }
  if (selectedEventId.length === 0) {
    selectedEventId = defaultFirstId;
  }
  return selectedEventId;
}

export function v15F37SetSelectedEventId(id: string): void {
  selectedEventId = id;
}
