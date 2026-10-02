// Copy compatible old saves without deleting their original recovery keys.
export function resolveWritingDraft(drafts, { activityId, grade, lesson, topic }) {
  const key = `${activityId}:${grade}:${lesson}:${topic.id}`;
  if (drafts[key]) return { key, draft: drafts[key] };
  const prefix = `${activityId === 'paragraphBuilder' ? 'paragraph' : 'composition'}:${grade}:${lesson}:`;
  const legacy = Object.entries(drafts).find(([oldKey, draft]) => oldKey.startsWith(prefix) &&
    (draft.essayId ? draft.essayId === topic.id : draft.title === topic.title));
  return { key, draft: legacy ? { ...structuredClone(legacy[1]), migratedFrom: legacy[0], essayId: topic.id } : undefined };
}
