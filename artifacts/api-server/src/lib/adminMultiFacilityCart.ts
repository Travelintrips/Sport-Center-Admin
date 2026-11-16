/**
 * Pure booking-cart validation shared by the admin multi-schedule route and tests.
 * Different facilities may use the same time; one facility may not overlap itself.
 */
export type AdminCartSession = {
  facilityId: number;
  date: string;
  startTime: string;
  durationHours: number;
};

const minute = (value: string): number => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

export function hasAdminCartOverlap(sessions: ReadonlyArray<AdminCartSession>): boolean {
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const first = sessions[i]!;
      const second = sessions[j]!;
      if (
        first.facilityId === second.facilityId &&
        first.date === second.date &&
        minute(first.startTime) < minute(second.startTime) + second.durationHours * 60 &&
        minute(second.startTime) < minute(first.startTime) + first.durationHours * 60
      ) return true;
    }
  }
  return false;
}

export function adminCartLockKeys(sessions: ReadonlyArray<AdminCartSession>): Array<{ facilityId: number; date: string }> {
  const unique = new Map<string, { facilityId: number; date: string }>();
  for (const item of sessions) {
    unique.set(item.facilityId + ":" + item.date, {
      facilityId: item.facilityId,
      date: item.date,
    });
  }
  return [...unique.values()].sort((a, b) => a.facilityId - b.facilityId || a.date.localeCompare(b.date));
}
