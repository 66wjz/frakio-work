const officialReleaseTagPattern = /^v\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/;

function compareReleaseTagsDesc(left, right) {
  const a = String(left || '').match(/\d+/g)?.map(Number) || [];
  const b = String(right || '').match(/\d+/g)?.map(Number) || [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] || 0) - (a[index] || 0);
    if (difference) return difference;
  }
  return String(right || '').localeCompare(String(left || ''));
}

export function parseOfficialHermesReleaseTags(raw, { limit = 20 } = {}) {
  const tags = new Map();
  for (const line of String(raw || '').split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]+)\s+refs\/tags\/([^\s^]+)(\^\{\})?$/i);
    if (!match || !officialReleaseTagPattern.test(match[2])) continue;
    const previous = tags.get(match[2]);
    if (!previous || match[3]) tags.set(match[2], { tag: match[2], commit: match[1] });
  }
  return [...tags.values()]
    .sort((left, right) => compareReleaseTagsDesc(left.tag, right.tag))
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 20)))
    .map(({ tag, commit }) => {
      const dateParts = tag.slice(1).split('.').slice(0, 3);
      const releaseDate = dateParts.length === 3
        ? `${dateParts[0]}-${dateParts[1].padStart(2, '0')}-${dateParts[2].padStart(2, '0')}`
        : '';
      return {
        tag,
        version: '',
        releaseDate,
        label: `Hermes ${tag}`,
        url: `https://github.com/NousResearch/hermes-agent/releases/tag/${tag}`,
        commit,
      };
    });
}

export function isOfficialHermesReleaseTag(value) {
  return officialReleaseTagPattern.test(String(value || '').trim());
}
