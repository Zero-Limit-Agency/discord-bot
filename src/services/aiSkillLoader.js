const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const skillsDirectoryPath = path.join(process.cwd(), 'src', 'ai-skills');
const defaultMaxCharacters = 12000;
const minimalMaxCharacters = 2000;

const skillMatchers = {
  'discordEsportPatterns.md': /\b(esport|team|player|players|scrim|scrims|tournament|competitive|roster|coach)\b/i,
  'discordCommunityPatterns.md': /\b(community|public|member|members|social|server community)\b/i,
  'discordTicketPatterns.md': /\b(ticket|tickets|support|helpdesk|help)\b/i,
  'discordPremiumPatterns.md': /\b(premium|vip|exclusive|subscriber)\b/i,
  'discordVoicePatterns.md': /\b(voice|vocal|lounge|call|meeting room)\b/i,
  'discordOnboardingPatterns.md': /\b(onboarding|welcome|rules|start here|how to use)\b/i,
};

const alwaysIncludeCompact = [
  'discordServerBriefing.md',
  'discordArchitectureRules.md',
  'discordPermissionDoctrine.md',
  'discordNamingRules.md',
];

const listSkillFiles = () => {
  if (!fs.existsSync(skillsDirectoryPath)) {
    return [];
  }

  return fs.readdirSync(skillsDirectoryPath)
    .filter((fileName) => fileName.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));
};

const readSkillContent = (fileName) => {
  const filePath = path.join(skillsDirectoryPath, fileName);
  return fs.readFileSync(filePath, 'utf8').trim();
};

const compactSkillContent = (content) => {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines.find((line) => line.startsWith('#')) || '';
  const bullets = lines.filter((line) => line.startsWith('-')).slice(0, 8);
  const body = [];

  if (title) {
    body.push(title);
  }

  body.push(...bullets);

  return body.join('\n');
};

const normalizeMode = (mode) => {
  const normalized = String(mode || '').trim().toLowerCase();

  if (['off', 'minimal', 'compact', 'full'].includes(normalized)) {
    return normalized;
  }

  return 'compact';
};

const minimalSkillContent = (content) => {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines.find((line) => line.startsWith('#')) || '';
  const bullets = lines.filter((line) => line.startsWith('-')).slice(0, 4);
  const body = [];

  if (title) {
    body.push(title);
  }

  body.push(...bullets);

  return body.join('\n');
};

const selectSkillFiles = (promptContext, mode, allSkillFiles) => {
  if (mode === 'off') {
    return [];
  }

  if (mode === 'full') {
    return allSkillFiles;
  }

  const selected = new Set(alwaysIncludeCompact.filter((fileName) => allSkillFiles.includes(fileName)));

  Object.entries(skillMatchers).forEach(([fileName, matcher]) => {
    if (allSkillFiles.includes(fileName) && matcher.test(promptContext)) {
      selected.add(fileName);
    }
  });

  return Array.from(selected);
};

const loadAiSkillsBlock = (options = {}) => {
  const mode = normalizeMode(options.mode ?? config.aiSkillsMode);
  const promptContext = String(options.promptContext || '').trim();
  const maxCharacters = Number.isInteger(options.maxCharacters) && options.maxCharacters > 0
    ? options.maxCharacters
    : config.aiSkillsMaxChars;
  const fallbackMaxCharacters = mode === 'minimal' ? minimalMaxCharacters : defaultMaxCharacters;
  const safeMaxCharacters = Number.isInteger(maxCharacters) && maxCharacters > 0
    ? maxCharacters
    : fallbackMaxCharacters;
  const allSkillFiles = listSkillFiles();
  const selectedSkillFiles = selectSkillFiles(promptContext, mode, allSkillFiles);
  const sections = [];
  let currentLength = 0;
  let truncated = false;

  for (const fileName of selectedSkillFiles) {
    const fullContent = readSkillContent(fileName);
    const content = mode === 'minimal'
      ? minimalSkillContent(fullContent)
      : mode === 'compact'
        ? compactSkillContent(fullContent)
        : fullContent;
    const section = `--- SKILL: ${fileName} ---\n${content}\n`;

    if (currentLength + section.length > safeMaxCharacters) {
      truncated = true;
      break;
    }

    sections.push(section);
    currentLength += section.length;
  }

  return {
    enabled: mode !== 'off' && config.aiSkillsEnabled !== false,
    mode,
    skillFiles: selectedSkillFiles,
    selectedSkills: selectedSkillFiles,
    truncated,
    chars: currentLength,
    maxChars: safeMaxCharacters,
    content: mode === 'off' ? '' : sections.join('\n'),
  };
};

module.exports = {
  loadAiSkillsBlock,
};
