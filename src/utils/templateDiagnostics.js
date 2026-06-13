const MAX_FIELD_LENGTH = 1024;

const uniqueDiagnostics = (items = []) => {
  const seen = new Set();

  return items
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .filter((item) => {
      const normalized = item.toLowerCase();

      if (seen.has(normalized)) {
        return false;
      }

      seen.add(normalized);
      return true;
    });
};

const summarizeDiagnostics = (items = [], options = {}) => {
  const {
    limit = 3,
    fallback = 'None detected.',
  } = options;
  const unique = uniqueDiagnostics(items);

  if (!unique.length) {
    return fallback;
  }

  const visible = unique.slice(0, limit).map((item) => `- ${item}`);

  if (unique.length > limit) {
    visible.push(`- ...and ${unique.length - limit} more`);
  }

  return visible.join('\n').slice(0, MAX_FIELD_LENGTH);
};

const countDiagnostics = (items = []) => uniqueDiagnostics(items).length;

const inferTemplateStatus = (diagnostics = {}, options = {}) => {
  const {
    blocked = false,
    failed = false,
  } = options;

  if (failed) {
    return 'failed';
  }

  if (blocked) {
    return 'blocked';
  }

  const repaired = countDiagnostics([
    ...(diagnostics.normalizationWarnings || []),
    ...(diagnostics.repairWarnings || []),
  ]) > 0;

  return repaired ? 'repaired' : 'valid';
};

const getPrimaryIssue = (...diagnosticGroups) => {
  for (const group of diagnosticGroups) {
    const [first] = uniqueDiagnostics(group);

    if (first) {
      return first;
    }
  }

  return null;
};

const formatFailureMessage = (title, options = {}) => {
  const {
    errors = [],
    warnings = [],
    suggestion = 'Corrige le template ou relance une generation.',
  } = options;
  const primaryIssue = getPrimaryIssue(errors, warnings);

  if (!primaryIssue) {
    return title;
  }

  return `${title}\nCause: ${primaryIssue}\n${suggestion}`;
};

module.exports = {
  uniqueDiagnostics,
  summarizeDiagnostics,
  countDiagnostics,
  inferTemplateStatus,
  getPrimaryIssue,
  formatFailureMessage,
};
