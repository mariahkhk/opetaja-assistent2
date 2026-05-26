import js from '@eslint/js'
import globals from 'globals'
import security from 'eslint-plugin-security'
import noUnsanitized from 'eslint-plugin-no-unsanitized'

export default [
  js.configs.recommended,
  security.configs.recommended,
  noUnsanitized.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      'no-useless-catch': 'off',
      indent: 'off',
      'linebreak-style': ['error', 'unix'],
      quotes: 'off',
      semi: ['error', 'never'],
      'max-len': [
        'warn',
        {
          code: 155,
          ignoreComments: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreRegExpLiterals: true,
          ignoreUrls: true
        }
      ],
      'comma-dangle': 'off',
      'comma-spacing': ['error', { before: false, after: true }],
      'comma-style': ['error', 'last'],
      'eol-last': ['error', 'always'],
      'key-spacing': ['error', { beforeColon: false, afterColon: true }],
      'keyword-spacing': ['error', { before: true, after: true }],
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],
      'object-curly-spacing': ['error', 'always'],
      'space-before-blocks': 'error',
      'space-before-function-paren': ['error', { anonymous: 'never', named: 'never', asyncArrow: 'never' }],
      'space-in-parens': ['error', 'never'],
      'space-infix-ops': 'error',
      'arrow-spacing': ['error', { before: true, after: true }],
      'arrow-parens': ['error', 'as-needed'],
      'arrow-body-style': ['error', 'as-needed'],
      'brace-style': 'off',
      'function-call-argument-newline': 'off',
      'function-paren-newline': 'off',
      'object-property-newline': ['error', { allowAllPropertiesOnSameLine: true }],
      'array-bracket-newline': ['error', 'consistent'],
      'array-element-newline': ['error', 'consistent'],
      'operator-linebreak': ['error', 'after', { overrides: { '?': 'before', ':': 'before' } }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      camelcase: 'off',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'no-console': 'off',
      eqeqeq: 'off',
      curly: 'off',
      'no-else-return': 'off',
      'no-empty': 'warn',
      'no-undef': 'error',
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'security/detect-object-injection': 'off'
    }
  },
  {
    files: ['**/Logger.js'],
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['**/build.js', '**/watch.js'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off'
    }
  },
  {
    files: ['tests/e2e/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: 'readonly'
      }
    }
  }
]
