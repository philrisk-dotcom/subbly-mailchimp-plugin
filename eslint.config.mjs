import json from '@eslint/json'
import markdown from '@eslint/markdown'
import subbly from '@subbly/plugin-lint/eslint'

const gate = {
  'subbly/errors': 'error',
  'subbly/warnings': 'warn',
}

export default [
  {
    ignores: ['node_modules/**', '**/node_modules/**', 'schemas/**'],
  },
  {
    files: ['marketplace.json', 'plugins/**/*.json'],
    language: 'json/json',
    plugins: { json, subbly },
    rules: {
      ...gate,
      'json/no-duplicate-keys': 'error',
      'json/no-empty-keys': 'error',
    },
  },
  {
    files: ['plugins/**/*.md'],
    language: 'markdown/gfm',
    languageOptions: { frontmatter: 'yaml' },
    plugins: { markdown, subbly },
    rules: gate,
  },
]
