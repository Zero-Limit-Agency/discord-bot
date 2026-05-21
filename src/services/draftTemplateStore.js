const fs = require('node:fs');
const path = require('node:path');

const templatesRootPath = path.join(process.cwd(), 'templates');
const officialTemplatesDirectoryPath = path.join(templatesRootPath, 'discord');
const draftTemplatesDirectoryPath = path.join(templatesRootPath, 'drafts');

const existingTemplateDirectories = [
  officialTemplatesDirectoryPath,
  draftTemplatesDirectoryPath,
];

const ensureDraftDirectory = () => {
  fs.mkdirSync(draftTemplatesDirectoryPath, { recursive: true });
};

const slugifyTemplateName = (value) => {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return normalized || 'untitled-template';
};

const fileExistsInAnyTemplateDirectory = (slug) => existingTemplateDirectories.some((directoryPath) => (
  fs.existsSync(path.join(directoryPath, `${slug}.json`))
));

const buildUniqueSlug = (baseSlug) => {
  if (!fileExistsInAnyTemplateDirectory(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;

  while (fileExistsInAnyTemplateDirectory(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
};

const isSafeDraftPath = (filePath) => {
  const relativePath = path.relative(draftTemplatesDirectoryPath, filePath);
  return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
};

const saveDraftTemplate = (template) => {
  const templateName = typeof template?.name === 'string' ? template.name.trim() : '';
  const baseSlug = slugifyTemplateName(templateName);
  const slug = buildUniqueSlug(baseSlug);

  ensureDraftDirectory();

  const fileName = `${slug}.json`;
  const filePath = path.join(draftTemplatesDirectoryPath, fileName);

  if (!isSafeDraftPath(filePath)) {
    return {
      ok: false,
      code: 'UNSAFE_DRAFT_PATH',
      message: 'Draft path is invalid.',
    };
  }

  fs.writeFileSync(filePath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    slug,
    relativePath: path.join('templates', 'drafts', fileName),
    absolutePath: filePath,
  };
};

module.exports = {
  draftTemplatesDirectoryPath,
  officialTemplatesDirectoryPath,
  slugifyTemplateName,
  saveDraftTemplate,
};
