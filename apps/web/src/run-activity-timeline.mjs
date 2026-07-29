export function activityTimelineEntries(group) {
  return (group.items || []).map((item) => ({ type: 'tool', id: item.id, item }));
}

export function buildRunActivityTimeline(content = '', groups = []) {
  const ordered = [...groups].sort((left, right) => left.contentOffset - right.contentOffset || String(left.createdAt).localeCompare(String(right.createdAt)));
  let cursor = 0;
  const timelineGroups = ordered.map((group) => {
    const offset = Math.max(cursor, Math.min(content.length, Number(group.contentOffset || 0)));
    const commentary = content.slice(cursor, offset);
    cursor = offset;
    return { group, commentary, hasFollowingText: content.length > offset };
  });
  return { groups: timelineGroups, tail: content.slice(cursor) };
}
